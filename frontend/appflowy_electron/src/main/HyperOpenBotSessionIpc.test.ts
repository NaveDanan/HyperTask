import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IpcChannel as C } from '@shared/api';
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>(), fetch: vi.fn(), path: vi.fn(async () => '/private/gateway.sock'), close: vi.fn(), sockets: [] as any[] }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => ipc.handlers.set(name, fn), on: (name: string, fn: (...args: any[]) => any) => ipc.events.set(name, fn) } }));
vi.mock('./HyperOpenBotTunnel', () => ({ hyperTunnelFetch: ipc.fetch, hyperOpenBotSocketPath: ipc.path, closeHyperOpenBotTunnel: ipc.close, hyperOpenBotCookieHeader: async (lease: { assertCurrent(): void }) => { lease.assertCurrent(); return ''; } }));
vi.mock('ws', async () => { const { EventEmitter } = await import('node:events'); return { default: class extends EventEmitter { static OPEN = 1; readyState = 1; terminate = vi.fn(() => { this.readyState = 3; this.emit('close', 1006, Buffer.from('')); }); close = this.terminate; constructor() { super(); ipc.sockets.push(this); } } }; });
import { HyperOpenBotSession, hyperNativeCoreRequest, type HyperOpenBotSessionDependencies } from './HyperOpenBotSession';
import { registerHyperOpenBotFileIpc, registerHyperOpenBotIpc } from './hyper-openbot';
beforeEach(() => { ipc.handlers.clear(); ipc.events.clear(); ipc.sockets.length = 0; vi.clearAllMocks(); ipc.path.mockResolvedValue('/private/gateway.sock'); });
function setup(identity: string | null = 'a') {
  let owner: string | null = null;
  const manager = new HyperOpenBotSession({ readIdentity: async () => identity, bindOwner: async (value: string) => { owner ??= value; if (owner !== value) throw new Error('Owner mismatch'); }, readOwner: async () => owner, partition: () => ({ cookies: {}, clearStorageData: async () => {}, clearAuthCache: async () => {} }), clearLegacyCookies: async () => {} } as unknown as HyperOpenBotSessionDependencies);
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
  const event = { sender, senderFrame: sender.mainFrame };
  registerHyperOpenBotIpc(() => ({ webContents: sender }) as never, manager);
  return { manager, sender, event };
}
it('denies unauthenticated HTTP before touching SSH or the backend', async () => {
  const h = setup(null);
  await expect(ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'one', path: '/api/channels', method: 'GET' })).rejects.toThrow('identity is unavailable');
  expect(ipc.fetch).not.toHaveBeenCalled(); expect(ipc.path).not.toHaveBeenCalled();
});
it('terminates a real registered socket on native signout and blocks new opens', async () => {
  const h = setup();
  await ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'socket-one', '/api/intelligence/client/websocket?vsn=2.0.0', []);
  expect(ipc.sockets).toHaveLength(1);
  const signout = h.manager.beginNativeTransition();
  expect(ipc.sockets[0].terminate).toHaveBeenCalledOnce(); expect(ipc.close).toHaveBeenCalledOnce();
  await signout.cleared;
  await expect(ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'socket-two', '/api/intelligence/client/websocket?vsn=2.0.0', [])).rejects.toThrow('Sign in');
  expect(ipc.sockets).toHaveLength(1);
});
it('aborts active HTTP and suppresses response bytes delivered after native signout', async () => {
  const h = setup(); let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  ipc.fetch.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })));
  await ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'request-one', path: '/api/channels', method: 'GET' });
  const options = ipc.fetch.mock.calls[0][1]; expect(options.signal.aborted).toBe(false);
  const signout = h.manager.beginNativeTransition(); expect(options.signal.aborted).toBe(true);
  stream!.enqueue(new Uint8Array([1, 2, 3])); stream!.close(); await signout.cleared;
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledWith('hyper-openbot:chunk', expect.objectContaining({ done: true })));
  expect(h.sender.send.mock.calls.some(([, value]) => value.chunk)).toBe(false);
});
it('refuses a pending socket startup completed after signout', async () => {
  const h = setup(); let openPath: (value: string) => void = () => {};
  ipc.path.mockImplementationOnce(() => new Promise(resolve => { openPath = resolve; }));
  const opening = ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'socket-one', '/api/intelligence/client/websocket?vsn=2.0.0', []);
  const rejected = expect(opening).rejects.toThrow();
  await vi.waitFor(() => expect(ipc.path).toHaveBeenCalledOnce());
  const signout = h.manager.beginNativeTransition(); openPath('/private/gateway.sock');
  await rejected; await signout.cleared; expect(ipc.sockets).toHaveLength(0);
});
it('invalidates registered sockets before OpenAnonUser can change the native identity', async () => {
  const h = setup();
  await ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'socket-one', '/api/intelligence/client/websocket?vsn=2.0.0', []);
  const native = vi.fn(async () => { expect(ipc.sockets[0].terminate).toHaveBeenCalledOnce(); return { status: 0 }; });
  const switched = hyperNativeCoreRequest(h.manager, 'OpenAnonUser', native);
  expect(ipc.sockets[0].terminate).toHaveBeenCalledOnce();
  await switched; expect(native).toHaveBeenCalledOnce();
});
it.each(['SignOut', 'DeleteAccount', 'OauthSignIn', 'OpenAnonUser'])('dispatches native %s after cleanup failure while keeping OpenBot blocked', async event => {
  const manager = new HyperOpenBotSession({ readIdentity: async () => 'a', readOwner: async () => { throw new Error('Malformed binding or failed cleanup'); } } as unknown as HyperOpenBotSessionDependencies);
  const native = vi.fn(async () => ({ status: 0 }));
  await expect(hyperNativeCoreRequest(manager, event, native)).resolves.toEqual({ status: 0 });
  expect(native).toHaveBeenCalledOnce();
  await expect(manager.acquire()).rejects.toThrow('Sign in');
});
it('closes a socket with a UTF-8 reason that fits its byte limit and contains no split character', async () => {
  const h = setup();
  await ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'socket-one', '/api/intelligence/client/websocket?vsn=2.0.0', []);
  const socket = ipc.sockets[0];
  socket.close = vi.fn((_code, reason) => { if (Buffer.byteLength(reason) > 123) throw new RangeError('reason too long'); });
  expect(() => ipc.events.get('hyper-openbot:socket-close')!(h.event, 'socket-one', 1000, 'a'.repeat(122) + 'é')).not.toThrow();
  const reason = socket.close.mock.calls[0][1];
  expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(123); expect(reason).not.toContain('\uFFFD');
  socket.close.mockImplementationOnce(() => { throw new Error('Close failed'); });
  expect(() => ipc.events.get('hyper-openbot:socket-close')!(h.event, 'socket-one', 1000, 'safe')).not.toThrow();
  expect(socket.terminate).toHaveBeenCalledOnce();
});
it('blocks all generic renderer file handlers from main-owned state, including traversal and symlink aliases', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-file-ipc-'));
  try {
    const userData = path.join(directory, 'app');
    const binding = path.join(userData, 'hyper-openbot-session', 'owner.json');
    await fs.mkdir(path.dirname(binding), { recursive: true }); await fs.writeFile(binding, 'original-owner');
    const alias = path.join(directory, 'alias'); await fs.symlink(userData, alias, 'junction');
    const aliases = [path.join(alias, 'hyper-openbot-session', 'owner.json')];
    if (process.platform !== 'win32') {
      const fileAlias = path.join(directory, 'owner-alias'); await fs.symlink(binding, fileAlias); aliases.push(fileAlias);
    }
    registerHyperOpenBotFileIpc(userData);
    for (const target of [binding, path.join(userData, 'hyper-openbot-session', '..', 'hyper-openbot-session', 'owner.json'), ...aliases]) {
      await expect(ipc.handlers.get(C.FsWriteText)!({}, target, 'forged-owner')).rejects.toThrow('protected');
      await expect(ipc.handlers.get(C.FsWriteBytes)!({}, target, new Uint8Array([1, 2]))).rejects.toThrow('protected');
      await expect(ipc.handlers.get(C.FsReadText)!({}, target)).rejects.toThrow('protected');
      await expect(ipc.handlers.get(C.FsExists)!({}, target)).rejects.toThrow('protected');
    }
    await expect(ipc.handlers.get(C.FsEnsureDir)!({}, path.join(alias, 'Partitions', 'forged'))).rejects.toThrow('protected');
    await expect(ipc.handlers.get(C.FsWriteText)!({}, path.join(alias, 'new', 'owner.json'), 'forged')).rejects.toThrow('protected');
    expect(await fs.readFile(binding, 'utf8')).toBe('original-owner');
    // A prefix neighbour is an ordinary user file, not part of Electron's private state.
    const ordinary = path.join(directory, 'app-exports', 'saved.txt');
    await ipc.handlers.get(C.FsWriteText)!({}, ordinary, 'export');
    expect(await ipc.handlers.get(C.FsReadText)!({}, ordinary)).toBe('export');
    await ipc.handlers.get(C.FsWriteBytes)!({}, ordinary, new Uint8Array([65, 66]));
    expect(await ipc.handlers.get(C.FsReadText)!({}, ordinary)).toBe('AB');
    expect(await ipc.handlers.get(C.FsExists)!({}, ordinary)).toBe(true);
    await ipc.handlers.get(C.FsEnsureDir)!({}, path.join(directory, 'ordinary-directory'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
