import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IpcChannel as C } from '@shared/api';
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>(), fetch: vi.fn(), path: vi.fn(async () => '/private/gateway.sock'), close: vi.fn(), sockets: [] as any[], dialog: vi.fn(), copy: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => ipc.handlers.set(name, fn), on: (name: string, fn: (...args: any[]) => any) => ipc.events.set(name, fn) }, dialog: { showMessageBox: ipc.dialog }, clipboard: { writeText: ipc.copy } }));
vi.mock('./HyperOpenBotTunnel', () => ({ hyperTunnelFetch: ipc.fetch, hyperOpenBotSocketPath: ipc.path, closeHyperOpenBotTunnel: ipc.close, hyperOpenBotCookieHeader: async (lease: { assertCurrent(): void }) => { lease.assertCurrent(); return ''; } }));
vi.mock('ws', async () => { const { EventEmitter } = await import('node:events'); return { default: class extends EventEmitter { static OPEN = 1; readyState = 1; terminate = vi.fn(() => { this.readyState = 3; this.emit('close', 1006, Buffer.from('')); }); close = this.terminate; constructor() { super(); ipc.sockets.push(this); } } }; });
import { HyperOpenBotSession, hyperNativeCoreRequest, type HyperOpenBotSessionDependencies } from './HyperOpenBotSession';
import { registerHyperOpenBotFileIpc, registerHyperOpenBotIpc } from './hyper-openbot';
beforeEach(() => { ipc.handlers.clear(); ipc.events.clear(); ipc.sockets.length = 0; vi.clearAllMocks(); ipc.fetch.mockReset(); ipc.dialog.mockReset().mockResolvedValue({ response: 0 }); ipc.path.mockReset().mockResolvedValue('/private/gateway.sock'); });
function setup(identity: string | null = 'a', ready = () => true) {
  let owner: string | null = null;
  const manager = new HyperOpenBotSession({ readIdentity: async () => identity, bindOwner: async (value: string) => { owner ??= value; if (owner !== value) throw new Error('Owner mismatch'); }, readOwner: async () => owner, partition: () => ({ cookies: {}, clearStorageData: async () => {}, clearAuthCache: async () => {} }), clearLegacyCookies: async () => {} } as unknown as HyperOpenBotSessionDependencies);
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
  const event = { sender, senderFrame: sender.mainFrame };
  const bridge = registerHyperOpenBotIpc(() => ({ webContents: sender }) as never, manager, ready);
  return { manager, sender, event, bridge };
}
it('denies unauthenticated HTTP before touching SSH or the backend', async () => {
  const h = setup(null);
  await expect(ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'one', path: '/api/channels', method: 'GET' })).rejects.toThrow('identity is unavailable');
  expect(ipc.fetch).not.toHaveBeenCalled(); expect(ipc.path).not.toHaveBeenCalled();
});
it.each([
  ['/api/responsibilities/goal/triggers', 'POST'],
  ['/api/responsibilities/triggers/trigger/secret', 'GET'],
  ['/api/responsibilities/triggers/trigger/%73ecret?nonce=test', 'POST'],
])('keeps trigger credentials in native main at %s', async (route, method) => {
  const h = setup(), secret = 'whsec_' + 'x'.repeat(43) + '=';
  ipc.dialog.mockResolvedValue({ response: 1 });
  ipc.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ trigger: { id: 'trigger' }, secret }), { status: method === 'POST' && !route.includes('triggers/trigger') ? 201 : 200 }));
  await ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'trigger-secret', path: route, method });
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledWith('hyper-openbot:chunk', expect.objectContaining({ id: 'trigger-secret', done: true })));
  const text = h.sender.send.mock.calls.filter(([, value]) => value.id === 'trigger-secret' && value.chunk).map(([, value]) => Buffer.from(value.chunk).toString()).join('');
  expect(text).not.toContain(secret); expect(JSON.parse(text)).not.toHaveProperty('secret');
  expect(ipc.dialog).toHaveBeenCalledTimes(2); expect(ipc.copy).toHaveBeenCalledWith(secret);
});
it('does not mutate a trigger when native confirmation is cancelled', async () => {
  const h = setup();
  ipc.fetch.mockResolvedValueOnce(new Response('{"secret":null}', { status: 201 }));
  await expect(ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'trigger-cancel', path: '/api/responsibilities/goal/triggers', method: 'POST' })).rejects.toThrow('cancelled');
  expect(ipc.fetch).not.toHaveBeenCalled(); expect(ipc.copy).not.toHaveBeenCalled();
});
it('stops trigger mutation if the native owner signs out during confirmation', async () => {
  const h = setup();
  ipc.dialog.mockImplementationOnce(async () => { await h.manager.beginNativeTransition().cleared; return { response: 1 }; });
  await expect(ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'trigger-signout', path: '/api/responsibilities/goal/triggers', method: 'POST' })).rejects.toThrow();
  expect(ipc.fetch).not.toHaveBeenCalled(); expect(ipc.copy).not.toHaveBeenCalled();
});
it('does not expose trigger error text or user-provided signing values through response bytes', async () => {
  const h = setup(); ipc.dialog.mockResolvedValue({ response: 1 });
  ipc.fetch.mockResolvedValueOnce(new Response('{"error":"synthetic-signing-secret"}', { status: 403 }));
  const result = await ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'trigger-error', path: '/api/responsibilities/triggers/trigger/secret', method: 'POST', body: '{"secret":"synthetic-signing-secret"}' });
  expect(result.status).toBe(403);
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledWith('hyper-openbot:chunk', expect.objectContaining({ id: 'trigger-error', done: true })));
  const text = h.sender.send.mock.calls.filter(([, value]) => value.id === 'trigger-error' && value.chunk).map(([, value]) => Buffer.from(value.chunk).toString()).join('');
  expect(text).not.toContain('synthetic-signing-secret'); expect(ipc.copy).not.toHaveBeenCalled();
});
it('forwards the audit export row cap without forwarding authentication headers', async () => {
  const h = setup();
  ipc.fetch.mockResolvedValueOnce(new Response('row\n', { headers: { 'x-audit-export-truncated': '5000', 'set-cookie': 'private', authorization: 'private' } }));
  const response = await ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'audit-export', path: '/api/admin/audit-events?format=csv', method: 'GET' });
  expect(response.headers['x-audit-export-truncated']).toBe('5000');
  expect(response.headers).not.toHaveProperty('set-cookie');
  expect(response.headers).not.toHaveProperty('authorization');
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledWith('hyper-openbot:chunk', expect.objectContaining({ done: true })));
});
it.each(['/api/voice/calls?nonce=test', '/api/voice/%63alls?nonce=test'])('applies voice guards to canonical route %s', async route => {
  const h = setup();
  const secret = 'synthetic-voice-secret';
  ipc.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ transport: 'websocket', url: 'wss://api.x.ai/v1/realtime', clientSecret: secret, session: { id: 'session' } })));
  await ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'voice-query', path: route, method: 'POST', body: '{}' });
  expect(ipc.fetch.mock.calls[0][1].headers['x-openbot-voice']).toBe('1');
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledWith('hyper-openbot:chunk', expect.objectContaining({ id: 'voice-query', done: true })));
  const chunks = h.sender.send.mock.calls.filter(([, value]) => value.id === 'voice-query' && value.chunk).map(([, value]) => Buffer.from(value.chunk).toString());
  const payload = chunks.join('');
  expect(payload).not.toContain(secret);
  expect(JSON.parse(payload).url).toMatch(/^wss:\/\/hyper-openbot\.invalid\/api\/voice\/socket\/[a-f0-9-]{36}$/);
  await h.manager.beginNativeTransition().cleared;
});
it.each(['/api/agents/bot/callback-token', '/api/agents/bot/callback-token?nonce=test', '/api/agents/%62ot/callback%2Dtoken?nonce=test', '/api/agents/bot/callback%2Dtoken?nonce=test'])('refuses raw callback-key creation through generic renderer HTTP at %s', async route => {
  const h = setup();
  ipc.fetch.mockResolvedValueOnce(new Response('{"token":"synthetic-secret"}'));
  await expect(ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'callback', path: route, method: 'POST' })).rejects.toThrow('protected native handoff');
  expect(ipc.fetch).not.toHaveBeenCalled();
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

it('blocks new HTTP/socket work while services are not ready and cancels an established bridge', async () => {
  let ready = true; const h = setup('a', () => ready);
  await ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'live', '/api/intelligence/client/websocket?vsn=2.0.0', []);
  ready = false; h.bridge.disconnect(); expect(ipc.sockets[0].terminate).toHaveBeenCalledOnce();
  ipc.path.mockClear();
  await expect(ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'blocked', path: '/api/channels', method: 'GET' })).rejects.toThrow('not ready');
  await expect(ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'blocked-socket', '/api/intelligence/client/websocket?vsn=2.0.0', [])).rejects.toThrow('not ready');
  expect(ipc.fetch).not.toHaveBeenCalled(); expect(ipc.path).not.toHaveBeenCalled();
});
it('does not restart the private tunnel when Stop interrupts a pending identity read', async () => {
  let ready = true; const h = setup('a', () => ready);
  const lease = await h.manager.acquire();
  let finish!: (value: typeof lease) => void;
  vi.spyOn(h.manager, 'acquire').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const opening = ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'pending-owner', '/api/intelligence/client/websocket?vsn=2.0.0', []);
  const rejected = expect(opening).rejects.toThrow();
  ready = false; h.bridge.disconnect(); finish(lease);
  await rejected;
  expect(ipc.path).not.toHaveBeenCalled(); expect(ipc.sockets).toHaveLength(0);
});
it('allows only the exact channel events socket and rejects variants', async () => {
  const h = setup();
  for (const path of ['/api/channels/events?token=x', '/api/channels/events/extra', '/api/channels/../events', '/api/channels/%65vents', 'wss://evil/api/channels/events']) await expect(ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'events-denied', path, [])).rejects.toThrow('Socket route refused');
  await ipc.handlers.get('hyper-openbot:socket-open')!(h.event, 'events-allowed', '/api/channels/events', []);
  expect(ipc.sockets).toHaveLength(1); await h.manager.beginNativeTransition().cleared;
});
it('synthesizes the required voice header for transcript saves including query paths', async () => {
  const h = setup(); ipc.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: 'call' } })));
  await ipc.handlers.get('hyper-openbot:start')!(h.event, { id: 'voice-save', path: '/api/voice/sessions?retry=true', method: 'POST', body: '{}' });
  expect(ipc.fetch.mock.calls[0][1].headers['x-openbot-voice']).toBe('1');
  await h.manager.beginNativeTransition().cleared;
});
