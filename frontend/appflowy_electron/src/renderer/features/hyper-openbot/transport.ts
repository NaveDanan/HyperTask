/** Fetch-compatible streaming bridge. Session cookies stay in Electron's main session. */
export const HYPER_OPENBOT_ORIGIN = 'https://hyper-openbot.invalid';
export const hyperOpenBotFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== HYPER_OPENBOT_ORIGIN) throw new Error('OpenBot origin refused');
  const id = crypto.randomUUID();
  let dispose = () => {};
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      dispose = window.appflowy.hyperOpenBot.onChunk((event) => {
        if (event.id !== id) return;
        if (event.error) { controller.error(new Error(event.error)); dispose(); return; }
        if (event.chunk) controller.enqueue(event.chunk);
        if (event.done) { controller.close(); dispose(); }
      });
    },
    cancel() { window.appflowy.hyperOpenBot.cancel(id); dispose(); },
  });
  const abort = () => { window.appflowy.hyperOpenBot.cancel(id); dispose(); try { streamController?.error(new DOMException('OpenBot request aborted', 'AbortError')); } catch { /* Already settled. */ } };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    request.signal.throwIfAborted();
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer());
    request.signal.throwIfAborted();
    const result = await window.appflowy.hyperOpenBot.start({ id, path: url.pathname + url.search, method: request.method, contentType: request.headers.get('content-type') ?? undefined, body });
    request.signal.throwIfAborted();
    return new Response([204, 205, 304].includes(result.status) ? null : stream, result);
  } catch (error) { abort(); throw error; }
};

export async function hyperOpenBotRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? value.detail ?? `OpenBot request failed (${response.status})`);
  return value as T;
}
