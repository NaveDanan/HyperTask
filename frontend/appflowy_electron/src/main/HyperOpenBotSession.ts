import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { session, type Cookies, type Session } from 'electron';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';

const ORIGIN = 'http://127.0.0.1:3010';
const BACKEND = 'ssh:agent@100.104.170.51:127.0.0.1:3010';
const digest = (identity: string) => createHash('sha256').update(identity).digest('hex');
export type HyperOpenBotIdentityReader = () => Promise<string | null>;
type HyperCookieSession = Pick<Session, 'cookies' | 'clearStorageData' | 'clearAuthCache'>;
export interface HyperOpenBotSessionLease {
  readonly signal: AbortSignal;
  assertCurrent(): void;
  withCookies<T>(action: (cookies: Cookies) => Promise<T>): Promise<T>;
}
export interface HyperOpenBotSessionDependencies {
  readIdentity: HyperOpenBotIdentityReader;
  bindOwner(owner: string): Promise<void>;
  readOwner(): Promise<string | null>;
  partition(name: string): HyperCookieSession;
  clearLegacyCookies(): Promise<void>;
}
/** The identity comes only from a direct, authenticated Rust-core response, never IPC arguments. */
export async function hyperReadCoreIdentity(request: (event: string, payload: Uint8Array) => Promise<{ status: number; payload: Uint8Array }>): Promise<string | null> {
  const reply = await request('GetUserProfile', new Uint8Array());
  if (reply.status !== 0) return null;
  try {
    const profile = fromBinary(UserProfilePBSchema, reply.payload);
    // Remote numeric IDs and UUIDs are server supplied. Until the core persists the
    // authenticating server's origin, they cannot safely identify this backend's owner.
    if (profile.id === 0n || profile.userAuthType !== 0) return null;
    const identity = await request('HyperGetNativeIdentity', new Uint8Array());
    if (identity.status !== 0) return null;
    const value: unknown = JSON.parse(new TextDecoder().decode(identity.payload));
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('domain' in value) || value.domain !== 'local' || !('userId' in value) || value.userId !== profile.id.toString() || !('userUuid' in value) || typeof value.userUuid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.userUuid) || value.userUuid === '00000000-0000-0000-0000-000000000000') return null;
    return JSON.stringify(['local', value.userUuid]);
  }
  catch { return null; }
}

/** One personal backend has one native owner, even when its server needs no session cookie. */
export class HyperOpenBotSession {
  private generation = 0;
  private blocked = false;
  private active?: { owner: string; controller: AbortController; partition: HyperCookieSession };
  private cookieWork: Promise<unknown> = Promise.resolve();
  private transition: Promise<void> = Promise.resolve();
  private acquiring: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private readonly dependencies: HyperOpenBotSessionDependencies) {}
  onInvalidate(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private invalidate() {
    ++this.generation;
    this.active?.controller.abort(new Error('Native OpenBot identity invalidated'));
    this.active = undefined;
    for (const listener of this.listeners) listener();
  }
  /** Called before native SignOut or authentication changes. Blocking is synchronous. */
  beginNativeTransition(clearCredentials = true): { version: number; cleared: Promise<void> } {
    this.blocked = true;
    this.invalidate();
    const version = this.generation;
    const priorCookies = this.cookieWork;
    this.transition = this.transition.catch(() => {}).then(async () => {
      // A response already writing cookies must finish before the clear, so it cannot restore them later.
      await priorCookies.catch(() => {});
      if (!clearCredentials) return;
      const owner = await this.dependencies.readOwner();
      if (owner) {
        const partition = this.dependencies.partition(`persist:hyper-openbot-${owner}`);
        await partition.clearStorageData({ storages: ['cookies'] });
        await partition.clearAuthCache();
      }
      await this.dependencies.clearLegacyCookies();
    });
    return { version, cleared: this.transition };
  }
  /** Only successful native authentication/init may lift the sign-out barrier. */
  completeNativeTransition(version: number, authenticated: boolean) {
    if (version === this.generation && authenticated) this.blocked = false;
  }
  async acquire(): Promise<HyperOpenBotSessionLease> {
    const version = this.generation;
    const assertVersion = () => { if (this.blocked || version !== this.generation) throw new Error('Sign in to HyperTask before connecting OpenBot'); };
    assertVersion();
    const identity = await this.dependencies.readIdentity();
    assertVersion();
    if (!identity) { this.invalidate(); throw new Error('Authenticated HyperTask identity is unavailable'); }
    const owner = digest(identity);
    // Serialize first-owner creation and partition activation without trusting renderer state.
    const activate = this.acquiring.catch(() => {}).then(async () => {
      assertVersion();
      if (this.active && this.active.owner !== owner) {
        const transition = this.beginNativeTransition(); await transition.cleared;
        throw new Error('OpenBot is bound to another HyperTask identity. A trusted reconnect is required.');
      }
      await this.dependencies.bindOwner(owner);
      assertVersion();
      this.active ??= { owner, controller: new AbortController(), partition: this.dependencies.partition(`persist:hyper-openbot-${owner}`) };
      return this.active;
    });
    this.acquiring = activate;
    const active = await activate;
    const assertCurrent = () => { assertVersion(); if (this.active !== active) throw new Error('OpenBot identity changed'); active.controller.signal.throwIfAborted(); };
    assertCurrent();
    return {
      signal: active.controller.signal,
      assertCurrent,
      withCookies: <T>(action: (cookies: Cookies) => Promise<T>) => {
        assertCurrent();
        const work = this.cookieWork.catch(() => {}).then(async () => { assertCurrent(); const result = await action(active.partition.cookies); assertCurrent(); return result; });
        this.cookieWork = work;
        return work;
      },
    };
  }
}

/** Native account operations must proceed even when OpenBot cleanup fails. */
export async function hyperNativeCoreRequest<T extends { status: number }>(sessions: HyperOpenBotSession, event: string, request: () => Promise<T>): Promise<T> {
  const authentication = ['SignOut', 'DeleteAccount', 'SignUp', 'OauthSignIn', 'SignInWithEmailPassword', 'PasscodeSignIn', 'MagicLinkSignIn', 'InitUser', 'OpenAnonUser'].includes(event);
  if (!authentication) return request();
  const transition = sessions.beginNativeTransition(event !== 'InitUser');
  let cleared = false;
  try { await transition.cleared; cleared = true; }
  catch { /* The native operation proceeds; failed cleanup keeps OpenBot blocked. */ }
  const reply = await request();
  if (cleared && !['SignOut', 'DeleteAccount'].includes(event)) sessions.completeNativeTransition(transition.version, reply.status === 0);
  return reply;
}

export function createHyperOpenBotSession(storageRoot: string, readIdentity: HyperOpenBotIdentityReader) {
  const directory = path.join(storageRoot, 'hyper-openbot-session');
  const file = path.join(directory, 'owner.json');
  async function readOwner(): Promise<string | null> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2 || !('backend' in value) || value.backend !== BACKEND || !('owner' in value) || typeof value.owner !== 'string' || !/^[a-f0-9]{64}$/.test(value.owner)) throw new Error('Invalid OpenBot owner binding; a trusted reconnect is required');
      return value.owner;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  return new HyperOpenBotSession({
    readIdentity, readOwner,
    async bindOwner(owner) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await fs.chmod(directory, 0o700);
      try { await fs.writeFile(file, JSON.stringify({ version: 2, backend: BACKEND, owner }), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (await readOwner() !== owner) throw new Error('OpenBot is bound to another HyperTask identity. A trusted reconnect is required.');
    },
    partition: name => session.fromPartition(name),
    async clearLegacyCookies() {
      const cookies = await session.defaultSession.cookies.get({ url: ORIGIN });
      for (const cookie of cookies) await session.defaultSession.cookies.remove(`${cookie.secure ? 'https' : 'http'}://127.0.0.1:3010${cookie.path || '/'}`, cookie.name);
    },
  });
}
