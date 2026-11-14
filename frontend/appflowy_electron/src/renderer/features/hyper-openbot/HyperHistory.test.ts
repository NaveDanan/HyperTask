import { afterEach, expect, it, vi } from 'vitest';
import { readableTurns } from './HyperThreadMessages';
import { hyperRestoreStoredMessages, mergeStoredMessages } from './HyperHistoryMerge';
import { hyperMessageContent } from './HyperMessageContent';
import { hyperLoadAllChannels } from './HyperChannelPaging';
import { hyperGatewayJoin, hyperRunWithRecovery, hyperWatchGatewayActivity } from './HyperRun';
afterEach(() => vi.useRealTimers());
it('normalizes actual persisted tool dialect and counts corrupt history', () => {
  const result = readableTurns([{ id: 'call', role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'lookup', args: { q: 'test' } }] }, { id: 'bad', role: 'user', content: null }]);
  expect(result.unreadable).toBe(1);
  expect(result.messages[0]).toMatchObject({ toolCalls: [{ function: { name: 'lookup', arguments: '{"q":"test"}' } }] });
});
it('restores missing turns without replacing longer streamed text with lagging persisted text', () => {
  const live = [{ id: 'a', role: 'assistant' as const, content: 'complete live answer' }];
  const result = mergeStoredMessages(live, [{ id: 'u', role: 'user', content: 'question' }, { id: 'a', role: 'assistant', content: 'complete' }]);
  expect(result.map(message => message.id)).toEqual(['u', 'a']);
  expect(result[1].content).toBe('complete live answer');
});
it('replaces a waiting tool placeholder with its durable result and never regresses a final result', () => {
  const waiting = { id: 'tool', role: 'tool' as const, toolCallId: 'call', content: '{"waiting":true}' };
  for (const content of ['{"ok":true,"text":"done"}', '{"ok":false,"refused":true}', '{"ok":false,"error":"failed"}']) {
    const final = { ...waiting, content };
    expect(mergeStoredMessages([waiting], [final])).toEqual([final]);
    expect(mergeStoredMessages([final], [waiting])).toEqual([final]);
  }
  const otherCall = { ...waiting, toolCallId: 'different', content: '{"ok":true}' };
  expect(mergeStoredMessages([waiting], [otherCall])).toEqual([waiting]);
});
it('renders compound text and attachment identity without serializing metadata', () => {
  expect(hyperMessageContent([{ type: 'text', text: 'Caption' }, { type: 'document', source: { type: 'url', value: '/api/attachments/a' }, metadata: { attachmentId: 'a', filename: 'notes.txt' } }])).toEqual({ text: 'Caption', attachments: [{ id: 'a', name: 'notes.txt', image: false, mimeType: undefined }] });
});
it('loads pages after the first fifty and deduplicates channel IDs', async () => {
  const read = vi.fn().mockResolvedValueOnce({ channels: [{ id: 'one' }], nextCursor: 'next value' }).mockResolvedValueOnce({ channels: [{ id: 'two' }, { id: 'one' }], nextCursor: null });
  const result = await hyperLoadAllChannels(read);
  expect(result.channels.map(channel => channel.id)).toEqual(['one', 'two']);
  expect(read).toHaveBeenLastCalledWith('/api/channels?cursor=next%20value');
});
it('retains every pending history group when multiple stored tool-call turns share a local anchor', () => {
  const call = (id: string) => ({ id, type: 'function' as const, function: { name: 'lookup', arguments: '{}' } });
  const local = { id: 'combined', role: 'assistant' as const, toolCalls: [call('c1'), call('c2')] };
  const result = mergeStoredMessages([local], [
    { id: 'u', role: 'user', content: 'question' },
    { id: 'a', role: 'assistant', toolCalls: [call('c1')] },
    { id: 't1', role: 'tool', toolCallId: 'c1', content: 'result' },
    { id: 'b', role: 'assistant', toolCalls: [call('c2')] },
  ]);
  expect(result.map(message => message.id)).toEqual(['u', 't1', 'combined']);
});
it('restores read-back text when the local assistant has no content', () => {
  const local = [{ id: 'a', role: 'assistant' as const }];
  const stored = [{ id: 'a', role: 'assistant' as const, content: 'Recovered answer' }];
  expect(mergeStoredMessages(local, stored, { readBack: true })[0].content).toBe('Recovered answer');
  expect(mergeStoredMessages(local, stored)).toBe(local);
});
it('the UI recovery entry point restores a contentless idle assistant while preserving longer live text and active runs', () => {
  const saved = [{ id: 'a', role: 'assistant' as const, content: 'Authoritative saved answer' }];
  const agent = { isRunning: false, messages: [{ id: 'a', role: 'assistant' as const }], setMessages: vi.fn() };
  hyperRestoreStoredMessages(agent, saved);
  expect(agent.setMessages.mock.calls[0][0][0].content).toBe('Authoritative saved answer');
  const streamed = [{ id: 'a', role: 'assistant' as const, content: 'Longer completed live response retained' }];
  const idle = { isRunning: false, messages: streamed, setMessages: vi.fn() };
  hyperRestoreStoredMessages(idle, saved);
  expect(idle.setMessages).toHaveBeenCalledWith(streamed);
  agent.setMessages.mockClear(); agent.isRunning = true;
  hyperRestoreStoredMessages(agent, saved);
  expect(agent.setMessages).not.toHaveBeenCalled();
});
it('recovers each tool call independently without shortening another call when the store adds or improves a call', () => {
  const call = (id: string, args: string) => ({ id, type: 'function' as const, function: { name: 'lookup', arguments: args } });
  const complete = call('c1', '{"path":"complete-live-arguments"}');
  const partial = call('c2', '{"q":');
  const improved = call('c2', '{"q":"saved arguments"}');
  const extra = call('c3', '{"added":true}');
  const local = [{ id: 'a', role: 'assistant' as const, toolCalls: [complete, partial] }];
  for (const toolCalls of [[call('c1', '{"path":'), improved], [call('c1', '{"path":'), partial, extra], [improved, extra]]) {
    const agent = { isRunning: false, messages: local, setMessages: vi.fn() };
    hyperRestoreStoredMessages(agent, [{ id: 'a', role: 'assistant', toolCalls }]);
    const result = agent.setMessages.mock.calls[0][0][0].toolCalls;
    expect(result.find((each: any) => each.id === 'c1')).toEqual(complete);
    expect(result.find((each: any) => each.id === 'c2')).toEqual(toolCalls.includes(improved) ? improved : partial);
    if (toolCalls.includes(extra)) expect(result.map((each: any) => each.id)).toEqual(['c1', 'c2', 'c3']);
  }
});
it('rejects a resolved SDK call when a run failure event was emitted', async () => {
  let events: any; const unsubscribe = vi.fn();
  const agent = { subscribe: (value: unknown) => { events = value; return { unsubscribe }; } };
  await expect(hyperRunWithRecovery(agent as never, async () => { events.onRunInitialized(); events.onRunFailed({ error: new Error('Gateway unavailable') }); }, () => false)).rejects.toThrow('Gateway unavailable');
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('keeps a draft retryable when the agent refused initialization', async () => {
  const unsubscribe = vi.fn();
  await expect(hyperRunWithRecovery({ subscribe: () => ({ unsubscribe }) } as never, async () => {}, () => false)).rejects.toThrow('did not start');
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('treats a deliberate Stop as completion and always releases its observer', async () => {
  let events: any; const unsubscribe = vi.fn();
  const agent = { subscribe: (value: unknown) => { events = value; return { unsubscribe }; } };
  await expect(hyperRunWithRecovery(agent as never, async () => { events.onRunFailed({ error: new Error('Aborted') }); }, () => true)).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('releasing a pending join prevents its stale deadline from detaching a later run', async () => {
  vi.useFakeTimers();
  const detach = vi.fn();
  const join = hyperGatewayJoin(() => new Promise(() => {}), detach);
  await Promise.resolve();
  join.cancel();
  await join.promise;
  await vi.advanceTimersByTimeAsync(6000);
  expect(detach).not.toHaveBeenCalled();
});
it('successful joins clear their deadline and an overdue active join invokes it once', async () => {
  vi.useFakeTimers();
  const detach = vi.fn();
  await hyperGatewayJoin(async () => {}, detach).promise;
  await vi.advanceTimersByTimeAsync(6000);
  expect(detach).not.toHaveBeenCalled();
  const overdue = hyperGatewayJoin(() => new Promise(() => {}), detach);
  await vi.advanceTimersByTimeAsync(5000);
  await overdue.promise;
  expect(detach).toHaveBeenCalledTimes(1);
});

it.each(['onTextMessageContentEvent', 'onToolCallStartEvent', 'onToolCallArgsEvent', 'onToolCallResultEvent'])('keeps a cursor-based reconnect alive when %s arrives without RUN_STARTED', async event => {
  vi.useFakeTimers();
  let events: any; const unsubscribe = vi.fn(), detach = vi.fn();
  const watching = hyperWatchGatewayActivity({ subscribe: (value: unknown) => { events = value; return { unsubscribe }; } } as never);
  const join = hyperGatewayJoin(() => new Promise(() => {}), () => { if (!watching.isAnswering()) detach(); });
  events[event]();
  await vi.advanceTimersByTimeAsync(5000); await join.promise;
  expect(detach).not.toHaveBeenCalled(); expect(watching.isAnswering()).toBe(true);
  events.onRunFinishedEvent(); expect(watching.isAnswering()).toBe(false);
  watching.unsubscribe(); expect(unsubscribe).toHaveBeenCalledOnce();
});
