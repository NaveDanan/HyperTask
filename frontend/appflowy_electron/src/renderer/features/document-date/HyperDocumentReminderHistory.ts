import { clone, create } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperBlockText, hyperChildren, hyperTextTypes } from '../document/HyperDocumentModel';
import type { HyperDocumentHistoryParticipant, HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
import { viewIsLocked } from '../view-header/page-access-level-store';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperDocumentCustomSchedule, hyperDocumentDateDraft, hyperDocumentDateMention, hyperDocumentDateSchedule, hyperParseMentionDate, type HyperDateMention } from './HyperDocumentDateValue';
import type { HyperDocumentDateBackend, HyperDocumentDateContext } from './HyperDocumentDateStore';

interface Reference { id: string; blockId: string; mention: HyperDateMention; attributes: Record<string, unknown> }
type References = Map<string, Reference[]>;
const stable = (value: unknown): string => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
function referenceValue(ref: Reference) { return { blockId: ref.blockId, date: ref.mention.date, includeTime: ref.mention.include_time === true, option: ref.mention.reminder_option ?? 'custom', custom: ref.mention.reminder_option === 'custom' || ref.mention.reminder_option === undefined ? ref.attributes.hyper_reminder ?? null : null }; }
const refStamp = (ref: Reference) => stable([ref.id, referenceValue(ref)]);
const refsStamp = (refs: Reference[] = []) => stable(refs.map(referenceValue).sort((a, b) => stable(a).localeCompare(stable(b))));
function references(doc: DocumentDataPB): References {
  const result: References = new Map(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) throw new Error('The document contains a repeated block.'); visited.add(id);
    const block = doc.blocks[id]; if (!block) throw new Error('A document block is missing.');
    if (block.ty === 'hyper_canvas') return;
    if (hyperTextTypes.has(block.ty)) for (const run of hyperBlockText(doc, block)) {
      const mention = hyperDocumentDateMention(run), id = mention?.reminder_id;
      if (!mention || typeof id !== 'string' || !id) continue;
      for (let i = 0; i < (run.insert as string).length; i++) { const refs = result.get(id) ?? []; refs.push({ id, blockId: block.id, mention, attributes: run.attributes ?? {} }); result.set(id, refs); }
    }
    for (const child of hyperChildren(doc, block)) visit(child);
  };
  visit(doc.pageId); return result;
}
const owned = (reminder: ReminderPB | null) => reminder ? stable({ id: reminder.id, objectId: reminder.objectId, scheduledAt: reminder.scheduledAt, blockId: reminder.meta.block_id ?? null, rowId: reminder.meta.row_id ?? null, date: reminder.meta.date ?? null, includeTime: reminder.meta.include_time ?? null }) : null;
interface Operation { id: string; expected: ReminderPB | null; desired: ReminderPB | null }
interface Plan { before: DocumentDataPB; after: DocumentDataPB; beforeSidecars: ReminderPB[]; ids: string[]; operations?: Operation[] }
export interface HyperReminderHistoryState { busy: boolean; pending: boolean; error: string | null; recovery: string }
const histories = new WeakMap<HyperDocumentSession, HyperDocumentReminderHistory>();

/** One companion per scoped session, independent of pane lifetimes and native undo grouping. */
export class HyperDocumentReminderHistory implements HyperDocumentHistoryParticipant {
  readonly store = createStore<HyperReminderHistoryState>(() => ({ busy: false, pending: false, error: null, recovery: '' }));
  private leases = new Map<symbol, HyperDocumentDateContext>();
  private cache = new Map<string, ReminderPB>();
  private prepared: ReminderPB[] = [];
  private plan: Plan | null = null;
  private dateBusy = false;
  private readonly ownerKey: string;
  constructor(private readonly initial: HyperDocumentDateContext, private readonly backend: HyperDocumentDateBackend) { this.ownerKey = hyperDocumentOwnerKey(initial.owner); initial.session.attachHistoryParticipant?.(this); }
  connect(context: HyperDocumentDateContext) {
    if (hyperDocumentOwnerKey(context.owner) !== this.ownerKey || stable(context.rowScope) !== stable(this.initial.rowScope)) throw new Error('The reminder history belongs to another document owner.');
    const token = Symbol(); this.leases.set(token, context); return () => { this.leases.delete(token); };
  }
  blocked() { return !!this.plan || this.dateBusy || this.store.getState().busy; }
  retain() { return this.blocked(); }
  beginDate() { if (this.blocked()) throw new Error('Finish reminder recovery before changing another date.'); this.dateBusy = true; this.store.setState({ error: null, recovery: '' }); return () => { this.dateBusy = false; this.store.setState({}); }; }
  private context() {
    const context = [...this.leases.values()].find(value => (value.canWrite ?? value.editable)());
    if (!context) throw new Error('This document is read-only or its editor was closed.');
    const { session, owner } = context, state = session.store.getState();
    if (!owner.isCurrent() || hyperDocumentOwnerKey((context.currentOwner ?? hyperGetDocumentOwner)()) !== this.ownerKey || !session.belongsTo(owner) || !session.isCurrentOwner() || !state.document || ['loading', 'error'].includes(state.status)) throw new Error('The document, workspace or account changed. The reminder recovery was kept.');
    return context;
  }
  private async validate() {
    const context = this.context(), { session, owner, rowScope } = context;
    const identity = await this.backend.identity(); this.context();
    if (identity.actorId !== owner.actorId || identity.workspaceId !== owner.workspaceId) throw new Error('The active workspace or account changed.');
    const view = await this.backend.view(rowScope?.viewId ?? session.id); this.context();
    if (view.id !== (rowScope?.viewId ?? session.id) || viewIsLocked(view)) throw new Error('This page is unavailable or locked.');
    if (rowScope) {
      if (![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout)) throw new Error('The row database changed.');
      const row = await this.backend.row(rowScope.viewId, rowScope.rowId); this.context();
      const id = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowScope.rowId || id !== session.id || row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) throw new Error('The row document changed or was removed.');
    } else if (view.layout !== ViewLayoutPB.Document) throw new Error('This page is no longer a document.');
    const latest = await this.backend.identity(); this.context();
    if (latest.actorId !== owner.actorId || latest.workspaceId !== owner.workspaceId) throw new Error('The active workspace or account changed.');
  }
  private find(all: ReminderPB[], id: string): ReminderPB | null { const found = all.filter(item => item.id === id); if (found.length > 1) throw new Error('This reminder ID is duplicated. No timer was overwritten.'); return found[0] ?? null; }
  private binding(ref: Reference, reminder: ReminderPB) {
    const { session, rowScope } = this.initial;
    if (![session.id, rowScope?.viewId].includes(reminder.objectId) || reminder.meta.block_id && reminder.meta.block_id !== ref.blockId || rowScope && reminder.meta.row_id && reminder.meta.row_id !== rowScope.rowId) throw new Error('A reminder belongs to another page, block or row.');
  }
  remember(doc: DocumentDataPB, all: ReminderPB[]) {
    for (const [id, refs] of references(doc)) {
      if (refs.length !== 1) continue;
      const found = all.filter(item => item.id === id); if (found.length !== 1) continue;
      const reminder = found[0];
      try { this.binding(refs[0], reminder); } catch { continue; }
      if (!this.cache.has(refStamp(refs[0]))) this.cache.set(refStamp(refs[0]), clone(ReminderPBSchema, reminder));
    }
  }
  private schedule(ref: Reference, fallback?: ReminderPB): bigint {
    const draft = hyperDocumentDateDraft(ref.mention);
    if (draft.reminderOption === 'custom') {
      const encoded = hyperDocumentCustomSchedule(ref.attributes);
      if (encoded !== null) return encoded;
      const cached = this.cache.get(refStamp(ref));
      if (cached) return cached.scheduledAt;
      if (fallback) return fallback.scheduledAt;
      throw new Error('The original custom reminder time is unavailable. Copy the recovery details.');
    }
    const result = hyperDocumentDateSchedule(draft, ref.mention.date);
    if (result === null) throw new Error('The restored date has a reminder ID but no reminder option.');
    return result;
  }
  private desired(ref: Reference, template: ReminderPB | null, fallback?: ReminderPB): ReminderPB {
    const scheduledAt = this.schedule(ref, fallback), { session, rowScope } = this.initial;
    return create(ReminderPBSchema, { ...template, id: ref.id, objectId: rowScope?.viewId ?? session.id, scheduledAt, isRead: template?.isRead ?? false, isAck: Number(scheduledAt) * 1000 < Date.now(), title: template?.title || 'Reminder', message: template?.message || 'You have a reminder.',
      meta: { ...template?.meta, block_id: ref.blockId, include_time: String(ref.mention.include_time === true), date: String(hyperParseMentionDate(ref.mention.date).getTime()), created_at: template?.meta.created_at ?? String(Date.now()), ...(rowScope ? { row_id: rowScope.rowId } : {}) } });
  }
  private build(plan: Plan): Operation[] {
    const before = references(plan.before), after = references(plan.after), operations: Operation[] = [];
    for (const id of plan.ids) {
      const previous = before.get(id) ?? [], next = after.get(id) ?? [];
      if (previous.length > 1 || next.length > 1) throw new Error('A reminder ID occurs more than once. No timer was overwritten.');
      const nativeBefore = this.find(plan.beforeSidecars, id), cachedBefore = previous[0] ? this.cache.get(refStamp(previous[0])) ?? null : null;
      let expected = cachedBefore ?? nativeBefore;
      if (previous[0] && expected) expected = create(ReminderPBSchema, { ...expected, scheduledAt: this.schedule(previous[0], expected) });
      if (!previous.length) expected = null;
      const cachedAfter = next[0] ? this.cache.get(refStamp(next[0])) ?? null : null;
      // Moving a legacy custom mention preserves its timer; changing its date does not
      // provide enough information to invent a custom schedule.
      const moved = previous[0] && next[0] && stable({ ...referenceValue(previous[0]), blockId: '' }) === stable({ ...referenceValue(next[0]), blockId: '' });
      const desired = next[0] ? this.desired(next[0], cachedAfter ?? nativeBefore ?? cachedBefore, moved ? expected ?? undefined : undefined) : null;
      if (!cachedBefore && nativeBefore && previous[0]) {
        try { this.binding(previous[0], nativeBefore); }
        catch (error) { if (owned(nativeBefore) !== owned(desired)) throw error; }
      }
      operations.push({ id, expected, desired });
    }
    return operations;
  }
  private assertDocument(plan: Plan) {
    const doc = this.context().session.store.getState().document!, current = references(doc), expected = references(plan.after);
    for (const id of plan.ids) if (refsStamp(current.get(id)) !== refsStamp(expected.get(id))) throw new Error('The affected date changed after history. The recovery plan was kept.');
  }
  private async apply(plan: Plan) {
    await this.validate(); await this.initial.session.flush(); await this.initial.session.refresh(); await this.validate(); this.assertDocument(plan); plan.operations ??= this.build(plan);
    for (const operation of plan.operations) {
      await this.validate(); this.assertDocument(plan);
      const current = this.find(await this.backend.reminders(), operation.id); this.context(); this.assertDocument(plan);
      if (owned(current) === owned(operation.desired)) continue;
      if (owned(current) !== owned(operation.expected)) throw new Error('A reminder schedule or binding changed elsewhere. Its timer was kept.');
      await this.validate(); this.assertDocument(plan);
      if (!operation.desired) { if (current) await this.backend.remove(operation.id); }
      else {
        const next = create(ReminderPBSchema, { ...operation.desired, isRead: current?.isRead ?? operation.desired.isRead, title: current?.title ?? operation.desired.title, message: current?.message ?? operation.desired.message, meta: { ...(current?.meta ?? operation.desired.meta), block_id: operation.desired.meta.block_id, include_time: operation.desired.meta.include_time, date: operation.desired.meta.date, ...(this.initial.rowScope ? { row_id: this.initial.rowScope.rowId } : {}) } });
        if (current) await this.backend.update(next); else await this.backend.create(next);
      }
      this.context();
    }
    const all = await this.backend.reminders(); this.context(); this.assertDocument(plan); this.remember(plan.after, all);
    this.backend.changed(); this.plan = null; this.store.setState({ busy: false, pending: false, error: null, recovery: '' });
  }
  private failed(error: unknown, plan: Plan) {
    this.plan = plan;
    let recovery: string;
    try { recovery = stable({ documentId: this.initial.session.id, owner: this.ownerKey, affectedReminderIds: plan.ids, operations: plan.operations ?? null, before: [...references(plan.before)], after: [...references(plan.after)] }); }
    catch { recovery = stable({ documentId: this.initial.session.id, owner: this.ownerKey, error: errorText(error) }); }
    this.store.setState({ busy: false, pending: true, error: `The document changed, but reminder recovery is required. ${errorText(error)} Retry changes only reminder timers.`, recovery });
  }
  async prepare(before: DocumentDataPB, _redo: boolean): Promise<boolean> {
    if (this.blocked()) return false;
    this.store.setState({ busy: true, error: null, recovery: '' });
    try { await this.validate(); this.prepared = (await this.backend.reminders()).map(item => clone(ReminderPBSchema, item)); this.context(); this.remember(before, this.prepared); return true; }
    catch (error) { this.store.setState({ busy: false, pending: false, error: `History was not applied. ${errorText(error)}`, recovery: stable({ documentId: this.initial.session.id, owner: this.ownerKey, error: errorText(error) }) }); return false; }
  }
  async complete(before: DocumentDataPB, after: DocumentDataPB, _redo: boolean): Promise<void> {
    const plan: Plan = { before, after, beforeSidecars: this.prepared, ids: [] };
    try {
      const a = references(before), b = references(after);
      plan.ids = [...new Set([...a.keys(), ...b.keys()])].filter(id => refsStamp(a.get(id)) !== refsStamp(b.get(id)));
      if (!plan.ids.length) { this.store.setState({ busy: false, error: null }); return; }
      this.plan = plan; await this.apply(plan);
    } catch (error) { this.failed(error, plan); }
  }
  async retry(): Promise<void> { if (!this.plan || this.store.getState().busy) return; const plan = this.plan; this.store.setState({ busy: true }); try { await this.apply(plan); } catch (error) { this.failed(error, plan); } }
  cancel(error: unknown) { this.store.setState({ busy: false, error: `Native document history was not confirmed. ${errorText(error)}` }); }
  async dateFailed(before: DocumentDataPB, after: DocumentDataPB, beforeSidecars: ReminderPB[], error: unknown) {
    const a = references(before), b = references(after), plan: Plan = { before, after, beforeSidecars, ids: [...new Set([...a.keys(), ...b.keys()])].filter(id => refsStamp(a.get(id)) !== refsStamp(b.get(id))) };
    try { plan.operations = this.build(plan); } catch { /* Keep source snapshots for an explicit retry. */ }
    this.failed(error, plan);
  }
}
export function hyperDocumentReminderHistory(context: HyperDocumentDateContext, backend: HyperDocumentDateBackend): HyperDocumentReminderHistory {
  let history = histories.get(context.session);
  if (!history) { history = new HyperDocumentReminderHistory(context, backend); histories.set(context.session, history); }
  return history;
}
