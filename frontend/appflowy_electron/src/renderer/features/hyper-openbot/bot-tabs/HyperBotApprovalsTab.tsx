// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
type HyperBehaviour = 'allow' | 'pre_approved' | 'ask' | 'hand_off';
interface HyperRule { id: string; botId: string; toolRef: string; effect: string; scope: string; behaviour: HyperBehaviour }
interface HyperInbox { rules: HyperRule[]; teamRules: HyperRule[]; preferences?: unknown; team?: { customRulesEnabled: boolean } }
export function hyperRuleCoversBot(pattern: string, id: string) { return new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(id); }
const HyperBehaviours: Record<HyperBehaviour, string> = { allow: 'Take action without asking', pre_approved: 'Take action if pre-approved', ask: 'Ask before taking action', hand_off: 'Hand off to you' };
export function HyperBotApprovalsTab({ agentId }: { agentId: string }) {
  const state = useHyperBotResource(() => request<HyperInbox>('/api/approvals'), agentId, 10000);
  const [toolRef, setTool] = useState(''); const [effect, setEffect] = useState(''); const [scope, setScope] = useState(''); const [behaviour, setBehaviour] = useState<HyperBehaviour>('ask');
  const off = state.data?.team?.customRulesEnabled === false;
  const rows = [...(state.data?.teamRules ?? []).filter(row => row.botId === '*' || row.botId === agentId).map(row => ({ ...row, locked: true })), ...(state.data?.rules ?? []).filter(row => row.botId !== '*' && hyperRuleCoversBot(row.botId, agentId)).map(row => ({ ...row, locked: off }))];
  return <section className="grid gap-3"><h3>Approval rules</h3><p className="text-sm text-muted-foreground">The strictest matching rule wins. An ask rule beats an allow rule. Rules for every Bot are in Settings.</p>
    {state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}<Button variant="outline" onClick={state.refresh} disabled={state.pending}>Refresh</Button>
    {off && <p>An administrator has turned off personal rules. Yours are kept but do not apply.</p>}
    {state.data && rows.length === 0 && <p>No rules for this Bot.</p>}
    {rows.map(row => <article key={row.id} className="grid gap-2 rounded-lg border border-border p-3"><p>{row.toolRef} · {row.effect} · {row.scope}{row.locked ? ' · Locked' : ''}</p><select aria-label={`Behaviour for ${row.toolRef}`} disabled={state.pending || row.locked} value={row.behaviour} onChange={event => void state.run(() => request(`/api/approvals/rules/${encodeURIComponent(row.id)}`, 'PATCH', { behaviour: event.target.value }))}>{Object.entries(HyperBehaviours).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{!row.locked && <Button variant="outline" disabled={state.pending} onClick={() => void state.run(() => request(`/api/approvals/rules/${encodeURIComponent(row.id)}`, 'DELETE'))}>Revoke</Button>}</article>)}
    {Boolean(state.data?.preferences) && !off && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void state.run(() => request('/api/approvals/rules', 'POST', { botId: agentId, toolRef, effect, scope, behaviour })); }}><label>Tool pattern<Input required value={toolRef} onChange={e => setTool(e.target.value)} placeholder="*" /></label><label>Effect<Input required value={effect} onChange={e => setEffect(e.target.value)} placeholder="*" /></label><label>Scope<Input required value={scope} onChange={e => setScope(e.target.value)} placeholder="*" /></label><select aria-label="Rule behaviour" value={behaviour} onChange={e => setBehaviour(e.target.value as HyperBehaviour)}>{Object.entries(HyperBehaviours).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button disabled={state.pending}>Add rule</Button></form>}
  </section>;
}
