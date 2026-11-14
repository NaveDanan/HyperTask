// Adapted from OpenBot permissions_.describe, approvals_.describe and approvals/team-settings.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { ruleLabel, withRuleReplaced, withoutRule, type RuleTemplate } from './HyperBoundaryRules';
import { HyperEvidence } from './HyperEvidence';
import { HyperSharedUseRequests } from './HyperSharedUseRequests';
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
    {reading !== undefined && <HyperEvidence value={reading} />}
    {rows.map((row, index) => <div className="rounded border p-3" key={index}><HyperEvidence value={row} /><Button disabled={a.busy} variant="outline" onClick={() => { setRows(rows.filter((_, i) => i !== index)); setPreview(undefined); setSaved(false); }}>Remove change</Button></div>)}
    <Button disabled={a.busy || !rows.length || source !== text} onClick={() => void a.run(async () => { setPreview(undefined); setPreview(await request(`${base}/${permissions ? 'preview' : 'backtest'}`, 'POST', { [key]: rows })); })}>Preview effects and validate</Button>
    {preview && <HyperEvidence value={preview} />}
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
    {!r.data?.teamRules.length && <p>No team rules.</p>}{r.data?.teamRules.map(row => <article className="rounded border p-3" key={row.id}><HyperEvidence value={row} /><select aria-label="Rule behavior" disabled={a.busy} value={row.behaviour} onChange={e => void a.run(() => request(`/api/approvals/team/rules/${encodeURIComponent(row.id)}`, 'PATCH', { behaviour: e.target.value }))}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select><Button variant="destructive" disabled={a.busy} onClick={() => { if (window.confirm('Remove this team rule?')) void a.run(() => request(`/api/approvals/team/rules/${encodeURIComponent(row.id)}`, 'DELETE')); }}>Remove</Button></article>)}
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void a.run(() => request('/api/approvals/team/rules', 'POST', rule)); }}><h3>Add team rule</h3>{(['botId', 'toolRef', 'effect', 'scope'] as const).map(key => <label key={key}>{key}<input className="rounded border bg-background p-2" required value={rule[key]} onChange={e => setRule({ ...rule, [key]: e.target.value })} /></label>)}<select aria-label="New rule behavior" value={rule.behaviour} onChange={e => setRule({ ...rule, behaviour: e.target.value })}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select><Button disabled={a.busy || !r.data?.team} type="submit">Add rule</Button></form><HyperSharedUseRequests /><HyperError message={a.error} /></div></HyperStatus>;
}

// Adapted from boundaries_.new, boundaries_.$index and lib/computers/policy-translate.
export function HyperBoundaryEditor({ policy, original, reload, template }: { policy: import('./HyperGovernanceApi').HyperPolicy; original?: string; reload(): void; template?: RuleTemplate }) {
  const initial = original ? ruleLabel(policy, original) : template;
  const [text, setText] = useState('');
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [expression, setExpression] = useState(original || template?.rule || '');
  const [reading, setReading] = useState<{ rule: string; compile: { ok: boolean }; summary: string | null; explanation: string | null; warning: string | null }>();
  const [report, setReport] = useState<unknown>();
  const [reach, setReach] = useState<unknown>();
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [open, setOpen] = useState(false);
  const a = useHyperAction();
  const trimmed = expression.trim();
  const duplicate = policy.deny.some(rule => rule === trimmed && rule !== original);
  const broken = reading && reading.rule.trim() === trimmed && !reading.compile.ok;
  useEffect(() => {
    if (!open || !trimmed || duplicate || broken) { setReport(undefined); return; }
    let active = true;
    setPreviewing(true); setReport(undefined); setPreviewError('');
    const timer = setTimeout(() => {
      request('/api/computers/policy-dry-run', 'POST', { policy: { mode: policy.mode, deny: [trimmed], allow: ['true'] } }).then(result => { if (active) setReport(result); }, () => { if (active) setPreviewError('This rule could not be evaluated against recent activity.'); }).finally(() => { if (active) setPreviewing(false); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [open, trimmed, policy.mode, duplicate, broken]);
  useEffect(() => {
    if (!open || !original) return;
    let active = true;
    request('/api/computers/policy-dry-run', 'POST', { policy: withoutRule(policy, original) }).then(result => { if (active) setReach(result); }, () => { if (active) setReach({ warning: 'Could not load recently stopped actions.' }); });
    return () => { active = false; };
  }, [open, original, policy]);
  const candidate = () => {
    const next = original ? withRuleReplaced(policy, original, trimmed) : { ...policy, deny: [...policy.deny, trimmed] };
    return { ...next, labels: { ...next.labels, [trimmed]: { name: name.trim(), description: description.trim() } }, ...(reading ? { authoring: { source: 'english', text } } : {}) };
  };
  return <details className="rounded border p-3" onToggle={e => setOpen(e.currentTarget.open)}><summary>{original ? 'Edit rule and review recent activity' : template ? 'Use this template' : 'Add a custom or described boundary'}</summary><div className="grid gap-3 pt-3">
    {template && <p>{template.cost}</p>}
    <label>Describe what to stop<textarea disabled={a.busy} className="w-full rounded border bg-background p-2" value={text} onChange={e => setText(e.target.value)} /></label>
    <Button disabled={a.busy || !text.trim()} onClick={() => void a.run(async () => { const result = await request<NonNullable<typeof reading> & { effect: string }>('/api/computers/policy-translate', 'POST', { text }); setReading(result); setExpression(result.rule); if (!name.trim()) setName(text.slice(0, 80)); if (!description.trim()) setDescription(result.summary?.slice(0, 300) || ''); })}>Write boundary</Button>
    {reading && <><HyperEvidence value={reading} />{reading.rule !== expression && <p>The expression has changed since this reading.</p>}</>}
    <label>Name<input className="w-full rounded border bg-background p-2" maxLength={80} disabled={a.busy} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>What it stops<input className="w-full rounded border bg-background p-2" maxLength={300} disabled={a.busy} value={description} onChange={e => setDescription(e.target.value)} /></label>
    <label>CEL expression<textarea disabled={a.busy} className="w-full rounded border bg-background p-2 font-mono" value={expression} onChange={e => setExpression(e.target.value)} /></label>
    {duplicate && <p role="alert">This rule is already in place.</p>}{previewing && <p role="status">Checking recent activity…</p>}<HyperError message={previewError} />
    {report !== undefined && <><h4>What this rule would stop</h4><HyperEvidence value={report} /></>}
    {reach !== undefined && <><h4>Recently stopped by the saved rule</h4><HyperEvidence value={reach} /></>}
    <Button disabled={a.busy || !name.trim() || !trimmed || duplicate || !!broken} onClick={() => void a.run(async () => { await request('/api/computers/policy', 'PUT', candidate()); reload(); })}>Save boundary</Button><HyperError message={a.error} />
  </div></details>;
}
