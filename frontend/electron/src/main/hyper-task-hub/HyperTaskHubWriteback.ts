import { randomUUID } from 'node:crypto';
import { hyperDetectStatusConflict, hyperMapSourceStatus } from '@shared/HyperHubStatusMapping';
import type { HyperHubStatusApproveResult, HyperHubStatusCandidate, HyperHubStatusIntent, HyperHubStatusPreview,
  HyperHubStatusRejectCode, HyperHubVersion, HyperHubWriteSource } from '@shared/HyperTaskHub';
import { hyperHubForgetWriteLabels, hyperHubInstant, type HyperTaskHubStore, type HyperHubDiskState } from './HyperTaskHubStore';
import { HyperHubStatusError, hyperHubStatusCode, type HyperHubDiscovery, type HyperHubStatusWriter, type HyperHubWriteEntry, type HyperHubWriteTarget } from './HyperHubStatusWriter';

export interface HyperHubDocument {
  window: object;
  frame: object;
  trusted(): boolean;
  confirm(options: { title: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number; noLink: boolean }): Promise<boolean>;
}
interface Bound {
  document: HyperHubDocument; target: HyperHubWriteTarget; taskId: string; intent: HyperHubStatusIntent; previous?: string;
  discovery: HyperHubDiscovery; writer: HyperHubStatusWriter; expires: number;
}
const dialogs = new WeakSet<object>();
const liveClaims = new Set<string>();
const clean = (s: string) => [...s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')].slice(0, 200).join('');
const isolate = (s: string) => '\u2068' + clean(s) + '\u2069';
const label = (s: HyperHubWriteSource) => s === 'jira' ? 'Jira' : 'Newsletter';
const assertion: (ok: unknown, code: HyperHubStatusRejectCode) => asserts ok = (ok, code) => { if (!ok) throw new HyperHubStatusError(code); };
const condition = (p: HyperHubDiscovery, id: string) => p.source === 'jira'
  ? { source: p.source, statusId: p.current.id, revision: p.versionLabel, candidate: p.candidates.find(c => c.candidateId === id) }
  : { source: p.source, statusId: p.current.id, revision: p.versionLabel, progress: p.current.progress ?? null, leaf: true };

function mergeRead(draft: HyperHubDiskState, evidenceId: string, observation: HyperHubDiscovery) {
  const { current, source } = observation;
  const mapped = hyperMapSourceStatus(source, source === 'jira' ? current.category : current.id);
  for (const inventory of Object.values(draft.cache)) for (const r of inventory.records) if (r.id === evidenceId) {
    r.revision = observation.versionLabel;
    r.category = current.category;
    r.rawStatus = source === 'jira' ? current.name : current.id;
    r.completion = mapped.completion;
    r.title = observation.target.title;
    r.initialState = source === 'jira' && r.ownerAssigned === false && mapped.completion !== 'complete' ? 'waiting' : mapped.state ?? r.initialState;
  }
}
function confirmation(d: HyperHubDiscovery, c: HyperHubStatusCandidate, resolution?: string) {
  const source = label(d.source);
  const lines = [isolate(d.current.name) + ' → ' + isolate(c.to.name) + '  (' + isolate(c.actionLabel) + ')'];
  if (resolution) lines.push('Resolution: ' + isolate(resolution));
  for (const effect of c.effects) {
    if (effect.code === 'any-status-transition') lines.push('Jira can apply this from any status.');
    if (effect.code === 'progress-set') lines.push('Completion sets progress to ' + (effect.from ?? 'unknown') + '% → 100%. Undo restores the status and leaves progress at 100%.');
    if (effect.code === 'progress-kept') lines.push('Progress stays at ' + effect.value + '%.');
  }
  if (d.source === 'newsletter') lines.push('Newsletter also normalizes and reschedules the chart and can recompute parent roll-ups.');
  lines.push('Account: ' + isolate(d.accountLabel) + ' · ' + isolate(d.site), 'Version: ' + isolate(d.versionLabel));
  if (d.permissionCheckedOnConfirm) lines.push('Newsletter checks your permission when you confirm.');
  return { title: 'Change status in ' + source + '?', message: (d.source === 'newsletter' ? isolate(d.target.container ?? '') + ' · task ' : '') +
    isolate(d.target.key ?? '') + ' · ' + isolate(d.target.title), detail: lines.join('\n'), buttons: ['Cancel', 'Change in ' + source], defaultId: 0, cancelId: 0, noLink: true };
}

export class HyperTaskHubWriteback {
  private readonly denials = new Map<string, HyperHubStatusRejectCode>();
  private tokens = new Map<string, Bound>();
  private reads = new Set<string>();
  constructor(private readonly store: HyperTaskHubStore, private readonly deps: {
    version(): HyperHubVersion; validate(): Promise<boolean>; signal: AbortSignal; now(): number; publish(): void;
    member?(target: HyperHubWriteTarget): boolean;
    writer(source: HyperHubWriteSource): HyperHubStatusWriter | undefined;
  }) {
    const interrupted = this.entries.filter(e => e.view.state === 'pending' && !liveClaims.has(e.view.operationId));
    if (interrupted.length) this.store.commit(() => true, d => {
      for (const e of interrupted) {
        const item = d.ledger.writes![e.view.operationId];
        item.view.state = 'unknown';
        item.view.earliestReconcileAt ??= hyperHubInstant(deps.now() + 30_000);
        item.events.push({ state: 'unknown', time: deps.now() });
      }
    });
  }
  get entries() { return Object.values(this.store.current.ledger.writes ?? {}); }
  lastFailure(id: string): HyperHubStatusRejectCode | undefined {
    const denied = this.denials.get(id);
    if (denied) return denied;
    const e = this.entries.filter(e => e.target.id === id && this.visible(e)).at(-1);
    const code = e?.view.code;
    return code === 'forbidden' || code === 'not-found' || code === 'reconnect' ? code : undefined;
  }
  available(source: HyperHubWriteSource) { return !!this.deps.writer(source); }
  private selected(source: HyperHubWriteSource, t: HyperHubWriteTarget) {
    const s = this.store.current.setup;
    return source === 'jira' ? s?.jiraProjects.some(p => p.projectId === t.projectId && p.connectionId === 'jira') :
      s?.newsletterProjects?.some(p => p.projectId === t.projectId && p.connectionId === 'newsletter');
  }
  visible(e: HyperHubWriteEntry) {
    const stored = e.view.source === 'jira' ? this.store.current.jiraBinding : this.store.current.newsletterBinding;
    return this.selected(e.view.source, e.target) && (this.deps.writer(e.view.source)?.binding ?? stored) === e.binding;
  }
  blocked(id: string, except?: string) { return this.entries.some(e => this.visible(e) && e.target.id === id && e.view.operationId !== except && (e.view.held || e.view.state === 'unknown')); }
  private check(source: HyperHubWriteSource, t: HyperHubWriteTarget, doc?: HyperHubDocument) {
    assertion(!this.deps.signal.aborted, 'scope-changed');
    assertion(!doc || doc.trusted(), 'access-denied');
    assertion(this.selected(source, t), 'access-denied');
    assertion(this.store.current.setup?.writeBack?.[source], 'disabled');
    const w = this.deps.writer(source);
    assertion(w, 'reconnect');
    return w;
  }
  private register(b: Bound): HyperHubStatusPreview {
    const previewId = randomUUID();
    for (const [id, prior] of this.tokens) if (prior.expires <= this.deps.now() || !prior.document.trusted()) this.tokens.delete(id);
    this.tokens.set(previewId, b);
    const { principal: _, ...d } = b.discovery;
    const candidates = d.candidates.map(c => ({ ...c, actionLabel: clean(c.actionLabel), to: { ...c.to, name: clean(c.to.name) },
      ...(c.resolution && { resolution: { values: c.resolution.values.map(v => ({ ...v, name: clean(v.name) })) } }) }));
    const unavailable = d.unavailable.map(u => ({ ...u, actionLabel: clean(u.actionLabel), toName: clean(u.toName), fields: u.fields?.map(clean) }));
    return { ...d, candidates, unavailable, current: { ...d.current, name: clean(d.current.name) }, versionLabel: clean(d.versionLabel), previewId, expiresAt: hyperHubInstant(b.expires),
      target: { title: clean(d.target.title), key: d.target.key && clean(d.target.key), container: d.target.container && clean(d.target.container) },
      site: clean(d.site), accountLabel: clean(d.accountLabel) };
  }
  async preview(doc: HyperHubDocument, intent: HyperHubStatusIntent, resolve: () => { target: HyperHubWriteTarget; taskId: string }) {
    try {
      const reverse = intent.kind === 'reverse' ? this.store.current.ledger.writes?.[intent.operationId] : undefined;
      if (intent.kind === 'reverse') assertion(reverse?.view.undoAvailable && this.visible(reverse), 'access-denied');
      const { target, taskId } = reverse ? { target: reverse.target, taskId: reverse.view.taskId } : resolve();
      const source = target.key.kind === 'newsletter-task' ? 'newsletter' : 'jira';
      const writer = this.check(source, target, doc);
      assertion(!this.blocked(target.id), 'held');
      let discovery: HyperHubDiscovery;
      try { discovery = await writer.discover(target, intent, reverse?.before.id, this.deps.signal); }
      catch (error) {
        const code = hyperHubStatusCode(error);
        if (doc.trusted() && ['reconnect', 'forbidden', 'access-denied', 'not-found'].includes(code)) {
          this.denials.set(target.id, code);
          await this.recheckReadAccess({ writer, target });
          this.deps.publish();
        }
        throw error;
      }
      assertion(await this.deps.validate(), 'scope-changed');
      this.check(source, target, doc);
      this.denials.delete(target.id);
      if (reverse && (reverse.principal !== discovery.principal || reverse.afterRevision !== discovery.versionLabel || reverse.after?.id !== discovery.current.id ||
        reverse.after?.progress !== discovery.current.progress || !discovery.candidates.length)) {
        this.update(reverse.view.operationId, e => { e.view.undoAvailable = false; });
        throw new HyperHubStatusError('revision-conflict');
      }
      assertion(discovery.candidates.length || discovery.unavailable.length, 'no-actions');
      return { ...this.deps.version(), ok: true as const, preview: this.register({ taskId, target, intent, previous: reverse?.before.id,
        writer, document: doc, expires: this.deps.now() + 60000, discovery }) };
    } catch (e) { return { ...this.deps.version(), ok: false as const, code: hyperHubStatusCode(e) }; }
  }
  discard(doc: HyperHubDocument, id: string) {
    const b = this.tokens.get(id);
    assertion(b && this.same(b, doc), 'access-denied');
    this.tokens.delete(id);
    return { ...this.deps.version(), ok: true as const };
  }
  private same(b: Bound, doc: HyperHubDocument) { return b.document.frame === doc.frame && b.document.window === doc.window && b.document.trusted() && doc.trusted(); }
  private guard(b: Bound, op?: string) {
    assertion(this.check(b.writer.source, b.target, b.document).binding === b.writer.binding, 'scope-changed');
    assertion(b.intent.kind === 'reverse' || this.deps.member?.(b.target) !== false, 'access-denied');
    assertion(!this.blocked(b.target.id, op), 'held');
    assertion(b.expires > this.deps.now(), 'invalid');
  }
  private update(id: string, change: (e: HyperHubWriteEntry) => void) {
    this.store.commit(() => true, d => change(d.ledger.writes![id]));
    this.deps.publish();
  }
  async approve(doc: HyperHubDocument, id: string, candidateId: string, resolutionId?: string): Promise<HyperHubStatusApproveResult> {
    const version = this.deps.version;
    const b = this.tokens.get(id);
    if (!b || b.expires <= this.deps.now()) { this.tokens.delete(id); return { ...version(), outcome: 'expired' }; }
    if (!this.same(b, doc)) return { ...version(), outcome: 'failed', code: 'access-denied' };
    const d = b.discovery, c = d.candidates.find(c => c.candidateId === candidateId);
    const resolution = c?.resolution?.values.find(v => v.id === resolutionId);
    if (!c || (c.resolution ? !resolution : resolutionId !== undefined)) return { ...version(), outcome: 'failed', code: 'invalid' };
    this.tokens.delete(id);
    if (dialogs.has(doc.window)) return { ...version(), outcome: 'cancelled' };
    let op: string | undefined, dispatchedAt: number | undefined;
    try {
      this.guard(b);
      dialogs.add(doc.window);
      try { if (!await doc.confirm(confirmation(d, c, resolution?.name))) return { ...version(), outcome: 'cancelled' }; }
      finally { dialogs.delete(doc.window); }
      assertion(await this.deps.validate(), 'scope-changed');
      this.guard(b);
      if (b.writer.principal) {
        assertion(await b.writer.principal(this.deps.signal) === d.principal, 'access-denied');
        this.guard(b);
      }
      assertion(!this.store.heldInAnotherWorkspace(b.writer.binding, b.target.id), 'held');
      const now = this.deps.now(), operationId = randomUUID();
      const entry: HyperHubWriteEntry = { binding: b.writer.binding, principal: d.principal, target: b.target,
        before: d.current, beforeRevision: d.versionLabel, requestedId: c.to.id, inverseOf: b.intent.kind === 'reverse' ? b.intent.operationId : undefined,
        events: [{ state: 'pending', time: now }], view: { operationId, evidenceId: b.target.id, taskId: b.taskId, source: d.source, state: 'pending',
          at: hyperHubInstant(now), fromName: d.current.name, toName: c.to.name, undoAvailable: false, held: true, ownerReleaseAvailable: false, readback: 'pending' } };
      assertion(this.store.commit(() => { this.guard(b); return true; }, draft => {
        (draft.ledger.writes ??= {})[operationId] = entry;
      }), 'unavailable');
      op = operationId;
      liveClaims.add(op);
      this.deps.publish();
      const fresh = async () => {
        const current = await b.writer.discover(b.target, b.intent, b.previous, this.deps.signal, 'final');
        assertion(await this.deps.validate(), 'scope-changed');
        this.guard(b, operationId);
        assertion(d.principal === current.principal, 'access-denied');
        return current;
      };
      const conflict = (next: HyperHubDiscovery) => hyperDetectStatusConflict(condition(d, candidateId), condition(next, candidateId), resolutionId) ||
        next.candidates.find(option => option.candidateId === candidateId)?.actionLabel !== c.actionLabel ||
        next.candidates.find(option => option.candidateId === candidateId)?.to.name !== c.to.name ||
        (resolution && next.candidates.find(option => option.candidateId === candidateId)?.resolution?.values.find(v => v.id === resolutionId)?.name !== resolution.name) ||
        d.target.title !== next.target.title || d.target.key !== next.target.key || d.target.container !== next.target.container;
      const conflictReply = (next: HyperHubDiscovery) => {
        this.fail(operationId, 'revision-conflict', next);
        if (b.intent.kind === 'reverse') return { ...version(), outcome: 'failed' as const, code: 'revision-conflict' as const };
        return { ...version(), outcome: 'conflict' as const, preview: this.register({ ...b, discovery: next, expires: this.deps.now() + 60000 }) };
      };
      // Never replay this operation, even when the transport times out after the server commits.
      const checked = await fresh();
      this.guard(b, op);
      if (conflict(checked)) return conflictReply(checked);
      dispatchedAt = this.deps.now();
      try { await b.writer.send(b.target, c, resolutionId, this.deps.signal); }
      catch (error) {
        if (d.source === 'jira' && error instanceof Error && /^Jira returned HTTP (400|409)\./.test(error.message)) {
          dispatchedAt = undefined;
          const next = await fresh();
          if (conflict(next)) return conflictReply(next);
          this.fail(op, 'rejected');
          return { ...version(), outcome: 'failed', code: 'rejected' };
        }
        throw error;
      }
      this.update(op, e => { e.view.state = 'succeeded'; e.events.push({ time: this.deps.now(), state: 'succeeded' }); });
      await this.observe(op);
      return { ...version(), outcome: 'succeeded', write: this.store.current.ledger.writes![op].view };
    } catch (error) {
      const code = hyperHubStatusCode(error);
      const definitive = error instanceof Error && /^(Jira|Newsletter) returned HTTP 4(?!08)\d{2}\./.test(error.message);
      if (op && dispatchedAt !== undefined && !definitive) {
        this.update(op, e => { e.view.state = 'unknown'; e.events.push({ time: this.deps.now(), state: 'unknown' });
          e.view.earliestReconcileAt = hyperHubInstant(dispatchedAt! + 30_000); });
        return { ...version(), outcome: 'unknown', write: this.store.current.ledger.writes![op].view };
      }
      if (op && definitive && (code === 'offline' || code === 'unavailable')) { this.fail(op, 'rejected'); return { ...version(), outcome: 'failed', code: 'rejected' }; }
      if (op) this.fail(op, code);
      if (doc.trusted() && ['not-found', 'forbidden', 'access-denied', 'reconnect'].includes(code)) await this.recheckReadAccess(b);
      if (b.expires <= this.deps.now()) return { ...version(), outcome: 'expired' };
      return { ...version(), outcome: 'failed', code };
    } finally { if (op) liveClaims.delete(op); }
  }
  private fail(id: string, code: string, observation?: HyperHubDiscovery) {
    this.store.commit(() => true, d => {
      const e = d.ledger.writes![id];
      Object.assign(e.view, { state: 'failed', code, held: false });
      e.events.push({ time: this.deps.now(), state: 'failed' });
      if (observation) {
        mergeRead(d, e.target.id, observation);
        e.after = observation.current; e.afterRevision = observation.versionLabel;
        e.view.observedName = observation.current.name; e.view.readback = 'verified';
      }
    });
    if (observation) this.store.accessGeneration++;
    this.deps.publish();
  }
  private async recheckReadAccess(b: Pick<Bound, 'writer' | 'target'>) {
    if (this.deps.signal.aborted || !await this.deps.validate() || this.deps.signal.aborted) return;
    try { await b.writer.discover(b.target, { kind: 'choose' }, undefined, this.deps.signal, 'observe'); }
    catch (error) {
      const code = hyperHubStatusCode(error);
      if (!['not-found', 'access-denied', 'forbidden', 'reconnect'].includes(code) || this.deps.signal.aborted) return;
      this.store.accessGeneration++;
      this.store.commit(() => !this.deps.signal.aborted, d => {
        hyperHubForgetWriteLabels(d, b.writer.source, code === 'reconnect' ? undefined : b.target.id);
        for (const [key, i] of Object.entries(d.cache)) {
          if (i.status.connectionId !== (b.writer.source === 'jira' ? 'jira' : 'newsletter')) continue;
          if (code === 'reconnect') { delete d.cache[key]; continue; }
          i.records = i.records.filter(r => r.id !== b.target.id);
          i.evidence = i.evidence?.filter(r => r.id !== b.target.id);
          i.cursor = null;
        }
      });
      this.deps.publish();
    }
  }
  private async observe(id: string) {
    const e = this.store.current.ledger.writes![id];
    if (!this.visible(e) || !this.deps.writer(e.view.source) || this.reads.has(id) || (e.view.earliestReconcileAt && this.deps.now() < Date.parse(e.view.earliestReconcileAt.iso))) return;
    this.reads.add(id);
    try {
      const w = this.deps.writer(e.view.source)!;
      const observation = await w.discover(e.target, { kind: 'reverse', operationId: id }, e.before.id, this.deps.signal, 'observe');
      assertion(await this.deps.validate() && !this.deps.signal.aborted && this.visible(e) && observation.principal === e.principal, 'access-denied');
      this.store.commit(() => !this.deps.signal.aborted, d => {
        const item = d.ledger.writes![id], v = item.view, status = observation.current;
        for (const prior of Object.values(d.ledger.writes!)) if (prior !== item && prior.target.id === e.target.id &&
          (prior.afterRevision !== observation.versionLabel || prior.after?.id !== status.id || prior.after?.progress !== status.progress)) prior.view.undoAvailable = false;
        item.after = status;
        item.afterRevision = observation.versionLabel;
        v.observedName = status.name;
        v.readback = 'verified';
        v.ownerReleaseAvailable = v.state === 'unknown' && v.held;
        v.held = v.state === 'unknown' && !v.ownerReleasedAt;
        v.undoAvailable = v.state === 'succeeded' && status.id === item.requestedId && observation.candidates.length > 0;
        mergeRead(d, e.target.id, observation);
      });
      this.store.accessGeneration++; // A sync that began before this targeted read cannot overwrite it.
      this.deps.publish();
      return observation;
    } catch {
      if (this.deps.signal.aborted || !this.visible(e)) return;
      this.update(id, item => { item.view.readback = 'failed'; item.view.ownerReleaseAvailable = false; item.view.undoAvailable = false; });
    } finally { this.reads.delete(id); }
  }
  async reconcile() {
    for (const e of this.entries) if (this.visible(e) && (e.view.state === 'unknown' || (e.view.state === 'succeeded' && e.view.held))) await this.observe(e.view.operationId);
  }
  async release(doc: HyperHubDocument, id: string) {
    const e = this.store.current.ledger.writes?.[id];
    assertion(e && e.view.state === 'unknown' && e.view.held && e.view.ownerReleaseAvailable && this.visible(e) && doc.trusted(), 'access-denied');
    assertion(!dialogs.has(doc.window), 'held');
    const source = label(e.view.source);
    dialogs.add(doc.window);
    try {
      const accepted = await doc.confirm({ title: 'Release hold?', message: source + ': ' + isolate(e.view.observedName ?? ''),
        detail: 'The earlier update may still apply.', buttons: ['Cancel', 'I checked in ' + source], cancelId: 0, defaultId: 0, noLink: true });
      assertion(accepted && doc.trusted(), 'invalid');
      const checked = await this.observe(id);
      assertion(checked && checked.versionLabel === e.afterRevision && checked.current.id === e.after?.id &&
        checked.current.progress === e.after?.progress && doc.trusted() && !this.deps.signal.aborted, 'revision-conflict');
      this.update(id, item => { item.view.held = false; item.view.ownerReleaseAvailable = false; item.view.ownerReleasedAt = hyperHubInstant(this.deps.now()); });
      return { ...this.deps.version(), ok: true as const, write: this.store.current.ledger.writes![id].view };
    } finally { dialogs.delete(doc.window); }
  }
}
