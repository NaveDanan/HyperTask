import type { HyperNodApi } from '@shared/api';
import { HYPER_NOD_MESSAGES, hyperNodChoiceText, type HyperNodActivity, type HyperNodAnswer, type HyperNodEvent, type HyperNodMessage, type HyperNodProblem, type HyperNodSnapshot, type HyperNodStatus } from '@shared/HyperNod';
import { HYPER_NOD_NO_STREAMS, hyperNodContiguous, hyperNodCursor, hyperNodDelta, hyperNodMergeOlder, hyperNodPersisted, type HyperNodStreams } from './HyperNodStore';
export interface HyperNodViewState {
  phase: 'checking' | 'unavailable' | 'ready';
  status: HyperNodStatus | null;
  /** Unavailable for a transient reason; another readiness check is scheduled. */
  retrying: boolean;
  snapshot: HyperNodSnapshot | null;
  older: HyperNodMessage[];
  /** Undefined until a page was read; the snapshot's hasEarlierMessages applies until then. */
  olderHasMore?: boolean;
  /** Questions and approvals answered here, or found settled, whose loaded copy may still say pending. */
  retired: string[];
  streams: HyperNodStreams;
  activity: HyperNodActivity[];
  connection: 'connecting' | 'live' | 'reconnecting';
  connectionError?: string;
  loadingOlder: boolean;
  sending: boolean;
  stopping: boolean;
  /** The last send, stop or history failure; it stays until the next action. */
  error?: string;
  /** Why the conversation could not be reloaded; a successful reload clears it. */
  syncError?: string;
}
/**
 * A send's retry identity outlives its page, so an identical retry after reopening reuses the ID. Once any
 * attempt with that ID is accepted, overlapping attempts count as accepted too, and the identity ends with the last.
 */
export interface HyperNodSendMemory { pending?: { key: string; id: string; attempts: number; accepted: boolean } }
const SEND_MEMORY: HyperNodSendMemory = {};
const IDLE: Pick<HyperNodViewState, 'loadingOlder' | 'sending' | 'stopping'> = { loadingOlder: false, sending: false, stopping: false };
const INITIAL: HyperNodViewState = { phase: 'checking', status: null, retrying: false, snapshot: null, older: [], retired: [], streams: HYPER_NOD_NO_STREAMS, activity: [], connection: 'connecting', ...IDLE };
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
/** Problems that can clear by themselves, such as Nod or the VM restarting. Others wait for the owner. */
const TRANSIENT: readonly HyperNodProblem[] = ['unreachable', 'ssh_unavailable'];
const delay = (attempt: number) => BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
type Outcome = 'sent' | 'unavailable' | 'failed';
/** Nod has one durable conversation. Reconnects reload it; nothing is resent to recover a reply. */
export class HyperNodController {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  /** Changes whenever loaded history is discarded, so a page requested before cannot attach to the new rows. */
  private historyEpoch = 0;
  private disposed = false;
  private offEvent?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private syncAttempts = 0;
  private refreshing?: { generation: number; done: Promise<void> };
  private refreshAgain = false;
  constructor(private readonly api: HyperNodApi, private readonly uuid: () => string = () => crypto.randomUUID(), private readonly memory: HyperNodSendMemory = SEND_MEMORY) {}
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<HyperNodViewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(generation: number) { return !this.disposed && generation === this.generation; }
  /** Starts or restarts. Work owned by an earlier generation can no longer update or block this one. */
  async start() {
    this.disposed = false;
    clearTimeout(this.retryTimer); clearTimeout(this.syncTimer);
    const generation = ++this.generation;
    this.offEvent ??= this.api.onEvent(event => this.receive(event));
    this.set({ phase: 'checking', retrying: false, error: undefined, syncError: undefined, connectionError: undefined, connection: 'connecting', ...IDLE });
    if (await this.check(generation)) await this.connect(generation);
  }
  readonly retry = () => { this.attempts = 0; return this.start(); };
  /** Reversible, so a StrictMode effect replay can start again. */
  dispose() {
    this.disposed = true; this.generation++;
    clearTimeout(this.retryTimer); clearTimeout(this.syncTimer);
    this.offEvent?.(); this.offEvent = undefined;
    this.api.unsubscribe();
  }
  private async check(generation: number) {
    const status = await this.api.status();
    if (!this.current(generation)) return false;
    const value: HyperNodStatus = status.ok ? status.value : { ready: false, problem: 'operation_failed', detail: status.message };
    if (value.ready) { this.set({ phase: 'ready', status: value, retrying: false }); return true; }
    // State reads wait for readiness; reconnecting reloads state anyway.
    clearTimeout(this.syncTimer);
    const retrying = TRANSIENT.includes(value.problem);
    this.set({ phase: 'unavailable', status: value, retrying });
    if (retrying) this.schedule(generation, () => this.check(generation).then(ready => { if (ready) return this.connect(generation); }));
    return false;
  }
  private schedule(generation: number, run: () => Promise<unknown>) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (this.current(generation)) void run(); }, delay(this.attempts++));
  }
  private async connect(generation: number) {
    const result = await this.api.subscribe();
    if (!this.current(generation)) return;
    if (!result.ok) this.reconnectLater(generation, result.message);
  }
  private reconnectLater(generation: number, reason: string) {
    this.set({ connection: 'reconnecting', connectionError: reason });
    this.schedule(generation, () => this.check(generation).then(ready => { if (ready) return this.connect(generation); }));
  }
  private receive(event: HyperNodEvent) {
    if (this.disposed || this.state.phase !== 'ready') return;
    if (event.type === 'connected') { this.attempts = 0; this.set({ connection: 'live', connectionError: undefined }); void this.refresh(); }
    else if (event.type === 'refresh') void this.refresh();
    else if (event.type === 'activity') this.set({ activity: event.items });
    else if (event.type === 'disconnected') this.reconnectLater(this.generation, event.reason);
    else if (this.state.snapshot && event.threadId !== this.state.snapshot.threadId) void this.refresh();
    else this.set({ streams: hyperNodDelta(this.state.streams, event) });
  }
  /** Coalesced per generation: one read at a time, repeated once if more refreshes arrived meanwhile. A failed read retries with backoff while Nod is ready. */
  refresh(): Promise<void> {
    const generation = this.generation;
    if (this.refreshing?.generation === generation) { this.refreshAgain = true; return this.refreshing.done; }
    this.refreshAgain = false;
    clearTimeout(this.syncTimer);
    const run = async () => {
      do {
        this.refreshAgain = false;
        const result = await this.api.state();
        if (!this.current(generation)) return;
        if (!result.ok) {
          this.set({ syncError: result.message });
          if (this.state.phase === 'ready') this.syncTimer = setTimeout(() => { if (this.current(generation) && this.state.phase === 'ready') void this.refresh(); }, delay(this.syncAttempts++));
          return;
        }
        this.syncAttempts = 0;
        this.apply(result.value);
      } while (this.refreshAgain);
    };
    const refreshing = { generation, done: run().finally(() => { if (this.refreshing === refreshing) this.refreshing = undefined; }) };
    this.refreshing = refreshing;
    return refreshing.done;
  }
  private apply(snapshot: HyperNodSnapshot) {
    const previous = this.state.snapshot?.threadId === snapshot.threadId ? this.state.snapshot : null;
    const known = previous ? [...this.state.older, ...previous.messages] : [];
    // Nod lists only its latest hidden IDs. When more were hidden than listed, cached rows may be hidden ones.
    const capped = !!previous && snapshot.hiddenMessageCount !== previous.hiddenMessageCount && snapshot.hiddenMessageCount > snapshot.hiddenMessageIds.length;
    const keep = !!previous && !capped && hyperNodContiguous(known, snapshot);
    if (!keep) this.historyEpoch++;
    this.set({
      snapshot, older: keep ? hyperNodMergeOlder(known, [], snapshot) : [], olderHasMore: keep ? this.state.olderHasMore : undefined, retired: previous ? this.state.retired : [],
      streams: hyperNodPersisted(this.state.streams, snapshot), activity: snapshot.activity, syncError: undefined,
    });
  }
  readonly reload = () => { this.syncAttempts = 0; return this.refresh(); };
  hasOlder() { return this.state.olderHasMore ?? this.state.snapshot?.hasEarlierMessages ?? false; }
  async loadOlder() {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.loadingOlder || !this.hasOlder()) return;
    const cursor = hyperNodCursor(snapshot, this.state.older);
    if (!cursor) return;
    const generation = this.generation, epoch = this.historyEpoch;
    this.set({ loadingOlder: true });
    const page = await this.api.history(cursor);
    if (!this.current(generation)) return;
    const latest = this.state.snapshot;
    if (!page.ok) { this.set({ loadingOlder: false, error: page.message }); void this.refresh(); return; }
    if (!latest || epoch !== this.historyEpoch) { this.set({ loadingOlder: false }); return; }
    this.set({ loadingOlder: false, older: hyperNodMergeOlder(this.state.older, page.value.messages, latest), olderHasMore: page.value.hasMore });
  }
  /** Resolves true once Nod accepted the message. A failed send keeps its ID for an identical retry. */
  async send(text: string): Promise<boolean> { return await this.submit(text) === 'sent'; }
  private async submit(text: string, reply?: { replyToMessageId: string; answer?: HyperNodAnswer }): Promise<Outcome> {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.sending || !text.trim()) return 'failed';
    const key = JSON.stringify([snapshot.threadId, text, reply?.replyToMessageId ?? null, reply?.answer ?? null]);
    let pending = this.memory.pending;
    if (pending?.key !== key || (pending.accepted && pending.attempts === 0)) pending = this.memory.pending = { key, id: this.uuid(), attempts: 0, accepted: false };
    pending.attempts++;
    const generation = this.generation;
    this.set({ sending: true, error: undefined });
    const result = await this.api.send({ text, threadId: snapshot.threadId, clientMessageId: pending.id, ...reply });
    pending.attempts--;
    if (result.ok) pending.accepted = true;
    // Nod deduplicates by ID, so an attempt that failed after an identical one was accepted was accepted too.
    const accepted = pending.accepted;
    if (accepted && pending.attempts === 0 && this.memory.pending === pending) this.memory.pending = undefined;
    const outcome: Outcome = accepted ? 'sent' : !result.ok && result.message.startsWith(HYPER_NOD_MESSAGES.request_unavailable) ? 'unavailable' : 'failed';
    if (!this.current(generation)) return outcome;
    this.set({ sending: false, ...(accepted || result.ok ? {} : { error: result.message }) });
    void this.refresh();
    return outcome;
  }
  /** Answers settle their request. A request Nod reports as no longer waiting is retired too. */
  private async answer(message: HyperNodMessage, text: string, answer: HyperNodAnswer) {
    const outcome = await this.submit(text, { replyToMessageId: message.id, answer });
    if (outcome !== 'failed' && !this.state.retired.includes(message.id)) this.set({ retired: [...this.state.retired, message.id] });
    return outcome === 'sent';
  }
  answerChoices(message: HyperNodMessage, choiceIds: readonly string[]) {
    const options = message.choices?.options.filter(option => choiceIds.includes(option.id)) ?? [];
    if (!options.length) return Promise.resolve(false);
    return this.answer(message, hyperNodChoiceText(options), { kind: 'choices', choiceIds: options.map(option => option.id) });
  }
  /** A written answer to a choice question targets it, so Nod resumes the task that asked. */
  answerWritten(message: HyperNodMessage, text: string) {
    if (!message.choices || !text.trim()) return Promise.resolve(false);
    return this.answer(message, text, { kind: 'written' });
  }
  answerApproval(message: HyperNodMessage, approved: boolean) {
    if (!message.approval) return Promise.resolve(false);
    return this.answer(message, hyperNodApprovalLabels(message.approval.title)[approved ? 'approve' : 'decline'], { kind: 'approval', approvalId: message.approval.id, approved });
  }
  async stop() {
    if (this.state.stopping) return;
    const generation = this.generation;
    this.set({ stopping: true, error: undefined });
    const result = await this.api.stop();
    if (!this.current(generation)) return;
    this.set({ stopping: false, ...(result.ok ? {} : { error: result.message }) });
    void this.refresh();
  }
}
/** Nod's approval card labels (src/web/components/action-card.tsx): the title's verb, or Cancel/No. */
export function hyperNodApprovalLabels(title: string) {
  return { approve: title.split(' ')[0] || 'Approve', decline: /^cancel\b/i.test(title) ? 'No' : 'Cancel' };
}
/** After a send succeeds, only the text that was sent is cleared; anything typed meanwhile stays. */
export const hyperNodDraftAfterSend = (current: string, sent: string) => current === sent ? '' : current;
