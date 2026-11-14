import { hyperOpenBotPathAllowed } from '@shared/hyper-openbot-policy';
import { ipcMain, net, type BrowserWindow } from 'electron';
import type { HyperOpenBotRequest } from '@shared/api';

// This transport can reach only the authorized local tunnel. No renderer-supplied host,
// headers, credentials, redirects, filesystem access, or arbitrary upstream URL.
export function registerHyperOpenBotIpc(window: () => BrowserWindow | null) {
  const running = new Map<string, AbortController>();
  ipcMain.handle('hyper-openbot:start', async (event, request: HyperOpenBotRequest) => {
    if (event.sender !== window()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted OpenBot caller');
    if (!request || !/^[\w-]{1,100}$/.test(request.id) || running.has(request.id)) throw new Error('Invalid request id');
    if (!hyperOpenBotPathAllowed(request.path)) throw new Error('OpenBot route refused');
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) throw new Error('OpenBot method refused');
    if (request.body && request.body.length > 24 * 1024 * 1024) throw new Error('OpenBot request too large');
    const controller = new AbortController();
    running.set(request.id, controller);
    try {
      const response = await net.fetch(`http://127.0.0.1:3010${request.path}`, {
        method: request.method, body: typeof request.body === 'string' ? request.body : request.body ? Buffer.from(request.body) : undefined, signal: controller.signal,
        credentials: 'include', redirect: 'error',
        headers: { 'content-type': /^multipart\/form-data; boundary=[\w-]+$/.test(request.contentType ?? '') ? request.contentType! : 'application/json', origin: 'http://127.0.0.1:3010' },
      });
      // Delay pumping until the invoke reply is queued. Renderer subscribes before start.
      setTimeout(() => void (async () => {
        try {
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          if (reader) for (;;) {
            const part = await reader.read();
            if (part.done) break;
            event.sender.send('hyper-openbot:chunk', { id: request.id, chunk: decoder.decode(part.value, { stream: true }) });
          }
          event.sender.send('hyper-openbot:chunk', { id: request.id, chunk: decoder.decode(), done: true });
        } catch (error) {
          if (!event.sender.isDestroyed()) event.sender.send('hyper-openbot:chunk', { id: request.id, error: String(error), done: true });
        } finally { running.delete(request.id); }
      })(), 0);
      return { status: response.status, headers: Object.fromEntries([...response.headers].filter(([key]) => !['set-cookie', 'set-cookie2'].includes(key))) };
    } catch (error) { running.delete(request.id); throw error; }
  });
  ipcMain.on('hyper-openbot:cancel', (event, id: string) => {
    if (event.sender === window()?.webContents) running.get(id)?.abort();
  });
}
