import { afterEach, expect, it, vi } from 'vitest';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN } from './transport';
import type { HyperOpenBotChunk, HyperOpenBotRequest } from '@shared/api';
afterEach(() => vi.unstubAllGlobals());
it('delivers split Unicode JSON and stream events without exposing credentials', async () => {
  let listener: (event: HyperOpenBotChunk) => void = () => {};
  const dispose = vi.fn();
  const start = vi.fn(async (request: HyperOpenBotRequest) => {
    listener({ id: 'another-request', chunk: new TextEncoder().encode('ignored') });
    listener({ id: request.id, chunk: new TextEncoder().encode('data: שלום\n') });
    listener({ id: request.id, chunk: new TextEncoder().encode('\n'), done: true });
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
it('preserves arbitrary attachment bytes across IPC', async () => {
  let listener: (event: HyperOpenBotChunk) => void = () => {};
  const bytes = new Uint8Array([0, 255, 128, 195, 40]);
  vi.stubGlobal('window', { appflowy: { hyperOpenBot: { start: async ({ id }: HyperOpenBotRequest) => { listener({ id, chunk: bytes, done: true }); return { status: 200, headers: {} }; }, onChunk: (fn: typeof listener) => { listener = fn; return () => {}; }, cancel: vi.fn() } } });
  const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + '/api/attachments/id');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});
it('does not start a POST aborted during body serialization', async () => {
  const controller = new AbortController();
  const start = vi.fn();
  vi.stubGlobal('window', { appflowy: { hyperOpenBot: { start, onChunk: () => () => {}, cancel: vi.fn() } } });
  const original = Request.prototype.arrayBuffer;
  vi.spyOn(Request.prototype, 'arrayBuffer').mockImplementation(async function(this: Request) { controller.abort(); return original.call(this); });
  await expect(hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + '/api/channels', { method: 'POST', body: '{}', signal: controller.signal })).rejects.toThrow();
  expect(start).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
