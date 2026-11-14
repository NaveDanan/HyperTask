import { useEffect, useRef, useState } from 'react';
export function useHyperBotResource<T>(load: () => Promise<T>, key: string, interval?: number) {
  const [data, setData] = useState<T>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const locked = useRef(false);
  useEffect(() => {
    let live = true;
    const refresh = () => { void load().then(value => { if (live) setData(value); }).catch(() => { if (live) setError('Unable to load. Access may be refused.'); }).finally(() => { if (live) setPending(false); }); };
    setPending(true); refresh();
    const timer = interval ? setInterval(refresh, interval) : undefined;
    return () => { live = false; clearInterval(timer); };
  }, [key, revision, interval]);
  async function run(action: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true; setPending(true); setError('');
    try { await action(); } catch { setError('The change was refused or could not be saved.'); }
    finally { locked.current = false; setRevision(v => v + 1); }
  }
  return { data, pending, error, run, refresh: () => { setError(''); setRevision(v => v + 1); } };
}
