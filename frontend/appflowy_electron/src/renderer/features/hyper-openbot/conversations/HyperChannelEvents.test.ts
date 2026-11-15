import { afterEach, expect, it, vi } from 'vitest';
import { hyperParseChannelEvent, hyperWatchChannelEvents } from './HyperChannelEvents';
import { hyperOpenBotRequest } from '../transport';
import { HyperNoticeChannelEvent, HyperForgetReplies } from '../approvals-inbox/HyperReplyNotices';
const clients = vi.hoisted(() => ({ sockets: [] as any[] }));
vi.mock('../socket', () => ({ HyperOpenBotSocket: class { onopen: any; onmessage: any; onclose: any; close = vi.fn(); constructor(public url: string) { clients.sockets.push(this); } } }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('../approvals-inbox/HyperReplyNotices', () => ({ HyperNoticeChannelEvent: vi.fn(), HyperForgetReplies: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); clients.sockets = []; vi.useRealTimers(); });
it('drops invalid frames and retains resync and exact channel activity', () => {
  for (const value of [null, '{}', 'null', '[]', '3', 'bad', new Uint8Array()]) expect(hyperParseChannelEvent(value)).toBeNull();
  expect(hyperParseChannelEvent('{"resync":true}')).toEqual({ resync: true });
  expect(hyperParseChannelEvent('{"channelId":"channel","busy":false}')).toEqual({ channelId: 'channel', busy: false });
});
it('uses exact socket, fresh notice reads, reconnect resync and teardown', async () => {
  vi.useFakeTimers(); const changed = vi.fn(); const open = vi.fn();
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ agents: [{ id: 'bot', name: 'Bot' }] }).mockResolvedValueOnce({ bots: [] }).mockResolvedValueOnce({ lifecycle: { notify: 'all' } });
  const stop = hyperWatchChannelEvents(changed, open); const socket = clients.sockets[0];
  expect(socket.url).toBe('wss://hyper-openbot.invalid/api/channels/events'); socket.onopen(); expect(changed).toHaveBeenCalledWith({ resync: true });
  socket.onmessage({ data: JSON.stringify({ channelId: 'channel', lastMessageAgentId: 'bot', lastMessage: 'Done' }) }); for (let i = 0; i < 10; i++) await Promise.resolve();
  const reads = vi.mocked(HyperNoticeChannelEvent).mock.calls[0][1];
  expect(await reads.attention()).toEqual([]); expect(await reads.notify('bot')).toBe('all'); expect(reads.agents()).toEqual([{ id: 'bot', name: 'Bot' }]);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/bots/bot/lifecycle');
  socket.onclose(); await vi.advanceTimersByTimeAsync(1000); expect(clients.sockets).toHaveLength(2);
  stop(); expect(HyperForgetReplies).toHaveBeenCalledOnce(); expect(clients.sockets[1].close).toHaveBeenCalledOnce();
  await expect(reads.attention()).rejects.toThrow();
});
it('notification processing preserves socket order when later roster reads finish first', async () => {
  let first!: (value: any) => void, second!: (value: any) => void;
  vi.mocked(hyperOpenBotRequest).mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  const stop = hyperWatchChannelEvents(vi.fn(), vi.fn()), socket = clients.sockets[0];
  socket.onmessage({ data: JSON.stringify({ channelId: 'channel', lastMessageAgentId: 'bot', lastMessage: 'Reply' }) });
  socket.onmessage({ data: JSON.stringify({ channelId: 'channel', busy: false }) });
  second({ agents: [] }); for (let i = 0; i < 10; i++) await Promise.resolve();
  first({ agents: [] }); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(vi.mocked(HyperNoticeChannelEvent).mock.calls.map(call => call[0])).toEqual([{ channelId: 'channel', lastMessageAgentId: 'bot', lastMessage: 'Reply' }, { channelId: 'channel', busy: false }]); stop();
});
