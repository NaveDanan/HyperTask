// Adapted from OpenBot components/bot-profile/activity.tsx and lib/bot-lifecycle.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { HyperPersonalActivity } from '../settings/HyperPersonalActivity';
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
export interface HyperActivityItem {
  id: string; kind: string; title: string; detail: string | null; status: string;
  at: string; channelId: string | null; needsYou: boolean; stoppable: boolean; cancellable: boolean;
}
export interface HyperActivity {
  inProgress: HyperActivityItem[]; scheduled: HyperActivityItem[];
  onDemand?: HyperActivityItem[]; completed: HyperActivityItem[];
}
export function hyperActivityIsRoutine(item: HyperActivityItem) {
  return item.kind === 'routine' || (item.kind === 'responsibility' && !item.id.startsWith('responsibility-run:'));
}
export function hyperBotRoutinesSummary(activity: HyperActivity, goals: ReadonlySet<string>, checkIns: number) {
  const scheduled = activity.scheduled.filter(item => hyperActivityIsRoutine(item) && !(item.kind === 'routine' && goals.has(item.id.slice('routine:'.length)))).length + checkIns;
  const onDemand = (activity.onDemand ?? []).filter(hyperActivityIsRoutine).length;
  return [scheduled ? `${scheduled} scheduled` : '', onDemand ? `${onDemand} on demand` : ''].filter(Boolean).join(' · ') || 'No routines yet.';
}
export function HyperBotActivityTab({ agentId, openConversation, selectTab, glance = false }: {
  agentId: string; openConversation?: (id: string) => void; selectTab?: (id: string) => void; glance?: boolean;
}) {
  const [actions, setActions] = useState(false);
  const access = useHyperBotResource(async () => {
    if (glance) return { allowed: false };
    const [me, capabilities] = await Promise.all([request<{ user: { role: string } }>('/api/me'), request<{ edition: string }>('/api/capabilities')]);
    return { allowed: me.user.role === 'admin' || capabilities.edition === 'personal' };
  }, `actions:${agentId}`);
  const routines = useHyperBotResource(async () => {
    const [page, checkIns] = await Promise.all([
      request<{ routines: { id: string; goalId?: string }[] }>('/api/routines'),
      request<{ settings: { agentId: string; enabled: boolean }[] }>('/api/proactive/settings'),
    ]);
    return { goals: new Set(page.routines.filter(row => row.goalId).map(row => row.id)), checkIns: checkIns.settings.filter(row => row.agentId === agentId && row.enabled).length };
  }, `routines:${agentId}`, 30000);
  const path = `/api/bots/${encodeURIComponent(agentId)}`;
  const state = useHyperBotResource(async () => (await request<{ activity: HyperActivity }>(`${path}/activity`)).activity, agentId, 10000);
  const upcoming = state.data ? [...state.data.inProgress, ...state.data.scheduled, ...(state.data.onDemand ?? [])].slice(0, 3) : [];
  if (glance && !state.error && !upcoming.length) return null;
  function row(item: HyperActivityItem) {
    return <article key={`${item.kind}:${item.id}`} className="grid gap-2 rounded-lg border border-border p-3">
      <h5>{item.title}</h5><p className="text-sm text-muted-foreground">{item.kind} · {item.needsYou ? 'Needs you' : item.status} · {new Date(item.at).toLocaleString()}</p>
      {item.detail && <p>{item.detail}</p>}
      {!item.channelId && selectTab && ['routine', 'responsibility', 'approval', 'question'].includes(item.kind) && <Button variant="link" onClick={() => selectTab(item.kind === 'routine' || item.kind === 'responsibility' ? 'routines' : 'approvals')}>Open {item.kind === 'routine' || item.kind === 'responsibility' ? 'routines' : 'approvals'}</Button>}
      {item.channelId && openConversation && <Button variant="link" onClick={() => openConversation(item.channelId!)}>Open conversation</Button>}
      {item.stoppable && <Button disabled={state.pending} variant="outline" onClick={() => void state.run(() => request(`${path}/activity/handoffs/stop`, 'POST', { id: item.id }))}>Stop</Button>}
      {!item.stoppable && item.cancellable && <Button disabled={state.pending} variant="outline" onClick={() => void state.run(() => request(`${path}/follow-ups/cancel`, 'POST', { id: item.id }))}>Cancel follow-up</Button>}
    </article>;
  }
  return <section className="grid gap-3"><h3>Activity</h3>
    {state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    <Button disabled={state.pending} variant="outline" onClick={state.refresh}>Refresh</Button>
    {glance ? upcoming.map(row) : state.data && (['inProgress', 'scheduled', 'completed'] as const).map(key => {
      const items = state.data![key].filter(item => key !== 'scheduled' || !hyperActivityIsRoutine(item));
      return <section key={key} className="grid gap-2"><h4 className="font-medium">{{ inProgress: 'In progress', scheduled: 'Scheduled', completed: 'Completed' }[key]}</h4>
        {!items.length && <p className="text-sm text-muted-foreground">Nothing here.</p>}{items.map(row)}
        {key === 'scheduled' && <><Button variant="link" disabled={!selectTab} onClick={() => selectTab?.('routines')}>Routines</Button><p>{hyperBotRoutinesSummary(state.data!, routines.data?.goals ?? new Set(), routines.data?.checkIns ?? 0)}</p>{routines.error && <p role="alert">Routine and check-in counts could not be loaded.</p>}</>}
      </section>;
    })}
    {access.data?.allowed && <><Button variant="outline" onClick={() => setActions(!actions)}>{actions ? 'Close actions' : 'Every action this Bot took'}</Button>{actions && <HyperPersonalActivity bot={agentId} />}</>}
  </section>;
}
