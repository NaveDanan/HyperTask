// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperApproval, HyperQuestion } from '../activity';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { hyperOpenBotRequest as request } from '../transport';
import * as api from './HyperApprovalsApi';
import { HyperOffersStandingRule, HyperApprovalDetails } from './HyperApprovalPresentation';
import * as notify from './HyperNotificationsApi';
const behaviours = { allow: 'Take action without asking', pre_approved: 'Take action if pre-approved', ask: 'Ask before taking action', hand_off: 'Hand off to you' } as const;
export default function HyperApprovalsSection({ context }: { context: HyperOpenBotSectionContext }) {
  const [tab, setTab] = useState('Inbox');
  const [inbox, setInbox] = useState<api.HyperApprovalInboxData>();
  const [delivery, setDelivery] = useState<notify.HyperReachability>();
  const [routing, setRouting] = useState<notify.HyperRouting>();
  const [channels, setChannels] = useState<{ id: string; threadId: string }[]>([]);
  const [error, setError] = useState('');
  const [personal, setPersonal] = useState<boolean>();
  const [reset, setReset] = useState(false);
  const mutationLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const version = useRef(0);
  async function refresh(propagate = false) {
    const current = ++version.current;
    try {
      const value = await api.HyperLoadInbox();
      if (alive.current && current === version.current) { setInbox(value); setError(''); }
    } catch (cause) { if (alive.current && current === version.current) setError('Approvals could not be loaded. Check your connection or access and retry.'); if (propagate) throw cause; }
  }
  useEffect(() => { alive.current = true; void request<{ edition: string }>('/api/capabilities').then(data => { if (alive.current) setPersonal(data.edition === 'personal'); }).catch(() => {}); void refresh(); const timer = setInterval(() => void refresh(), 10000); void request<{ channels: { id: string; threadId: string }[] }>('/api/channels').then(data => { if (alive.current) setChannels(data.channels); }).catch(() => {}); return () => { alive.current = false; version.current++; clearInterval(timer); }; }, []);
  async function loadNotifications() { const [d, r] = await Promise.all([notify.HyperLoadDelivery(), notify.HyperLoadRouting()]); if (alive.current) { setDelivery(d); setRouting(r); } }
  async function mutate(action: () => Promise<unknown>) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true); setError('');
    try { await action(); await refresh(true); if (tab === 'Notifications') await loadNotifications(); return true; }
    catch { if (alive.current) setError('The change could not be saved. Check your access and retry.'); return false; }
    finally { mutationLock.current = false; if (alive.current) setBusy(false); }
  }
  function open(threadId: string, channelId?: string) { const id = channelId ?? channels.find(c => c.threadId === threadId)?.id; if (id) context.openConversation(id); else setError('This conversation could not be found.'); }
  const pending = inbox?.requests.filter(row => row.status === 'pending') ?? [];
  return <div className="space-y-6 overflow-auto p-6 text-sm">
    <h1 className="text-xl font-semibold">Approvals</h1>
    <nav className="flex gap-2" aria-label="Approval sections">{['Inbox', 'Standing rules', 'Notifications'].map(name => <Button key={name} variant={tab === name ? 'secondary' : 'ghost'} onClick={() => { setTab(name); if (name === 'Notifications') void loadNotifications().catch(() => setError('Notifications could not be loaded.')); }}>{name}</Button>)}</nav>
    {error && <div role="alert" className="text-destructive">{error} <Button variant="outline" onClick={() => { void refresh(); if (tab === 'Notifications') void loadNotifications().catch(() => setError('Notifications could not be loaded.')); }}>Retry</Button></div>}
    {!inbox && !error && <p role="status">Loading approvals…</p>}
    {tab === 'Inbox' && inbox && <>
      {!pending.length && !inbox.questions.length && <p>Nothing needs your answer.</p>}
      {pending.map(row => <article key={row.id} className="space-y-2 rounded-lg border border-border p-4"><HyperApprovalDetails args={row.action.args} /><HyperApproval request={{ id: row.id, title: `${row.action.toolRef}: ${row.action.effect} · ${row.action.scope}`, reason: row.action.policy?.reason, handOff: row.action.policy?.behaviour === 'hand_off', offersStandingRule: HyperOffersStandingRule(row.action) }} submitting={busy} onDecide={(id, choice) => void mutate(() => api.HyperDecide(id, choice))} /><Button variant="outline" onClick={() => open(row.action.threadId)}>Open conversation</Button></article>)}
      {inbox.questions.map(row => <article key={row.id} className="space-y-2 rounded-lg border border-border p-4"><HyperQuestion id={row.id} parts={row.parts?.length ? row.parts : [{ header: row.why ?? 'Question', question: row.question }]} submitting={busy} onAnswer={(id, answer) => void mutate(() => api.HyperAnswer(id, answer))} onDismiss={id => void mutate(() => api.HyperDismiss(id))} /><Button variant="outline" onClick={() => open(row.threadId, row.channelId)}>Open conversation</Button></article>)}
    </>}
    {tab === 'Inbox' && inbox && <details><summary>Previous decisions</summary>{inbox.requests.filter(row => row.status !== 'pending').map(row => <div key={row.id} className="rounded-lg border border-border p-3"><p>{row.action.toolRef} · {row.decision ?? row.status} · {new Date(row.decidedAt ?? row.createdAt).toLocaleString()}</p><Button variant="outline" onClick={() => open(row.action.threadId)}>Open conversation</Button></div>)}</details>}
    {tab === 'Standing rules' && inbox && <>
      <h2 className="font-semibold">Before a Bot acts</h2>
      <label className="flex gap-2"><input type="checkbox" checked={inbox.enabled} disabled={busy} onChange={e => void mutate(() => api.HyperPreferences({ enabled: e.target.checked }))} />Ask before taking action</label>
      {inbox.preferences && <><label className="flex gap-2"><input type="checkbox" checked={inbox.team?.enforceAutoReview || inbox.preferences.autoReview} disabled={busy || inbox.team?.enforceAutoReview} onChange={e => void mutate(() => api.HyperPreferences({ autoReview: e.target.checked }))} />Auto-review {inbox.team?.enforceAutoReview && '(Required by your admin)'}</label><label>Commands on your computer <select className="rounded border border-border bg-background p-2" value={inbox.preferences.hostCommands} disabled={busy} onChange={e => void mutate(() => api.HyperPreferences({ hostCommands: e.target.value as api.HyperHostCommandPolicy }))}>{Object.entries({ ask: 'Ask every time', allow: 'Always allow', never: 'Never' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{inbox.hostCommands !== inbox.preferences.hostCommands && <p>Your admin limits commands to {inbox.hostCommands}.</p>}</>}
      {personal === false && <div><h2 className="font-semibold">Shared Bots</h2><p>{reset ? 'Reset. Each shared Bot will ask again.' : 'Forget every answer about apps you let shared Bots use, so each shared Bot asks again.'}</p><Button variant="outline" disabled={busy} onClick={() => void mutate(api.HyperClearSharedBotConsents).then(ok => { if (ok) setReset(true); })}>Reset</Button></div>}
      <h2 className="font-semibold">Standing rules</h2><p>The strictest matching rule wins. An ask rule beats an allow rule. Team rules are locked.</p>
      {inbox.team?.customRulesEnabled === false && <p>Your admin has turned off personal rules. Saved rules are kept but do not apply.</p>}
      {!inbox.rules.length && !inbox.teamRules.length && <p>No rules yet.</p>}
      {[...inbox.teamRules.map(rule => ({ rule, locked: true })), ...inbox.rules.map(rule => ({ rule, locked: inbox.team?.customRulesEnabled === false }))].map(({ rule, locked }) => <div key={rule.id} className="space-y-2 rounded border border-border p-3"><p>{rule.botId} · {rule.toolRef} · {rule.effect} · {rule.scope}{rule.account ? ` · ${rule.account}` : ''}</p><select aria-label={`Behaviour for ${rule.toolRef}`} className="bg-background" disabled={busy || locked} value={rule.behaviour} onChange={e => void mutate(() => api.HyperSaveRule({ botId: rule.botId, toolRef: rule.toolRef, effect: rule.effect, scope: rule.scope, behaviour: e.target.value as api.RuleBehaviour }, rule.id))}>{Object.entries(behaviours).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{locked ? <span> Locked</span> : <Button variant="outline" disabled={busy} onClick={() => void mutate(() => api.HyperRemoveRule(rule.id))}>Remove</Button>}</div>)}
      {inbox.preferences && inbox.team?.customRulesEnabled !== false && <HyperRuleForm busy={busy} save={input => mutate(() => api.HyperSaveRule(input))} />}
      {!!inbox.conversationGrants?.length && <h2 className="font-semibold">Conversation allowances</h2>}{inbox.conversationGrants?.map(grant => <div key={grant.id}>{grant.toolRef} · {grant.scope} <Button disabled={busy} variant="outline" onClick={() => void mutate(() => api.HyperRevokeGrant(grant.id))}>Turn off</Button><Button variant="ghost" onClick={() => open(grant.threadId)}>Open conversation</Button></div>)}
    </>}
    {tab === 'Notifications' && (!delivery || !routing ? <p>Loading notifications…</p> : <>
      <h2 className="font-semibold">Where updates go</h2>
      {!notify.HyperTransports.some(t => delivery.available[t]) && <p>Updates stay in HyperTask. Push, Slack, Microsoft Teams and SMS appear once configured on the server.</p>}
      {notify.HyperKinds.map(kind => <fieldset key={kind} className="flex gap-4"><legend>{kind}</legend>{notify.HyperTransports.filter(t => delivery.available[t]).map(t => <label key={t}><input type="checkbox" disabled={busy} checked={routing[kind] === 'all' || routing[kind].includes(t)} onChange={e => { const next = notify.HyperTransports.filter(value => value === t ? e.target.checked : routing[kind] === 'all' || routing[kind].includes(value)); void mutate(() => notify.HyperRouteUpdates(kind, next.length === 4 ? 'all' : next)); }} /> {t}</label>)}</fieldset>)}
      <h2 className="font-semibold">Your devices</h2><p>Sign in to the OpenBot app on your phone and turn on notifications to add it here.</p>{!delivery.devices.length && <p>No devices yet.</p>}{delivery.devices.map(device => <div key={device.id}>{device.platform}<Button disabled={busy} variant="outline" onClick={() => void mutate(() => notify.HyperRemoveDevice(device.id))}>Remove</Button></div>)}
      <h2 className="font-semibold">Recent deliveries</h2>{!delivery.deliveries.length && <p>No deliveries yet.</p>}{delivery.deliveries.map(row => <div key={row.id} className="rounded border border-border p-3">{row.kind} · {row.transport} · {row.state} · {new Date(row.createdAt).toLocaleString()}{row.error && <p className="text-destructive">Delivery failed. Check the server configuration.</p>}</div>)}
    </>)}
  </div>;
}
function HyperRuleForm({ busy, save }: { busy: boolean; save(input: api.HyperApprovalRuleInput): Promise<boolean> }) {
  const empty: api.HyperApprovalRuleInput = { botId: '*', toolRef: '', effect: '*', scope: '*', behaviour: 'ask' };
  const [draft, setDraft] = useState(empty);
  return <form className="space-y-3 rounded border border-border p-4" onSubmit={e => { e.preventDefault(); void save({ ...draft, botId: draft.botId.trim(), toolRef: draft.toolRef.trim(), effect: draft.effect.trim(), scope: draft.scope.trim() }).then(ok => { if (ok) setDraft(empty); }); }}><h3>Add a rule</h3><p>Use * to match anything. composio-gmail/* matches every Gmail tool.</p>{(['botId', 'toolRef', 'effect', 'scope'] as const).map(key => <label className="block" key={key}>{({ botId: 'Bot', toolRef: 'Tool or app', effect: 'Kind of action', scope: 'Target' })[key]}<Input required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}<select aria-label="New rule behaviour" className="bg-background" value={draft.behaviour} onChange={e => setDraft({ ...draft, behaviour: e.target.value as api.RuleBehaviour })}>{Object.entries(behaviours).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button type="submit" disabled={busy || ![draft.botId, draft.toolRef, draft.effect, draft.scope].every(value => value.trim())}>Save rule</Button></form>;
}
