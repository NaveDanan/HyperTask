import { useEffect, useRef } from 'react';
import { useHyperBotResource } from '../bot-tabs/HyperBotResource';
import { hyperInvalidateAppAccess, hyperSubscribeAppAccess } from './HyperAccessRefresh';
import { useHyperRoutineNavigation } from '../routines/HyperRoutineNavigation';

/** Add arrival ownership to the existing Bot resource's load/mutation lifecycle. */
export function useHyperAppResource<T extends object>(key: string, load: () => Promise<T>) {
  const navigation = useHyperRoutineNavigation();
  const current = useRef({ key, active: false, sequence: 0, busy: false, data: undefined as T | undefined });
  const owners = useRef(new WeakMap<T, object>());
  if (current.current.key !== key) current.current = { key, active: false, sequence: 0, busy: false, data: undefined };
  const scope = current.current;
  const valid = () => current.current === scope && scope.active && navigation?.isCurrentNavigation?.() !== false;
  const resource = useHyperBotResource(async () => {
    const ticket = ++scope.sequence;
    const value = await load();
    owners.current.set(value, scope);
    if (!valid() || scope.sequence !== ticket) throw new Error('The app selection changed.');
    scope.data = value;
    return value;
  }, key);
  useEffect(() => {
    scope.active = true;
    const off = hyperSubscribeAppAccess(() => { scope.sequence++; resource.refresh(); });
    const offState = window.appflowy?.hyperOpenBot?.service?.onState?.(state => { if (!state.ready) { scope.active = false; scope.sequence++; } else if (current.current === scope && !scope.active) { current.current = { ...scope, active: false, busy: false, sequence: 0, data: undefined }; resource.refresh(); } });
    return () => { scope.active = false; scope.sequence++; off(); offState?.(); };
  }, [scope]);
  const data = resource.data && (!owners.current.has(resource.data) || owners.current.get(resource.data) === scope) ? resource.data : undefined;
  const isCurrent = () => valid() && !!data && scope.data === data && !scope.busy;
  async function run(action: (stillCurrent: () => boolean) => Promise<void>) {
    if (!isCurrent()) return;
    scope.busy = true; scope.sequence++;
    const stillCurrent = () => valid() && scope.data === data;
    try { await resource.run(async () => { if (stillCurrent()) await action(stillCurrent); }); }
    finally { scope.busy = false; hyperInvalidateAppAccess(); }
  }
  return { ...resource, data, run, isCurrent, scope };
}
