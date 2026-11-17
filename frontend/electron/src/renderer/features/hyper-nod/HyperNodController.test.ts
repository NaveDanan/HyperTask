import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HyperNodApi, IpcResult } from '@shared/api';
import type { HyperNodEvent, HyperNodMessage, HyperNodSnapshot } from '@shared/HyperNod';
import { HyperNodController, hyperNodApprovalLabels, hyperNodDraftAfterSend, type HyperNodSendMemory } from './HyperNodController';
const THREAD = '11111111-1111-4111-8111-111111111111';
const TURN = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ok = <T,>(value: T): IpcResult<T> => ({ ok: true, value });
const fail = (message: string): IpcResult<never> => ({ ok: false, kind: 'other', message });
const message = (n: number, patch: Partial<HyperNodMessage> = {}): HyperNodMessage => ({ id: id(n), role: 'assistant', text: `m${n}`, turnId: TURN, createdAt: `2026-11-16T10:00:${String(n).padStart(2, '0')}.000Z`, streamId: null, attachments: [], choicesPending: false, ...patch });
const snapshot = (patch: Partial<HyperNodSnapshot> = {}): HyperNodSnapshot => ({ threadId: THREAD, messages: [message(10)], turns: [], hasEarlierMessages: false, activity: [], hiddenMessageIds: [], hiddenMessageCount: 0, pendingQuestionIds: null, ...patch });
let listener: (event: HyperNodEvent) => void;
let api: { [K in keyof HyperNodApi]: ReturnType<typeof vi.fn> };
let ids: number;
let memory: HyperNodSendMemory;
const controller = () => new HyperNodController(api as unknown as HyperNodApi, () => id(900 + ids++), memory);
beforeEach(() => {
  ids = 0; memory = {};
  api = {
    status: vi.fn(async () => ok({ ready: true, problem: 'none', model: 'gpt-x' })), state: vi.fn(async () => ok(snapshot())), history: vi.fn(),
    send: vi.fn(async () => ok({ threadId: THREAD, turnId: TURN, messageId: id(1) })), stop: vi.fn(async () => ok(undefined)),
    subscribe: vi.fn(async () => ok(undefined)), unsubscribe: vi.fn(), onEvent: vi.fn(next => { listener = next; return vi.fn(); }),
  };
});
afterEach(() => { vi.useRealTimers(); });
async function live(nod = controller()) {
  await nod.start();
  listener({ type: 'connected' });
  await vi.waitFor(() => expect(nod.getState().snapshot).not.toBeNull());
  return nod;
}
it('shows the readiness problem without subscribing or retrying when the owner must act', async () => {
  vi.useFakeTimers();
  api.status.mockResolvedValueOnce(ok({ ready: false, problem: 'setup_required', detail: 'The Nod self-host .env is missing.' }));
  const nod = controller();
  await nod.start();
  expect(nod.getState()).toMatchObject({ phase: 'unavailable', retrying: false, status: { problem: 'setup_required', detail: 'The Nod self-host .env is missing.' } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(api.status).toHaveBeenCalledOnce();
  expect(api.subscribe).not.toHaveBeenCalled();
  api.status.mockResolvedValueOnce(fail('Untrusted Nod caller refused.'));
  await nod.retry();
  expect(nod.getState().status).toEqual({ ready: false, problem: 'operation_failed', detail: 'Untrusted Nod caller refused.' });
});
it('subscribes first and reloads durable state on connect, without sending anything', async () => {
  const nod = await live();
  expect(api.subscribe.mock.invocationCallOrder[0]).toBeLessThan(api.state.mock.invocationCallOrder[0]);
  expect(nod.getState()).toMatchObject({ phase: 'ready', connection: 'live', snapshot: { threadId: THREAD } });
  expect(api.send).not.toHaveBeenCalled();
  nod.dispose();
  expect(api.unsubscribe).toHaveBeenCalledOnce();
});
it('starts again after dispose, as a StrictMode effect replay does', async () => {
  const nod = controller();
  const replayed = nod.start();
  nod.dispose();
  await replayed;
  await live(nod);
  expect(nod.getState()).toMatchObject({ phase: 'ready', connection: 'live' });
  expect(api.onEvent).toHaveBeenCalledTimes(2);
  expect(api.subscribe).toHaveBeenCalledOnce();
});
it('coalesces refresh bursts into one follow-up read and ignores results after dispose', async () => {
  const nod = await live();
  let release: (value: IpcResult<HyperNodSnapshot>) => void = () => {};
  api.state.mockReset().mockImplementation(() => new Promise(resolve => { release = resolve; }));
  for (let n = 0; n < 5; n++) listener({ type: 'refresh' });
  expect(api.state).toHaveBeenCalledOnce();
  release(ok(snapshot({ messages: [message(11)] })));
  await vi.waitFor(() => expect(api.state).toHaveBeenCalledTimes(2));
  nod.dispose();
  release(ok(snapshot({ messages: [message(12)] })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nod.getState().snapshot?.messages[0].id).toBe(id(11));
});
it('keeps rows displaced from Nod\'s recent window after a refresh', async () => {
  api.state.mockResolvedValueOnce(ok(snapshot({ messages: [message(1), message(2), message(3)] })));
  const nod = await live();
  api.state.mockResolvedValueOnce(ok(snapshot({ messages: [message(2), message(3), message(4)] })));
  await nod.refresh();
  expect(nod.getState().older.map(row => row.id)).toEqual([id(1)]);
});
it('retries a failed state read with backoff and offers an immediate reload', async () => {
  vi.useFakeTimers();
  api.state.mockResolvedValueOnce(fail('Nod is not responding on the VM.'));
  const nod = controller();
  await nod.start();
  listener({ type: 'connected' });
  await vi.advanceTimersByTimeAsync(0);
  expect(nod.getState()).toMatchObject({ snapshot: null, syncError: 'Nod is not responding on the VM.' });
  api.state.mockResolvedValueOnce(fail('again'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.state).toHaveBeenCalledTimes(2);
  await nod.reload();
  expect(nod.getState()).toMatchObject({ syncError: undefined, snapshot: { threadId: THREAD } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(api.state).toHaveBeenCalledTimes(3);
  nod.dispose();
});
it('streams deltas for the current thread and refreshes for another thread', async () => {
  const nod = await live();
  listener({ type: 'delta', threadId: THREAD, turnId: TURN, text: 'Hi', streamId: 's', done: false });
  expect(nod.getState().streams.active.s.text).toBe('Hi');
  api.state.mockClear();
  listener({ type: 'delta', threadId: id(77), turnId: TURN, text: 'x', streamId: 's', done: false });
  expect(api.state).toHaveBeenCalledOnce();
  listener({ type: 'activity', items: [{ turnId: TURN, title: null, step: 'Searching', doing: 'tool' }] });
  expect(nod.getState().activity[0].step).toBe('Searching');
});
it('keeps one client message ID for identical retries and a new one for changed input', async () => {
  const nod = await live();
  api.send.mockResolvedValueOnce(fail('Nod did not answer POST /api/messages within 30 seconds.'));
  expect(await nod.send('Hello')).toBe(false);
  expect(nod.getState().error).toContain('within 30 seconds');
  expect(await nod.send('Hello')).toBe(true);
  expect(await nod.send('Hello')).toBe(true);
  api.send.mockResolvedValueOnce(fail('x'));
  await nod.send('Other');
  await nod.send('Other again');
  expect(api.send.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900), id(901), id(902), id(903)]);
  expect(api.send.mock.calls[0][0]).toEqual({ text: 'Hello', threadId: THREAD, clientMessageId: id(900) });
});
it('reuses an uncertain send\'s ID after the page is reopened, until Nod accepts it', async () => {
  const first = await live();
  api.send.mockResolvedValueOnce(fail('The Nod response was interrupted: reset'));
  await first.send('Book it');
  first.dispose();
  const reopened = await live(controller());
  await reopened.send('Book it');
  await reopened.send('Book it');
  expect(api.send.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900), id(901)]);
  expect(memory.pending).toBeUndefined();
});
it('clears busy controls owned by an earlier generation when retrying', async () => {
  const nod = await live();
  let settle: (value: IpcResult<unknown>) => void = () => {};
  api.send.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  void nod.send('Hello');
  expect(nod.getState().sending).toBe(true);
  await nod.retry();
  expect(nod.getState()).toMatchObject({ sending: false, stopping: false, loadingOlder: false });
  settle(ok({ threadId: THREAD, turnId: TURN, messageId: id(1) }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nod.getState().sending).toBe(false);
  expect(memory.pending).toBeUndefined();
});
it('answers choices with Nod\'s exact text in offered order, written answers with the question as target, and approvals with the card labels', async () => {
  const nod = await live();
  const question = message(20, { choicesPending: true, choices: { multiple: true, options: [{ id: id(1), label: 'Email', description: 'Send it by email' }, { id: id(2), label: 'Call', description: 'call' }] } });
  await nod.answerChoices(question, [id(2), id(1)]);
  expect(api.send.mock.calls[0][0]).toMatchObject({ text: 'Email: Send it by email\nCall', replyToMessageId: id(20), answer: { kind: 'choices', choiceIds: [id(1), id(2)] } });
  expect(await nod.answerChoices(question, [id(3)])).toBe(false);
  await nod.answerWritten(question, 'Text me instead');
  expect(api.send.mock.calls[1][0]).toEqual({ text: 'Text me instead', threadId: THREAD, clientMessageId: expect.any(String), replyToMessageId: id(20), answer: { kind: 'written' } });
  expect(await nod.answerWritten(message(21), 'x')).toBe(false);
  await nod.answerApproval(message(21, { approval: { id: id(5), state: 'pending', title: 'Delete the file', app: 'Drive', fields: [], bodyCut: false } }), false);
  expect(api.send.mock.calls[2][0]).toMatchObject({ text: 'Cancel', replyToMessageId: id(21), answer: { kind: 'approval', approvalId: id(5), approved: false } });
  expect(hyperNodApprovalLabels('Cancel the trial')).toEqual({ approve: 'Cancel', decline: 'No' });
});
it('pages older history and refreshes when the page cannot be read', async () => {
  api.state.mockResolvedValue(ok(snapshot({ hasEarlierMessages: true })));
  const nod = await live();
  api.history.mockResolvedValueOnce(ok({ messages: [message(5), message(6)], hasMore: false }));
  await nod.loadOlder();
  expect(api.history).toHaveBeenCalledWith({ threadId: THREAD, before: message(10).createdAt, beforeId: id(10) });
  expect(nod.getState()).toMatchObject({ olderHasMore: false, loadingOlder: false });
  expect(nod.getState().older.map(row => row.id)).toEqual([id(5), id(6)]);
  expect(nod.hasOlder()).toBe(false);
});
it('keeps retrying readiness with backoff while Nod or the VM is restarting', async () => {
  vi.useFakeTimers();
  const nod = controller();
  await nod.start();
  listener({ type: 'disconnected', reason: 'Nod closed the event stream.' });
  expect(nod.getState()).toMatchObject({ connection: 'reconnecting', connectionError: 'Nod closed the event stream.' });
  api.status.mockResolvedValueOnce(ok({ ready: false, problem: 'unreachable' })).mockResolvedValueOnce(ok({ ready: false, problem: 'ssh_unavailable' }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(nod.getState()).toMatchObject({ phase: 'unavailable', retrying: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.status).toHaveBeenCalledTimes(3);
  expect(api.subscribe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.status).toHaveBeenCalledTimes(4);
  expect(nod.getState()).toMatchObject({ phase: 'ready', retrying: false });
  expect(api.subscribe).toHaveBeenCalledTimes(2);
  api.status.mockResolvedValueOnce(ok({ ready: false, problem: 'unauthorized' }));
  listener({ type: 'disconnected', reason: 'again' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nod.getState()).toMatchObject({ phase: 'unavailable', retrying: false, status: { problem: 'unauthorized' } });
  expect(api.status).toHaveBeenCalledTimes(5);
  nod.dispose();
});
it('stops all of Nod\'s work and reloads state', async () => {
  const nod = await live();
  api.state.mockClear();
  await nod.stop();
  expect(api.stop).toHaveBeenCalledOnce();
  expect(api.state).toHaveBeenCalledOnce();
  expect(nod.getState().stopping).toBe(false);
});
it('clears only the sent draft, keeping anything typed while sending', () => {
  expect(hyperNodDraftAfterSend('Hello', 'Hello')).toBe('');
  expect(hyperNodDraftAfterSend('Hello, and also', 'Hello')).toBe('Hello, and also');
});
it('counts an attempt that failed after an identical overlapping attempt was accepted as sent', async () => {
  const first = await live();
  let settleFirst: (value: IpcResult<unknown>) => void = () => {};
  let settleSecond: (value: IpcResult<unknown>) => void = () => {};
  api.send.mockImplementationOnce(() => new Promise(resolve => { settleFirst = resolve; })).mockImplementationOnce(() => new Promise(resolve => { settleSecond = resolve; }));
  const a = first.send('Book it');
  first.dispose();
  const reopened = await live(controller());
  const b = reopened.send('Book it');
  settleFirst(ok({ threadId: THREAD, turnId: TURN, messageId: id(1) }));
  await a;
  expect(memory.pending).toMatchObject({ accepted: true, attempts: 1 });
  settleSecond(fail('The Nod response was interrupted before it finished.'));
  expect(await b).toBe(true);
  expect(reopened.getState().error).toBeUndefined();
  expect(memory.pending).toBeUndefined();
  await reopened.send('Book it');
  expect(api.send.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900), id(901)]);
});
it('drops retained history that no longer connects to the snapshot, and discards pages requested before', async () => {
  api.state.mockResolvedValueOnce(ok(snapshot({ hasEarlierMessages: true, messages: [message(4), message(5), message(6)] })));
  const nod = await live();
  let page: (value: IpcResult<unknown>) => void = () => {};
  api.history.mockImplementationOnce(() => new Promise(resolve => { page = resolve; }));
  const loading = nod.loadOlder();
  api.state.mockResolvedValueOnce(ok(snapshot({ hasEarlierMessages: true, messages: [message(20), message(21)] })));
  await nod.refresh();
  expect(nod.getState()).toMatchObject({ older: [], olderHasMore: undefined });
  page(ok({ messages: [message(1), message(2)], hasMore: false }));
  await loading;
  expect(nod.getState()).toMatchObject({ older: [], olderHasMore: undefined, loadingOlder: false });
  expect(nod.hasOlder()).toBe(true);
});
it('discards cached history when Nod hid more messages than it can list', async () => {
  api.state.mockResolvedValueOnce(ok(snapshot({ messages: [message(1), message(2), message(3)] })));
  const nod = await live();
  api.state.mockResolvedValueOnce(ok(snapshot({ messages: [message(2), message(3), message(4)], hiddenMessageIds: [id(40)], hiddenMessageCount: 1 })));
  await nod.refresh();
  expect(nod.getState().older.map(row => row.id)).toEqual([id(1)]);
  api.state.mockResolvedValueOnce(ok(snapshot({ messages: [message(2), message(3), message(4)], hiddenMessageIds: [id(40)], hiddenMessageCount: 151 })));
  await nod.refresh();
  expect(nod.getState()).toMatchObject({ older: [], olderHasMore: undefined });
});
it('retires answered requests and ones Nod reports as no longer waiting', async () => {
  const nod = await live();
  const approval = (n: number) => message(n, { approval: { id: id(n + 100), state: 'pending', title: 'Send it', app: '', fields: [], bodyCut: false } });
  expect(await nod.answerApproval(approval(30), true)).toBe(true);
  api.send.mockResolvedValueOnce(fail('This request is no longer waiting for an answer. Nod returned 409 for POST /api/messages: This approval is no longer waiting for an answer.'));
  expect(await nod.answerApproval(approval(31), true)).toBe(false);
  api.send.mockResolvedValueOnce(fail('Nod is not responding on the VM.'));
  expect(await nod.answerApproval(approval(32), true)).toBe(false);
  expect(nod.getState().retired).toEqual([id(30), id(31)]);
});
it('stops retrying state reads once readiness fails for a reason the owner must fix', async () => {
  vi.useFakeTimers();
  const nod = await live();
  api.state.mockResolvedValue(fail('Nod is not responding on the VM.'));
  await nod.refresh();
  api.status.mockResolvedValueOnce(ok({ ready: false, problem: 'unauthorized' }));
  listener({ type: 'disconnected', reason: 'lost' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(nod.getState()).toMatchObject({ phase: 'unavailable', retrying: false });
  const reads = api.state.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(api.state).toHaveBeenCalledTimes(reads);
  nod.dispose();
});
