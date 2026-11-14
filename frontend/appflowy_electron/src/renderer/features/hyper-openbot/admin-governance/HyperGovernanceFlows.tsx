// Adapted from OpenBot permissions_.describe, approvals_.describe and approvals/team-settings.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { hyperGovernanceRequest as request } from './HyperGovernanceApi';
import { HyperResult, HyperStatus, HyperError, useHyperResource, useHyperAction } from './HyperGovernanceSection';

export function HyperDescribeChanges({ kind }: { kind: 'permissions' | 'approvals' }) {
  const permissions = kind === 'permissions';
  const base = permissions ? '/api/admin/enterprise/capabilities' : '/api/approvals/team/rules';
  const key = permissions ? 'changes' : 'rules';
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [rows, setRows] = useState<unknown[]>([]);
  const [reading, setReading] = useState<unknown>();
  const [preview, setPreview] = useState<{ check: { ok: boolean } }>();
  const [saved, setSaved] = useState(false);
  const a = useHyperAction();
  return <div className="grid gap-3"><label>Describe the change<textarea className="w-full rounded-md border bg-background p-3" value={text} maxLength={4000} disabled={a.busy} onChange={e => { setText(e.target.value); setPreview(undefined); setSaved(false); }} /></label>
    <Button disabled={a.busy || !text.trim()} onClick={() => void a.run(async () => {
      setPreview(undefined); setSaved(false);
      const result = await request<Record<string, unknown>>(`${base}/translate`, 'POST', { text });
      setReading(result); setSource(text); setRows(result[key] as unknown[]);
    })}>Write changes</Button>
    {reading !== undefined && <HyperResult value={reading} />}
    {rows.map((row, index) => <div className="rounded border p-3" key={index}><HyperResult value={row} /><Button disabled={a.busy} variant="outline" onClick={() => { setRows(rows.filter((_, i) => i !== index)); setPreview(undefined); setSaved(false); }}>Remove change</Button></div>)}
    <Button disabled={a.busy || !rows.length || source !== text} onClick={() => void a.run(async () => { setPreview(undefined); setPreview(await request(`${base}/${permissions ? 'preview' : 'backtest'}`, 'POST', { [key]: rows })); })}>Preview effects and validate</Button>
    {preview && <HyperResult value={preview} />}
    <Button disabled={a.busy || !preview?.check.ok || source !== text || saved} onClick={() => void a.run(async () => { await request(`${base}/batch`, 'POST', { [key]: rows, authoring: { source: 'english', text: source } }); setSaved(true); setPreview(undefined); })}>Save changes</Button>
    {saved && <p role="status">Changes saved.</p>}<HyperError message={a.error} />
  </div>;
}

type HyperRule = { id: string; botId: string; toolRef: string; effect: string; scope: string; behaviour: string };
export function HyperTeamApprovals() {
  const r = useHyperResource<{ team?: { enforceAutoReview: boolean; customRulesEnabled: boolean; hostCommandsCap: string; actionKinds?: Record<string, string> }; teamRules: HyperRule[] }>('/api/approvals');
  const a = useHyperAction(r.reload);
  const [rule, setRule] = useState({ botId: '*', toolRef: '*', effect: '*', scope: '*', behaviour: 'ask' });
  const patch = (body: unknown) => a.run(() => request('/api/approvals/team', 'PATCH', body));
  return <HyperStatus resource={r}><div className="grid gap-3">{r.data?.team ? <>
    {(['enforceAutoReview', 'customRulesEnabled'] as const).map(key => <label key={key}><input type="checkbox" checked={r.data!.team![key]} disabled={a.busy} onChange={e => void patch({ [key]: e.target.checked })} /> {key === 'enforceAutoReview' ? 'Require automatic review' : 'Allow custom rules'}</label>)}
    <label>Host commands <select value={r.data.team.hostCommandsCap} disabled={a.busy} onChange={e => void patch({ hostCommandsCap: e.target.value })}>{['ask', 'allow', 'never'].map(v => <option key={v}>{v}</option>)}</select></label>
    {['deleting', 'sending', 'sharing', 'publishing', 'payments', 'credentials', 'security_settings'].map(kind => <label key={kind}>{kind} <select disabled={a.busy} value={r.data!.team!.actionKinds?.[kind] ?? 'open'} onChange={e => void patch({ actionKinds: { [kind]: e.target.value } })}>{['open', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select></label>)}
    </> : <p>Team controls are unavailable for this account or edition.</p>}
    {!r.data?.teamRules.length && <p>No team rules.</p>}{r.data?.teamRules.map(row => <article className="rounded border p-3" key={row.id}><HyperResult value={row} /><select aria-label="Rule behavior" disabled={a.busy} value={row.behaviour} onChange={e => void a.run(() => request(`/api/approvals/team/rules/${encodeURIComponent(row.id)}`, 'PATCH', { behaviour: e.target.value }))}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select><Button variant="destructive" disabled={a.busy} onClick={() => { if (window.confirm('Remove this team rule?')) void a.run(() => request(`/api/approvals/team/rules/${encodeURIComponent(row.id)}`, 'DELETE')); }}>Remove</Button></article>)}
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void a.run(() => request('/api/approvals/team/rules', 'POST', rule)); }}><h3>Add team rule</h3>{(['botId', 'toolRef', 'effect', 'scope'] as const).map(key => <label key={key}>{key}<input className="rounded border bg-background p-2" required value={rule[key]} onChange={e => setRule({ ...rule, [key]: e.target.value })} /></label>)}<select aria-label="New rule behavior" value={rule.behaviour} onChange={e => setRule({ ...rule, behaviour: e.target.value })}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select><Button disabled={a.busy || !r.data?.team} type="submit">Add rule</Button></form><HyperError message={a.error} /></div></HyperStatus>;
}

// Adapted from boundaries_.new, boundaries_.$index and lib/computers/policy-translate.
export function HyperBoundaryEditor({ policy, original, reload }: { policy: import('./HyperGovernanceApi').HyperPolicy; original?: string; reload(): void }) {
  const [text, setText] = useState('');
  const [expression, setExpression] = useState(original || '');
  const [reading, setReading] = useState<unknown>();
  const [report, setReport] = useState<unknown>();
  const [validated, setValidated] = useState(false);
  const a = useHyperAction(reload);
  const candidate = () => {
    const labels = { ...policy.labels };
    const label = original ? labels[original] : { name: text.trim() || 'Custom rule', description: '' };
    if (original) delete labels[original];
    if (label) labels[expression] = label;
    return { ...policy, deny: original ? policy.deny.map(rule => rule === original ? expression : rule) : [...policy.deny, expression], labels };
  };
  return <details className="rounded border p-3"><summary>{original ? 'Edit and test rule' : 'Describe a boundary'}</summary><div className="grid gap-3 pt-3">
    <label>Describe what to stop<textarea disabled={a.busy} className="w-full rounded border bg-background p-2" value={text} onChange={e => { setText(e.target.value); setValidated(false); }} /></label>
    <Button disabled={a.busy || !text.trim()} onClick={() => void a.run(async () => { setValidated(false); setReport(undefined); const result = await request<{ rule: string; effect: string }>('/api/computers/policy-translate', 'POST', { text }); setReading(result); if (result.effect === 'deny') setExpression(result.rule); })}>Write boundary</Button>
    {reading !== undefined && <HyperResult value={reading} />}
    <label>Rule expression<textarea disabled={a.busy} className="w-full rounded border bg-background p-2" value={expression} onChange={e => { setExpression(e.target.value); setValidated(false); setReport(undefined); }} /></label>
    <Button disabled={a.busy || !expression.trim() || (!original && policy.deny.includes(expression))} onClick={() => void a.run(async () => { setValidated(false); const result = await request('/api/computers/policy-dry-run', 'POST', { policy: candidate() }); setReport(result); setValidated(true); })}>Test against recent actions</Button>
    {report !== undefined && <HyperResult value={report} />}
    <Button disabled={a.busy || !validated} onClick={() => void a.run(async () => { await request('/api/computers/policy', 'PUT', candidate()); setValidated(false); })}>Save boundary</Button><HyperError message={a.error} />
  </div></details>;
}
