import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { UserProfilePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { HYPER_BOTS_SIGN_IN, HyperBotsHub, hyperBotsReadIdentity, type HyperBotsUser } from './HyperBotsHub';
import type { HyperBotsRuntime } from './HyperBotsRuntime';

const profile = (id: bigint, email = 'a@corp.example', userAuthType = 0) => toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id, email, userAuthType, token: 'never-part-of-the-key' }));
const A: HyperBotsUser = { key: 'a'.repeat(64), userId: '1' };
const B: HyperBotsUser = { key: 'b'.repeat(64), userId: '2' };

it('reads the signed-in account from the core profile; null when signed out', async () => {
  const request = vi.fn(async () => ({ status: 0, payload: profile(42n, 'dana@corp.example', 0) }));
  const user = await hyperBotsReadIdentity(request);
  expect(request).toHaveBeenCalledWith('GetUserProfile', new Uint8Array());
  expect(user).toEqual({ userId: '42', key: createHash('sha256').update(JSON.stringify([0, '42', 'dana@corp.example'])).digest('hex') });
  // The same numeric id from another authenticator or address is another account.
  request.mockResolvedValueOnce({ status: 0, payload: profile(42n, 'dana@corp.example', 2) });
  expect((await hyperBotsReadIdentity(request))!.key).not.toBe(user!.key);
  request.mockResolvedValueOnce({ status: 0, payload: profile(0n) });
  expect(await hyperBotsReadIdentity(request)).toBeNull();
  request.mockResolvedValueOnce({ status: 1, payload: new Uint8Array() });
  expect(await hyperBotsReadIdentity(request)).toBeNull();
  request.mockResolvedValueOnce({ status: 0, payload: new Uint8Array([0xff, 0xff, 0xff]) });
  expect(await hyperBotsReadIdentity(request)).toBeNull();
});

function fakeRuntime(stop: () => Promise<void> = async () => {}) {
  return { start: vi.fn(), stop: vi.fn(stop) } as unknown as HyperBotsRuntime & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
}
function setup(stopTimeoutMs = 50) {
  let who: HyperBotsUser | null = A;
  const identity = vi.fn(async () => who);
  const made: Array<{ user: HyperBotsUser; file: string; runtime: ReturnType<typeof fakeRuntime> }> = [];
  let nextStop: (() => Promise<void>) | undefined;
  const createRuntime = vi.fn((user: HyperBotsUser, file: string) => { const runtime = fakeRuntime(nextStop); made.push({ user, file, runtime }); return runtime; });
  const hub = new HyperBotsHub({ directory: path.join('C:', 'support', 'hyper_bots', 'users'), identity, create: createRuntime, stopTimeoutMs });
  const switches: Array<HyperBotsRuntime | null> = [];
  hub.onSwitch(runtime => switches.push(runtime));
  return { hub, identity, made, createRuntime, switches, as: (user: HyperBotsUser | null) => { who = user; }, stopWith: (fn: () => Promise<void>) => { nextStop = fn; } };
}

// Audit #5: one runtime and one state file per verified account; a switch stops the previous account's work first.
it('audit #5: each verified account gets its own runtime and state file; switching stops the previous one', async () => {
  const h = setup();
  const first = await h.hub.current();
  expect(first.user).toEqual(A);
  expect(h.made[0]!.file).toBe(path.join('C:', 'support', 'hyper_bots', 'users', 'a'.repeat(32), 'state.json'));
  expect(h.made[0]!.runtime.start).toHaveBeenCalledTimes(1);
  expect((await h.hub.current()).runtime).toBe(first.runtime);
  expect(h.identity).toHaveBeenCalledTimes(2);
  h.as(B);
  const second = await h.hub.current();
  expect(h.made[0]!.runtime.stop).toHaveBeenCalledTimes(1);
  expect(second.runtime).not.toBe(first.runtime);
  expect(h.made[1]!.file).toBe(path.join('C:', 'support', 'hyper_bots', 'users', 'b'.repeat(32), 'state.json'));
  expect(h.switches).toEqual([first.runtime, null, second.runtime]);
  // Signing out stops the account's work and refuses every call.
  h.as(null);
  await expect(h.hub.current()).rejects.toThrow(HYPER_BOTS_SIGN_IN);
  expect(h.made[1]!.runtime.stop).toHaveBeenCalledTimes(1);
  expect(h.switches.at(-1)).toBeNull();
  h.as(A);
  expect((await h.hub.current()).runtime).toBe(h.made[2]!.runtime);
  expect(h.createRuntime).toHaveBeenCalledTimes(3);
});

it('concurrent calls are serialized: one runtime is created, never two', async () => {
  const h = setup();
  const results = await Promise.all([h.hub.current(), h.hub.current(), h.hub.current()]);
  expect(h.createRuntime).toHaveBeenCalledTimes(1);
  expect(new Set(results.map(r => r.runtime)).size).toBe(1);
});

it('a runtime that cannot open its state file is reported from current() and does not stick', async () => {
  const h = setup();
  h.createRuntime.mockImplementationOnce(() => { throw new Error('EACCES: state.json'); });
  await expect(h.hub.current()).rejects.toMatchObject({ kind: 'state', message: 'HyperBots could not start. EACCES: state.json' });
  expect((await h.hub.current()).user).toEqual(A);
});

it('a slow stop is bounded; the same account is not reopened while its old runtime still runs', async () => {
  const h = setup(20);
  const finishers: Array<() => void> = [];
  h.stopWith(() => new Promise<void>(resolve => { finishers.push(resolve); }));
  await h.hub.current();
  h.as(B);
  await h.hub.current();
  h.as(A);
  await expect(h.hub.current()).rejects.toThrow(/still stopping/);
  expect(h.createRuntime).toHaveBeenCalledTimes(2);
  for (const finish of finishers) finish();
  await vi.waitFor(async () => expect((await h.hub.current()).user).toEqual(A));
});

it('stop() stops the active runtime and refuses later calls', async () => {
  const h = setup();
  const { runtime } = await h.hub.current();
  await h.hub.stop();
  expect(runtime.stop).toHaveBeenCalledTimes(1);
  await expect(h.hub.current()).rejects.toThrow(/shutting down/);
});
