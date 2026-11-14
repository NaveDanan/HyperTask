// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperCreateCredential, hyperLoadCredentials, hyperRevokeCredential, type HyperCredentials, type HyperCredentialDraft } from './HyperPlatformApi';
export default function HyperCredentialsSection() {
  const [data, setData] = useState<HyperCredentials>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [revoke, setRevoke] = useState<string>();
  const [draft, setDraft] = useState<HyperCredentialDraft>({ kind: 'model', provider: 'openai', keyId: '', plaintext: '' });
  async function load() { try { setError(''); setData(await hyperLoadCredentials()); } catch { setError('Could not load credentials. Check your permissions and retry.'); } }
  useEffect(() => { void load(); }, []);
  async function save() {
    setBusy(true); setError('');
    try { await hyperCreateCredential(draft); setDraft({ kind: 'model', provider: data?.modelKey?.provider ?? 'openai', keyId: '', plaintext: '' }); setAdding(false); await load(); }
    catch { setError('Could not save credential. Check required fields, existing active keys and your permissions.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 p-6 text-sm"><h2 className="text-lg font-semibold">Credentials</h2><p className="text-muted-foreground">Manage this deployment’s keys and tokens. Saved secrets cannot be viewed again.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!adding && <><Button onClick={() => { setDraft({ kind: 'model', provider: data?.modelKey?.provider ?? 'openai', keyId: '', plaintext: '' }); setAdding(true); }}>Add credential</Button><Button variant="ghost" onClick={() => void load()}>Refresh</Button></>}
    {adding ? <form className="max-w-lg space-y-4 rounded-lg border border-border p-4" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="block">Type<select className="block rounded-lg border border-border bg-background p-2" value={draft.kind} disabled={busy} onChange={e => setDraft({ ...draft, kind: e.target.value as HyperCredentialDraft['kind'], provider: e.target.value === 'model' ? data?.modelKey?.provider ?? 'openai' : '', keyId: '' })}><option value="model">Model</option><option value="connector">Connector</option></select></label>
      <label className="block">Provider{draft.kind === 'model' ? <select className="block rounded-lg border border-border bg-background p-2" disabled={busy} value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select> : <Input required disabled={busy} value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })} />}</label>
      {draft.kind === 'model' && data?.modelKey && <p>Your Bots run on {data.modelKey.provider}. {draft.provider !== data.modelKey.provider && 'They will not use this key.'}</p>}
      {draft.kind === 'connector' && <label className="block">Key ID<Input required disabled={busy} value={draft.keyId} onChange={e => setDraft({ ...draft, keyId: e.target.value })} />{data?.credentials.some(c => !c.revokedAt && c.kind === draft.kind && c.provider === draft.provider.trim() && c.keyId === draft.keyId.trim()) && <span>An active credential already holds this key ID. Revoke it before saving.</span>}</label>}
      <label className="block">Secret<Input type="password" autoComplete="new-password" required disabled={busy} value={draft.plaintext} onChange={e => setDraft({ ...draft, plaintext: e.target.value })} /></label>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save credential'}</Button><Button variant="outline" disabled={busy} onClick={() => { setDraft({ ...draft, plaintext: '' }); setAdding(false); }}>Cancel</Button>
    </form> : !data ? <p role="status">Loading credentials…</p> : data.credentials.length === 0 ? <p>No credentials yet</p> : data.credentials.map(c => <div className="flex items-center justify-between rounded-lg border border-border p-4" key={c.id}><div><p>{c.provider}</p><p className="text-muted-foreground">{c.kind} · {c.keyId} · {c.revokedAt ? 'revoked' : 'active'}</p></div><Button variant="outline" disabled={busy || !!c.revokedAt} onClick={() => setRevoke(c.id)}>Revoke</Button></div>)}
    {revoke && <div role="alertdialog" aria-label="Revoke credential" className="space-y-3 rounded-lg border border-border p-4"><p>Revoke this credential? Services using it will lose access.</p><Button disabled={busy} variant="destructive" onClick={async () => { setBusy(true); try { await hyperRevokeCredential(revoke); setRevoke(undefined); await load(); } catch { setError('Could not revoke credential. Check your permissions and retry.'); } finally { setBusy(false); } }}>Confirm revoke</Button><Button disabled={busy} variant="outline" onClick={() => setRevoke(undefined)}>Cancel</Button></div>}
  </section>;
}
