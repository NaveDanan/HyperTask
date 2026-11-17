import type { HyperNodEvent, HyperNodHistoryCursor, HyperNodMessage, HyperNodSnapshot, HyperNodTurn } from '@shared/HyperNod';
import type { HyperTranscriptMessage } from '../hyper-openbot/transcript';
/** Live text not yet saved, following Nod's streams.ts: deltas append, done or a saved message ends a stream. */
export interface HyperNodStreams {
  threadId: string;
  active: Record<string, { turnId: string; text: string }>;
  completed: string[];
}
export const HYPER_NOD_NO_STREAMS: HyperNodStreams = { threadId: '', active: {}, completed: [] };
const COMPLETED_LIMIT = 512;
const LIVE: readonly HyperNodTurn['status'][] = ['queued', 'running', 'waiting'];
const order = (a: HyperNodMessage, b: HyperNodMessage) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function close(streams: HyperNodStreams, ids: readonly string[]): HyperNodStreams {
  if (!ids.length) return streams;
  const closed = new Set(ids);
  return {
    ...streams,
    active: Object.fromEntries(Object.entries(streams.active).filter(([id]) => !closed.has(id))),
    completed: [...streams.completed.filter(id => !closed.has(id)), ...closed].slice(-COMPLETED_LIMIT),
  };
}
/** Nod sends done for saved and discarded streams alike; the saved message arrives with the next snapshot. */
export function hyperNodDelta(streams: HyperNodStreams, event: Extract<HyperNodEvent, { type: 'delta' }>): HyperNodStreams {
  if (streams.threadId && event.threadId !== streams.threadId) return streams;
  if (!streams.threadId) streams = { ...HYPER_NOD_NO_STREAMS, threadId: event.threadId };
  const id = event.streamId || `turn:${event.turnId}`;
  if (event.done) return close(streams, [id]);
  const current = streams.active[id];
  if (!event.text || streams.completed.includes(id) || (current && current.turnId !== event.turnId)) return streams;
  return { ...streams, active: { ...streams.active, [id]: { turnId: event.turnId, text: (current?.text ?? '') + event.text } } };
}
/** Applies a durable snapshot: saved streams and streams of finished turns end. */
export function hyperNodPersisted(streams: HyperNodStreams, snapshot: HyperNodSnapshot): HyperNodStreams {
  if (streams.threadId !== snapshot.threadId) streams = { ...HYPER_NOD_NO_STREAMS, threadId: snapshot.threadId };
  const live = new Set(snapshot.turns.filter(turn => LIVE.includes(turn.status)).map(turn => turn.id));
  const known = new Set(snapshot.turns.map(turn => turn.id));
  const saved = snapshot.messages.flatMap(message => message.streamId ? [message.streamId] : []);
  const ended = Object.entries(streams.active).filter(([, stream]) => known.has(stream.turnId) && !live.has(stream.turnId)).map(([id]) => id);
  return close(streams, [...saved, ...ended]);
}
/**
 * Rows shown before the snapshot window. Previously seen rows stay when newer messages push them out of
 * Nod's recent window; hidden rows, and rows inside the window but missing from it, are gone.
 */
export function hyperNodMergeOlder(known: readonly HyperNodMessage[], page: readonly HyperNodMessage[], snapshot: HyperNodSnapshot): HyperNodMessage[] {
  const first = snapshot.messages[0];
  if (!first) return [];
  const recent = new Set(snapshot.messages.map(message => message.id));
  const hidden = new Set(snapshot.hiddenMessageIds);
  const byId = new Map<string, HyperNodMessage>();
  for (const message of [...page, ...known]) if (!recent.has(message.id) && !hidden.has(message.id) && order(message, first) < 0) byId.set(message.id, message);
  return [...byId.values()].sort(order);
}
/**
 * Known rows connect to a new snapshot only when they share a message with it. Without one, unseen
 * messages may lie between them, so the known rows must be dropped and paged in again from the snapshot.
 */
export function hyperNodContiguous(known: readonly HyperNodMessage[], snapshot: HyperNodSnapshot) {
  const recent = new Set(snapshot.messages.map(message => message.id));
  return known.some(message => recent.has(message.id));
}
export function hyperNodCursor(snapshot: HyperNodSnapshot, older: readonly HyperNodMessage[]): HyperNodHistoryCursor | null {
  const oldest = older[0] ?? snapshot.messages[0];
  return oldest ? { threadId: snapshot.threadId, before: oldest.createdAt, beforeId: oldest.id } : null;
}
/**
 * Questions with choices and approvals still waiting for the owner, across all loaded history, oldest first.
 * Older rows are not refreshed, so requests answered or found settled here are retired locally.
 */
export function hyperNodPending(snapshot: HyperNodSnapshot, older: readonly HyperNodMessage[], retired: readonly string[] = []) {
  const questions = snapshot.pendingQuestionIds ? new Set(snapshot.pendingQuestionIds) : null;
  return [...older, ...snapshot.messages].filter(message => message.role === 'assistant' && !retired.includes(message.id) && (
    (message.choices && (questions ? questions.has(message.id) : message.choicesPending)) || message.approval?.state === 'pending'));
}
export function hyperNodWork(snapshot: HyperNodSnapshot): 'idle' | 'running' | 'waiting' {
  if (snapshot.turns.some(turn => turn.status === 'queued' || turn.status === 'running')) return 'running';
  return snapshot.turns.some(turn => turn.status === 'waiting') ? 'waiting' : 'idle';
}
/** The newest finished turn's failure, while nothing newer has started. */
export function hyperNodFailure(snapshot: HyperNodSnapshot): string | undefined {
  const latest = [...snapshot.turns].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return latest?.status === 'failed' ? latest.error || 'Nod could not finish this request.' : undefined;
}
export function hyperNodTranscript(snapshot: HyperNodSnapshot, older: readonly HyperNodMessage[], streams: HyperNodStreams): HyperTranscriptMessage[] {
  // The shared attachment row downloads from OpenBot, so Nod files are named only until Nod downloads exist.
  const rows: HyperTranscriptMessage[] = [...older, ...snapshot.messages].map(message => ({
    id: message.id, role: message.role,
    content: message.attachments.length ? `${message.text}${message.text ? '\n\n' : ''}Attached: ${message.attachments.map(file => file.name).join(', ')}` : message.text,
  }));
  if (streams.threadId !== snapshot.threadId) return rows;
  for (const [id, stream] of Object.entries(streams.active)) rows.push({ id: `stream:${id}`, role: 'assistant', content: stream.text, live: true, streaming: true });
  return rows;
}
