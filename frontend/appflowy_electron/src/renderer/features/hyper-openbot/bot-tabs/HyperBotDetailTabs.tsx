// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest } from '../transport';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
import { HyperSharedAppNotice } from './HyperSharedAppNotice';
import { HyperBotAppGrants } from './HyperBotAppGrants';
import { HyperBotSetupTab } from './HyperBotSetupTab';
import { HyperBotActivityTab } from './HyperBotActivityTab';
import { HyperReachability } from './HyperReachability';
import { HyperBotApprovalsTab } from './HyperBotApprovalsTab';
import { HyperBotSkillsTab } from './HyperBotSkillsTab';
import { HyperBotHandoffTab } from './HyperBotHandoffTab';
import { HYPER_BOT_EXTRA_TABS } from './HyperBotExtraTabs';
import { HyperBotTabsApi as api, type HyperBotApp, type HyperTeamBots } from './HyperBotTabsApi';

export function HyperBotDetailTabs({ bot }: { bot: HyperBotProfile }) {
  const [tab, setTab] = useState('apps');
  const Extra = HYPER_BOT_EXTRA_TABS.find(item => item.id === tab)?.component;
  return <section className="grid gap-4 border-t border-border pt-4">
    <nav aria-label="Bot details" className="flex flex-wrap gap-2">{[{ id: 'setup', label: 'Setup' }, { id: 'apps', label: 'Apps' }, { id: 'sharing', label: 'Sharing' }, { id: 'access', label: 'Access' }, { id: 'approvals', label: 'Approvals' }, { id: 'skills', label: 'Skills' }, { id: 'reach', label: 'Reaching you' }, { id: 'activity', label: 'Activity' }, ...HYPER_BOT_EXTRA_TABS].map(item => <Button key={item.id} variant={tab === item.id ? 'secondary' : 'ghost'} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</nav>
    {tab === 'setup' ? <HyperBotSetupTab agentId={bot.id} /> : tab === 'activity' ? <HyperBotActivityTab agentId={bot.id} /> : tab === 'reach' ? <HyperReachability agentId={bot.id} /> : tab === 'approvals' ? <HyperBotApprovalsTab agentId={bot.id} /> : tab === 'skills' ? <HyperBotSkillsTab agentId={bot.id} mine={bot.mine} /> : tab === 'access' ? <HyperBotHandoffTab agentId={bot.id} /> : Extra ? <Extra agentId={bot.id} /> : <HyperBotRemoteTab key={`${bot.id}:${tab}`} bot={bot} tab={tab} />}
  </section>;
}
function HyperBotRemoteTab({ bot, tab }: { bot: HyperBotProfile; tab: string }) {
  const [editingApp, setEditingApp] = useState<string>();
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
  useEffect(() => {
    let live = true;
    setPending(true);
    void (tab === 'apps' ? api.apps(bot.id).then(rows => { if (live) setApps(rows); }) : Promise.all([api.team(), hyperOpenBotRequest<{ user: { role: string } }>('/api/me')]).then(([data, me]) => {
      if (!live) return;
      setTeam(data); setAdmin(me.user.role === 'admin');
      const current = data.teamBots.find(row => row.id === bot.id);
      setAudience(current?.audience ?? 'team'); setEmails(current?.people?.join(', ') ?? ''); setGroups(current?.groups?.join(', ') ?? '');
    })).catch(() => { if (live) setError('Unable to load this Bot tab. Access may be refused.'); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [bot.id, tab, revision]);
  async function mutate(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { await action(); } catch { setError('The change was refused or could not be saved.'); }
    finally { lock.current = false; setPending(false); setRevision(v => v + 1); }
  }
  const split = (text: string) => text.split(',').map(value => value.trim()).filter(Boolean);
  const published = team?.teamBots.find(row => row.id === bot.id);
  return <div className="grid gap-3">
    {pending && <p role="status">Loading…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" disabled={pending} onClick={() => setRevision(v => v + 1)}>Refresh</Button>
    {tab === 'apps' && apps && <>{apps.length === 0 && <p>No apps on this Bot.</p>}{apps.map(app => <article key={app.key} className="grid gap-2 rounded-lg border border-border p-3">
      <h3 className="font-medium">{app.displayName}</h3><Button variant="outline" onClick={() => setEditingApp(editingApp === app.key ? undefined : app.key)}>Manage actions</Button>{editingApp === app.key && <HyperBotAppGrants agentId={bot.id} app={app.key} onSaved={() => setRevision(v => v + 1)} />}<p className="text-sm text-muted-foreground">{app.state.replaceAll('_', ' ')}{app.accountHolder === 'owner' ? ' · Uses the owner’s account' : ''}{app.asksFirst ? ' · Asks before first use' : ''}</p>
      {app.needsConnect && <p>Connect your account on Connections first.</p>}
      {app.state === 'owner_grantable' && !app.needsConnect && <Button disabled={pending} onClick={() => void mutate(() => api.give(bot.id, app.key))}>Give app</Button>}
      {app.givenByOwner && bot.mine && <Button disabled={pending} variant="outline" onClick={() => void mutate(() => api.give(bot.id, app.key, true))}>Take back app</Button>}
      {app.request ? <Button disabled={pending} variant="outline" onClick={() => void mutate(() => api.cancelRequest(app.request!.id))}>Withdraw request</Button> : app.requestKind && <Button disabled={pending} onClick={() => void mutate(() => api.request(bot.id, app.key))}>Request access</Button>}
    </article>)}</>}
    {tab === 'sharing' && team && <><p>{published ? published.audience === 'team' ? 'Published to the whole team.' : `Published to ${[...(published.people ?? []), ...(published.groups ?? [])].join(', ')}.` : 'Not published.'}</p>
      <p className="text-sm text-muted-foreground">Each person's conversations remain private.</p>
      {published && !published.visibleToTeam && <p>Set a real name and description before teammates can see this Bot.</p>}
      {admin && published && <section className="grid gap-2"><h4>Assign to groups</h4><p>Pins this Bot for every member. Use * for the whole team.</p>{published.assignments?.map(group => <div key={group}>{group}<Button variant="outline" disabled={pending} onClick={() => void mutate(() => api.assign(bot.id, group, true))}>Remove assignment</Button></div>)}<form className="flex gap-2" onSubmit={event => { event.preventDefault(); void mutate(() => api.assign(bot.id, assignment.trim())); }}><Input aria-label="Group assignment" required value={assignment} onChange={e => setAssignment(e.target.value)} /><Button disabled={pending || !assignment.trim()}>Assign</Button></form></section>}
      {bot.mine && (published || team.publishable.some(row => row.id === bot.id)) && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void mutate(() => api.publish(bot.id, audience, split(emails), split(groups))); }}>
        <label><input type="checkbox" checked={audience === 'people'} onChange={e => setAudience(e.target.checked ? 'people' : 'team')} /> Publish to specific people or groups</label>
        {audience === 'people' && <><label>People by email<Input value={emails} onChange={e => setEmails(e.target.value)} placeholder="Comma separated" /></label><label>Groups<Input value={groups} onChange={e => setGroups(e.target.value)} placeholder="Comma separated" /></label></>}
        <HyperSharedAppNotice agentId={bot.id} /><Button disabled={pending} type="submit">{published ? 'Update audience' : 'Publish'}</Button>
        {published && <Button disabled={pending} type="button" variant="outline" onClick={() => void mutate(() => api.unpublish(bot.id))}>Unpublish</Button>}
      </form>}
    </>}
  </div>;
}
