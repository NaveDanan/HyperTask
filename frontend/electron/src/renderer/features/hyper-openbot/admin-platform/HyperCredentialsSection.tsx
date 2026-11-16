// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { HyperKeyForm } from '../vault';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { hyperLoadCredentials, hyperRevokeCredential, type HyperCredentials } from './HyperPlatformApi';
export default function HyperCredentialsSection({path}: {path?:string}) {
  const [data, setData] = useState<HyperCredentials>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(()=>!!path && /^\/admin\/credentials\/new\/?(?:[?#]|$)/.test(path));
  const [revoke, setRevoke] = useState<string>();
  async function load() { try { setError(''); setData(await hyperLoadCredentials()); } catch { setError('Could not load credentials. Check your permissions and retry.'); } }
  useEffect(() => { void load(); }, []);
  return <section className="space-y-4 p-6 text-sm"><h2 className="text-lg font-semibold">Credentials</h2><p className="text-muted-foreground">Manage this deployment’s keys and tokens. Saved secrets cannot be viewed again.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!adding && <><Button onClick={() => { setAdding(true); }}>Add credential</Button><Button variant="ghost" onClick={() => void load()}>Refresh</Button></>}
    {adding && <Button variant="outline" disabled={busy} onClick={()=>setAdding(false)}>Back to credentials</Button>}
    {adding ? error ? null : !data ? <p role="status">Loading credentials…</p> : <HyperKeyForm keys={data} onSaved={() => { setAdding(false); void load(); }} onCancel={() => setAdding(false)} /> : !data ? <p role="status">Loading credentials…</p> : data.credentials.length === 0 ? <p>No credentials yet</p> : data.credentials.map(c => <div className="flex items-center justify-between rounded-lg border border-border p-4" key={c.id}><div><p>{c.provider}</p><p className="text-muted-foreground">{c.kind} · {c.keyId} · {c.revokedAt ? 'revoked' : 'active'}</p></div><Button variant="outline" disabled={busy || !!c.revokedAt} onClick={() => setRevoke(c.id)}>Revoke</Button></div>)}
    {revoke && <div role="alertdialog" aria-label="Revoke credential" className="space-y-3 rounded-lg border border-border p-4"><p>Revoke this credential? Services using it will lose access.</p><Button disabled={busy} variant="destructive" onClick={async () => { setBusy(true); try { await hyperRevokeCredential(revoke); setRevoke(undefined); await load(); } catch { setError('Could not revoke credential. Check your permissions and retry.'); } finally { setBusy(false); } }}>Confirm revoke</Button><Button disabled={busy} variant="outline" onClick={() => setRevoke(undefined)}>Cancel</Button></div>}
  </section>;
}
