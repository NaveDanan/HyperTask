import { useEffect, useRef, useState } from 'react';
/** Refetch authoritative state after every write, including a write that partly succeeded. */
export function useHyperBotResource<T>(load: () => Promise<T>, key: string, interval?: number) {
  const [data, setData] = useState<T>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const locked = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    let live = true;
    let reading = false;
    const refresh = async () => {
      if (reading || locked.current) return;
      reading = true;
      const version = ++sequence.current;
      try { const value = await load(); if (live && version === sequence.current) setData(value); }
      catch { if (live && version === sequence.current) { setData(undefined); setError('Unable to load. Access may be refused.'); } }
      finally { reading = false; if (live && version === sequence.current) setPending(false); }
    };
    setPending(true); void refresh();
    const timer = interval ? setInterval(() => void refresh(), interval) : undefined;
    return () => { live = false; clearInterval(timer); };
  }, [key, revision, interval]);
  async function run(action: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true; sequence.current++; setPending(true); setError('');
    try { await action(); } catch { setError('The change was refused or could not be saved.'); }
    finally { locked.current = false; setRevision(v => v + 1); }
  }
  return { data, pending, error, run, refresh: () => { setError(''); setRevision(v => v + 1); } };
}
