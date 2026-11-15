// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest } from '../transport';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
import { HyperAppAccessAction, HyperConnectionsPanel } from '../connections';
import { hyperSubscribeAppAccess } from '../connections/HyperAccessRefresh';
import type { HyperAppSetupIntent } from '../HyperOpenBotSections';
import { HyperSharedAppNotice } from './HyperSharedAppNotice';
import { HyperBotAppGrants } from './HyperBotAppGrants';
import { HyperBotSetupTab } from './HyperBotSetupTab';
import { HyperBotActivityTab } from './HyperBotActivityTab';
import { HyperReachability } from './HyperReachability';
import { HyperBotApprovalsTab } from './HyperBotApprovalsTab';
import { HyperBotSkillsTab } from './HyperBotSkillsTab';
import { HYPER_BOT_EXTRA_TABS } from './HyperBotExtraTabs';
import { hyperTeamBotShareLink, HyperBotTabsApi as api, type HyperBotApp, type HyperTeamBots } from './HyperBotTabsApi';

export function HyperBotDetailTabs({ bot, openConversation, initialTab }: { initialTab?: string; bot: HyperBotProfile; openConversation?: (id: string) => void }) {
  const [tab, setTab] = useState(initialTab === 'access' ? 'apps' : initialTab ?? 'apps');
  const Extra = HYPER_BOT_EXTRA_TABS.find(item => item.id === tab)?.component;
  return <section className="grid gap-4 border-t border-border pt-4">
    <nav aria-label="Bot details" className="flex flex-wrap gap-2">{[{ id: 'setup', label: 'Setup' }, { id: 'apps', label: 'Apps' }, { id: 'sharing', label: 'Sharing' }, { id: 'approvals', label: 'Approvals' }, { id: 'skills', label: 'Skills' }, { id: 'reach', label: 'Reaching you' }, { id: 'activity', label: 'Activity' }, ...HYPER_BOT_EXTRA_TABS].map(item => <Button key={item.id} variant={tab === item.id ? 'secondary' : 'ghost'} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</nav>
    {tab === 'setup' ? <HyperBotSetupTab agentId={bot.id} /> : tab === 'activity' ? <HyperBotActivityTab agentId={bot.id} openConversation={openConversation} selectTab={setTab} /> : tab === 'reach' ? <HyperReachability agentId={bot.id} /> : tab === 'approvals' ? <HyperBotApprovalsTab agentId={bot.id} /> : tab === 'skills' ? <HyperBotSkillsTab agentId={bot.id} mine={bot.mine} /> : Extra ? <Extra agentId={bot.id} /> : tab === 'apps' || tab === 'sharing' ? <HyperBotRemoteTab key={`${bot.id}:${tab}`} bot={bot} tab={tab} /> : <p>This tab is waiting for its area integration.</p>}
  </section>;
}
function HyperBotRemoteTab({ bot, tab }: { bot: HyperBotProfile; tab: string }) {
  const [connecting, setConnecting] = useState(false);
  const [editingApp, setEditingApp] = useState<string>();
  const [connectionApp, setConnectionApp] = useState<string>();
  const [apps, setApps] = useState<HyperBotApp[]>();
  const [team, setTeam] = useState<HyperTeamBots>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const [audience, setAudience] = useState<'team' | 'people'>('team');
  const [emails, setEmails] = useState('');
  const [groups, setGroups] = useState('');
  const [assignment, setAssignment] = useState('');
  const [admin, setAdmin] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectionIntent, setConnectionIntent] = useState<HyperAppSetupIntent>();
  const readGeneration = useRef(0);
  const invalidate = () => { readGeneration.current++; setRevision(value => value + 1); };
  useEffect(() => hyperSubscribeAppAccess(change => { if (tab === 'apps' && (!change || change.agentId === bot.id)) invalidate(); }), [bot.id, tab]);
  useEffect(() => {
    let live = true;
    const generation = ++readGeneration.current;
    const current = () => live && generation === readGeneration.current;
    setPending(true);
    void (tab === 'apps' ? (async () => { const [rows, me, capabilities] = await Promise.all([api.apps(bot.id), hyperOpenBotRequest<{ user: { role: string } }>('/api/me'), hyperOpenBotRequest<{ edition: string }>('/api/capabilities')]); if (!current()) return; const personalEdition = capabilities.edition === 'personal'; const giveable = bot.mine && !personalEdition ? await hyperOpenBotRequest<{ apps: { key: string }[] }>('/api/plugins/giveable') : { apps: [] }; if (!current()) return; const extra = await Promise.all(giveable.apps.filter(app => !rows.some(row => row.key === app.key)).map(async app => (await hyperOpenBotRequest<{ app: HyperBotApp }>(`/api/plugins/for/${encodeURIComponent(bot.id)}/apps/${encodeURIComponent(app.key)}`)).app)); if (current()) { setApps([...rows, ...extra]); setAdmin(me.user.role === 'admin'); } })() : Promise.all([api.team(), hyperOpenBotRequest<{ user: { role: string } }>('/api/me'), hyperOpenBotRequest<{ redirectUri: string | null }>('/api/plugins').catch(() => ({ redirectUri: null }))]).then(([data, me, plugins]) => {
      if (!current()) return;
      setShareLink(hyperTeamBotShareLink(plugins.redirectUri, bot.id)); setCopied(false); setTeam(data); setAdmin(me.user.role === 'admin');
      const publishedRow = data.teamBots.find(row => row.id === bot.id);
      setAudience(publishedRow?.audience ?? 'team'); setEmails(publishedRow?.people?.join(', ') ?? ''); setGroups(publishedRow?.groups?.join(', ') ?? '');
    })).catch(() => { if (current()) { setApps(undefined); setTeam(undefined); setAdmin(false); setError('Unable to load this Bot tab. Access may be refused.'); } }).finally(() => { if (current()) setPending(false); });
    return () => { live = false; readGeneration.current++; };
  }, [bot.id, tab, revision]);
  async function mutate(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { await action(); } catch { setError('The change was refused or could not be saved.'); }
    finally { lock.current = false; invalidate(); }
  }
  const split = (text: string) => text.split(',').map(value => value.trim()).filter(Boolean);
  const published = team?.teamBots.find(row => row.id === bot.id);
  return <div className="grid gap-3">
    {pending && <p role="status">Loading…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" disabled={pending} onClick={invalidate}>Refresh</Button>
    {tab === 'apps' && apps && <><Button variant="outline" onClick={() => { setConnectionIntent(undefined); setConnectionApp(undefined); setConnecting(!connecting); }}>{connecting ? 'Close connections' : 'Connect accounts'}</Button>{connecting && <HyperConnectionsPanel admin={connectionIntent?.admin === true && admin} selection={connectionIntent?.provider ? { page: 'browse', provider: connectionIntent.provider } : connectionApp ? { page: 'app', key: connectionApp } : undefined} />}{apps.length === 0 && <p>No apps on this Bot.</p>}{apps.map(app => <article key={app.key} className="grid gap-2 rounded-lg border border-border p-3">
      <h3 className="font-medium">{app.displayName}</h3><HyperAppAccessAction key={`${bot.id}:${app.key}`} agentId={bot.id} app={app.key} admin={admin} onOpenConnection={(key, intent) => { setConnecting(true); setConnectionApp(key); setConnectionIntent(intent); }} />{admin && <Button variant="outline" onClick={() => setEditingApp(editingApp === app.key ? undefined : app.key)}>Manage actions</Button>}{editingApp === app.key && <HyperBotAppGrants agentId={bot.id} app={app.key} shared={app.account === 'shared'} onSaved={invalidate} />}    </article>)}</>}
    {tab === 'sharing' && team && <><p>{published ? published.audience === 'team' ? 'Published to the whole team.' : `Published to ${[...(published.people ?? []), ...(published.groups ?? [])].join(', ')}.` : 'Not published.'}</p>
      <p className="text-sm text-muted-foreground">Each person's conversations remain private.</p>{published && (shareLink ? <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(shareLink).then(() => setCopied(true)).catch(() => setError('The link could not be copied.')); }}>{copied ? 'Copied' : 'Copy link'}</Button> : <p>A share link needs a public server address.</p>)}
      {published && !published.visibleToTeam && <p>Set a real name and description before teammates can see this Bot.</p>}
      {admin && published && <section className="grid gap-2"><h4>Assign to groups</h4><p>Pins this Bot for every member. Use * for the whole team.</p>{published.assignments?.map(group => <div key={group}>{group}<Button variant="outline" disabled={pending} onClick={() => void mutate(() => api.assign(bot.id, group, true))}>Remove assignment</Button></div>)}<form className="flex gap-2" onSubmit={event => { event.preventDefault(); void mutate(() => api.assign(bot.id, assignment.trim())); }}><Input aria-label="Group assignment" required value={assignment} onChange={e => setAssignment(e.target.value)} /><Button type="submit" disabled={pending || !assignment.trim()}>Assign</Button></form></section>}
      {bot.mine && (published || team.publishable.some(row => row.id === bot.id)) && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void mutate(() => api.publish(bot.id, audience, split(emails), split(groups))); }}>
        <label><input type="checkbox" checked={audience === 'people'} onChange={e => setAudience(e.target.checked ? 'people' : 'team')} /> Publish to specific people or groups</label>
        {audience === 'people' && <><label>People by email<Input value={emails} onChange={e => setEmails(e.target.value)} placeholder="Comma separated" /></label><label>Groups<Input value={groups} onChange={e => setGroups(e.target.value)} placeholder="Comma separated" /></label></>}
        <HyperSharedAppNotice agentId={bot.id} /><Button disabled={pending} type="submit">{published ? 'Update audience' : 'Publish'}</Button>
        {published && <Button disabled={pending} type="button" variant="outline" onClick={() => void mutate(() => api.unpublish(bot.id))}>Unpublish</Button>}
      </form>}
    </>}
  </div>;
}
