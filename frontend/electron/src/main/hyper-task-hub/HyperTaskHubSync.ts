import type { HyperHubAgendaItem, HyperHubInterval, HyperHubConnectionStatus, HyperHubReadScope } from '@shared/HyperTaskHub';
import { hyperHubBusyInterval, hyperHubHash, hyperHubIndex, hyperHubInstant, type HyperHubInventory, type HyperHubRecord, type HyperTaskHubStore } from './HyperTaskHubStore';

export class HyperHubAccessLost extends Error {}
export class HyperHubConnectionAccessLost extends HyperHubAccessLost {}
export class HyperHubStoreAccessLost extends HyperHubAccessLost {}
export interface HyperHubBatch {
  evidence?: HyperHubRecord[];
  agenda?: HyperHubAgendaItem[];
  interval?: HyperHubInterval;
  /** Messages positively checked in a partial inventory replace all older excerpts of that message. */
  checkedMailIds?: string[];
  records: HyperHubRecord[];
  cursor: string | null;
  completeness: 'complete' | 'partial';
}
export interface HyperHubQuery {
  queryId: string;
  connectionId: string;
  kind: HyperHubConnectionStatus['kind'];
  label: string;
  availabilitySource?: boolean;
  verifyCommit?(signal: AbortSignal): Promise<void>;
  read(scope: HyperHubReadScope, signal: AbortSignal, previous?: HyperHubInventory): Promise<HyperHubBatch>;
}
export const hyperHubQueryKey = (query: Pick<HyperHubQuery, 'connectionId' | 'queryId'>) => hyperHubHash(query.connectionId, query.queryId);

/** Each run reads a full inventory or an explicitly partial prefix. Only exhaustion replaces membership. */
export class HyperTaskHubSync {
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly committedReads = new Set<string>();
  private readonly failures = new Map<string, { count: number; retryAt: number }>();
  constructor(private readonly store: HyperTaskHubStore, private readonly current: (scope: HyperHubReadScope) => Promise<boolean>,
    private readonly generation: () => number, private readonly changed: () => void, private readonly now = Date.now,
    private readonly random = Math.random) {}

  hasRead(query: HyperHubQuery) { return this.committedReads.has(hyperHubQueryKey(query)); }
  isReading(query: HyperHubQuery) { return this.inflight.has(hyperHubQueryKey(query)); }

  run(scope: HyperHubReadScope, query: HyperHubQuery, signal: AbortSignal, manual = false): Promise<void> {
    const key = hyperHubQueryKey(query);
    const active = this.inflight.get(key);
    if (active) return active;
    if (!manual && (this.failures.get(key)?.retryAt ?? 0) > this.now()) return Promise.resolve();
    const work = this.read(scope, query, key, signal).finally(() => {
      this.inflight.delete(key);
      if (!signal.aborted && this.generation() === scope.generation) this.changed();
    });
    this.inflight.set(key, work);
    this.changed();
    return work;
  }

  private async read(scope: HyperHubReadScope, query: HyperHubQuery, key: string, signal: AbortSignal) {
    const accessGeneration = this.store.accessGeneration;
    const valid = () => accessGeneration === this.store.accessGeneration && !signal.aborted && this.generation() === scope.generation && scope.connectionId === query.connectionId;
    if (!valid()) return;
    let batch: HyperHubBatch | undefined;
    let denied = false, mailboxRevoked = false, connectionRevoked = false;
    try { batch = await query.read(scope, signal, this.store.current.cache[key]); }
    catch (error) { denied = error instanceof HyperHubAccessLost; mailboxRevoked = error instanceof HyperHubStoreAccessLost; connectionRevoked = error instanceof HyperHubConnectionAccessLost; }
    if (!valid() || !await this.current(scope) || !valid()) return;
    // The scope check can itself queue work. Verify the external store last, immediately before the synchronous commit.
    if (batch && query.verifyCommit) {
      try { await query.verifyCommit(signal); }
      catch (error) { batch = undefined; denied = error instanceof HyperHubAccessLost; mailboxRevoked = error instanceof HyperHubStoreAccessLost; connectionRevoked = error instanceof HyperHubConnectionAccessLost; }
      if (!valid()) return;
    }
    if (batch && [...batch.records, ...batch.evidence ?? []].some(r => r.scope.accountId !== scope.accountId || r.scope.workspaceId !== scope.workspaceId ||
      r.scope.connectionId !== scope.connectionId || r.scope.generation !== scope.generation)) return;
    const at = this.now();
    const committed = this.store.commit(valid, draft => {
      if (mailboxRevoked) {
        if (draft.setup) { draft.setup.mail = null; draft.setup.outlookCalendar = false; }
        for (const [id, inventory] of Object.entries(draft.cache)) if (inventory.status.kind.startsWith('outlook-')) delete draft.cache[id];
        return;
      }
      if (connectionRevoked) {
        for (const [id, inventory] of Object.entries(draft.cache)) if (inventory.status.connectionId === query.connectionId) delete draft.cache[id];
      }
      const prior = draft.cache[key];
      const lastSuccess = batch ? hyperHubInstant(at) : denied ? null : prior?.status.lastSuccess ?? null;
      const records = new Map((!denied && batch?.completeness !== 'complete' ? prior?.records ?? [] : []).map(r => [r.id, r]));
      const checkedMail = new Set(batch?.checkedMailIds);
      for (const [id, r] of records) {
        if ((batch?.completeness !== 'complete' && r.reviewSpan?.rule === 'Unanswered direct question') ||
            (r.expiresAt ?? Infinity) <= at || (r.key.kind === 'outlook-mail' && checkedMail.has(r.key.entryId))) records.delete(id);
      }
      for (const record of batch?.records ?? []) {
        records.set(record.id, record);
        for (const e of Object.values(draft.ledger.writes ?? {})) if (e.target.id === record.id && e.view.undoAvailable &&
          e.afterRevision !== record.revision) e.view.undoAvailable = false;
      }
      const interval = batch?.interval;
      const priorComplete = prior?.lastComplete;
      const retained = !denied && priorComplete && Date.parse(priorComplete.asOf.iso) >= at - 30 * 86400000 ? priorComplete : undefined;
      const lastComplete = interval && batch?.completeness === 'complete' ? { interval, asOf: hyperHubInstant(at) } : retained;
      let agenda = batch?.agenda;
      if (query.availabilitySource && !denied && batch?.completeness !== 'complete' && prior?.status.lastSuccess &&
        Date.parse(prior.status.lastSuccess.iso) >= at - 30 * 86400000) {
        // A partial scan can miss a public event whose sensitivity has since changed.
        // Carry only its reservation forward, never its title, meeting identity or handle.
        const seen = new Map((agenda ?? []).map(a => [a.id, a]));
        for (const item of prior.agenda ?? []) {
          if (seen.has(item.id) || item.availability === 'free' || item.availability === 'working-elsewhere') continue;
          if (Date.parse(item.interval.end.iso) < at - 86400000) continue;
          if (item.sourceKind === 'hypertask') { seen.set(item.id, item); continue; }
          const busy = hyperHubBusyInterval(item.interval, item.sourceKind);
          if (!seen.has(busy.id)) seen.set(busy.id, busy);
        }
        agenda = [...seen.values()];
      }
      draft.cache[key] = {
        agenda, lastComplete,
        evidence: query.availabilitySource ? batch?.evidence : [...new Map([
          ...(!denied && batch?.completeness !== 'complete' ? prior?.evidence ?? [] : [])
            .filter(r => (r.expiresAt ?? Infinity) > at && Date.parse(r.observedAt.iso) >= at - 30 * 86400000 &&
              !(r.key.kind === 'outlook-mail' && checkedMail.has(r.key.entryId))),
          ...batch?.evidence ?? [],
        ].map(r => [r.id, r])).values()],
        records: [...records.values()].filter(r => Date.parse(r.observedAt.iso) >= at - 30 * 86400000),
        cursor: batch ? batch.cursor : denied ? null : prior?.cursor ?? null,
        status: { connectionId: scope.connectionId, label: query.label, kind: query.kind,
          status: !batch ? 'error' : batch.completeness === 'complete' ? 'fresh' : 'partial', lastSuccess,
          coverage: [{ queryId: query.queryId, connectionId: scope.connectionId, interval: interval ?? (denied ? undefined : prior?.status.coverage[0]?.interval), lastSuccess, completeness: batch?.completeness ?? 'partial' }] },
      };
      hyperHubIndex(draft);
    });
    if (!committed) return;
    if (denied) this.store.accessGeneration++;
    if (batch) { this.committedReads.add(key); this.failures.delete(key); }
    else {
      const count = (this.failures.get(key)?.count ?? 0) + 1;
      this.failures.set(key, { count, retryAt: at + Math.min(3600000, 30000 * 2 ** Math.min(7, count - 1)) * (0.5 + this.random()) });
    }
  }
}
