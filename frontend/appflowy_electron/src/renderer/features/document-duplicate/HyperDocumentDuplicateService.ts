import { create, fromJsonString, toJsonString } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import type { FlowyResult } from '@/backend/dispatch';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentCustomSchedule, hyperDocumentDateDraft, hyperDocumentDateSchedule, hyperParseMentionDate } from '../document-date/HyperDocumentDateValue';
import { hyperDuplicateDateBinding, hyperDuplicateDateReferences, hyperDuplicateDocumentSnapshot, hyperDuplicateReminderId, hyperDuplicateStable, type HyperDuplicateDateReference } from './HyperDocumentDuplicateModel';

export interface HyperDuplicateOptions { view: Pick<ViewPB, 'id'>; openAfterDuplicate: boolean; includeChildren: boolean; parentViewId?: string; suffix?: string; syncAfterDuplicate: boolean; owner?: HyperDocumentOwner | null }
export type HyperDuplicateCheck = <T>(operation: () => Promise<T>) => Promise<T>;
export interface HyperDocumentDuplicateBackend {
  owner(): HyperDocumentOwner | null;
  /** Monotonic launch/owner revision also rejects an away-and-back transition. */
  ownerVersion?(): number;
  identity(check: HyperDuplicateCheck): Promise<{ workspaceId: string; actorId: string }>;
  writable(id: string, owner: HyperDocumentOwner, check: HyperDuplicateCheck): Promise<void>;
  view(id: string): Promise<ViewPB>;
  views(): Promise<ViewPB[]>;
  flush(id: string, owner: HyperDocumentOwner): Promise<void>;
  document(id: string): Promise<DocumentDataPB>;
  reminders(): Promise<ReminderPB[]>;
  create(reminder: ReminderPB): Promise<void>;
  duplicate(options: HyperDuplicateOptions): Promise<ViewPB>;
  open(id: string): Promise<void>;
  changed(): void;
}
interface PreparedReference { source: HyperDuplicateDateReference; reminder: string; sourceStamp: string | null }
interface SourceNode { id: string; name: string; layout: ViewLayoutPB; digest?: string; references: PreparedReference[]; children: SourceNode[] }
interface TargetDocument { id: string; references: { source: HyperDuplicateDateReference; desired: string }[] }
export interface HyperDocumentDuplicatePlan {
  id: string; ownerKey: string; workspaceId: string; actorId: string; source: SourceNode; parentId: string; baseline: string[]; expectedName: string;
  rootId: string | null; targets: TargetDocument[] | null; includeChildren: boolean; openAfterDuplicate: boolean; error: string;
}
export interface HyperDocumentDuplicateState { busy: boolean; ownerKey: string; plans: HyperDocumentDuplicatePlan[]; error: string | null }
export interface HyperDuplicateCandidate { id: string; name: string }
const ownerKey = (owner: HyperDocumentOwner | null) => owner ? JSON.stringify([owner.workspaceId, owner.actorId, owner.contextKey]) : '';
const message = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
const failure = (error: unknown): FlowyResult<never> => ({ ok: false, error: create(FlowyErrorSchema, { code: ErrorCode.Internal, msg: message(error) }) });
const ownedReminder = (reminder: ReminderPB) => hyperDuplicateStable({ id: reminder.id, objectId: reminder.objectId, scheduledAt: String(reminder.scheduledAt), block: reminder.meta.block_id ?? null, row: reminder.meta.row_id ?? null, date: reminder.meta.date ?? null, includeTime: reminder.meta.include_time ?? null });
const dateLayout = (layout: ViewLayoutPB) => layout === ViewLayoutPB.Document;
const serializeReminder = (reminder: ReminderPB) => hyperDuplicateStable(JSON.parse(toJsonString(ReminderPBSchema, reminder)));

/** Copy initialization belongs to native creation; this service only creates independent timers.
 * Plans survive pane closure in memory. Closing the app discards them; Copy exports recovery. */
export class HyperDocumentDuplicateService {
  readonly store = createStore<HyperDocumentDuplicateState>(() => ({ busy: false, ownerKey: '', plans: [], error: null }));
  private running = new Map<string, Promise<FlowyResult<ViewPB>>>();
  constructor(private readonly backend: HyperDocumentDuplicateBackend) {}
  private access(owner: HyperDocumentOwner) {
    const key = ownerKey(owner), version = this.backend.ownerVersion?.(); let lost = false;
    const current = () => { if (lost || this.backend.ownerVersion?.() !== version || !owner.isCurrent() || ownerKey(this.backend.owner()) !== key) { lost = true; throw new Error('The workspace or account changed. The copy recovery was kept for its original owner.'); } };
    const check: HyperDuplicateCheck = async operation => { current(); const value = await operation(); current(); return value; };
    const identity = async () => { current(); const value = await this.backend.identity(check); current(); if (value.workspaceId !== owner.workspaceId || value.actorId !== owner.actorId) { lost = true; throw new Error('The active workspace or account changed.'); } };
    const writable = async (id: string) => { await identity(); await check(() => this.backend.writable(id, owner, check)); await identity(); };
    return { key, current, check, identity, writable };
  }
  private async readSource(id: string, includeChildren: boolean, owner: HyperDocumentOwner): Promise<SourceNode> {
    const access = this.access(owner), visited = new Set<string>(), sidecars = await access.check(() => this.backend.reminders());
    const visit = async (id: string): Promise<SourceNode> => {
      if (visited.has(id) || visited.size >= 2000) throw new Error('The copy contains repeated pages or more than 2,000 pages.'); visited.add(id);
      const view = await access.check(() => this.backend.view(id));
      if (view.id !== id || view.layout === ViewLayoutPB.Chat) throw new Error('This page cannot be copied.');
      const node: SourceNode = { id, name: view.name, layout: view.layout, references: [], children: [] };
      if (dateLayout(view.layout)) {
        await access.check(() => this.backend.flush(id, owner));
        const snapshot = hyperDuplicateDocumentSnapshot(await access.check(() => this.backend.document(id))); node.digest = snapshot.digest;
        if (snapshot.references.length > 10_000) throw new Error('This page has more than 10,000 reminders.');
        for (const ref of snapshot.references) {
          const found = sidecars.filter(reminder => reminder.id === ref.id);
          if (found.length > 1) throw new Error('A reminder ID has multiple timer records. The source page was kept.');
          const previous = found[0];
          if (previous && (previous.objectId !== id || previous.meta.block_id && previous.meta.block_id !== ref.blockId || previous.meta.row_id)) throw new Error('A reminder is bound to another page, block or row. The source timer was kept.');
          const draft = hyperDocumentDateDraft(ref.mention);
          if (draft.reminderOption === 'none') throw new Error('A date has a reminder ID without an active reminder option. Finish its reminder updates before copying.');
          const custom = draft.reminderOption === 'custom' ? hyperDocumentCustomSchedule(ref.attributes) : null;
          if (custom !== null && previous && custom !== previous.scheduledAt) throw new Error('A custom date and its timer have different schedules. Finish its reminder updates before copying.');
          const scheduledAt = previous?.scheduledAt ?? custom ?? (draft.reminderOption === 'custom' ? null : hyperDocumentDateSchedule(draft, ref.mention.date));
          if (scheduledAt === null || draft.reminderOption === 'custom' && !previous && custom === null) throw new Error('The original custom reminder time is unavailable. Set its time explicitly before copying.');
          const date = hyperParseMentionDate(ref.mention.date); if (!Number.isFinite(date.getTime())) throw new Error('A reminder has an invalid date. Its source data was kept.');
          node.references.push({ source: ref, sourceStamp: previous ? ownedReminder(previous) : null, reminder: serializeReminder(create(ReminderPBSchema, { ...previous, id: ref.id, objectId: id, scheduledAt, title: previous?.title || 'Reminder', message: previous?.message || 'You have a reminder.', isAck: previous?.isAck ?? Number(scheduledAt) * 1000 < Date.now(), isRead: previous?.isRead ?? false, meta: { ...previous?.meta, block_id: ref.blockId, include_time: previous?.meta.include_time ?? String(ref.mention.include_time === true), date: previous?.meta.date ?? String(date.getTime()), created_at: previous?.meta.created_at ?? String(date.getTime()) } })) });
        }
      }
      if (includeChildren) for (const child of view.childViews.filter(child => child.layout !== ViewLayoutPB.Chat)) node.children.push(await visit(child.id));
      return node;
    };
    const source = await visit(id); await access.identity(); return source;
  }
  /** Space duplication preflights its whole accessible subtree before creating a container. */
  async preflight(viewId: string, owner: HyperDocumentOwner): Promise<void> {
    const access = this.access(owner);
    try {
      if (this.store.getState().busy || this.store.getState().plans.some(plan => plan.ownerKey === access.key)) throw new Error('Finish the pending copy recovery before duplicating another space.');
      await access.identity(); await access.writable(owner.workspaceId); await this.readSource(viewId, true, owner);
    }
    catch (error) { this.store.setState({ ownerKey: access.key, error: message(error) }); throw error; }
  }
  duplicate(options: HyperDuplicateOptions): Promise<FlowyResult<ViewPB>> {
    const owner = options.owner === undefined ? this.backend.owner() : options.owner;
    if (!owner?.isCurrent()) return Promise.resolve(failure(new Error('The workspace or account changed. Reopen the page.')));
    const key = ownerKey(owner), requestKey = JSON.stringify([key, options.view.id, options.parentViewId ?? '']);
    const existing = this.running.get(requestKey); if (existing) return existing;
    if (this.store.getState().busy || this.store.getState().plans.some(plan => plan.ownerKey === key)) return Promise.resolve(failure(new Error('Finish the pending copy recovery before duplicating another page.')));
    const run = this.execute(options, owner); this.running.set(requestKey, run);
    void run.finally(() => { if (this.running.get(requestKey) === run) this.running.delete(requestKey); });
    return run;
  }
  private async execute(options: HyperDuplicateOptions, owner: HyperDocumentOwner): Promise<FlowyResult<ViewPB>> {
    const access = this.access(owner); let plan: HyperDocumentDuplicatePlan | undefined, sent = false;
    this.store.setState({ busy: true, ownerKey: access.key, error: null });
    try {
      await access.identity(); const sourceView = await access.check(() => this.backend.view(options.view.id));
      const parentId = options.parentViewId ?? sourceView.parentViewId; await access.writable(parentId);
      const baseline = (await access.check(() => this.backend.views())).filter(view => view.parentViewId === parentId).map(view => view.id);
      const source = await this.readSource(sourceView.id, options.includeChildren, owner);
      await access.writable(parentId);
      // Catch observed edits or tree changes during preflight; native does not provide a snapshot transaction.
      if (hyperDuplicateStable(source) !== hyperDuplicateStable(await this.readSource(sourceView.id, options.includeChildren, owner))) throw new Error('The source changed while preparing the copy. Try again after its edits finish.');
      plan = { id: crypto.randomUUID(), ownerKey: access.key, workspaceId: owner.workspaceId, actorId: owner.actorId, source, parentId, baseline, expectedName: `${source.name || 'Untitled'}${options.suffix ?? ' (copy)'}`, rootId: null, targets: null, includeChildren: options.includeChildren, openAfterDuplicate: options.openAfterDuplicate, error: '' };
      this.store.setState(state => ({ plans: [...state.plans, plan!] }));
      await access.identity(); sent = true;
      // This is dispatched once. Any rejection after dispatch is an uncertain copy, never a replay.
      const root = await this.backend.duplicate({ ...options, openAfterDuplicate: false });
      plan.rootId = root.id; access.current();
      await this.finish(plan, owner);
      return { ok: true, value: root };
    } catch (error) {
      if (plan && sent) { plan.error = `The copy was not fully confirmed. ${message(error)} The source timers were kept. Closing the app discards this recovery; copy its details first.`; this.store.setState(state => ({ plans: [...state.plans], error: plan!.error })); }
      else { if (plan) this.remove(plan.id); this.store.setState({ error: message(error) }); }
      return failure(error);
    } finally { this.store.setState({ busy: false }); }
  }
  private async validateTargets(plan: HyperDocumentDuplicatePlan, owner: HyperDocumentOwner): Promise<TargetDocument[]> {
    if (!plan.rootId || plan.baseline.includes(plan.rootId)) throw new Error('Select a newly created copy, not an existing source page.');
    const access = this.access(owner), targets: TargetDocument[] = [], visited = new Set<string>();
    const visit = async (source: SourceNode, id: string, parentId: string, root = false) => {
      if (visited.has(id) || id === source.id) throw new Error('The selected copy contains an invalid page binding.'); visited.add(id);
      const view = await access.check(() => this.backend.view(id));
      if (view.id !== id || view.parentViewId !== parentId || view.layout !== source.layout || view.name !== (root ? plan.expectedName : source.name)) throw new Error('The selected page does not match this copy.');
      const children = plan.includeChildren ? view.childViews.filter(view => view.layout !== ViewLayoutPB.Chat) : [];
      if (children.length !== source.children.length) throw new Error('The copied subtree is incomplete or changed. No timers were guessed.');
      if (source.digest !== undefined) {
        const doc = await access.check(() => this.backend.document(id)), snapshot = hyperDuplicateDocumentSnapshot(doc);
        if (snapshot.digest !== source.digest || snapshot.references.length !== source.references.length) throw new Error('The copied document differs from the captured source. Its content was kept.');
        const references = source.references.map(prepared => {
          const expectedId = hyperDuplicateReminderId(id, prepared.source.blockId, prepared.source.offset, prepared.source.id), actual = snapshot.references.find(ref => ref.blockId === prepared.source.blockId && ref.offset === prepared.source.offset && ref.id === expectedId);
          if (!actual) throw new Error('The copy does not have initialized reminder IDs. Its source timers were kept.');
          const desired = fromJsonString(ReminderPBSchema, prepared.reminder); desired.id = expectedId; desired.objectId = id; desired.meta = { ...desired.meta, block_id: actual.blockId }; delete desired.meta.row_id;
          return { source: actual, desired: serializeReminder(desired) };
        });
        targets.push({ id, references });
      }
      for (let i = 0; i < children.length; i++) await visit(source.children[i], children[i].id, id);
    };
    await visit(plan.source, plan.rootId, plan.parentId, true); return targets;
  }
  private async finish(plan: HyperDocumentDuplicatePlan, owner: HyperDocumentOwner) {
    const access = this.access(owner); if (access.key !== plan.ownerKey) throw new Error('This recovery belongs to another workspace or account.');
    await access.writable(plan.parentId);
    if (!plan.targets) {
      const targets = await this.validateTargets(plan, owner), sourceReminders = await access.check(() => this.backend.reminders());
      const checkSource = (node: SourceNode) => {
        for (const reference of node.references) {
          const found = sourceReminders.filter(item => item.id === reference.source.id);
          if (found.length > 1 || (found[0] ? ownedReminder(found[0]) : null) !== reference.sourceStamp) throw new Error('A source reminder changed while copying. Its timer was kept.');
        }
        node.children.forEach(checkSource);
      };
      checkSource(plan.source); plan.targets = targets; this.store.setState(state => ({ plans: [...state.plans] }));
    }
    for (const target of plan.targets) {
      for (const reference of target.references) {
        await access.writable(target.id);
        await access.check(() => this.backend.flush(target.id, owner));
        const doc = await access.check(() => this.backend.document(target.id)), refs = hyperDuplicateDateReferences(doc).filter(ref => ref.id === reference.source.id);
        if (refs.length !== 1 || hyperDuplicateDateBinding(refs[0]) !== hyperDuplicateDateBinding(reference.source)) throw new Error('A copied date or its block changed. No timer was overwritten.');
        const desired = fromJsonString(ReminderPBSchema, reference.desired), found = (await access.check(() => this.backend.reminders())).filter(reminder => reminder.id === desired.id);
        if (found.length > 1 || found.length === 1 && ownedReminder(found[0]) !== ownedReminder(desired)) throw new Error('A copied reminder ID has a conflicting timer. Its timer was kept.');
        if (!found.length) {
          await access.writable(target.id);
          const latest = hyperDuplicateDateReferences(await access.check(() => this.backend.document(target.id))).filter(ref => ref.id === reference.source.id);
          if (latest.length !== 1 || hyperDuplicateDateBinding(latest[0]) !== hyperDuplicateDateBinding(reference.source)) throw new Error('A copied date changed before its timer could be created.');
          const fresh = (await access.check(() => this.backend.reminders())).filter(item => item.id === desired.id);
          if (fresh.length > 1 || fresh.length === 1 && ownedReminder(fresh[0]) !== ownedReminder(desired)) throw new Error('A copied reminder changed before creation. Its timer was kept.');
          if (!fresh.length) await access.check(() => this.backend.create(desired));
        }
      }
    }
    // Verify acknowledgments against current native state, including a create that returned an uncertain error.
    const all = await access.check(() => this.backend.reminders());
    for (const target of plan.targets) {
      const references = hyperDuplicateDateReferences(await access.check(() => this.backend.document(target.id)));
      for (const reference of target.references) {
        const desired = fromJsonString(ReminderPBSchema, reference.desired), found = all.filter(reminder => reminder.id === desired.id), refs = references.filter(ref => ref.id === reference.source.id);
        if (refs.length !== 1 || hyperDuplicateDateBinding(refs[0]) !== hyperDuplicateDateBinding(reference.source)) throw new Error('A copied date changed while its reminder was being saved. Recovery was kept.');
        if (found.length !== 1 || ownedReminder(found[0]) !== ownedReminder(desired)) throw new Error('A copied timer was not confirmed. Retry only its reminder updates.');
      }
    }
    this.backend.changed();
    if (plan.openAfterDuplicate) { await access.identity(); await access.check(() => this.backend.open(plan.rootId!)); }
    this.remove(plan.id); this.store.setState({ error: null });
  }
  private remove(id: string) { this.store.setState(state => ({ plans: state.plans.filter(plan => plan.id !== id) })); }
  async candidates(planId: string, owner: HyperDocumentOwner): Promise<HyperDuplicateCandidate[]> {
    const plan = this.store.getState().plans.find(plan => plan.id === planId), access = this.access(owner);
    if (!plan || plan.ownerKey !== access.key) return [];
    await access.identity(); return (await access.check(() => this.backend.views())).filter(view => view.parentViewId === plan.parentId && view.layout === plan.source.layout && view.name === plan.expectedName && !plan.baseline.includes(view.id) && view.id !== plan.source.id).map(view => ({ id: view.id, name: view.name }));
  }
  async retry(planId: string, owner: HyperDocumentOwner, selectedRoot?: string): Promise<boolean> {
    const plan = this.store.getState().plans.find(plan => plan.id === planId);
    if (!plan || plan.ownerKey !== ownerKey(owner) || this.store.getState().busy) return false;
    this.store.setState({ busy: true, ownerKey: plan.ownerKey });
    const selecting = !plan.rootId;
    try {
      if (selecting) { if (!selectedRoot || !(await this.candidates(planId, owner)).some(view => view.id === selectedRoot)) throw new Error('Choose an existing newly created copy. Duplicate will not run again.'); plan.rootId = selectedRoot; }
      await this.finish(plan, owner); return true;
    } catch (error) { if (selecting && !plan.targets) plan.rootId = null; plan.error = message(error); this.store.setState(state => ({ plans: [...state.plans], error: plan.error })); return false; }
    finally { this.store.setState({ busy: false }); }
  }
  recovery(planId: string, owner: HyperDocumentOwner): string {
    const plan = this.store.getState().plans.find(plan => plan.id === planId);
    if (!owner.isCurrent() || ownerKey(this.backend.owner()) !== ownerKey(owner) || plan?.ownerKey !== ownerKey(owner)) return '';
    return JSON.stringify({ version: 1, action: 'finish-existing-copy-only', appCloseDiscardsRecovery: true, plan }, null, 2);
  }
  dismissError(owner: HyperDocumentOwner) { if (owner.isCurrent() && ownerKey(this.backend.owner()) === ownerKey(owner)) this.store.setState({ error: null }); }
  discard(planId: string, owner: HyperDocumentOwner) {
    if (this.store.getState().busy || !owner.isCurrent() || ownerKey(this.backend.owner()) !== ownerKey(owner)) return;
    const plan = this.store.getState().plans.find(plan => plan.id === planId);
    if (plan?.ownerKey === ownerKey(owner)) { this.remove(planId); this.store.setState({ error: null }); }
  }
}
