// Adapted from CopilotKit OpenBot, MIT. See REUSE.md and ../LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Plug, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperStoreMcpToken } from '../vault';
import { HyperConnectionSecrets } from './HyperConnectionSecrets';
import { HyperAppAccessRequests } from './HyperAppAccessAction';
import { HyperSharedAccessRequests } from './HyperSharedAccessRequests';
import { HyperPluginGrants, HyperSharedApprovalFields } from './HyperPluginGrants';
import * as details from './HyperPluginDetailsApi';
import { hyperOpenBotRequest } from '../transport';
import { hyperAddServerOutcome, hyperAuthorizationUrl, hyperLoadConnections, hyperServerPath, hyperStartConnection, type HyperConnectionRow } from './HyperConnectionsApi';

export function HyperConnectionsPanel({ admin = false, selection, onSelectionChange, onConnectionStarted }: { admin?: boolean } & details.HyperConnectionNavigationProps) {
  const [rows, setRows] = useState<HyperConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(() => selection && 'key' in selection ? selection.key : null);
  const [adding, setAdding] = useState(selection?.page === 'new');
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [addRefusal, setAddRefusal] = useState<import('./HyperConnectionsApi').HyperAddServerRefusal>();
  const [configureCurated, setConfigureCurated] = useState(false);
  const [savedCredential, setSavedCredential] = useState<{ key: string; id: string }>();
  const [needsToken, setNeedsToken] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [nested, setNested] = useState<details.HyperConnectionSelection>(selection ?? { page: 'list' });
  const [directory, setDirectory] = useState<details.HyperBrokerApp[]>();
  const [provider, setProvider] = useState<'arcade' | 'composio'>('composio');
  const [fields, setFields] = useState<{ id: string; fields: details.HyperBrokerField[]; guide?: { steps: string; url: string | null } }>();
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof details.hyperLoadAccounts>>>();
  const [modeState, setModeState] = useState<details.HyperModePreview & { serverId: string; epoch: number }>();
  const [siblings, setSiblings] = useState<{ siblings: string[]; unanswered: number }>();
  const [disconnectAccount, setDisconnectAccount] = useState<string>();
  const modeEpoch = useRef(0);
  const modeTarget = useRef<string | null>(selected);
  const selectionKey = JSON.stringify([admin, selection ?? { page: 'list' }]);
  const previousSelection = useRef(selectionKey);
  if (previousSelection.current !== selectionKey) {
    previousSelection.current = selectionKey; modeEpoch.current++;
    modeTarget.current = selection && 'key' in selection ? selection.key : null;
  }
  const frameEpoch = modeEpoch.current, frameTarget = modeTarget.current;
  const setMode = (next: details.HyperModePreview | undefined) => {
    if (modeEpoch.current !== frameEpoch || modeTarget.current !== frameTarget) return;
    setModeState(next && frameTarget ? { ...next, serverId: frameTarget, epoch: frameEpoch } : undefined);
  };
  useEffect(() => () => { modeEpoch.current++; }, []);
  function navigate(value: details.HyperConnectionSelection) {
    modeEpoch.current++; modeTarget.current = 'key' in value ? value.key : null;
    setNested(value); onSelectionChange?.(value); setAdding(value.page === 'new'); setSelected('key' in value ? value.key : null); setFields(undefined); setModeState(undefined); setConfigureCurated(false); setRemoving(false); setDisconnecting(null); setDisconnectAccount(undefined); setSiblings(undefined); setError('');
  }
  useEffect(() => {
    const next = selection ?? { page: 'list' as const }, key = 'key' in next ? next.key : null;
    setNested(next); setAdding(next.page === 'new'); setSelected(key);
    setModeState(undefined); setConfigureCurated(false); setRemoving(false); setDisconnecting(null); setDisconnectAccount(undefined); setSiblings(undefined);
    setFields(current => current?.id === key ? current : undefined);
  }, [selectionKey]);
  useEffect(() => { let active = true; if (nested.page === 'browse') { setDirectory(undefined); hyperOpenBotRequest<{ provider?: 'arcade' | 'composio' }>('/api/plugins').then(page => { if (active) setProvider(page.provider ?? 'composio'); }).catch(() => {}); const timer = setTimeout(() => { void details.hyperBrowseApps(search).then(result => { if (active) setDirectory(result.apps); }).catch(() => { if (active) setError('Could not load the app directory. Retry or check the broker configuration.'); }); }, 250); return () => { active = false; clearTimeout(timer); }; } return () => { active = false; }; }, [nested.page, search]);
  useEffect(() => { let active = true; setAccounts(undefined); if (selected) details.hyperLoadAccounts(selected).then(result => { if (active) setAccounts(result); }).catch(() => {}); return () => { active = false; }; }, [selected, rows]);
  const sequence = useRef(0);
  const reconcileWanted = useRef(false);
  const pendingReturn = useRef(false);
  const load = useCallback(async (confirm = true) => {
    if (confirm) reconcileWanted.current = true;
    const request = ++sequence.current;
    setLoading(true);
    try {
      let next = await hyperLoadConnections();
      if (request !== sequence.current) return;
      let confirmationFailed = false, asked = false;
      if (reconcileWanted.current) {
        for (const row of next) {
          const server = row.server;
          if (!server || !row.brokerConfigured || !['composio', 'arcade'].includes(server.provenance ?? '') || server.authScheme === 'NO_AUTH' || (!admin && (server.accountMode === 'shared' || server.sharedOnly))) continue;
          if (request !== sequence.current) return;
          asked = true;
          try { const result = await details.hyperConfirmConnection(row.key); if (typeof result?.connected !== 'boolean') throw new Error('Invalid confirmation'); }
          catch { confirmationFailed = true; }
        }
        if (request !== sequence.current) return;
        if (asked) next = await hyperLoadConnections();
      }
      if (request === sequence.current) {
        reconcileWanted.current = false; setRows(next);
        setError(confirmationFailed ? 'Could not confirm the provider connection. Last recorded state is shown. Refresh to retry.' : '');
      }
    }
    catch (e) { if (request === sequence.current) setError('Could not load connections. Check your permissions and retry.'); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [admin]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  useEffect(() => { const refresh = () => { const confirm = pendingReturn.current; pendingReturn.current = false; void load(confirm); }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [load]);
  async function action(run: () => Promise<void>) {
    if (modeEpoch.current !== frameEpoch || modeTarget.current !== frameTarget) return;
    setBusy(true); setError(''); setNotice('');
    let failure = '';
    try { await run(); } catch (e) { failure = 'The connection request failed or was refused. Current server state has been reloaded. Retype any secret to retry.'; }
    finally { await load(false); if (failure) setError(failure); setBusy(false); }
  }
  async function connect(id: string, another = false) {
    const result = await hyperStartConnection(id, admin, another);
    if (result.authorizationUrl) {
      pendingReturn.current = true;
      onConnectionStarted?.(id);
      await window.appflowy.shell.openExternal(hyperAuthorizationUrl(result.authorizationUrl));
      setNotice('Finish signing in in your browser, then refresh to check the connection.');
    } else if (result.connected) setNotice('Account connected.');
    else if (result.fields) setFields({ id, fields: result.fields, guide: result.guide });
    else throw new Error('The service did not return a sign-in URL or connection status.');
  }
  const row = rows.find(r => r.key === selected);
  const mode = modeState?.serverId === row?.key && modeState?.epoch === modeEpoch.current ? modeState : undefined;
  const disabled = busy || loading;
  return <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6 text-foreground" aria-label="Connections">
    <header className="flex flex-wrap items-center gap-3">
      <Plug className="size-5 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1"><h1 className="text-lg font-semibold">{adding ? 'Add server' : row?.title ?? 'Connections'}</h1><p className="text-xs text-muted-foreground">Connect your accounts so Bots can use apps on your behalf.</p></div>
      <Button variant="outline" disabled={disabled} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>
      {!adding && <Button onClick={() => { navigate({ page: 'new' }); }} disabled={busy}><Plus />Add server</Button>}
    </header>
    {(selected || adding) && <Button className="self-start" variant="ghost" disabled={busy} onClick={() => { navigate({ page: 'list' }); }}><ArrowLeft />All connections</Button>}
    {error && <p role="alert" className="rounded-lg border border-border bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading connections…</p>}
    <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => navigate({ page: 'browse' })}>Browse {provider === 'arcade' ? 'Arcade' : 'Composio'} apps</Button></div>
    {nested.page === 'browse' ? <div className="space-y-3"><Button variant="outline" onClick={() => navigate({ page: 'list' })}>All connections</Button><Input aria-label="Search app directory" value={search} onChange={e => setSearch(e.target.value)} />{!directory ? <p role="status">Loading directory…</p> : !directory.length ? <p>No apps match.</p> : directory.map(app => <div key={app.slug} className="space-y-2 rounded-lg border border-border p-4"><h2>{app.name}</h2><p>{app.description}</p><p>{app.categories.join(', ')} · {app.actionCount} actions · {app.connection.kind}</p>{app.classifiedCount !== null && app.classifiedCount < app.actionCount && <p>Some actions are not classified. Unknown actions count as writes.</p>}{app.permissionCount !== null && <p>{app.permissionCount} permissions · {app.scopedActionCount} scoped actions</p>}<Button disabled={disabled || app.connection.kind === 'unsupported'} onClick={() => void action(async () => { const existing = rows.find(row => row.server?.url === `${provider}://${app.slug}`); const id = existing?.key ?? (await details.hyperEnableBrokerApp(app.slug)).server.id; navigate({ page: 'app', key: id }); await connect(id); })}>{app.enabled ? 'Open and connect' : 'Add and connect'}</Button></div>)}</div> : adding ? <form className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-4" onSubmit={e => { e.preventDefault(); const values = new FormData(e.currentTarget); const token = String(values.get('token') ?? ''); e.currentTarget.reset(); void action(async () => {
      const result = await hyperAddServerOutcome(title, address, token);
      if (!result.ok || !result.server) { setAddRefusal(result); setNeedsToken(result.code === 'needs-key'); if (result.serverId) { navigate({ page: 'app', key: result.serverId }); setNotice('This server was already added.'); } else setNotice(result.code === 'needs-key' ? 'This server needs a key. An administrator can provide it below.' : result.code === 'not-approved' ? 'This server address is not approved.' : 'Server could not be added. Refresh and retry.'); return; }
      navigate({ page: 'app', key: result.server.id }); setTitle(''); setAddress('');
      if (result.signIn) await connect(result.server.id);
    }); }}>
      <label className="flex flex-col gap-2 text-sm font-medium">Name<Input required value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">Server address<Input type="url" required placeholder="https://example.com/mcp" value={address} onChange={e => setAddress(e.target.value)} disabled={busy} /></label>
      <p className="text-xs text-muted-foreground">Use the MCP address from the server documentation. An administrator may supply a key if the server asks for one.</p>
      {needsToken && admin && <label className="block">Server key<Input name="token" required type="password" autoComplete="off" /></label>}{needsToken && !admin && <p>An administrator must add this key.</p>}
      {addRefusal?.code === 'not-approved' && addRefusal.canApprove && admin && <Button type="button" variant="outline" disabled={disabled} onClick={() => void action(async () => { const controls = await hyperOpenBotRequest<{ settings: { mcpAllowlist: { enabled: boolean; servers: string[] } } }>('/api/admin/enterprise'); await hyperOpenBotRequest('/api/admin/enterprise/settings/mcpAllowlist', 'PUT', { value: { ...controls.settings.mcpAllowlist, servers: [...new Set([...controls.settings.mcpAllowlist.servers, address.trim()])] } }); setAddRefusal(undefined); setNotice('Address approved. Add the server again.'); })}>Approve this address</Button>}
      <Button type="submit" disabled={disabled || !title.trim() || !address.trim()}>{busy ? 'Adding…' : 'Add server'}</Button>
    </form> : row ? <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{row.summary}</p><p className="text-sm font-medium">{row.state}</p>
      {row.server?.lastError && <p role="alert" className="text-sm text-destructive">{'The last tool refresh failed. Check the server configuration and retry.'}</p>}
      {row.server && <p className="break-all font-mono text-xs text-muted-foreground">{row.server.url}</p>}
      <div className="flex flex-wrap gap-2">
        {!row.server && row.app && <Button disabled={disabled} onClick={() => void action(async () => { if (row.app?.auth === 'deployment-bearer' || row.app?.perInstance) { setConfigureCurated(true); return; } await hyperOpenBotRequest('/api/plugins/servers', 'POST', { key: row.key }); setNotice('App added. Open its connection to sign in if required.'); })}>Add app</Button>}
        {row.server && (admin || (row.server.accountMode !== 'shared' && !row.server.sharedOnly)) && row.state !== 'On' && <Button disabled={disabled} onClick={() => void action(() => connect(row.key))}>{row.state === 'Connected' ? 'Connect again' : 'Connect account'}</Button>}
        {row.connections.some(c => c.holder !== 'deployment' && c.checkable) && <Button variant="outline" disabled={disabled} onClick={() => void action(async () => { await hyperOpenBotRequest(`${hyperServerPath(row.key)}/connection/recheck`, 'POST'); setNotice('Connection check completed.'); })}>Check connection</Button>}
        {row.connections.some(c => c.holder !== 'deployment' || admin) && <Button variant="destructive" disabled={disabled} onClick={() => void action(async () => { setSiblings(await details.hyperConnectionSiblings(row.key)); setDisconnecting(row.key); })}>Disconnect</Button>}
        {(row.server?.docsUrl || row.app?.docsUrl) && <Button variant="outline" disabled={disabled} onClick={() => void action(async () => { await window.appflowy.shell.openExternal(hyperAuthorizationUrl((row.server?.docsUrl || row.app?.docsUrl)!)); })}><ExternalLink />Documentation</Button>}
      </div>
      {disconnecting === row.key && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3"><p className="text-sm">Disconnect this account at the provider?{siblings?.siblings.length ? ` Also ends: ${siblings.siblings.join(', ')}.` : ''}{siblings?.unanswered ? ` ${siblings.unanswered} apps could not be checked.` : ''}</p><Button variant="destructive" disabled={disabled} onClick={() => void action(async () => { await hyperOpenBotRequest(`${hyperServerPath(row.key)}/connection`, 'DELETE'); setDisconnecting(null); })}>Confirm disconnect</Button><Button variant="outline" disabled={disabled} onClick={() => setDisconnecting(null)}>Cancel</Button></div>}
      {admin && row.server && row.app?.auth === 'deployment-bearer' && <Button disabled={disabled} variant="outline" onClick={() => setConfigureCurated(true)}>Update access token</Button>}
      {configureCurated && row.app && <HyperConnectionSecrets key={`curated-${row.key}`} busy={busy} fields={[...(row.app.perInstance ? [{ name: 'instanceHost', label: 'Instance hostname', help: 'The vendor hostname for your organization.', required: true, secret: false }] : []), ...(row.app.auth === 'deployment-bearer' ? [{ name: 'token', label: 'Access token', help: savedCredential?.key === row.key ? 'A credential was already saved. Leave blank to reuse it after the partial save.' : 'Stored through Vault and used by the deployment.', required: savedCredential?.key !== row.key, secret: true }] : [])]} onCancel={() => setConfigureCurated(false)} onSubmit={values => action(async () => {
        try {
          let credentialId = savedCredential?.key === row.key ? savedCredential.id : undefined;
          if (values.token) { credentialId = await hyperStoreMcpToken(row.key, values.token); if (credentialId) setSavedCredential({ key: row.key, id: credentialId }); }
          await hyperOpenBotRequest('/api/plugins/servers', 'POST', { key: row.key, ...(values.instanceHost ? { instanceHost: values.instanceHost } : {}), ...(credentialId ? { credentialId } : {}) }); setConfigureCurated(false); setSavedCredential(undefined);
        } finally { for (const key of Object.keys(values)) delete values[key]; }
      })} />}
      {fields?.id === row.key && <div className="space-y-2">{fields.guide && <p>{fields.guide.steps}</p>}<HyperConnectionSecrets fields={fields.fields} busy={busy} onCancel={() => setFields(undefined)} onSubmit={values => action(async () => { const result = await details.hyperConnectFields(row.key, values); setFields(undefined); setNotice(result.verified ? 'Account connected and checked.' : result.probe ? 'Account recorded, but the key failed its check. Disconnect it or correct the key.' : 'Account accepted without a check. The app publishes no safe read to try.'); })} /></div>}
      {row.server?.authScheme && (row.server.accountMode !== 'shared' || admin) && <Button variant="outline" disabled={disabled} onClick={() => void action(async () => { const result = await details.hyperConfirmConnection(row.key); setNotice(result.connected ? 'Connection confirmed by the provider.' : 'The provider has not confirmed this connection.'); })}>Check sign-in completion</Button>}
      {accounts && <div className="space-y-3"><h2>Accounts</h2>{accounts.accounts.map(account => <div key={account.id} className="rounded-lg border border-border p-3"><p>{account.label}{account.isDefault ? ' · Default' : ''}{account.connectedAt ? ` · ${account.connectedAt}` : ''}</p><Button disabled={disabled || account.isDefault} variant="outline" onClick={() => void action(async () => { await details.hyperAccountDefault(row.key, account.id); })}>Make default</Button><Button disabled={disabled} variant="destructive" onClick={() => setDisconnectAccount(account.id)}>Disconnect account</Button></div>)}{accounts.canAddAnother && <Button disabled={disabled} onClick={() => void action(() => connect(row.key, true))}>Connect another account</Button>}{disconnectAccount && <div role="alertdialog" aria-label="Disconnect account"><p>Disconnect this account and keep the others?</p><Button disabled={disabled} variant="destructive" onClick={() => void action(async () => { await details.hyperDisconnectAccount(row.key, disconnectAccount); setDisconnectAccount(undefined); })}>Confirm disconnect account</Button><Button disabled={disabled} variant="outline" onClick={() => setDisconnectAccount(undefined)}>Cancel</Button></div>}</div>}
      {admin && <HyperAppAccessRequests app={row.key} busy={disabled} run={action} />}
      {admin && row.server && <HyperSharedAccessRequests serverId={row.key} busy={disabled} run={action} />}
      {admin && row.server && <div className="space-y-3"><h2>Account and access settings</h2><p>{row.server.accountMode === 'shared' ? 'Every granted Bot acts as the team account.' : 'Each person connects their own account.'}</p><Button disabled={disabled} variant="outline" onClick={() => void action(async () => setMode((await details.hyperPreviewMode(row.key, row.server?.accountMode === 'shared' ? 'personal' : 'shared')).preview))}>Switch to {row.server.accountMode === 'shared' ? 'personal' : 'shared'} account</Button><label className="block">Who may give this app to a Bot<select disabled={disabled} value={row.server.ownerGrants ?? 'admin'} onChange={e => void action(async () => { await details.hyperOwnerGrants(row.key, e.target.value as 'any' | 'admin'); })}><option value="any">Any Bot owner</option><option value="admin">Admins only</option></select></label>{mode && <div role="alertdialog" aria-label="Switch account mode" className="space-y-3 rounded-lg border border-border p-4"><p>Switch to {mode.mode}? This revokes {mode.wouldRevoke.count} {mode.wouldRevoke.holder} accounts. Review each Bot's exposure.</p>{mode.bots.map((bot, index) => <div key={bot.botId}><p>{bot.botId}</p><HyperSharedApprovalFields disabled={busy} value={bot.exposure} onChange={value => setMode({ ...mode, bots: mode.bots.map((item, i) => i === index ? { ...item, exposure: value } : item) })} /></div>)}<Button disabled={disabled || mode.bots.some(b => b.exposure.audience === 'people' && !b.exposure.members.length)} variant="destructive" onClick={() => void action(async () => { await details.hyperCommitMode(row.key, mode); setMode(undefined); })}>Confirm switch</Button><Button disabled={disabled} variant="outline" onClick={() => setMode(undefined)}>Cancel</Button></div>}
      {row.server.dynamicClient === false && <HyperConnectionSecrets key={`oauth-${row.key}`} busy={busy} fields={[{ name: 'clientId', label: 'OAuth client ID', help: 'The deployment client ID registered with this vendor.', required: true, secret: false }, { name: 'clientSecret', label: 'OAuth client secret', help: 'Forwarded once and cleared before the request.', required: true, secret: true }]} onCancel={() => setNotice('OAuth client registration cancelled.')} onSubmit={values => action(async () => { try { await details.hyperRegisterOAuth(row.key, values.clientId, values.clientSecret); } finally { for (const key of Object.keys(values)) delete values[key]; } })} />}</div>}
      {row.server?.skippedTools?.length ? <p role="alert">Tool refresh skipped names: {row.server.skippedTools.join(', ')}. Other tools were saved.</p> : null}
      {row.server && <HyperPluginGrants server={row.server} busy={disabled} selection={nested} navigate={navigate} run={action} callbackAllowed={row.callbackAllowed} admin={admin} />}
      {row.connections.map((c, i) => <div key={i} className="rounded-md bg-muted p-3 text-xs"><p>{c.holder === 'deployment' ? 'Team account' : 'Your account'}{c.displayName ? ` · ${c.displayName}` : ''}</p>{c.scope && <p className="mt-1 break-all text-muted-foreground">Granted scopes: {c.scope}</p>}{c.connectedAt && <p className="mt-1 text-muted-foreground">Connected {c.connectedAt}</p>}</div>)}
      {admin && row.server && row.key !== 'routines' && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled} onClick={() => void action(async () => { await hyperOpenBotRequest(`${hyperServerPath(row.key)}/refresh`, 'POST', {}); })}>Refresh tools</Button><Button variant="destructive" disabled={disabled} onClick={() => setRemoving(true)}>Remove app</Button></div>}
      {admin && removing && <div role="alertdialog" aria-label="Remove app" className="space-y-3 rounded-lg bg-muted p-3"><p>Remove this app and its grants?</p><Button disabled={disabled} variant="destructive" onClick={() => void action(async () => { await hyperOpenBotRequest(hyperServerPath(row.key), 'DELETE'); setRemoving(false); setSelected(null); })}>Confirm removal</Button><Button disabled={disabled} variant="outline" onClick={() => setRemoving(false)}>Cancel</Button></div>}
      <h2 className="text-sm font-medium">Tools</h2>
      {row.server?.tools.length ? <ul className="divide-y divide-border">{row.server.tools.map(tool => <li key={tool.name} className="py-3"><p className="text-sm font-medium">{tool.name}</p><p className="text-xs text-muted-foreground">{tool.description}</p>{tool.effect && <p className="text-xs text-muted-foreground">{tool.effect}</p>}</li>)}</ul> : <p className="text-sm text-muted-foreground">No tools reported by the service.</p>}
    </div> : !loading && !error && <>
      <Input aria-label="Search connections" placeholder="Search connections" value={search} onChange={e => setSearch(e.target.value)} />
      {['Your apps', 'Available apps'].map(section => { const matching = rows.filter(r => (section === 'Available apps' ? r.state === 'Available' : r.state !== 'Available') && `${r.title} ${r.summary}`.toLowerCase().includes(search.toLowerCase())); return <div key={section}><h2 className="mb-3 text-sm font-medium">{section}</h2>{matching.length ? <div className="grid gap-3 md:grid-cols-2">{matching.map(item => <button type="button" key={item.key} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-ring" onClick={() => { navigate({ page: 'app', key: item.key }); }}><span className="text-sm font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.summary}</span><span className="text-xs">{item.state}</span></button>)}</div> : <p className="text-sm text-muted-foreground">No apps to show.</p>}</div>; })}
    </>}
  </section>;
}
