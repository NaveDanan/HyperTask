import { afterEach, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const electron = vi.hoisted(() => ({ fromPartition: vi.fn(), getLegacy: vi.fn(async () => []), removeLegacy: vi.fn(async () => {}) }));
vi.mock('electron', () => ({ session: { fromPartition: electron.fromPartition, defaultSession: { cookies: { get: electron.getLegacy, remove: electron.removeLegacy } } } }));
import { HyperOpenBotSession, createHyperOpenBotSession, hyperReadCoreIdentity, type HyperOpenBotSessionDependencies } from './HyperOpenBotSession';
const directories: string[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
function harness() {
  let identity: string | null = 'native-user-a'; let owner: string | null = null;
  const cookieSession = { cookies: { get: vi.fn(async () => []), set: vi.fn(async () => {}) }, clearStorageData: vi.fn(async () => {}), clearAuthCache: vi.fn(async () => {}) };
  const partition = vi.fn((_name: string) => cookieSession);
  const dependencies = { readIdentity: vi.fn(async () => identity), readOwner: vi.fn(async () => owner), bindOwner: vi.fn(async (next: string) => { if (owner && owner !== next) throw new Error('Trusted reconnect required'); owner = next; }), partition, clearLegacyCookies: vi.fn(async () => {}) };
  return { manager: new HyperOpenBotSession(dependencies as unknown as HyperOpenBotSessionDependencies), cookieSession, dependencies, partition, identity: (next: string | null) => { identity = next; }, owner: () => owner };
}
it('uses the core session UUID in the local namespace rather than a numeric profile ID', async () => {
  const payload = toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 123n, userAuthType: 0, token: 'not-part-of-identity' }));
  const userUuid = '02753979-2e38-48f5-959d-7a7b38469dc1';
  const identity = (uuid = userUuid, userId = '123', domain = 'local') => new TextEncoder().encode(JSON.stringify({ version: 1, userId, userUuid: uuid, domain }));
  const request = vi.fn(async (event: string) => ({ status: 0, payload: event === 'GetUserProfile' ? payload : identity() }));
  expect(await hyperReadCoreIdentity(request)).toBe(JSON.stringify(['local', userUuid]));
  expect(request).toHaveBeenCalledWith('GetUserProfile', new Uint8Array());
  expect(request).toHaveBeenCalledWith('HyperGetNativeIdentity', new Uint8Array());
  expect(await hyperReadCoreIdentity(async event => ({ status: 0, payload: event === 'GetUserProfile' ? payload : identity('38fb8eb1-bb70-4248-8ce8-64cddc296224') }))).not.toBe(await hyperReadCoreIdentity(request));
  expect(await hyperReadCoreIdentity(async event => ({ status: 0, payload: event === 'GetUserProfile' ? payload : identity(userUuid, '124') }))).toBeNull();
  expect(await hyperReadCoreIdentity(async event => ({ status: 0, payload: event === 'GetUserProfile' ? payload : identity(userUuid, '123', 'https://other-server.example') }))).toBeNull();
  expect(await hyperReadCoreIdentity(async event => ({ status: 0, payload: event === 'GetUserProfile' ? payload : identity('00000000-0000-0000-0000-000000000000') }))).toBeNull();
  expect(await hyperReadCoreIdentity(async () => ({ status: 1, payload }))).toBeNull();
  expect(await hyperReadCoreIdentity(async () => ({ status: 0, payload: new Uint8Array() }))).toBeNull();
  expect(await hyperReadCoreIdentity(async () => ({ status: 0, payload: new Uint8Array([255]) }))).toBeNull();
});
it('denies remote accounts with colliding IDs until authenticated server provenance is available', async () => {
  for (const userAuthType of [1, 2, 99]) {
    const payload = toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 123n, userAuthType }));
    const request = vi.fn(async () => ({ status: 0, payload }));
    expect(await hyperReadCoreIdentity(request)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  }
});
it('invalidates HTTP/WS leases synchronously on signout, clears credentials, and keeps owner binding', async () => {
  const h = harness(); const lease = await h.manager.acquire(); const bound = h.owner();
  const http = new AbortController(); const terminate = vi.fn();
  h.manager.onInvalidate(() => { http.abort(); terminate(); });
  const signout = h.manager.beginNativeTransition();
  expect(lease.signal.aborted).toBe(true); expect(http.signal.aborted).toBe(true); expect(terminate).toHaveBeenCalledOnce();
  expect(() => lease.assertCurrent()).toThrow();
  await expect(h.manager.acquire()).rejects.toThrow('Sign in');
  await signout.cleared;
  expect(h.cookieSession.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
  expect(h.cookieSession.clearAuthCache).toHaveBeenCalledOnce(); expect(h.dependencies.clearLegacyCookies).toHaveBeenCalledOnce();
  expect(h.owner()).toBe(bound);
  h.identity('native-user-b');
  const signin = h.manager.beginNativeTransition(); await signin.cleared; h.manager.completeNativeTransition(signin.version, true);
  await expect(h.manager.acquire()).rejects.toThrow('reconnect');
  expect(h.owner()).toBe(bound);
});
it('does not let a response rewrite cookies after signout has cleared them', async () => {
  const h = harness(); const lease = await h.manager.acquire(); const order: string[] = [];
  let writing = false;
  let finishWrite: () => void = () => {};
  const write = lease.withCookies(async () => { writing = true; await new Promise<void>(resolve => { finishWrite = resolve; }); order.push('write'); });
  const rejected = expect(write).rejects.toThrow();
  await vi.waitFor(() => expect(writing).toBe(true));
  h.cookieSession.clearStorageData.mockImplementation(async () => { order.push('clear'); });
  const signout = h.manager.beginNativeTransition();
  expect(h.cookieSession.clearStorageData).not.toHaveBeenCalled();
  finishWrite(); await rejected; await signout.cleared;
  expect(order).toEqual(['write', 'clear']);
  expect(() => lease.withCookies(async () => {})).toThrow();
});
it('rejects an identity read begun before signout and never opens its partition', async () => {
  const h = harness(); let finish: (id: string) => void = () => {};
  h.dependencies.readIdentity.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const acquire = h.manager.acquire(); const rejected = expect(acquire).rejects.toThrow('Sign in');
  const signout = h.manager.beginNativeTransition(); finish('native-user-a');
  await rejected; await signout.cleared;
  expect(h.partition).not.toHaveBeenCalled(); expect(h.dependencies.bindOwner).not.toHaveBeenCalled();
});
it('clears and cancels an unexpected native identity switch even without a renderer signout', async () => {
  const h = harness(); const original = await h.manager.acquire(); h.identity('native-user-b');
  await expect(h.manager.acquire()).rejects.toThrow('another HyperTask identity');
  expect(original.signal.aborted).toBe(true); expect(h.cookieSession.clearStorageData).toHaveBeenCalledOnce();
  await expect(h.manager.acquire()).rejects.toThrow('Sign in');
});
it('ignores stale authentication completion and permits only the same owner after fresh native authentication', async () => {
  const h = harness(); const original = await h.manager.acquire(); const owner = h.owner();
  const old = h.manager.beginNativeTransition(); const signout = h.manager.beginNativeTransition(); await old.cleared; await signout.cleared;
  h.manager.completeNativeTransition(old.version, true);
  await expect(h.manager.acquire()).rejects.toThrow('Sign in');
  const signin = h.manager.beginNativeTransition(); await signin.cleared; h.manager.completeNativeTransition(signin.version, true);
  const restored = await h.manager.acquire(); expect(restored.signal.aborted).toBe(false); expect(original.signal.aborted).toBe(true); expect(h.owner()).toBe(owner);
  expect(new Set(h.partition.mock.calls.map(args => args[0])).size).toBe(1);
});
it('persists the first owner privately across restart and signout, refusing a second owner before partition access', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-session-test-')); directories.push(directory);
  const cookieSession = harness().cookieSession; electron.fromPartition.mockReturnValue(cookieSession);
  const a = createHyperOpenBotSession(directory, async () => 'native-a'); await a.acquire();
  const file = path.join(directory, 'hyper-openbot-session', 'owner.json');
  const before = await fs.readFile(file, 'utf8');
  expect(before).not.toContain('native-a'); expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  await a.beginNativeTransition().cleared;
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  electron.fromPartition.mockClear();
  const b = createHyperOpenBotSession(directory, async () => 'native-b');
  await expect(b.acquire()).rejects.toThrow('trusted reconnect'); expect(electron.fromPartition).not.toHaveBeenCalled();
  const restart = createHyperOpenBotSession(directory, async () => 'native-a'); await expect(restart.acquire()).resolves.toBeDefined();
});
it('fails closed if the private owner binding is malformed rather than replacing it', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-session-test-')); directories.push(directory);
  await fs.mkdir(path.join(directory, 'hyper-openbot-session')); const file = path.join(directory, 'hyper-openbot-session', 'owner.json'); await fs.writeFile(file, 'broken');
  const manager = createHyperOpenBotSession(directory, async () => 'native-b');
  await expect(manager.acquire()).rejects.toThrow(); expect(await fs.readFile(file, 'utf8')).toBe('broken');
});
it('does not promote an old numeric-ID owner binding into a UUID binding', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-session-test-')); directories.push(directory);
  await fs.mkdir(path.join(directory, 'hyper-openbot-session'));
  const file = path.join(directory, 'hyper-openbot-session', 'owner.json');
  const legacy = JSON.stringify({ version: 1, backend: 'ssh:agent@100.104.170.51:127.0.0.1:3010', owner: 'a'.repeat(64) });
  await fs.writeFile(file, legacy);
  const manager = createHyperOpenBotSession(directory, async () => 'new-uuid-owner');
  electron.fromPartition.mockClear();
  await expect(manager.acquire()).rejects.toThrow('Invalid OpenBot owner binding');
  expect(electron.fromPartition).not.toHaveBeenCalled();
  expect(await fs.readFile(file, 'utf8')).toBe(legacy);
});
