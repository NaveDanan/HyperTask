import { useEffect, useRef, useState } from 'react';
/** Refetch authoritative state after every write, including a write that partly succeeded. */
export function useHyperBotResource<T>(load: () => Promise<T>, key: string, interval?: number) {
  const [data, setData] = useState<T>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const locked = useRef(false);
  const sequence = useRef(0);
  const owner = useRef({ key, live: true, version: 0 });
  if (owner.current.key !== key) { owner.current.live = false; owner.current = { key, live: true, version: 0 }; }
  const scope = owner.current;
  const dataOwner = useRef(scope);
  const versionAtRender = scope.version;
  const current = () => owner.current === scope && scope.live && scope.version === versionAtRender;
  useEffect(() => {
    let live = true;
    scope.live = true;
    let reading = false;
    const refresh = async () => {
      if (reading || locked.current) return;
      reading = true;
      const version = ++sequence.current;
      try { const value = await load(); if (live && version === sequence.current && owner.current === scope) { dataOwner.current = scope; scope.version++; setData(value); } }
      catch { if (live && version === sequence.current) { setData(undefined); setError('Unable to load. Access may be refused.'); } }
      finally { reading = false; if (live && version === sequence.current) setPending(false); }
    };
    setPending(true); void refresh();
    const timer = interval ? setInterval(() => void refresh(), interval) : undefined;
    return () => { live = false; scope.live = false; sequence.current++; clearInterval(timer); };
  }, [key, revision, interval]);
  async function run(action: (isCurrent: () => boolean) => Promise<unknown>) {
    if (locked.current || !current()) return;
    locked.current = true; sequence.current++; setPending(true); setError('');
    try { await action(current); } catch { if (current()) setError('The change was refused or could not be saved.'); }
    finally { locked.current = false; if (current()) { scope.version++; setRevision(v => v + 1); } }
  }
  return { data: dataOwner.current === scope ? data : undefined, pending, error, run, current, refresh: () => { if (!current() || locked.current) return; sequence.current++; scope.version++; setError(''); setRevision(v => v + 1); } };
}
