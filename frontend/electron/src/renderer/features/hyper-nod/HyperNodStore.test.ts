import { expect, it } from 'vitest';
import type { HyperNodMessage, HyperNodSnapshot, HyperNodTurn } from '@shared/HyperNod';
import { HYPER_NOD_NO_STREAMS, hyperNodContiguous, hyperNodCursor, hyperNodDelta, hyperNodFailure, hyperNodMergeOlder, hyperNodPending, hyperNodPersisted, hyperNodTranscript, hyperNodWork } from './HyperNodStore';
const THREAD = '11111111-1111-4111-8111-111111111111';
const TURN = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const message = (n: number, patch: Partial<HyperNodMessage> = {}): HyperNodMessage => ({ id: id(n), role: n % 2 ? 'user' : 'assistant', text: `m${n}`, turnId: TURN, createdAt: `2026-11-16T10:00:${String(n % 60).padStart(2, '0')}.000Z`, streamId: null, attachments: [], choicesPending: false, ...patch });
const turn = (status: HyperNodTurn['status'], patch: Partial<HyperNodTurn> = {}): HyperNodTurn => ({ id: TURN, status, createdAt: '2026-11-16T10:00:00.000Z', finishedAt: null, error: null, ...patch });
const snapshot = (patch: Partial<HyperNodSnapshot> = {}): HyperNodSnapshot => ({ threadId: THREAD, messages: [message(10), message(11)], turns: [turn('running')], hasEarlierMessages: true, activity: [], hiddenMessageIds: [], hiddenMessageCount: 0, pendingQuestionIds: null, ...patch });
const approval = (state: 'pending' | 'done') => ({ id: id(51), state, title: 'Send email', app: 'Gmail', fields: [], bodyCut: false });
const delta = (text: string, patch: Partial<{ threadId: string; turnId: string; streamId: string | null; done: boolean }> = {}) => ({ type: 'delta' as const, threadId: THREAD, turnId: TURN, text, streamId: 's1', done: false, ...patch });
it('appends fragments per stream, ignores other threads and drops a stream as soon as Nod says done', () => {
  let streams = hyperNodDelta(HYPER_NOD_NO_STREAMS, delta('Hel'));
  streams = hyperNodDelta(streams, delta('lo'));
  streams = hyperNodDelta(streams, delta('x', { threadId: id(99) }));
  expect(streams.active.s1).toEqual({ turnId: TURN, text: 'Hello' });
  expect(hyperNodTranscript(snapshot(), [], streams).at(-1)).toMatchObject({ id: 'stream:s1', content: 'Hello', live: true, streaming: true });
  streams = hyperNodDelta(streams, delta('', { done: true }));
  expect(streams.active).toEqual({});
  expect(hyperNodDelta(streams, delta(' late')).active).toEqual({});
  expect(hyperNodTranscript(snapshot(), [], streams).map(row => row.id)).toEqual([id(10), id(11)]);
});
it('ends streams superseded by a saved message or a finished turn, and resets on a new thread', () => {
  const streams = hyperNodDelta(hyperNodDelta(HYPER_NOD_NO_STREAMS, delta('a')), delta('b', { streamId: null }));
  expect(Object.keys(streams.active)).toEqual(['s1', `turn:${TURN}`]);
  expect(Object.keys(hyperNodPersisted(streams, snapshot({ messages: [message(10, { streamId: 's1' })] })).active)).toEqual([`turn:${TURN}`]);
  expect(hyperNodPersisted(streams, snapshot({ turns: [turn('failed')] })).active).toEqual({});
  expect(hyperNodPersisted(streams, snapshot({ threadId: id(5) }))).toEqual({ ...HYPER_NOD_NO_STREAMS, threadId: id(5) });
});
it('merges older pages in order, drops duplicates of the snapshot and pages from the oldest shown row', () => {
  const current = snapshot();
  const older = hyperNodMergeOlder([], [message(8), message(9), message(10)], current);
  expect(older.map(row => row.text)).toEqual(['m8', 'm9']);
  expect(hyperNodCursor(current, older)).toEqual({ threadId: THREAD, before: message(8).createdAt, beforeId: id(8) });
  expect(hyperNodCursor(current, [])).toEqual({ threadId: THREAD, before: message(10).createdAt, beforeId: id(10) });
  const tie = { createdAt: '2026-11-16T09:00:00.000Z' };
  expect(hyperNodMergeOlder(older, [message(3, { ...tie, id: id(4) }), message(3, tie)], current).map(row => row.id).slice(0, 2)).toEqual([id(3), id(4)]);
  expect(hyperNodCursor(snapshot({ messages: [] }), [])).toBeNull();
});
it('keeps rows that newer messages push out of the recent window, but never hidden or in-window rows', () => {
  const before = snapshot({ messages: [message(1), message(2), message(3)] });
  const after = snapshot({ messages: [message(2), message(3), message(4)] });
  expect(hyperNodMergeOlder([message(0), ...before.messages], [], after).map(row => row.id)).toEqual([id(0), id(1)]);
  expect(hyperNodMergeOlder([message(0), ...before.messages], [], { ...after, hiddenMessageIds: [id(1)] }).map(row => row.id)).toEqual([id(0)]);
  expect(hyperNodMergeOlder([message(5)], [], after)).toEqual([]);
  expect(hyperNodMergeOlder([message(0)], [], snapshot({ messages: [] }))).toEqual([]);
});
it('finds pending requests across loaded history, using Nod\'s authoritative question list when present', () => {
  const choices = { multiple: false, options: [{ id: id(50), label: 'Yes' }] };
  const older = [message(2, { choices, choicesPending: false }), message(4, { approval: approval('pending') })];
  const current = snapshot({ turns: [turn('waiting')], messages: [message(20, { choices, choicesPending: true }), message(22, { choices, choicesPending: false }), message(26, { approval: approval('done') })] });
  expect(hyperNodPending(current, older).map(row => row.id)).toEqual([id(4), id(20)]);
  expect(hyperNodPending({ ...current, pendingQuestionIds: [id(2)] }, older).map(row => row.id)).toEqual([id(2), id(4)]);
});
it('reports waiting work and the latest failure', () => {
  const current = snapshot({ turns: [turn('waiting'), turn('failed', { id: id(60), createdAt: '2026-11-16T09:00:00.000Z', error: 'Old failure' })] });
  expect(hyperNodWork(current)).toBe('waiting');
  expect(hyperNodWork(snapshot({ turns: [turn('queued')] }))).toBe('running');
  expect(hyperNodWork(snapshot({ turns: [] }))).toBe('idle');
  expect(hyperNodFailure(current)).toBeUndefined();
  expect(hyperNodFailure(snapshot({ turns: [turn('failed', { error: 'Model refused: quota' })] }))).toBe('Model refused: quota');
});
it('names attachments in the transcript without the OpenBot download row', () => {
  const rows = hyperNodTranscript(snapshot({ messages: [message(11, { attachments: [{ id: id(70), name: 'a.pdf', mimeType: 'application/pdf', size: 3 }] })] }), [], HYPER_NOD_NO_STREAMS);
  expect(rows).toEqual([{ id: id(11), role: 'user', content: 'm11\n\nAttached: a.pdf' }]);
});
it('treats known rows as connected to a snapshot only when they share a message', () => {
  expect(hyperNodContiguous([message(1), message(2), message(3)], snapshot({ messages: [message(3), message(4)] }))).toBe(true);
  expect(hyperNodContiguous([message(1), message(2), message(3)], snapshot({ messages: [message(7), message(8)] }))).toBe(false);
  expect(hyperNodContiguous([], snapshot())).toBe(false);
});
it('leaves requests retired here out of the pending list', () => {
  const current = snapshot({ messages: [message(4, { approval: approval('pending') })] });
  expect(hyperNodPending(current, []).map(row => row.id)).toEqual([id(4)]);
  expect(hyperNodPending(current, [], [id(4)])).toEqual([]);
});
