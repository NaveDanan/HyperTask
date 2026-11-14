import { beforeEach, expect, it, vi } from 'vitest';
import { hyperSaveVoiceTranscript } from './HyperVoiceArchive';
import { hyperOpenBotFetch, hyperOpenBotRequest } from '../transport';
vi.mock('../transport', () => ({ hyperOpenBotFetch: vi.fn(), hyperOpenBotRequest: vi.fn(), HYPER_OPENBOT_ORIGIN: 'https://hyper-openbot.invalid' }));
beforeEach(() => vi.resetAllMocks());
const call = { id: 'call', channelId: 'channel', anchorMessageId: null, startedAt: '2026-09-22T12:00:00Z', endedAt: '2026-09-22T12:01:00Z', transcript: [] };
it('deduplicates navigation/retry saves and accepts a saved transcript despite summary failure', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ user: { id: 'owner' } });
  vi.mocked(hyperOpenBotFetch).mockResolvedValue(new Response(JSON.stringify({ session: { ...call, summaryStatus: 'failed' } }), { status: 429 }));
  const first = hyperSaveVoiceTranscript(call, 'owner'); expect(hyperSaveVoiceTranscript(call, 'owner')).toBe(first);
  expect((await first).summaryStatus).toBe('failed'); expect(hyperOpenBotFetch).toHaveBeenCalledTimes(1);
  expect(hyperOpenBotFetch).toHaveBeenCalledWith('https://hyper-openbot.invalid/api/voice/sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify(call), headers: { 'content-type': 'application/json', 'x-openbot-voice': '1' } }));
});
it('refuses to save a previous account transcript under the current account', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ user: { id: 'other' } });
  await expect(hyperSaveVoiceTranscript(call, 'owner')).rejects.toThrow('another'); expect(hyperOpenBotFetch).not.toHaveBeenCalled();
});
