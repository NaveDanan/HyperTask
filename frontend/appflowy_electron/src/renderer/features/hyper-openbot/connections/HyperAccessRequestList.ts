import { hyperSubscribeAppAccess } from './HyperAccessRefresh';
import { useEffect, useRef, useState } from 'react';

/** Rows, readbacks and decisions belong to one mounted app selection. */
export function useHyperAccessRequestList<Request extends { id: string }>(
  target: string,
  busy: boolean,
  read: () => Promise<Request[]>,
) {
  const current = useRef({ target, active: false, sequence: 0, busy, requests: undefined as Request[] | undefined });
  if (current.current.target !== target) current.current = { target, active: false, sequence: 0, busy, requests: undefined };
  const scope = current.current;
  scope.busy = busy;
  const [result, setResult] = useState<{ scope: typeof scope; requests?: Request[]; failed: boolean }>();
  const isCurrent = () => current.current === scope && scope.active;
  async function load() {
    if (!isCurrent()) return;
    const sequence = ++scope.sequence;
    try {
      const requests = await read();
      if (!isCurrent() || sequence !== scope.sequence) return;
      scope.requests = requests;
      setResult({ scope, requests, failed: false });
    } catch {
      if (isCurrent() && sequence === scope.sequence) setResult({ scope, requests: scope.requests, failed: true });
    }
  }
  useEffect(() => {
    scope.active = true;
    scope.requests = undefined;
    setResult(undefined);
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => { scope.active = false; scope.sequence++; scope.requests = undefined; clearInterval(timer); };
  }, [target]);
  useEffect(() => hyperSubscribeAppAccess(() => { if (isCurrent() && !scope.busy) { scope.sequence++; void load(); } }), [target]);
  async function decide(request: Request, action: () => Promise<unknown>, run: (action: () => Promise<void>) => Promise<void>) {
    const allowed = () => isCurrent() && !!scope.requests?.includes(request);
    if (scope.busy || !allowed()) return;
    await run(async () => {
      // The parent's runner may defer execution until after navigation or unmount.
      if (!allowed()) return;
      try { await action(); } finally { await load(); }
    });
  }
  return { requests: result?.scope === scope ? result.requests : undefined, failed: result?.scope === scope && result.failed, decide };
}
