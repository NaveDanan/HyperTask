import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';

export const hyperDatabaseRowActivityLimit = 512;
export interface HyperDatabaseRowActivityRequest {
  viewId: string;
  contextId: string;
  activityId: string;
  revision: bigint;
  rowIds: string[];
  closeActivity: boolean;
}
export interface HyperDatabaseRowActivityAck {
  contextId: string;
  activityId: string;
  revision: bigint;
}
export interface HyperDatabaseRowActivityBackend {
  updateRowActivity(request: HyperDatabaseRowActivityRequest): Promise<HyperDatabaseRowActivityAck>;
}
export interface HyperDatabaseRowActivityState {
  status: 'idle' | 'connecting' | 'active' | 'error' | 'closed';
  error: string | null;
  desiredCount: number;
  confirmedCount: number;
  revision: bigint;
  confirmedRevision: bigint | null;
}
const errorText = (error: unknown) => (error as { msg?: string; message?: string } | null)?.msg ?? (error as Error | null)?.message ?? String(error);
const sameRows = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id, index) => id === right[index]);

/** Owns one pane's desired row subscriptions, independently of cell drafts and writes.
 * The supplied owner must be a captured monotonic scope, including app launch changes.
 * Native acknowledgements confirm activation, not completion of cloud synchronization. */
export class HyperDatabaseRowActivity {
  readonly activityId: string;
  private readonly sources = new Map<symbol, readonly string[]>();
  private readonly listeners = new Set<() => void>();
  private desired: string[] = [];
  private state: HyperDatabaseRowActivityState = { status: 'idle', error: null, desiredCount: 0, confirmedCount: 0, revision: 0n, confirmedRevision: null };
  private inFlight = false;
  private queued = false;
  private failed = false;
  private closed = false;
  private sent = false;
  private disposal: Promise<void> | null = null;

  constructor(private readonly options: {
    owner: Pick<HyperDocumentOwner, 'isCurrent'>;
    viewId: string;
    contextId: string;
    backend: HyperDatabaseRowActivityBackend;
    activityId?: string;
    activated?(): void;
  }) {
    if (!options.viewId || !options.contextId) throw new Error('The database subscription context is unavailable. Reopen the view.');
    this.activityId = options.activityId ?? crypto.randomUUID();
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(next: Partial<HyperDatabaseRowActivityState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }
  private current() {
    try { return this.options.owner.isCurrent(); } catch { return false; }
  }

  /** Even an empty visible dataset owns a pane lifetime. Register after child
   * windows have contributed their rows, keeping nonempty activation batched. */
  start() {
    if (this.closed || !this.current() || this.state.revision !== 0n) return;
    this.set({ revision: 1n, status: 'connecting' });
    this.schedule();
  }

  /** Each mounted grid/card/day/detail window contributes a set. Duplicate rows,
   * including calendar spans and linked cards within a pane, activate only once. */
  rows(source: symbol, rowIds: readonly string[]) {
    if (this.closed || !this.current()) return;
    const next = [...new Set(rowIds)];
    if (next.some(id => typeof id !== 'string' || !id || id.length > 128 || id.includes('\0'))) throw new Error('A visible row has an invalid identifier.');
    const sources = new Map(this.sources);
    if (next.length) sources.set(source, next); else sources.delete(source);
    const desired = [...new Set([...sources.values()].flat())].sort();
    if (desired.length > hyperDatabaseRowActivityLimit) throw new Error('Too many visible rows need live updates.');
    this.sources.clear(); sources.forEach((value, key) => this.sources.set(key, value));
    if (sameRows(this.desired, desired)) return;
    this.desired = desired;
    this.set({ desiredCount: desired.length, revision: this.state.revision + 1n, status: this.failed ? 'error' : 'connecting' });
    this.schedule();
  }

  /** Explicit retry uses a higher revision even when membership is unchanged.
   * Failed native initialization keeps its accepted desired pins until this retry
   * or a release; there is no timer or automatic replay. */
  retry() {
    if (this.closed || !this.current()) return;
    this.failed = false;
    this.set({ error: null, revision: this.state.revision + 1n, status: 'connecting' });
    this.schedule();
  }

  private schedule() {
    if (this.queued || this.closed) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; void this.send(); });
  }

  private request(rowIds: string[], revision = this.state.revision, closeActivity = false): HyperDatabaseRowActivityRequest {
    return { viewId: this.options.viewId, contextId: this.options.contextId, activityId: this.activityId, revision, rowIds, closeActivity };
  }

  private async send() {
    if (this.closed || this.inFlight || !this.current() || this.failed && this.desired.length > 0 || this.state.confirmedRevision === this.state.revision) return;
    const request = this.request([...this.desired]);
    this.inFlight = true; this.sent = true;
    try {
      const ack = await this.options.backend.updateRowActivity(request);
      if (this.closed || !this.current()) return;
      if (ack.contextId !== request.contextId || ack.activityId !== request.activityId || ack.revision !== request.revision) throw new Error('The database subscription response changed. Reopen the view.');
      const latest = request.revision === this.state.revision;
      if (latest) this.failed = false;
      this.set({ confirmedCount: request.rowIds.length, confirmedRevision: request.revision, ...(latest ? { status: request.rowIds.length ? 'active' : 'idle', error: null } : {}) });
      if (latest && request.rowIds.length) this.options.activated?.();
    } catch (error) {
      if (!this.closed && this.current() && request.revision === this.state.revision) { this.failed = true; this.set({ status: 'error', error: errorText(error) }); }
    } finally {
      this.inFlight = false;
      if (!this.closed && this.current() && this.state.confirmedRevision !== this.state.revision && (!this.failed || this.desired.length === 0 && request.revision !== this.state.revision)) this.schedule();
    }
  }

  /** Release immediately, even while an older activation awaits. Native reserves
   * this higher revision before initialization can finish, preventing resurrection.
   * Captured terminal IDs remain safe after owner expiry: native closes only that
   * old activity or acknowledges an already retired context. */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.sources.clear(); this.desired = [];
    this.set({ status: 'closed', desiredCount: 0, revision: this.state.revision + 1n });
    this.disposal = this.sent
      ? this.options.backend.updateRowActivity(this.request([], this.state.revision, true)).then(() => {}, () => {})
      : Promise.resolve();
    return this.disposal;
  }
}
