import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HyperNodError } from './HyperNodAccess';
const BACKEND = 'nod:mmems-mems01:127.0.0.1:4311';
const digest = (identity: string) => createHash('sha256').update(identity).digest('hex');
export interface HyperNodLease { readonly signal: AbortSignal; assertCurrent(): void }
export interface HyperNodSessionDependencies {
  readIdentity(): Promise<string | null>;
  /** Persists the first owner; rejects when the backend already belongs to another identity. */
  bindOwner(owner: string): Promise<void>;
}
/** One Nod server belongs to one person: its token opens the whole assistant. Bind it to one native identity. */
export class HyperNodSession {
  private generation = 0;
  private blocked = false;
  private active?: { owner: string; controller: AbortController };
  private acquiring: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly dependencies: HyperNodSessionDependencies) {}
  onInvalidate(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private invalidate() {
    ++this.generation;
    this.active?.controller.abort(new HyperNodError('signed_out'));
    this.active = undefined;
    for (const listener of this.listeners) listener();
  }
  /** Called before native sign-out or authentication changes. Blocking is synchronous. */
  beginNativeTransition(): number { this.blocked = true; this.invalidate(); return this.generation; }
  /** Only a successful native authentication or init may lift the barrier. */
  completeNativeTransition(version: number, authenticated: boolean) { if (version === this.generation && authenticated) this.blocked = false; }
  async acquire(): Promise<HyperNodLease> {
    const version = this.generation;
    const assertVersion = () => { if (this.blocked || version !== this.generation) throw new HyperNodError('signed_out'); };
    assertVersion();
    const identity = await this.dependencies.readIdentity();
    assertVersion();
    if (!identity) { this.invalidate(); throw new HyperNodError('signed_out'); }
    const owner = digest(identity);
    const activate = this.acquiring.catch(() => {}).then(async () => {
      assertVersion();
      if (this.active && this.active.owner !== owner) { this.invalidate(); throw new HyperNodError('profile_required'); }
      await this.dependencies.bindOwner(owner);
      assertVersion();
      this.active ??= { owner, controller: new AbortController() };
      return this.active;
    });
    this.acquiring = activate;
    const active = await activate;
    const assertCurrent = () => { assertVersion(); if (this.active !== active) throw new HyperNodError('signed_out'); active.controller.signal.throwIfAborted(); };
    assertCurrent();
    return { signal: active.controller.signal, assertCurrent };
  }
}
const AUTHENTICATION = ['SignOut', 'DeleteAccount', 'SignUp', 'OauthSignIn', 'SignInWithEmailPassword', 'PasscodeSignIn', 'MagicLinkSignIn', 'InitUser', 'OpenAnonUser'];
/** Native account operations always proceed; Nod stays blocked until authentication succeeds. */
export async function hyperNodNativeCoreRequest<T extends { status: number }>(sessions: HyperNodSession, event: string, request: () => Promise<T>): Promise<T> {
  if (!AUTHENTICATION.includes(event)) return request();
  const version = sessions.beginNativeTransition();
  const reply = await request();
  if (!['SignOut', 'DeleteAccount'].includes(event)) sessions.completeNativeTransition(version, reply.status === 0);
  return reply;
}
export function createHyperNodSession(storageRoot: string, readIdentity: () => Promise<string | null>) {
  const directory = path.join(storageRoot, 'hyper-nod-session');
  const file = path.join(directory, 'owner.json');
  async function readOwner(): Promise<string | null> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('backend' in value) || value.backend !== BACKEND || !('owner' in value) || typeof value.owner !== 'string' || !/^[a-f0-9]{64}$/.test(value.owner)) throw new HyperNodError('profile_required', 'The saved Nod owner record is unreadable. A trusted reconnect is required.');
      return value.owner;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  return new HyperNodSession({
    readIdentity,
    async bindOwner(owner) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await fs.chmod(directory, 0o700);
      try { await fs.writeFile(file, JSON.stringify({ version: 1, backend: BACKEND, owner }), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (await readOwner() !== owner) throw new HyperNodError('profile_required');
    },
  });
}
