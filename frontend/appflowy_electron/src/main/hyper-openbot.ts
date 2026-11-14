import { closeHyperOpenBotTunnel, hyperOpenBotSocketPath, hyperOpenBotCookieHeader, hyperTunnelFetch } from './HyperOpenBotTunnel';
import type { HyperOpenBotSession } from './HyperOpenBotSession';
import { hyperOpenBotPathAllowed } from '@shared/hyper-openbot-policy';
import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import WebSocket from 'ws';
import type { HyperOpenBotRequest, HyperOpenBotSocketEvent } from '@shared/api';
const ORIGIN = 'http://127.0.0.1:3010';
const MAX_BYTES = 24 * 1024 * 1024;
const DEADLINE_MS = 10 * 60 * 1000;
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
export function registerHyperOpenBotIpc(window: () => BrowserWindow | null, sessions: HyperOpenBotSession) {
  const running = new Map<string, AbortController>();
  const sockets = new Map<string, WebSocket>();
  const openingSockets = new Map<string, { cancelled: boolean }>();
  const owners = new WeakSet<object>();
  const own = (event: IpcMainEvent | IpcMainInvokeEvent) => { if (!owners.has(event.sender)) { owners.add(event.sender); event.sender.once('destroyed', () => { for (const controller of running.values()) controller.abort(); for (const socket of sockets.values()) socket.terminate(); for (const opening of openingSockets.values()) opening.cancelled = true; closeHyperOpenBotTunnel(); }); } };
  sessions.onInvalidate(() => { for (const controller of running.values()) controller.abort(); for (const socket of sockets.values()) socket.terminate(); for (const opening of openingSockets.values()) opening.cancelled = true; closeHyperOpenBotTunnel(); });
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => event.sender === window()?.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle('hyper-openbot:start', async (event, request: HyperOpenBotRequest) => {
    if (!trusted(event)) throw new Error('Untrusted OpenBot caller');
    own(event);
    if (!request || !safeId(request.id) || running.has(request.id)) throw new Error('Invalid request id');
    if (!hyperOpenBotPathAllowed(request.path)) throw new Error('OpenBot route refused');
    if (typeof request.method !== 'string' || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) throw new Error('OpenBot method refused');
    if (request.body !== undefined && typeof request.body !== 'string' && !(request.body instanceof Uint8Array)) throw new Error('Invalid OpenBot body');
    if (request.body && (typeof request.body === 'string' ? Buffer.byteLength(request.body) : request.body.byteLength) > MAX_BYTES) throw new Error('OpenBot request too large');
    if (request.contentType !== undefined && (typeof request.contentType !== 'string' || request.contentType.length > 200)) throw new Error('Invalid content type');
    const controller = new AbortController();
    running.set(request.id, controller);
    const timer = setTimeout(() => controller.abort(new Error('OpenBot request deadline exceeded')), DEADLINE_MS);
    const cleanup = () => { clearTimeout(timer); running.delete(request.id); };
    const send = (value: object) => { if ('chunk' in value && controller.signal.aborted) return; if (!event.sender.isDestroyed()) event.sender.send('hyper-openbot:chunk', { id: request.id, ...value }); };
    try {
      const lease = await sessions.acquire();
      controller.signal.throwIfAborted();
      const response = await hyperTunnelFetch(request.path, {
        method: request.method, body: typeof request.body === 'string' ? request.body : request.body ? Buffer.from(request.body) : undefined,
        signal: controller.signal, lease,
        headers: { 'content-type': /^multipart\/form-data; boundary=[\w-]+$/.test(request.contentType ?? '') ? request.contentType! : 'application/json', origin: ORIGIN },
      });
      setTimeout(() => void (async () => {
        try {
          const reader = response.body?.getReader();
          if (reader) for (;;) { const part = await reader.read(); if (part.done) break; send({ chunk: part.value }); }
          send({ done: true });
        } catch { send({ error: controller.signal.aborted ? 'OpenBot request stopped or timed out' : 'OpenBot response interrupted', done: true }); }
        finally { cleanup(); }
      })(), 0);
      // Only content metadata crosses IPC. Authentication and deployment headers stay in main.
      return { status: response.status, headers: Object.fromEntries([...response.headers].filter(([key]) => ['content-type', 'content-length', 'content-disposition', 'cache-control'].includes(key))) };
    } catch (error) { cleanup(); throw error; }
  });
  ipcMain.on('hyper-openbot:cancel', (event, id: unknown) => { if (trusted(event) && safeId(id)) running.get(id)?.abort(); });
  ipcMain.handle('hyper-openbot:socket-open', async (event, id: unknown, path: unknown, protocols: unknown) => {
    if (!trusted(event) || !safeId(id) || sockets.has(id) || openingSockets.has(id) || sockets.size + openingSockets.size >= 16) throw new Error('Socket caller refused');
    if (typeof path !== 'string' || path.length > 16384 || !/^\/api\/intelligence\/client\/websocket\?[^#\\]*$/.test(path)) throw new Error('Socket route refused');
    if (!Array.isArray(protocols) || protocols.length > 8 || protocols.some(value => typeof value !== 'string' || value.length > 200)) throw new Error('Socket protocols refused');
    own(event);
    const opening = { cancelled: false }; openingSockets.set(id, opening);
    try {
    const lease = await sessions.acquire();
    const socketPath = await hyperOpenBotSocketPath();
    const cookie = await hyperOpenBotCookieHeader(lease);
    lease.assertCurrent();
    if (event.sender.isDestroyed() || opening.cancelled) throw new Error('Renderer closed or socket cancelled');
    const socket = new WebSocket(`ws+unix://${socketPath}:${path}`, protocols, { origin: ORIGIN, headers: { cookie: cookie }, handshakeTimeout: 15000, maxPayload: MAX_BYTES, followRedirects: false });
    sockets.set(id, socket);
    const abort = () => socket.terminate();
    lease.signal.addEventListener('abort', abort, { once: true });
    lease.assertCurrent();
    const send = (value: Omit<HyperOpenBotSocketEvent, 'id'>) => { if (value.type !== 'close' && lease.signal.aborted) return; if (!event.sender.isDestroyed()) event.sender.send('hyper-openbot:socket', { id, ...value }); };
    const deadline = setTimeout(() => socket.close(1000, 'Connection lifetime reached'), DEADLINE_MS);
    socket.on('open', () => send({ type: 'open' }));
    socket.on('message', (data, binary) => send({ type: 'message', data: binary ? new Uint8Array(data as Buffer) : data.toString() }));
    socket.on('error', () => send({ type: 'error' }));
    socket.on('close', (code, reason) => { clearTimeout(deadline); lease.signal.removeEventListener('abort', abort); sockets.delete(id); send({ type: 'close', code, reason: reason.toString() }); });
    } finally { openingSockets.delete(id); }
  });
  ipcMain.on('hyper-openbot:socket-send', (event, id: unknown, data: unknown) => {
    if (!trusted(event) || !safeId(id) || (typeof data !== 'string' && !(data instanceof Uint8Array))) return;
    if ((typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength) > MAX_BYTES) return;
    const socket = sockets.get(id); if (socket?.readyState === WebSocket.OPEN) socket.send(data);
  });
  ipcMain.on('hyper-openbot:socket-close', (event, id: unknown, code: unknown, reason: unknown) => {
    if (!trusted(event) || !safeId(id)) return;
    const opening = openingSockets.get(id); if (opening) opening.cancelled = true;
    const validCode = typeof code === 'number' && Number.isInteger(code) && (code === 1000 || (code >= 3000 && code <= 4999)) ? code : 1000;
    // Streaming decode omits an incomplete trailing code point instead of expanding it to U+FFFD.
    const text = typeof reason === 'string' ? new TextDecoder().decode(Buffer.from(reason).subarray(0, 123), { stream: true }) : '';
    const socket = sockets.get(id);
    try { socket?.close(validCode, text); } catch { socket?.terminate(); }
  });
}
