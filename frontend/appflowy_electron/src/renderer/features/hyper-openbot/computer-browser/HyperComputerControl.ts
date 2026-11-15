// Adapted from pinned OpenBot lib/computers/use-control.ts and shared/computer-control.ts.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { hyperOpenBotRequest } from '../transport';
import { hyperComputerPath, hyperReadControl, hyperReleaseControl, hyperTakeControl, type HyperControl } from './HyperComputerApi';

type HyperControlAction = 'take' | 'release' | 'cancel' | 'private' | 'drive';
type HyperControlScope = { id?: string; live: boolean; version: number; reads: number; writing: boolean; actor?: string; control?: HyperControl };
export async function hyperReadComputerActor(): Promise<string | undefined> {
  const me = await hyperOpenBotRequest<{ user?: { id?: unknown } | null }>('/api/me');
  return typeof me?.user?.id === 'string' && me.user.id.trim() ? me.user.id : undefined;
}

/** Unknown identity, transition or holder never grants another person's wheel. Role is irrelevant. */
export function hyperComputerPermits(control: HyperControl | undefined, actor: string | undefined, action: HyperControlAction): boolean {
  if (!actor || !control || control.transitioning !== false) return false;
  if (control.holder !== 'bot' && control.holder !== 'human') return false;
  if (control.holder === 'human' && (!control.heldBy || control.heldBy !== actor)) return false;
  if (action === 'drive') return control.holder === 'human';
  if (action === 'private') return true; // A Bot can ask for a private field without handing over the wheel.
  if (action === 'take') return control.holder === 'bot';
  if (!control.request?.id) return false;
  if (action === 'release') return control.holder === 'human' && ['taken', 'cancelled'].includes(control.request.status);
  return control.holder === 'human' ? control.request.status === 'taken' : control.request.status === 'waiting';
}
const signature = (actor?: string, control?: HyperControl) => JSON.stringify([actor, control]);

/** One mounted caller's authority. Cached handlers keep their version and cannot adopt a later owner or Bot. */
export function useHyperComputerControl(id?: string, supplied?: HyperComputerAuthority): HyperComputerAuthority {
  const [, redraw] = useState(0);
  const ref = useRef<HyperControlScope>({ id, live: true, version: 0, reads: 0, writing: false });
  if (ref.current.id !== id) {
    ref.current.live = false;
    ref.current = { id, live: true, version: 0, reads: 0, writing: false };
  }
  const scope = ref.current;
  const live = () => ref.current === scope && scope.live;
  function publish(actor?: string, control?: HyperControl) {
    if (!live()) return;
    if (signature(actor, control) !== signature(scope.actor, scope.control)) scope.version++;
    scope.actor = actor; scope.control = control; redraw(n => n + 1);
  }
  async function read() {
    const [actor, control] = await Promise.all([hyperReadComputerActor(), id ? hyperReadControl(id) : Promise.resolve(undefined)]);
    return { actor, control };
  }
  useEffect(() => {
    if (supplied) return;
    scope.live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const sequence = ++scope.reads;
      try { const next = await read(); if (live() && !scope.writing && sequence === scope.reads) publish(next.actor, next.control); }
      catch { if (live() && !scope.writing && sequence === scope.reads) publish(); }
      finally { if (live()) timer = setTimeout(() => void poll(), 1000); }
    }
    void poll();
    return () => { scope.live = false; scope.version++; scope.reads++; clearTimeout(timer); };
  }, [id, supplied !== undefined]);
  const version = scope.version;
  const current = () => live() && scope.version === version;
  const permits = (action: HyperControlAction) => current() && !scope.writing && hyperComputerPermits(scope.control, scope.actor, action);
  async function run(action: HyperControlAction, work: (isCurrent: () => boolean) => Promise<void>, callerCurrent = () => true) {
    if (!permits(action) || !callerCurrent()) return false;
    const expected = signature(scope.actor, scope.control);
    const valid = () => current() && callerCurrent();
    let checked = false;
    scope.writing = true; scope.reads++; redraw(n => n + 1);
    try {
      const next = await read();
      if (!valid()) return false;
      if (signature(next.actor, next.control) !== expected || !hyperComputerPermits(next.control, next.actor, action)) {
        publish(next.actor, next.control); return false;
      }
      checked = true;
      await work(valid);
      return true;
    } catch (error) {
      if (valid()) {
        // A refused write need not change the owner. Read it back so a valid retry keeps its draft;
        // a failed read or a different owner still invalidates every retained action.
        if (checked) {
          try { const next = await read(); if (valid()) publish(next.actor, next.control); }
          catch { if (valid()) publish(); }
        } else publish();
        throw error;
      }
      return false;
    } finally { if (live()) { scope.writing = false; redraw(n => n + 1); } }
  }
  async function change(action: 'take' | 'release' | 'cancel') {
    return run(action, async valid => {
      const control = scope.control!;
      const next = action === 'take'
        ? await hyperTakeControl(id!, control.request?.status === 'waiting' ? control.request.id : undefined, async requestId => {
          // Request creation may wait on the computer. Verify the resulting request and actor before taking it.
          const fresh = await read();
          if (!valid()) return false;
          if (fresh.actor !== scope.actor || !hyperComputerPermits(fresh.control, fresh.actor, 'take') || fresh.control?.request?.id !== requestId || fresh.control.request.status !== 'waiting') {
            publish(fresh.actor, fresh.control); return false;
          }
          return true;
        })
        : action === 'release' ? await hyperReleaseControl(id!, control.request!.id)
        : await hyperOpenBotRequest<HyperControl>(`${hyperComputerPath(id!)}/control/cancel`, 'POST', { requestId: control.request!.id });
      if (valid()) publish(scope.actor, next);
    });
  }
  return supplied && supplied.computerId === id ? supplied : { computerId: id, actor: scope.actor, control: scope.control, busy: scope.writing, key: `${id}:${version}`, current,
    permits, canDrive: () => permits('drive'), run, change };
}
export interface HyperComputerAuthority {
  computerId?: string;
  actor?: string;
  control?: HyperControl;
  busy: boolean;
  key: string;
  current(): boolean;
  permits(action: HyperControlAction): boolean;
  canDrive(): boolean;
  run(action: HyperControlAction, work: (isCurrent: () => boolean) => Promise<void>, callerCurrent?: () => boolean): Promise<boolean>;
  change(action: 'take' | 'release' | 'cancel'): Promise<boolean>;
}
/** Vault's sign-in form must run every mutation through this guard, including retained/deferred callbacks. */
export interface HyperComputerActionGuard {
  current(): boolean;
  run(work: (isCurrent: () => boolean) => Promise<void>): Promise<boolean>;
}
