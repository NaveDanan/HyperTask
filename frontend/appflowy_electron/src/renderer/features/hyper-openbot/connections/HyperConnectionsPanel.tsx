// Adapted from CopilotKit OpenBot, MIT. See REUSE.md and ../LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Plug, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest } from '../transport';
import { hyperAddConnectionServer, hyperAuthorizationUrl, hyperLoadConnections, hyperServerPath, hyperStartConnection, type HyperConnectionRow } from './HyperConnectionsApi';

export function HyperConnectionsPanel({}: Record<string, never>) {
  const [rows, setRows] = useState<HyperConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try { const next = await hyperLoadConnections(); if (request === sequence.current) { setRows(next); setError(''); } }
    catch (e) { if (request === sequence.current) setError(e instanceof Error ? e.message : 'Could not load connections.'); }
    finally { if (request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  useEffect(() => { const refresh = () => { void load(); }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [load]);
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    let failure = '';
    try { await run(); } catch (e) { failure = e instanceof Error ? e.message : 'Connection request failed.'; }
    finally { await load(); if (failure) setError(failure); setBusy(false); }
  }
  async function connect(id: string) {
    const result = await hyperStartConnection(id);
    if (result.authorizationUrl) {
      await window.appflowy.shell.openExternal(hyperAuthorizationUrl(result.authorizationUrl));
      setNotice('Finish signing in in your browser, then refresh to check the connection.');
    } else if (result.connected) setNotice('Account connected.');
    else if (result.fields) setNotice('This app requires credentials. Configure them in the service settings; this panel does not collect keys.');
    else throw new Error('The service did not return a sign-in URL or connection status.');
  }
  const row = rows.find(r => r.key === selected);
  const disabled = busy || loading;
  return <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6 text-foreground" aria-label="Connections">
    <header className="flex flex-wrap items-center gap-3">
      <Plug className="size-5 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1"><h1 className="text-lg font-semibold">{adding ? 'Add server' : row?.title ?? 'Connections'}</h1><p className="text-xs text-muted-foreground">Connect your accounts so Bots can use apps on your behalf.</p></div>
      <Button variant="outline" disabled={disabled} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>
      {!adding && <Button onClick={() => { setAdding(true); setSelected(null); setError(''); }} disabled={busy}><Plus />Add server</Button>}
    </header>
    {(selected || adding) && <Button className="self-start" variant="ghost" disabled={busy} onClick={() => { setSelected(null); setAdding(false); setDisconnecting(false); }}><ArrowLeft />All connections</Button>}
    {error && <p role="alert" className="rounded-lg border border-border bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading connections…</p>}
    {adding ? <form className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-4" onSubmit={e => { e.preventDefault(); void action(async () => {
      const result = await hyperAddConnectionServer(title, address);
      setAdding(false); setSelected(result.server.id); setTitle(''); setAddress('');
      if (result.signIn) await connect(result.server.id);
    }); }}>
      <label className="flex flex-col gap-2 text-sm font-medium">Name<Input required value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">Server address<Input type="url" required placeholder="https://example.com/mcp" value={address} onChange={e => setAddress(e.target.value)} disabled={busy} /></label>
      <p className="text-xs text-muted-foreground">Use the MCP address from the server documentation. Servers requiring a key must be configured in the service settings.</p>
      <Button type="submit" disabled={disabled || !title.trim() || !address.trim()}>{busy ? 'Adding…' : 'Add server'}</Button>
    </form> : row ? <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{row.summary}</p><p className="text-sm font-medium">{row.state}</p>
      {row.server?.lastError && <p role="alert" className="text-sm text-destructive">{row.server.lastError}</p>}
      {row.server && <p className="break-all font-mono text-xs text-muted-foreground">{row.server.url}</p>}
      <div className="flex flex-wrap gap-2">
        {!row.server && row.app && <Button disabled={disabled} onClick={() => void action(async () => { await hyperOpenBotRequest('/api/plugins/servers', 'POST', { key: row.key }); setNotice('App added. Open its connection to sign in if required.'); })}>Add app</Button>}
        {row.server && row.server.accountMode !== 'shared' && !row.server.sharedOnly && row.state !== 'On' && <Button disabled={disabled} onClick={() => void action(() => connect(row.key))}>{row.state === 'Connected' ? 'Connect again' : 'Connect account'}</Button>}
        {row.connections.some(c => c.holder !== 'deployment' && c.checkable) && <Button variant="outline" disabled={disabled} onClick={() => void action(async () => { await hyperOpenBotRequest(`${hyperServerPath(row.key)}/connection/recheck`, 'POST'); setNotice('Connection check completed.'); })}>Check connection</Button>}
        {row.connections.some(c => c.holder !== 'deployment' && c.verified !== undefined) && <Button variant="destructive" disabled={disabled} onClick={() => setDisconnecting(true)}>Disconnect</Button>}
        {(row.server?.docsUrl || row.app?.docsUrl) && <Button variant="outline" disabled={disabled} onClick={() => void action(async () => { await window.appflowy.shell.openExternal(hyperAuthorizationUrl((row.server?.docsUrl || row.app?.docsUrl)!)); })}><ExternalLink />Documentation</Button>}
      </div>
      {disconnecting && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3"><p className="text-sm">Disconnect this account at the provider?</p><Button variant="destructive" disabled={disabled} onClick={() => void action(async () => { await hyperOpenBotRequest(`${hyperServerPath(row.key)}/connection`, 'DELETE'); setDisconnecting(false); })}>Confirm disconnect</Button><Button variant="outline" disabled={disabled} onClick={() => setDisconnecting(false)}>Cancel</Button></div>}
      {row.connections.map((c, i) => <div key={i} className="rounded-md bg-muted p-3 text-xs"><p>{c.holder === 'deployment' ? 'Team account' : 'Your account'}{c.displayName ? ` · ${c.displayName}` : ''}</p>{c.scope && <p className="mt-1 break-all text-muted-foreground">Granted scopes: {c.scope}</p>}{c.connectedAt && <p className="mt-1 text-muted-foreground">Connected {c.connectedAt}</p>}</div>)}
      <h2 className="text-sm font-medium">Tools</h2>
      {row.server?.tools.length ? <ul className="divide-y divide-border">{row.server.tools.map(tool => <li key={tool.name} className="py-3"><p className="text-sm font-medium">{tool.name}</p><p className="text-xs text-muted-foreground">{tool.description}</p>{tool.effect && <p className="text-xs text-muted-foreground">{tool.effect}</p>}</li>)}</ul> : <p className="text-sm text-muted-foreground">No tools reported by the service.</p>}
    </div> : !loading && !error && <>
      <Input aria-label="Search connections" placeholder="Search connections" value={search} onChange={e => setSearch(e.target.value)} />
      {['Your apps', 'Available apps'].map(section => { const matching = rows.filter(r => (section === 'Available apps' ? r.state === 'Available' : r.state !== 'Available') && `${r.title} ${r.summary}`.toLowerCase().includes(search.toLowerCase())); return <div key={section}><h2 className="mb-3 text-sm font-medium">{section}</h2>{matching.length ? <div className="grid gap-3 md:grid-cols-2">{matching.map(item => <button type="button" key={item.key} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-ring" onClick={() => { setSelected(item.key); setDisconnecting(false); }}><span className="text-sm font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.summary}</span><span className="text-xs">{item.state}</span></button>)}</div> : <p className="text-sm text-muted-foreground">No apps to show.</p>}</div>; })}
    </>}
  </section>;
}
