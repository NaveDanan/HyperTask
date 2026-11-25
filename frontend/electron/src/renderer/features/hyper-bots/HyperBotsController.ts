import type { IpcResult } from '@shared/api';
import type { HyperBotsApi, HyperBotsDelivery, HyperBotsEvent, HyperBotsSettings, HyperBotsSnapshot } from '@shared/HyperBots';
/** A rejected invoke (no handler, window closing) reads as a failure, so no busy flag or 'opening' phase sticks. */
function hyperBotsSettled(api: HyperBotsApi): HyperBotsApi {
  const failure = (error: unknown): IpcResult<never> => ({ ok: false, kind: 'other', message: error instanceof Error ? error.message : String(error) });
  const wrap = <A extends unknown[], T>(call: (...args: A) => Promise<IpcResult<T>>) => (...args: A): Promise<IpcResult<T>> => {
    try { return Promise.resolve(call(...args)).catch(failure); } catch (error) { return Promise.resolve(failure(error)); }
  };
  return {
    open: wrap(args => api.open(args)), snapshot: wrap(args => api.snapshot(args)), post: wrap(input => api.post(input)),
    decide: wrap(args => api.decide(args)), saveSettings: wrap(settings => api.saveSettings(settings)), models: wrap(() => api.models()),
    newsletterConnection: wrap(() => api.newsletterConnection()),
    saveNewsletterConnection: wrap(input => api.saveNewsletterConnection(input)),
    onEvent: listener => api.onEvent(listener),
  };
}
export interface HyperBotsRoomSummary {
  preview: string;
  pendingApprovals: number;
  activeRun: boolean;
  unread: boolean;
}
/** A one-line sidebar preview: replies are Markdown, so code blocks, link targets and emphasis marks are dropped. */
export const hyperBotsPreviewText = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '').replace(/\*\*|__|~~|`/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
export function hyperBotsRoomSummary(snapshot: HyperBotsSnapshot, unread = false): HyperBotsRoomSummary {
  const last = snapshot.messages.at(-1);
  return { preview: last ? hyperBotsPreviewText(last.text) : '',
    pendingApprovals: snapshot.approvals.filter(row => row.status === 'pending').length,
    activeRun: snapshot.runs.some(row => row.status === 'queued' || row.status === 'running'), unread };
}
export interface HyperBotsViewState {
  loadingEarlier?: boolean;
  summaries?: Record<string, HyperBotsRoomSummary>;
  phase: 'idle' | 'opening' | 'ready' | 'unavailable';
  snapshot: HyperBotsSnapshot | null;
  /** Model IDs the endpoint offers; [] until loaded or when discovery is unavailable. */
  models: string[];
  sending: boolean;
  saving: boolean;
  /** Approvals with a decision in flight. */
  deciding: string[];
  /** The last send or decision failure; it stays until the next action. */
  error?: string;
  /** The last settings save failure. */
  settingsError?: string;
  /** Why the room could not be opened or reloaded; a successful read clears it. */
  syncError?: string;
}
export type HyperBotsOutboxState = 'sending' | 'uncertain' | 'accepted';
export interface HyperBotsOutboxEntry { readonly roomId: string; readonly text: string; readonly model: string | null; readonly clientMessageId: string; state: HyperBotsOutboxState; attempts: number }
/**
 * The composer's draft and every unconfirmed post, outside any page or controller, so a remount never holds a stale
 * copy. An identical retry (same room, text and model) of an unaccepted post reuses its ID; other uncertain posts keep
 * theirs. Once any attempt is accepted, overlapping attempts count as accepted too, and the sent draft is cleared.
 */
export class HyperBotsOutbox {
  private entries: HyperBotsOutboxEntry[] = [];
  private readonly drafts = new Map<string, string>();
  private model = '';
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { for (const listener of this.listeners) listener(); }
  readonly draft = (roomId: string) => this.drafts.get(roomId) ?? '';
  readonly setDraft = (roomId: string, text: string) => { if (this.draft(roomId) !== text) { this.drafts.set(roomId, text); this.changed(); } };
  /** The composer's model choice; '' means each bot's own model. */
  readonly getModel = () => this.model;
  readonly setModel = (model: string) => { if (this.model !== model) { this.model = model; this.changed(); } };
  readonly list = (roomId: string) => this.entries.filter(entry => entry.roomId === roomId).map(entry => ({ ...entry }));
  /** Starts an attempt and returns the entry whose ID it must carry. */
  begin(roomId: string, text: string, model: string | null, uuid: () => string): HyperBotsOutboxEntry {
    let entry = this.entries.find(row => row.roomId === roomId && row.text === text && row.model === model && row.state !== 'accepted');
    if (!entry) this.entries.push(entry = { roomId, text, model, clientMessageId: uuid(), state: 'sending', attempts: 0 });
    entry.attempts++;
    entry.state = 'sending';
    this.changed();
    return entry;
  }
  /** Ends an attempt; true when the room holds the message, whichever attempt delivered it. */
  end(entry: HyperBotsOutboxEntry, ok: boolean): boolean {
    entry.attempts--;
    if (ok && entry.state !== 'accepted') {
      entry.state = 'accepted';
      this.drafts.set(entry.roomId, hyperBotsDraftAfterSend(this.draft(entry.roomId), entry.text));
    } else if (entry.state === 'sending' && !entry.attempts) entry.state = 'uncertain';
    if (entry.state === 'accepted' && !entry.attempts) this.entries = this.entries.filter(row => row !== entry);
    this.changed();
    return entry.state === 'accepted';
  }
}
const OUTBOXES = new Map<string, HyperBotsOutbox>();
/** One outbox per signed-in user for the life of the window, so one user's drafts never show for another. */
export function hyperBotsOutbox(userId: string) {
  let outbox = OUTBOXES.get(userId);
  if (!outbox) OUTBOXES.set(userId, outbox = new HyperBotsOutbox());
  return outbox;
}
const IDLE: Pick<HyperBotsViewState, 'sending' | 'saving' | 'deciding'> = { sending: false, saving: false, deciding: [] };
const INITIAL: HyperBotsViewState = { phase: 'idle', snapshot: null, models: [], ...IDLE };
const INITIAL_MESSAGES = 16;
const EARLIER_MESSAGES = 40;
/** One room of bots. Events only trigger snapshot reads; nothing is resent to recover. */
export class HyperBotsController {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private settingsRevision = 0;
  private disposed = false;
  private started = false;
  private offEvent?: () => void;
  private refreshing?: { generation: number; done: Promise<void> };
  private refreshAgain = false;
  private windowSize = INITIAL_MESSAGES;
  /** An event arrived before the room was open. */
  private missed = false;
  private modelsLoaded = false;
  private readonly summaryReads = new Map<string, { generation: number; again: boolean; done: Promise<void> }>();
  private readonly api: HyperBotsApi;
  constructor(api: HyperBotsApi, readonly outbox: HyperBotsOutbox, private readonly uuid: () => string = () => crypto.randomUUID()) { this.api = hyperBotsSettled(api); }
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<HyperBotsViewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(generation: number) { return !this.disposed && generation === this.generation; }
  /** Listens first, then opens, so no change between the two is missed. Restartable after dispose. Main knows the user. */
  async start(roomId?: string) {
    this.disposed = false; this.started = true; this.missed = false;
    const generation = ++this.generation;
    this.offEvent ??= this.api.onEvent(event => this.receive(event));
    this.set({ phase: 'opening', error: undefined, syncError: undefined, settingsError: undefined, ...IDLE });
    this.windowSize = INITIAL_MESSAGES;
    const opened = await this.api.open({ roomId: roomId ?? this.state.snapshot?.roomId, limit: INITIAL_MESSAGES });
    if (!this.current(generation)) return;
    if (!opened.ok) { this.set({ phase: 'unavailable', syncError: opened.message }); return; }
    this.applySnapshot(opened.value);
    void this.loadModels();
    void this.sweep();
    if (this.missed) { this.missed = false; void this.refresh(); }
  }
  private applySnapshot(snapshot: HyperBotsSnapshot) {
    const summaries = snapshot.roomSummaries ? Object.fromEntries(Object.entries(snapshot.roomSummaries).map(([id, row]) => [id, {
      ...row, preview: hyperBotsPreviewText(row.preview), unread: this.state.summaries?.[id]?.unread ?? false,
    }])) : this.state.summaries;
    this.set({ phase: 'ready', snapshot, syncError: undefined, summaries: { ...summaries,
      [snapshot.roomId]: hyperBotsRoomSummary(snapshot) } });
  }
  /** Navigation cancels stale reads, never the outbox: each room retains its own draft and retry IDs. */
  async select(roomId: string) {
    if (this.disposed || roomId === this.state.snapshot?.roomId && this.state.phase === 'ready') return;
    if (!this.state.snapshot?.settings.rooms.some(room => room.id === roomId)) return;
    const generation = ++this.generation;
    this.set({ phase: 'opening', error: undefined, syncError: undefined, loadingEarlier: false, ...IDLE });
    const result = await this.api.open({ roomId, limit: INITIAL_MESSAGES });
    if (!this.current(generation)) return;
    if (!result.ok) { this.set({ phase: this.state.snapshot ? 'ready' : 'unavailable', syncError: result.message }); return; }
    this.windowSize = INITIAL_MESSAGES;
    this.applySnapshot(result.value);
    void this.sweep();
    if (this.missed) { this.missed = false; void this.refresh(); }
  }
  /** A single sweep after open/settings; event reads are coalesced separately per other room. */
  private async sweep() {
    const snapshot = this.state.snapshot;
    if (!snapshot || snapshot.roomSummaries) return;
    await Promise.all(snapshot.settings.rooms.filter(room => room.id !== snapshot.roomId).map(room => this.readSummary(room.id)));
  }
  private readSummary(roomId: string): Promise<void> {
    const generation = this.generation;
    const existing = this.summaryReads.get(roomId);
    if (existing?.generation === generation) { existing.again = true; return existing.done; }
    const read = { generation, again: false, done: Promise.resolve() };
    const run = async () => {
      do {
        read.again = false;
        const result = await this.api.snapshot({ roomId });
        if (!this.current(generation)) return;
        if (result.ok && this.state.snapshot?.roomId !== roomId && this.state.snapshot?.settings.rooms.some(room => room.id === roomId)) {
          this.set({ summaries: { ...this.state.summaries, [roomId]: hyperBotsRoomSummary(result.value, this.state.summaries?.[roomId]?.unread) } });
        }
      } while (read.again);
    };
    read.done = run().finally(() => { if (this.summaryReads.get(roomId) === read) this.summaryReads.delete(roomId); });
    this.summaryReads.set(roomId, read);
    return read.done;
  }
  /** Reversible, so a StrictMode effect replay can start again. */
  dispose() {
    this.disposed = true; this.generation++;
    this.offEvent?.(); this.offEvent = undefined;
  }
  /** Once per controller; a failed discovery is tried again on the next start. */
  private async loadModels() {
    if (this.modelsLoaded) return;
    this.modelsLoaded = true;
    const result = await this.api.models();
    if (result.ok) this.set({ models: result.value }); else this.modelsLoaded = false;
  }
  private receive(event: HyperBotsEvent) {
    if (this.disposed) return;
    const snapshot = this.state.snapshot;
    if (this.state.phase !== 'ready' || !snapshot) { this.missed = true; return; }
    if (event.type === 'connections') { void this.refresh(); return; }
    if (event.type === 'settings') { void this.refresh().then(() => this.sweep()); return; }
    if (event.roomId === snapshot.roomId) { void this.refresh(); return; }
    if (!snapshot.settings.rooms.some(room => room.id === event.roomId)) return;
    const previous = this.state.summaries?.[event.roomId] ?? { preview: '', pendingApprovals: 0, activeRun: false, unread: false };
    this.set({ summaries: { ...this.state.summaries, [event.roomId]: { ...previous, unread: previous.unread || event.type === 'message',
      ...(event.type === 'run' ? { activeRun: event.status === 'running' || event.status === 'queued' } : {}) } } });
    if (snapshot.roomSummaries) void this.refresh();
    else void this.readSummary(event.roomId);
  }
  /** Coalesced per generation: one read at a time, repeated once if more refreshes arrived meanwhile. */
  refresh(): Promise<void> {
    if (this.disposed || this.state.phase === 'opening') return Promise.resolve();
    const generation = this.generation;
    if (this.refreshing?.generation === generation) { this.refreshAgain = true; return this.refreshing.done; }
    const run = async () => {
      do {
        this.refreshAgain = false;
        const roomId = this.state.snapshot?.roomId;
        if (!roomId) return;
        const revision = this.settingsRevision;
        const fromMessageId = this.windowSize > INITIAL_MESSAGES ? this.state.snapshot?.messages[0]?.id : undefined;
        const result = await this.api.snapshot({ roomId, limit: this.windowSize, ...(fromMessageId && { fromMessageId }) });
        if (!this.current(generation)) return;
        // A read begun before a settings save must not erase newly created rooms or tool changes.
        if (revision !== this.settingsRevision) { this.refreshAgain = true; continue; }
        if (!result.ok) { this.set({ syncError: result.message }); return; }
        this.applySnapshot(result.value);
      } while (this.refreshAgain);
    };
    const refreshing = { generation, done: run().finally(() => { if (this.refreshing === refreshing) this.refreshing = undefined; }) };
    this.refreshing = refreshing;
    return refreshing.done;
  }
  /** Reloads the room, or opens it again when it never opened. */
  readonly reload = () => this.state.snapshot || !this.started ? this.refresh() : this.start();
  async loadEarlier() {
    const snapshot = this.state.snapshot;
    if (!snapshot?.hasEarlier || this.state.phase !== 'ready' || this.state.loadingEarlier) return;
    const generation = this.generation;
    this.windowSize = Math.min(100_000, snapshot.messages.length + EARLIER_MESSAGES);
    this.set({ loadingEarlier: true });
    try { await this.refresh(); }
    finally { if (this.current(generation)) this.set({ loadingEarlier: false }); }
  }
  /** Resolves true once the room accepted the message. A failed post keeps its ID in the outbox for an identical retry. */
  async send(text: string, model: string | null = null): Promise<boolean> {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.phase !== 'ready' || this.state.sending || !text.trim()) return false;
    const entry = this.outbox.begin(snapshot.roomId, text, model || null, this.uuid);
    const generation = this.generation;
    this.set({ sending: true, error: undefined });
    const result = await this.api.post({ roomId: snapshot.roomId, clientMessageId: entry.clientMessageId, text, model: entry.model });
    // Recorded even when this controller is gone, so whichever page is open now sees the message as sent.
    // The room deduplicates by ID, so an attempt that failed after an identical one was accepted was accepted too.
    const accepted = this.outbox.end(entry, result.ok);
    if (!this.current(generation)) return accepted;
    this.set({ sending: false, ...(accepted || result.ok ? {} : { error: result.message }) });
    void this.refresh();
    return accepted;
  }
  /** `delivery`: Send or Save to Drafts, given only when approving a mail write. */
  async decide(approvalId: string, approved: boolean, delivery?: HyperBotsDelivery): Promise<boolean> {
    if (this.state.deciding.includes(approvalId)) return false;
    const generation = this.generation;
    this.set({ deciding: [...this.state.deciding, approvalId], error: undefined });
    const result = await this.api.decide(delivery ? { approvalId, approved, delivery } : { approvalId, approved });
    if (!this.current(generation)) return result.ok;
    this.set({ deciding: this.state.deciding.filter(id => id !== approvalId), ...(result.ok ? {} : { error: result.message }) });
    void this.refresh();
    return result.ok;
  }
  async saveSettings(settings: HyperBotsSettings): Promise<boolean> {
    if (this.state.saving) return false;
    const generation = this.generation;
    this.set({ saving: true, settingsError: undefined });
    const result = await this.api.saveSettings(settings);
    if (!this.current(generation)) return result.ok;
    if (!result.ok) { this.set({ saving: false, settingsError: result.message }); return false; }
    const snapshot = this.state.snapshot;
    this.settingsRevision++;
    this.set({ saving: false, ...(snapshot ? { snapshot: { ...snapshot, settings: result.value } } : {}) });
    if (snapshot && !result.value.rooms.some(room => room.id === snapshot.roomId)) {
      const first = result.value.bots[0];
      const fallback = result.value.rooms.find(room => room.kind === 'direct' && room.botIds[0] === first?.id) ?? result.value.rooms[0];
      if (fallback) await this.select(fallback.id);
    } else void this.refresh();
    void this.sweep();
    return true;
  }
}
/** After a send succeeds, only the text that was sent is cleared; anything typed meanwhile stays. */
export const hyperBotsDraftAfterSend = (current: string, sent: string) => current === sent ? '' : current;
