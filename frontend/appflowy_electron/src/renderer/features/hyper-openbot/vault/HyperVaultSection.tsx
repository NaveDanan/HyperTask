// Adapted from OpenBot, Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperVaultApi, type HyperKeys } from './HyperVaultApi';
import { HyperSignInForm } from './HyperSignInForm';

export default function HyperVaultSection() {
  const [edition, setEdition] = useState('team');
  const [logins, setLogins] = useState<Awaited<ReturnType<typeof hyperVaultApi.logins>>>();
  const [keys, setKeys] = useState<HyperKeys>();
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof hyperVaultApi.pending>>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const load = async () => {
    setError('');
    const results = await Promise.allSettled([hyperVaultApi.capabilities(), hyperVaultApi.logins(), hyperVaultApi.pending()]);
    if (results[1].status === 'fulfilled') setLogins(results[1].value); else setError('Could not load saved logins. Access may be refused.');
    if (results[2].status === 'fulfilled') setRequests(results[2].value); else setError('Could not load sign-in requests. Try refreshing.');
    if (results[0].status !== 'fulfilled' || results[0].value.edition !== 'personal') { setEdition('team'); setKeys(undefined); }
    if (results[0].status === 'fulfilled' && results[0].value.edition === 'personal') {
      setEdition('personal');
      try { setKeys(await hyperVaultApi.keys()); } catch { setError('Could not load keys. Access may be refused.'); }
    }
  };
  useEffect(() => { void load(); }, []);
  async function act(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await load(); } catch { setError('Vault operation failed. Try again.'); } finally { setBusy(false); } }
  if (adding && edition === 'personal') return <HyperKeyForm keys={keys} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />;
  return <div className="space-y-6 p-6 text-sm"><h2 className="text-lg font-semibold">Vault</h2><p className="text-muted-foreground">Your saved website logins are kept here. Bots never see them, and you approve each use.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}<Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh</Button>
    <section className="space-y-3"><h3 className="font-medium">Logins</h3>{!logins ? <p>Loading saved logins…</p> : !logins.passwordManager ? <p>Saved logins are off. An admin turned them off. Your logins are kept but won't be offered.</p> : !logins.logins.length ? <p>No saved logins yet. Choose Save to Vault when you sign a Bot in to a website.</p> : logins.logins.map(login => <div key={login.id} className="flex items-center justify-between border-b border-border py-3"><div>{login.origin}<p className="text-muted-foreground">{login.username} · {login.lastUsedAt ? `last used ${new Date(login.lastUsedAt).toLocaleDateString()}` : 'never used'}</p></div><Button variant="ghost" disabled={busy} onClick={() => void act(() => hyperVaultApi.removeLogin(login.id))}>Delete login for {login.origin}</Button></div>)}</section>
    {edition === 'personal' && <section className="space-y-3"><h3 className="font-medium">Keys</h3><p>A saved key cannot be viewed again.</p><Button onClick={() => setAdding(true)}>Add key</Button>{!keys ? <p>Loading keys…</p> : !keys.credentials.length ? <p>No keys yet</p> : keys.credentials.map(key => <div key={key.id} className="flex items-center justify-between border-b border-border py-3"><span>{key.provider} · {key.kind} · {key.keyId} · {key.revokedAt ? 'revoked' : 'active'}</span><Button variant="outline" disabled={busy || !!key.revokedAt} onClick={() => void act(() => hyperVaultApi.revokeKey(key.id))}>Revoke</Button></div>)}</section>}
    {requests.map(request => <HyperSignInForm key={request.id} requestId={request.id} />)}
  </div>;
}

export function HyperKeyForm({ keys, onSaved, onCancel }: { keys?: HyperKeys; onSaved(): void; onCancel(): void }) {
  const [kind, setKind] = useState<'model' | 'connector'>('model');
  const [provider, setProvider] = useState(keys?.modelKey?.provider ?? 'openai');
  const [keyId, setKeyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const replacing = keys?.credentials.some(key => !key.revokedAt && key.kind === kind && key.provider === provider.trim() && key.keyId === (kind === 'model' ? keys.modelKey?.keyId : keyId.trim()));
  return <form className="space-y-4 p-6 text-sm" autoComplete="off" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const secret = form.elements.namedItem('plaintext') as HTMLInputElement;
    const plaintext = secret.value; secret.value = '';
    setBusy(true); setError('');
    try { await hyperVaultApi.createKey({kind, provider: provider.trim(), ...(kind === 'connector' ? {keyId: keyId.trim()} : {}), plaintext, metadata: {}}); onSaved(); }
    catch { setError('Could not save the key. Retype the secret and try again.'); } finally { setBusy(false); }
  }}><h2 className="text-lg font-semibold">Add key</h2><p>You cannot view the secret after saving it.</p>
    <label className="block">Type<select className="ml-3 border border-border bg-background" value={kind} onChange={e => { const value = e.target.value as typeof kind; setKind(value); setProvider(value === 'model' ? keys?.modelKey?.provider ?? 'openai' : ''); setKeyId(''); }}><option value="model">Model</option><option value="connector">Connector</option></select></label>
    <label className="block">Provider{kind === 'model' ? <select className="ml-3 border border-border bg-background" value={provider} onChange={e => setProvider(e.target.value)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select> : <Input required value={provider} onChange={e => setProvider(e.target.value)} />}</label>
    {kind === 'model' && keys?.modelKey && <p>Your Bots run on {keys.modelKey.provider} and {provider === keys.modelKey.provider ? 'will' : 'will not'} use this key.</p>}
    {kind === 'connector' && <label className="block">Key ID<Input required value={keyId} onChange={e => setKeyId(e.target.value)} /></label>}
    <label className="block">Secret<Input name="plaintext" type="password" autoComplete="off" required /></label>
    {replacing && <p className="text-warning">This key already has an active credential. Saving replaces it and revokes the old one.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}<Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy || !provider.trim() || (kind === 'connector' && !keyId.trim())}>{busy ? 'Saving…' : 'Save credential'}</Button>
  </form>;
}
