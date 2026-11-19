import { createHash } from 'node:crypto';
import path from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { UserProfilePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import type { HyperBotsRuntime } from './HyperBotsRuntime';
import { SettingsError } from './settings-error';

/** A HyperTask account as main verified it with the core: `key` partitions state, `userId` names the Jira settings and credential. */
export type HyperBotsUser = { key: string; userId: string };
export type HyperBotsActive = { user: HyperBotsUser; runtime: HyperBotsRuntime };
export const HYPER_BOTS_SIGN_IN = 'Sign in to HyperTask to use Bots.';

/** The signed-in account, read straight from the Rust core (never from the renderer). Null when signed out or unreadable. */
export async function hyperBotsReadIdentity(request: (event: string, payload: Uint8Array) => Promise<{ status: number; payload: Uint8Array }>): Promise<HyperBotsUser | null> {
  const reply = await request('GetUserProfile', new Uint8Array());
  if (reply.status !== 0) return null;
  try {
    const profile = fromBinary(UserProfilePBSchema, reply.payload);
    if (profile.id === 0n) return null;
    const key = createHash('sha256').update(JSON.stringify([profile.userAuthType, profile.id.toString(), profile.email])).digest('hex');
    return { key, userId: profile.id.toString() };
  } catch { return null; }
}

const settle = (work: Promise<unknown>, ms: number) => new Promise<boolean>((resolve) => {
  const timer = setTimeout(() => resolve(false), ms);
  work.then(() => true, () => true).then((done) => { clearTimeout(timer); resolve(done); });
});

/**
 * One runtime at a time, for the account the core says is signed in. Every current() re-reads the identity; a
 * different account (or none) stops the previous runtime before anything else runs, so one account never sees or
 * approves another's work. State lives in <directory>/<key prefix>/state.json.
 */
export class HyperBotsHub {
  private active: HyperBotsActive | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly draining = new Map<string, Promise<boolean>>();
  private readonly listeners = new Set<(runtime: HyperBotsRuntime | null) => void>();
  private stopped = false;
  private readonly stopTimeoutMs: number;

  constructor(private readonly deps: { directory: string; startOnResolve?: boolean; identity: () => Promise<HyperBotsUser | null>; create: (user: HyperBotsUser, stateFile: string) => HyperBotsRuntime; stopTimeoutMs?: number }) {
    this.stopTimeoutMs = deps.stopTimeoutMs ?? 5000;
  }

  onSwitch(listener: (runtime: HyperBotsRuntime | null) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Serialized: concurrent callers never create two runtimes or interleave a switch. */
  current(): Promise<HyperBotsActive> {
    const next = this.queue.catch(() => {}).then(() => this.resolve());
    this.queue = next;
    return next;
  }

  /** Stops the active runtime (bounded); later current() calls are refused. */
  stop(): Promise<void> {
    this.stopped = true;
    const next = this.queue.catch(() => {}).then(() => this.release());
    this.queue = next;
    return next;
  }

  private emit(runtime: HyperBotsRuntime | null) {
    for (const listener of this.listeners) { try { listener(runtime); } catch { /* best effort */ } }
  }

  private async resolve(): Promise<HyperBotsActive> {
    if (this.stopped) throw new SettingsError('state', 'HyperBots is shutting down.');
    const user = await this.deps.identity();
    if (this.stopped) throw new SettingsError('state', 'HyperBots is shutting down.');
    if (!user) { await this.release(); throw new SettingsError('state', HYPER_BOTS_SIGN_IN); }
    if (this.active?.user.key === user.key) return this.active;
    await this.release();
    const folder = user.key.slice(0, 32);
    // A runtime of this account still finishing must not share its state file with a new one.
    const draining = this.draining.get(folder);
    if (draining && !(await settle(draining, this.stopTimeoutMs))) throw new SettingsError('state', 'Bots are still stopping for this account. Try again in a moment.');
    let runtime: HyperBotsRuntime;
    try { runtime = this.deps.create(user, path.join(this.deps.directory, folder, 'state.json')); }
    catch (error) { throw new SettingsError('state', `HyperBots could not start. ${error instanceof Error ? error.message : String(error)}`); }
    this.active = { user, runtime };
    this.emit(runtime);
    // Approved work resumes for this account only.
    try { if (this.deps.startOnResolve !== false) runtime.start(); } catch (error) { console.error('[hyper-bots] could not resume runs', error); }
    return this.active;
  }

  private async release() {
    const previous = this.active;
    if (!previous) return;
    this.active = null;
    this.emit(null);
    const folder = previous.user.key.slice(0, 32);
    const stopping = Promise.resolve().then(() => previous.runtime.stop());
    const done = stopping.then(() => true, () => true).finally(() => { if (this.draining.get(folder) === done) this.draining.delete(folder); });
    this.draining.set(folder, done);
    await settle(stopping, this.stopTimeoutMs);
  }
}
