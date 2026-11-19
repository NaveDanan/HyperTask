import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HyperBotAttachmentSchema } from './HyperBotFiles';
import type {
  HyperBotAttachment, HyperBotMemory, HyperBotsAccess, HyperBotsApproval, HyperBotsApprovalStatus, HyperBotsCardRow, HyperBotsDelivery, HyperBotsMessage, HyperBotsRunStatus, HyperBotsRunSummary, HyperBotsSettings,
} from '@shared/HyperBots';

// Durable HyperBots state in one JSON file. Every mutation rewrites it atomically (tmp, fsync, rename);
// a failed write rolls the in-memory state back, so memory never claims what disk does not hold.

// OpenAI chat-completions wire shapes (subset).
export type HyperBotsToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type HyperBotsChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: HyperBotAttachment[] }
  | { role: 'assistant'; content: string | null; tool_calls?: HyperBotsToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type HyperBotsToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type HyperBotsRun = HyperBotsRunSummary & { transcript: HyperBotsChatMessage[] };
/** The approval as stored: `fingerprint` binds the call to its destination and never leaves main. */
export type HyperBotsApprovalRecord = HyperBotsApproval & { fingerprint: string | null };
/** One planned run of a message: the bot and the model captured when the message was stored. */
export type HyperBotsPlanEntry = { botId: string; model: string };
export type HyperBotsRecall = { message: HyperBotsMessage; sameText: boolean; live: boolean; plan: HyperBotsPlanEntry[] | null };
export type HyperBotsStored = HyperBotsRecall & { created: boolean; runs: HyperBotsRun[]; added: HyperBotsRun[] };

export const HYPER_BOTS_RECOVER_ERROR = 'HyperTask stopped while this call was running; it was not retried.';
export const HYPER_BOTS_DAMAGED_RUN = 'Stored run was damaged and was stopped.';
export const HYPER_BOTS_DAMAGED_APPROVAL = 'Stored request was damaged; it was not run.';
export const HYPER_BOTS_ORPHAN = JSON.stringify({ error: 'This request no longer applies; the call was not made.' });
export const HYPER_BOTS_ROOM_MESSAGES = 2000;
// Idempotency tombstones (owner messages only) outlive display history so a pruned clientMessageId stays a
// duplicate. ~150 bytes each; past this cap the oldest are forgotten (about 100k owner messages).
export const HYPER_BOTS_TOMBSTONES = 100_000;
const KEEP_TRANSCRIPTS = 50; // finished runs beyond the newest 50 drop their transcript

const ACTIVE: HyperBotsApprovalStatus[] = ['pending', 'approved', 'executing'];
const Count = z.int().min(0);
const Iso = z.iso.datetime();
const ToolCall = z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) });
const ChatMessage = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string(), attachments: z.array(HyperBotAttachmentSchema).max(4).optional() }),
  z.object({ role: z.literal('assistant'), content: z.string().nullable(), tool_calls: z.array(ToolCall).optional() }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string(), content: z.string() }),
]);
const PlanEntry = z.object({ botId: z.string(), model: z.string() });
const MessageRow = z.object({
  id: z.string().min(1), roomId: z.string(), clientMessageId: z.string(),
  author: z.discriminatedUnion('kind', [z.object({ kind: z.literal('user') }), z.object({ kind: z.literal('bot'), botId: z.string() })]),
  text: z.string(), model: z.string().nullable(), runId: z.string().nullable(), hop: Count, createdAt: Iso, seq: Count,
  attachments: z.array(HyperBotAttachmentSchema).max(4).optional(),
  scheduled: z.literal(true).optional(),
  routineId: z.uuid().optional(),
  plan: z.array(PlanEntry).nullable().default(null),
});
const RunRow = z.object({
  id: z.string().min(1), roomId: z.string(), botId: z.string(), triggerMessageId: z.string(), model: z.string(),
  status: z.enum(['queued', 'running', 'waiting_approval', 'done', 'failed']), steps: Count, error: z.string().nullable(),
  createdAt: Iso, updatedAt: Iso, transcript: z.array(ChatMessage),
});
const CardRow = z.strictObject({ label: z.string().max(80), value: z.string().max(20000), tone: z.literal('warning').optional(), long: z.boolean().optional() });
const ApprovalRow = z.object({
  id: z.string().min(1), runId: z.string(), roomId: z.string(), botId: z.string(), toolCallId: z.string(), tool: z.string(),
  access: z.enum(['read', 'write']), args: z.unknown(), summary: z.string(),
  destination: z.string().nullable().default(null), fingerprint: z.string().nullable().default(null),
  // Files from before cards and Send/Save to Drafts load with neither.
  card: z.array(CardRow).max(40).nullable().default(null), delivery: z.enum(['send', 'draft']).nullable().default(null),
  status: z.enum(['pending', 'approved', 'denied', 'executing', 'done', 'failed', 'unknown', 'skipped']),
  decidedBy: z.enum(['policy', 'owner']).nullable(), result: z.string().nullable(), error: z.string().nullable(), createdAt: Iso, updatedAt: Iso,
});
const Tombstone = z.object({ id: z.string().min(1), hash: z.string(), model: z.string().nullable(), createdAt: Iso });
const MemoryRow = z.object({ id: z.uuid(), botId: z.string(), roomId: z.string(), text: z.string().min(1).max(240) });
const Shape = z.object({
  version: z.literal(1), seq: Count, messages: z.array(MessageRow), runs: z.array(z.unknown()), approvals: z.array(z.unknown()),
  memory: z.array(MemoryRow).default([]),
  tombstones: z.record(z.string(), Tombstone).default({}),
  settings: z.record(z.string(), z.unknown()).nullable(),
});

type Stored = HyperBotsMessage & { seq: number; plan: HyperBotsPlanEntry[] | null };
type Tomb = z.infer<typeof Tombstone>;
type State = {
  version: 1; seq: number; messages: Stored[]; runs: HyperBotsRun[]; approvals: HyperBotsApprovalRecord[];
  memory: HyperBotMemory[];
  tombstones: Record<string, Tomb>; settings: HyperBotsSettings | null;
};
const empty = (): State => ({ version: 1, seq: 0, messages: [], runs: [], approvals: [], memory: [], tombstones: {}, settings: null });
const now = () => new Date().toISOString();
const copy = <T>(value: T): T => structuredClone(value);
const finished = (s: HyperBotsRunStatus) => s === 'done' || s === 'failed';
const strip = ({ seq: _seq, plan: _plan, ...m }: Stored): HyperBotsMessage => copy(m);
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64url').slice(0, 22); // 132 bits: plenty to tell two texts apart
const messageHash = (text: string, attachments?: HyperBotAttachment[]) => attachments?.length
  ? 'files:' + hash(JSON.stringify([text, attachments.map(({ id, name, type }) => [id, name, type])])) : hash(text);
const key = (roomId: string, clientMessageId: string) => `${roomId}/${clientMessageId}`;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const isCount = (v: unknown): v is number => Count.safeParse(v).success;

/** A run row that fails validation is kept as a failed run (never executed); null when it cannot be identified. */
function quarantineRun(row: unknown, t: string): HyperBotsRun | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id, roomId: text(r.roomId), botId: text(r.botId), triggerMessageId: text(r.triggerMessageId), model: text(r.model),
    status: 'failed', steps: isCount(r.steps) ? r.steps : 0, error: HYPER_BOTS_DAMAGED_RUN,
    createdAt: Iso.safeParse(r.createdAt).success ? (r.createdAt as string) : t, updatedAt: t, transcript: [],
  };
}

/** A damaged approval becomes 'unknown': it is never run, and its run gets the unknown-outcome result. */
function quarantineApproval(row: unknown, t: string): HyperBotsApprovalRecord | null {
  const a = row as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id || typeof a.runId !== 'string' || typeof a.toolCallId !== 'string') return null;
  return {
    id: a.id, runId: a.runId, roomId: text(a.roomId), botId: text(a.botId), toolCallId: a.toolCallId, tool: text(a.tool),
    access: a.access === 'read' ? 'read' : 'write', args: null, summary: text(a.summary), destination: null, fingerprint: null, card: null, delivery: null,
    status: 'unknown', decidedBy: null, result: null, error: HYPER_BOTS_DAMAGED_APPROVAL,
    createdAt: Iso.safeParse(a.createdAt).success ? (a.createdAt as string) : t, updatedAt: t,
  };
}

/** Validates a parsed file. Damaged runs/approvals are quarantined; anything else invalid rejects the whole file. */
export function hyperBotsParseState(value: unknown): { state: State; repaired: boolean } | null {
  const shape = Shape.safeParse(value);
  if (!shape.success) return null;
  const t = now();
  let repaired = false;
  const runs: HyperBotsRun[] = [];
  for (const row of shape.data.runs) {
    const ok = RunRow.safeParse(row);
    if (ok.success) { runs.push(ok.data as HyperBotsRun); continue; }
    const q = quarantineRun(row, t);
    if (!q) return null;
    runs.push(q); repaired = true;
  }
  const damaged = new Set(runs.filter((r) => r.error === HYPER_BOTS_DAMAGED_RUN).map((r) => r.id));
  const approvals: HyperBotsApprovalRecord[] = [];
  for (const row of shape.data.approvals) {
    const ok = ApprovalRow.safeParse(row);
    let a = ok.success ? (ok.data as HyperBotsApprovalRecord) : quarantineApproval(row, t);
    if (!a) return null;
    if (!ok.success) repaired = true;
    // A stopped run never resumes: its open requests are closed without a call.
    if (damaged.has(a.runId) && (a.status === 'pending' || a.status === 'approved')) {
      a = { ...a, status: 'skipped', result: HYPER_BOTS_ORPHAN, error: HYPER_BOTS_DAMAGED_RUN, updatedAt: t };
      repaired = true;
    }
    approvals.push(a);
  }
  const messages = shape.data.messages as Stored[];
  const tombstones = shape.data.tombstones as Record<string, Tomb>;
  // Older files have no tombstones: owner messages still on file get theirs now.
  for (const m of messages) {
    const k = key(m.roomId, m.clientMessageId);
    if (m.author.kind === 'user' && !own(tombstones, k)) tombstones[k] = { id: m.id, hash: messageHash(m.text, m.attachments), model: m.model, createdAt: m.createdAt };
  }
  const settings = shape.data.settings as HyperBotsSettings | null;
  return { state: { version: 1, seq: shape.data.seq, messages, runs, approvals, memory: shape.data.memory, tombstones, settings }, repaired };
}

export class HyperBotsStore {
  readonly file: string | null;
  private state: State;
  private saved: string;

  constructor(file: string | null) {
    this.file = file;
    const loaded = file ? this.load(file) : { state: empty(), repaired: false };
    this.state = loaded.state;
    const repaired = loaded.repaired;
    this.saved = JSON.stringify(this.state);
    // A quarantined run is written back at once so it stays stopped even if nothing else changes.
    if (repaired && file) try { this.write(this.saved); } catch { /* retried with the next write */ }
  }

  private load(file: string): { state: State; repaired: boolean } {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: empty(), repaired: false };
      throw e;
    }
    try {
      const parsed = hyperBotsParseState(JSON.parse(raw));
      if (parsed) return parsed;
    } catch { /* corrupt: set aside below */ }
    fs.renameSync(file, `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    return { state: empty(), repaired: false };
  }

  /** Applies `change` and persists it; on a failed write the state is restored and the error rethrown. */
  private mutate<T>(change: (s: State) => T): T {
    try {
      const out = change(this.state);
      const json = JSON.stringify(this.state);
      if (this.file) this.write(json);
      this.saved = json;
      return out;
    } catch (e) {
      this.state = JSON.parse(this.saved) as State;
      throw e;
    }
  }

  private write(json: string): void {
    const file = this.file!;
    const tmp = `${file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, json, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, file); return; } catch (e) {
        // Windows: a scanner holding the target briefly makes rename fail with EPERM/EBUSY.
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
  }

  settings(): HyperBotsSettings | null { return this.state.settings ? copy(this.state.settings) : null; }
  saveSettings(s: HyperBotsSettings): void {
    this.mutate(st => {
      st.settings = copy(s);
      st.memory = st.memory.filter(note => s.bots.some(bot => bot.id === note.botId) && s.rooms.some(room => room.id === note.roomId && room.botIds.includes(note.botId)));
    });
  }

  memories(roomId: string, botId: string): HyperBotMemory[] {
    return this.state.memory.filter(note => note.roomId === roomId && note.botId === botId).map(copy);
  }

  learn(note: Omit<HyperBotMemory, 'id'>): boolean {
    const prior = this.state.memory.filter(row => row.roomId === note.roomId && row.botId === note.botId);
    if (prior.some(row => row.text.toLowerCase() === note.text.toLowerCase())) return false;
    return this.mutate(st => {
      const overflow = new Set(prior.slice(0, -39).map(row => row.id));
      st.memory = st.memory.filter(row => !overflow.has(row.id));
      st.memory.push({ ...note, id: randomUUID() });
      return true;
    });
  }

  forget(roomId: string, id: string): void {
    if (this.state.memory.some(note => note.roomId === roomId && note.id === id)) {
      this.mutate(st => { st.memory = st.memory.filter(note => !(note.roomId === roomId && note.id === id)); });
    }
  }

  addMessage(input: Omit<HyperBotsMessage, 'id' | 'createdAt'>): { message: HyperBotsMessage; created: boolean; sameText: boolean } {
    const { message, created, sameText } = this.addMessageWithRuns(input, null);
    return { message, created, sameText };
  }

  /**
   * Stores a message and its whole run plan in ONE write. A repeat of (roomId, clientMessageId) creates nothing new,
   * except the planned runs that are missing (with the models captured in the stored plan). A message whose display
   * record was pruned is recalled from its tombstone and never gets runs again.
   */
  addMessageWithRuns(
    input: Omit<HyperBotsMessage, 'id' | 'createdAt'>, plan: HyperBotsPlanEntry[] | null,
    seed: (trigger: HyperBotsMessage, botId: string) => HyperBotsChatMessage[] = () => [],
  ): HyperBotsStored {
    const prior = this.recall(input.roomId, input.clientMessageId, input.text, input.attachments);
    if (prior) {
      const runs = this.state.runs.filter((r) => r.triggerMessageId === prior.message.id);
      const unchanged = { ...prior, created: false, runs: runs.map(copy), added: [] };
      if (!prior.sameText || !prior.live) return unchanged;
      // A message stored before plans existed adopts the given plan only if it never got any run.
      const adopt = !prior.plan && !runs.length && !!plan?.length;
      const missing = (prior.plan ?? (adopt ? plan! : [])).filter((p) => !runs.some((r) => r.botId === p.botId));
      if (!missing.length) return unchanged;
      return this.mutate((st) => {
        const m = st.messages.find((x) => x.id === prior.message.id)!;
        if (adopt) m.plan = copy(plan);
        const added = missing.map((p) => this.newRun(st, strip(m), p, seed));
        return { ...prior, plan: copy(m.plan), created: false, runs: st.runs.filter((r) => r.triggerMessageId === m.id).map(copy), added: added.map(copy) };
      });
    }
    return this.mutate((st) => {
      const m: Stored = {
        id: randomUUID(), roomId: input.roomId, clientMessageId: input.clientMessageId, author: copy(input.author), text: input.text,
        model: input.model ?? null, runId: input.runId ?? null, hop: input.hop, createdAt: now(), seq: ++st.seq, plan: plan ? copy(plan) : null,
      };
      if (input.scheduled) m.scheduled = true;
      if (input.routineId) m.routineId = input.routineId;
      if (input.attachments?.length) m.attachments = copy(input.attachments);
      st.messages.push(m);
      if (m.author.kind === 'user') this.tombstone(st, m);
      const message = strip(m);
      const added = (plan ?? []).map((p) => this.newRun(st, message, p, seed));
      this.prune(st, m.roomId);
      return { message, sameText: true, live: true, plan: copy(m.plan), created: true, runs: added.map(copy), added: added.map(copy) };
    });
  }

  private newRun(st: State, trigger: HyperBotsMessage, p: HyperBotsPlanEntry, seed: (trigger: HyperBotsMessage, botId: string) => HyperBotsChatMessage[]): HyperBotsRun {
    const t = now();
    const run: HyperBotsRun = {
      id: randomUUID(), roomId: trigger.roomId, botId: p.botId, triggerMessageId: trigger.id, model: p.model,
      status: 'queued', steps: 0, error: null, createdAt: t, updatedAt: t, transcript: copy(seed(trigger, p.botId)),
    };
    st.runs.push(run);
    return run;
  }

  private tombstone(st: State, m: Stored): void {
    st.tombstones[key(m.roomId, m.clientMessageId)] = { id: m.id, hash: messageHash(m.text, m.attachments), model: m.model, createdAt: m.createdAt };
    const keys = Object.keys(st.tombstones);
    // Trim to 90% so the scan runs once per ~10k messages, not on every write at the cap.
    if (keys.length > HYPER_BOTS_TOMBSTONES) for (const k of keys.slice(0, keys.length - Math.floor(HYPER_BOTS_TOMBSTONES * 0.9))) delete st.tombstones[k];
  }

  /**
   * Keeps the newest HYPER_BOTS_ROOM_MESSAGES of a room. Never drops what live work needs: runs that are not
   * done/failed or that own a pending/approved/executing approval, their trigger messages and their replies.
   */
  private prune(st: State, roomId: string): void {
    const room = st.messages.filter((x) => x.roomId === roomId);
    let excess = room.length - HYPER_BOTS_ROOM_MESSAGES;
    if (excess <= 0) return;
    const busy = new Set(st.approvals.filter((a) => ACTIVE.includes(a.status)).map((a) => a.runId));
    const keepRuns = new Set(st.runs.filter((r) => !finished(r.status) || busy.has(r.id)).map((r) => r.id));
    const pinned = new Set(st.runs.filter((r) => keepRuns.has(r.id)).map((r) => r.triggerMessageId));
    const dropped = new Set<string>();
    for (const m of room) {
      if (excess <= 0) break;
      if (pinned.has(m.id) || (m.runId !== null && keepRuns.has(m.runId))) continue;
      dropped.add(m.id); excess--;
    }
    if (!dropped.size) return;
    st.messages = st.messages.filter((x) => !dropped.has(x.id));
    const gone = new Set(st.runs.filter((r) => dropped.has(r.triggerMessageId) && !keepRuns.has(r.id)).map((r) => r.id));
    if (gone.size) {
      st.runs = st.runs.filter((r) => !gone.has(r.id));
      st.approvals = st.approvals.filter((a) => !gone.has(a.runId));
    }
  }

  /** Idempotency lookup that survives pruning: the live message, or one rebuilt from its tombstone. */
  recall(roomId: string, clientMessageId: string, messageText: string, attachments?: HyperBotAttachment[]): HyperBotsRecall | undefined {
    const live = this.state.messages.find((x) => x.roomId === roomId && x.clientMessageId === clientMessageId);
    if (live) return { message: strip(live), sameText: messageHash(live.text, live.attachments) === messageHash(messageText, attachments), live: true, plan: copy(live.plan) };
    const k = key(roomId, clientMessageId);
    if (!own(this.state.tombstones, k)) return undefined;
    const t = this.state.tombstones[k];
    const sameText = t.hash === messageHash(messageText, attachments);
    // Only the hash is kept, so the text is known only when it matches.
    return {
      message: { id: t.id, roomId, clientMessageId, author: { kind: 'user' }, text: sameText ? messageText : '', model: t.model, runId: null, hop: 0, createdAt: t.createdAt },
      sameText, live: false, plan: null,
    };
  }

  findMessage(roomId: string, clientMessageId: string): HyperBotsMessage | undefined {
    const m = this.state.messages.find((x) => x.roomId === roomId && x.clientMessageId === clientMessageId);
    return m ? strip(m) : undefined;
  }

  referencedAttachments(): Set<string> {
    const ids = new Set<string>();
    for (const message of this.state.messages) for (const file of message.attachments ?? []) ids.add(file.id);
    for (const run of this.state.runs) {
      if (finished(run.status)) continue;
      for (const message of run.transcript) if (message.role === 'user') for (const file of message.attachments ?? []) ids.add(file.id);
    }
    return ids;
  }

  getMessage(id: string): HyperBotsMessage | undefined {
    const m = this.state.messages.find((x) => x.id === id);
    return m ? strip(m) : undefined;
  }

  /** Oldest first; `limit` keeps the newest N (default 100); `beforeSeqOf` only messages stored before that one. */
  listMessages(roomId: string, opts: { limit?: number; beforeSeqOf?: string } = {}): HyperBotsMessage[] {
    const limit = Math.max(0, Math.floor(opts.limit ?? 100));
    let before = Infinity;
    if (opts.beforeSeqOf !== undefined) before = this.state.messages.find((x) => x.id === opts.beforeSeqOf)?.seq ?? -1;
    const all = this.state.messages.filter((x) => x.roomId === roomId && x.seq < before);
    return (limit ? all.slice(-limit) : []).map(strip);
  }

  createRun(input: { roomId: string; botId: string; triggerMessageId: string; model: string; transcript: HyperBotsChatMessage[] }): HyperBotsRun {
    return this.mutate((st) => {
      const t = now();
      const run: HyperBotsRun = {
        id: randomUUID(), roomId: input.roomId, botId: input.botId, triggerMessageId: input.triggerMessageId, model: input.model,
        status: 'queued', steps: 0, error: null, createdAt: t, updatedAt: t, transcript: copy(input.transcript),
      };
      st.runs.push(run);
      return copy(run);
    });
  }

  getRun(id: string): HyperBotsRun | undefined {
    const r = this.state.runs.find((x) => x.id === id);
    return r ? copy(r) : undefined;
  }

  listRuns(filter: { status?: HyperBotsRunStatus[]; roomId?: string } = {}): HyperBotsRun[] {
    return this.state.runs.filter((r) => (!filter.status || filter.status.includes(r.status)) && (filter.roomId === undefined || r.roomId === filter.roomId)).map(copy);
  }

  runsForMessage(messageId: string): HyperBotsRun[] { return this.state.runs.filter((r) => r.triggerMessageId === messageId).map(copy); }

  /** The model is fixed at creation and cannot be patched. */
  updateRun(id: string, patch: Partial<Pick<HyperBotsRun, 'status' | 'transcript' | 'steps' | 'error'>>): HyperBotsRun {
    if (!this.state.runs.some((r) => r.id === id)) throw new Error(`Run not found: ${id}`);
    if (patch.steps !== undefined && !isCount(patch.steps)) throw new Error(`Invalid step count: ${patch.steps}`);
    return this.mutate((st) => {
      const run = st.runs.find((r) => r.id === id)!;
      if (patch.status !== undefined) run.status = patch.status;
      if (patch.transcript !== undefined) run.transcript = copy(patch.transcript);
      if (patch.steps !== undefined) run.steps = patch.steps;
      if (patch.error !== undefined) run.error = patch.error;
      run.updatedAt = now();
      const out = copy(run);
      if (patch.status !== undefined && finished(patch.status)) {
        const done = st.runs.filter((r) => finished(r.status));
        for (const r of done.slice(0, Math.max(0, done.length - KEEP_TRANSCRIPTS))) r.transcript = [];
      }
      return out;
    });
  }

  createApproval(input: {
    runId: string; roomId: string; botId: string; toolCallId: string; tool: string; access: HyperBotsAccess; args: unknown;
    summary: string; status: 'pending' | 'approved'; decidedBy: 'policy' | null; destination?: string | null; fingerprint?: string | null; card?: HyperBotsCardRow[] | null;
  }): { approval: HyperBotsApprovalRecord; created: boolean } {
    const prior = this.findApproval(input.runId, input.toolCallId);
    if (prior) return { approval: prior, created: false };
    return this.mutate((st) => {
      const t = now();
      const approval: HyperBotsApprovalRecord = {
        id: randomUUID(), runId: input.runId, roomId: input.roomId, botId: input.botId, toolCallId: input.toolCallId, tool: input.tool,
        access: input.access, args: JSON.parse(JSON.stringify(input.args ?? null)), summary: input.summary,
        destination: input.destination ?? null, fingerprint: input.fingerprint ?? null, card: input.card ? copy(input.card) : null, delivery: null, status: input.status,
        decidedBy: input.decidedBy, result: null, error: null, createdAt: t, updatedAt: t,
      };
      st.approvals.push(approval);
      return { approval: copy(approval), created: true };
    });
  }

  findApproval(runId: string, toolCallId: string): HyperBotsApprovalRecord | undefined {
    const a = this.state.approvals.find((x) => x.runId === runId && x.toolCallId === toolCallId);
    return a ? copy(a) : undefined;
  }

  getApproval(id: string): HyperBotsApprovalRecord | undefined {
    const a = this.state.approvals.find((x) => x.id === id);
    return a ? copy(a) : undefined;
  }

  listApprovals(filter: { status?: HyperBotsApprovalStatus[]; runId?: string; roomId?: string } = {}): HyperBotsApprovalRecord[] {
    return this.state.approvals.filter((a) => (!filter.status || filter.status.includes(a.status))
      && (filter.runId === undefined || a.runId === filter.runId) && (filter.roomId === undefined || a.roomId === filter.roomId)).map(copy);
  }

  /** Compare-and-set: moves the approval to `to` only if its status is one of `from`; null otherwise. */
  transitionApproval(
    id: string, from: HyperBotsApprovalStatus[], to: HyperBotsApprovalStatus,
    patch: {
      decidedBy?: 'policy' | 'owner' | null; result?: string | null; error?: string | null; destination?: string | null; fingerprint?: string | null;
      card?: HyperBotsCardRow[] | null; delivery?: HyperBotsDelivery | null;
    } = {},
  ): HyperBotsApprovalRecord | null {
    const current = this.state.approvals.find((a) => a.id === id);
    if (!current || !from.includes(current.status)) return null;
    return this.mutate((st) => {
      const a = st.approvals.find((x) => x.id === id)!;
      a.status = to; a.updatedAt = now();
      if (patch.decidedBy !== undefined) a.decidedBy = patch.decidedBy;
      if (patch.result !== undefined) a.result = patch.result;
      if (patch.error !== undefined) a.error = patch.error;
      if (patch.destination !== undefined) a.destination = patch.destination;
      if (patch.fingerprint !== undefined) a.fingerprint = patch.fingerprint;
      if (patch.card !== undefined) a.card = patch.card ? copy(patch.card) : null;
      if (patch.delivery !== undefined) a.delivery = patch.delivery;
      return copy(a);
    });
  }

  /**
   * After a restart: calls left executing become 'unknown' (never re-run); running runs are queued again;
   * pending/approved requests of a finished or missing run are closed as 'skipped' (they would never run).
   */
  recover(): { runs: number; approvals: number } {
    const live = new Set(this.state.runs.filter((x) => !finished(x.status)).map((x) => x.id));
    const orphan = (x: HyperBotsApprovalRecord) => (x.status === 'pending' || x.status === 'approved') && !live.has(x.runId);
    const a = this.state.approvals.filter((x) => x.status === 'executing' || orphan(x)).length;
    const r = this.state.runs.filter((x) => x.status === 'running').length;
    if (!a && !r) return { runs: 0, approvals: 0 };
    return this.mutate((st) => {
      const t = now();
      for (const x of st.approvals) {
        if (x.status === 'executing') Object.assign(x, { status: 'unknown', error: HYPER_BOTS_RECOVER_ERROR, updatedAt: t });
        else if (orphan(x)) Object.assign(x, { status: 'skipped', result: HYPER_BOTS_ORPHAN, updatedAt: t });
      }
      for (const x of st.runs) if (x.status === 'running') Object.assign(x, { status: 'queued', updatedAt: t });
      return { runs: r, approvals: a };
    });
  }
}
