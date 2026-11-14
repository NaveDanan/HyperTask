// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HYPER_OPENBOT_SECTIONS } from '../HyperOpenBotSections';
import { HyperMayOpenSetup, HyperReadCapabilities, HyperReadSetup, HyperReadUser, HyperRecheckSetup, type HyperSetupChecklist } from './HyperOnboardingApi';
const HyperBots = lazy(() => import('../bots/HyperBotsPanel').then(module => ({ default: module.HyperBotsPanel })));
const HyperSkills = lazy(() => import('../skills/HyperSkillsPanel').then(module => ({ default: module.HyperSkillsPanel })));
const HyperConnections = lazy(() => import('../connections/HyperConnectionsPanel').then(module => ({ default: module.HyperConnectionsPanel })));
export function HyperNativeDestination({ path, context }: { path: string; context: HyperOpenBotSectionContext }) {
  const [opened, setOpened] = useState(false);
  const id = path.startsWith('/connections') ? 'connections' : path.startsWith('/settings') ? 'settings' : path.startsWith('/admin') ? 'admin-platform' : path.split('/')[1];
  const section = HYPER_OPENBOT_SECTIONS.find(item => item.id === id) ?? (id === 'bots' ? { label: 'Bots', render: () => <HyperBots onChat={botId => context.startConversation([botId])} /> } : id === 'skills' ? { label: 'Skills', render: () => <HyperSkills /> } : id === 'connections' ? { label: 'Connections', render: () => <HyperConnections /> } : undefined);
  return opened && section ? <div><Button variant="ghost" onClick={() => setOpened(false)}>Back</Button><Suspense fallback={<p role="status">Loading…</p>}>{section.render(context)}</Suspense></div> : <Button variant="outline" disabled={!section} onClick={() => setOpened(true)}>{section ? `Open ${section.label}` : `Open ${path} from the native navigation`}</Button>;
}
export default function HyperSetupSection({ context }: { context: HyperOpenBotSectionContext }) {
  const [data, setData] = useState<HyperSetupChecklist>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [allowed, setAllowed] = useState<boolean>();
  const load = async (check = false) => {
    setBusy(true); setError('');
    try {
      const [user, caps] = await Promise.all([HyperReadUser(), HyperReadCapabilities().catch(() => undefined)]);
      const may = HyperMayOpenSetup(user, caps); setAllowed(may);
      if (may) setData(await (check ? HyperRecheckSetup() : HyperReadSetup()));
    } catch { setError("Couldn't check your setup. Check again."); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6"><h1 className="text-lg font-semibold">Setup</h1><p className="text-sm text-muted-foreground">See what's ready and what still needs setting up. After you change a setting and restart OpenBot, check again here.</p>
    {allowed === false ? <p role="status">Your admin sets up anything that isn't ready yet.</p> : <>
      {busy && !data ? <p role="status">Checking…</p> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {data ? <><p role="status">{data.rows.every(row => row.ready) ? 'Everything is set up.' : 'See the setup details below.'}</p><ul className="divide-y rounded-lg border">{data.rows.map(row => <li key={row.id} data-setup-row={row.id} data-status={row.status} data-ready={row.ready ? '' : undefined} className="flex flex-col gap-2 p-4"><h2 className="text-sm font-medium">{row.title}{row.required && data.audience === 'admin' ? ' · Required' : ''}</h2><p className="text-sm text-muted-foreground">{row.detail}</p>{data.audience === 'admin' || row.ready ? <span className={row.required && !row.ready ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{row.status === 'ready' ? 'Ready' : row.status === 'not_checked' ? 'Not checked' : 'Needs setup'}</span> : null}
      {!row.ready && row.fix && data.audience === 'admin' ? <div className="flex flex-col gap-2 text-sm">{row.fix.kind === 'env' ? <p>Set {row.fix.names?.join(', ')}, then restart OpenBot.</p> : null}{row.fix.path || row.fix.page ? <HyperNativeDestination path={row.fix.page?.path ?? row.fix.path!} context={context} /> : null}{row.fix.docsUrl?.startsWith('https://') ? <a href={row.fix.docsUrl} target="_blank" rel="noreferrer">Setup guide</a> : null}</div> : null}</li>)}</ul></> : null}
      <Button className="self-start" variant="outline" disabled={busy} onClick={() => void load(Boolean(data) && !error)}>{busy ? 'Checking…' : 'Check again'}</Button></>}
  </section>;
}
