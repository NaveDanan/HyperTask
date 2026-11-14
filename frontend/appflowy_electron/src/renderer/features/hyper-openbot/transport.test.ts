import { afterEach, expect, it, vi } from 'vitest';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN } from './transport';
import type { HyperOpenBotChunk, HyperOpenBotRequest } from '@shared/api';
afterEach(() => vi.unstubAllGlobals());
it('delivers split Unicode JSON and stream events without exposing credentials', async () => {
  let listener: (event: HyperOpenBotChunk) => void = () => {};
  const dispose = vi.fn();
  const start = vi.fn(async (request: HyperOpenBotRequest) => {
    listener({ id: 'another-request', chunk: 'ignored' });
    listener({ id: request.id, chunk: 'data: שלום\n' });
    listener({ id: request.id, chunk: '\n', done: true });
    return { status: 200, headers: { 'content-type': 'text/event-stream' } };
  });
  vi.stubGlobal('window', { appflowy: { hyperOpenBot: { start, onChunk: (fn: typeof listener) => { listener = fn; return dispose; }, cancel: vi.fn() } } });
  const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + '/api/copilotkit', { method: 'POST', body: '{"input":"hello"}' });
  expect(await response.text()).toBe('data: שלום\n\n');
  expect(dispose).toHaveBeenCalledOnce();
  const request = start.mock.calls[0][0];
  expect(new TextDecoder().decode(request.body as Uint8Array)).toBe('{"input":"hello"}');
  expect(request.path).toBe('/api/copilotkit');
  expect(request).not.toHaveProperty('headers');
});
it('refuses arbitrary renderer hosts before invoking the bridge', async () => {
  await expect(hyperOpenBotFetch('https://example.org/api/channels')).rejects.toThrow('origin refused');
});
