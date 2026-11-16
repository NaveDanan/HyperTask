import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotFetch, hyperOpenBotRequest } from '../transport';
import { HyperHomeGreeting, HyperReadHomeChannels, HyperRouteHomeMessage, HyperRoutingRefusedError, HyperRoutingText, HyperStartHomeDraft } from './HyperHomeApi';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
vi.mock('../transport', () => ({ hyperOpenBotFetch: vi.fn(), hyperOpenBotRequest: vi.fn(), HYPER_OPENBOT_ORIGIN: 'https://hyper-openbot.invalid' }));
beforeEach(() => vi.resetAllMocks());
const bots = [{ id: 'picked-harness', visibility: 'public' }] as HyperBotProfile[];
it('routes an explicit choice and skills using the original request contract', async () => {
  vi.mocked(hyperOpenBotFetch).mockResolvedValue(new Response(JSON.stringify({ agentId: 'chosen' })));
  expect(await HyperRouteHomeMessage(' task ', 'chosen', ['summarize'])).toBe('chosen');
  expect(hyperOpenBotFetch).toHaveBeenCalledWith('https://hyper-openbot.invalid/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'task', agentId: 'chosen', skillSlugs: ['summarize'] }) });
});
it('never falls back on ambiguous routing or skill routing failures', async () => {
  const startConversation = vi.fn();
  vi.mocked(hyperOpenBotFetch).mockResolvedValue(new Response(JSON.stringify({ names: ['one', 'two'] }), { status: 409 }));
  await expect(HyperStartHomeDraft({ startConversation, openConversation: vi.fn(), initialDraftSupported: true }, bots, { text: 'task', files: [], commandIds: [], submit: true })).rejects.toBeInstanceOf(HyperRoutingRefusedError);
  expect(startConversation).not.toHaveBeenCalled();
  vi.mocked(hyperOpenBotFetch).mockRejectedValue(new Error('offline'));
  await expect(HyperStartHomeDraft({ startConversation, openConversation: vi.fn(), initialDraftSupported: true }, bots, { text: '/skill task', files: [], commandIds: ['skill'], submit: true })).rejects.toThrow();
});
it('falls back on unavailable routing and transfers the exact draft and files', async () => {
  vi.mocked(hyperOpenBotFetch).mockRejectedValue(new Error('offline'));
  const startConversation = vi.fn();
  const draft = { text: 'task', files: [new File(['test'], 'test.txt')], commandIds: [], submit: true };
  await HyperStartHomeDraft({ startConversation, openConversation: vi.fn(), initialDraftSupported: true }, bots, draft);
  expect(startConversation).toHaveBeenCalledWith(['picked-harness'], draft);
  expect(startConversation.mock.calls[0][1].files[0]).toBe(draft.files[0]);
});
it('rejects a late route before creation when the navigation scope is abandoned', async () => {
  let finish!: (response: Response) => void; let current = true;
  vi.mocked(hyperOpenBotFetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const startConversation = vi.fn();
  const context = { startConversation, openConversation: vi.fn(), initialDraftSupported: true, isCurrentNavigation: () => current };
  const sending = HyperStartHomeDraft(context, bots, { text: 'abandoned task', files: [], commandIds: [], submit: true });
  const refused = expect(sending).rejects.toThrow(/navigation|cancelled/i);
  current = false; finish(new Response(JSON.stringify({ agentId: 'chosen' })));
  await refused; expect(startConversation).not.toHaveBeenCalled();
});
it('forwards route cancellation and never falls back after an aborted request fails', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(hyperOpenBotFetch).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const controller = new AbortController(), startConversation = vi.fn();
  const sending = HyperStartHomeDraft({ startConversation, openConversation: vi.fn(), initialDraftSupported: true }, bots, { text: 'abandoned task', files: [], commandIds: [], submit: true }, 'chosen', controller.signal);
  const refused = expect(sending).rejects.toThrow(); controller.abort(); fail(new Error('offline')); await refused;
  expect(vi.mocked(hyperOpenBotFetch).mock.calls[0][1]?.signal).toBe(controller.signal); expect(startConversation).not.toHaveBeenCalled();
});
it('refuses to discard a draft when shared navigation has not implemented transfer', async () => {
  await expect(HyperStartHomeDraft({ startConversation: vi.fn(), openConversation: vi.fn() }, bots, { text: 'task', files: [], commandIds: [], submit: true })).rejects.toThrow('draft transfer');
});
it('keeps routing within 10000 units without splitting surrogate pairs', () => {
  expect(HyperRoutingText('a'.repeat(9999) + '😀')).toHaveLength(9999);
});
it('greets only the first conversation and encodes pagination cursors', async () => {
  const user = { id: 'u', email: 'a@b', name: ' Ada ', role: 'user', onboarding: null };
  expect(HyperHomeGreeting(user, true)).toBe('Hi Ada, what would you like to work on?');
  expect(HyperHomeGreeting(user, false)).toBe('Start a conversation');
  await HyperReadHomeChannels('a&b');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/channels?cursor=a%26b');
});
