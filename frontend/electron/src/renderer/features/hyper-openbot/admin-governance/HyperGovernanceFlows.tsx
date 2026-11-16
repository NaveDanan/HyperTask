// Adapted from OpenBot permissions_.describe, approvals_.describe and approvals/team-settings.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { ruleLabel, withRuleReplaced, withoutRule, type RuleTemplate } from './HyperBoundaryRules';
import { HyperGovernanceReport } from './HyperGovernanceReports';
import { HyperBoundaryReplay } from './HyperBoundaryReplay';
import { HyperEvidence } from './HyperEvidence';
import { HyperSharedUseRequests } from './HyperSharedUseRequests';
import { hyperGovernanceRequest as request } from './HyperGovernanceApi';
import { HyperStatus, HyperError, useHyperResource, useHyperAction } from './HyperGovernanceUi';
export function HyperDescribeChanges({
  kind
}: {
  kind: 'permissions' | 'approvals';
}) {
  const permissions = kind === 'permissions';
  const base = permissions ? '/api/admin/enterprise/capabilities' : '/api/approvals/team/rules';
  const key = permissions ? 'changes' : 'rules';
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [reading, setReading] = useState<unknown>();
  const [preview, setPreview] = useState<{
    check: {
      ok: boolean;
    };
  }>();
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    setPreview(undefined);
    setPreviewError('');
    if (!rows.length) return;
    let active = true;
    setPreviewing(true);
    request<{
      check: {
        ok: boolean;
      };
    }>(`${base}/${permissions ? 'preview' : 'backtest'}`, 'POST', {
      [key]: rows
    }).then(value => {
      if (active) setPreview(value);
    }, () => {
      if (active) setPreviewError('Could not preview these changes. Retry before saving.');
    }).finally(() => {
      if (active) setPreviewing(false);
    });
    return () => {
      active = false;
    };
  }, [rows, base, key, permissions]);
  const a = useHyperAction();
  return <div className="grid gap-3"><label>Describe the change<textarea className="w-full rounded-md border bg-background p-3" value={text} maxLength={1000} disabled={a.busy} onChange={e => {
        setText(e.target.value);
        setPreview(undefined);
        setSaved(false);
      }} /></label>
    <Button disabled={a.busy || !text.trim()} onClick={() => void a.run(async () => {
      setPreview(undefined);
      setSaved(false);
      const result = await request<Record<string, unknown>>(`${base}/translate`, 'POST', {
        text
      });
      setReading(result);
      setSource(text);
      setRows(result[key] as Record<string, unknown>[]);
    })}>Write changes</Button>
    {reading !== undefined && <HyperEvidence value={reading} />}
    {rows.map((row, index) => <div className="rounded border p-3" key={index}><HyperEvidence value={row} />{!permissions && <div className="grid gap-2">{['botId', 'toolRef', 'effect', 'scope', 'behaviour'].map(field => <label key={field}>{field}{field === 'behaviour' ? <select disabled={a.busy} value={String(row[field])} onChange={e => {
            setRows(rows.map((r, i) => i === index ? {
              ...r,
              [field]: e.target.value
            } : r));
            setPreview(undefined);
            setSaved(false);
          }}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(value => <option key={value}>{value}</option>)}</select> : <input className="rounded border bg-background p-2" disabled={a.busy} value={String(row[field])} onChange={e => {
            setRows(rows.map((r, i) => i === index ? {
              ...r,
              [field]: e.target.value
            } : r));
            setPreview(undefined);
            setSaved(false);
          }} />}</label>)}</div>}<Button disabled={a.busy} variant="outline" onClick={() => {
        setRows(rows.filter((_, i) => i !== index));
        setPreview(undefined);
        setSaved(false);
      }}>Remove change</Button></div>)}
    <Button disabled={a.busy || !rows.length || source !== text} onClick={() => void a.run(async () => {
      setPreview(undefined);
      setPreview(await request(`${base}/${permissions ? 'preview' : 'backtest'}`, 'POST', {
        [key]: rows
      }));
    })}>Preview effects and validate</Button>
    {previewing && <p role="status">Checking effects on recent activity…</p>}<HyperError message={previewError} />{preview && <HyperGovernanceReport kind={kind} value={preview} />}
    <Button disabled={a.busy || previewing || !rows.length || !preview?.check.ok || source !== text || saved} onClick={() => void a.run(async () => {
      await request(`${base}/batch`, 'POST', {
        [key]: rows,
        authoring: {
          source: 'english',
          text: source
        }
      });
      setSaved(true);
      setPreview(undefined);
    })}>Save changes</Button>
    {saved && <p role="status">Changes saved.</p>}<HyperError message={a.error} />
  </div>;
}
type HyperRule = {
  id: string;
  botId: string;
  toolRef: string;
  effect: string;
  scope: string;
  behaviour: string;
};
export function HyperTeamApprovals() {
  const r = useHyperResource<{
    enabled: boolean;
    team?: {
      enforceAutoReview: boolean;
      customRulesEnabled: boolean;
      hostCommandsCap: string;
      actionKinds?: Record<string, string>;
    };
    teamRules: HyperRule[];
  }>('/api/approvals');
  const a = useHyperAction(r.reload);
  const choices = useHyperResource<import('./HyperWhatIfModel').WhatIfVocabulary>('/api/admin/what-if/vocabulary');
  const [rule, setRule] = useState({
    botId: '*',
    toolRef: '',
    effect: '*',
    scope: '*',
    behaviour: 'ask'
  });
  const patch = (body: unknown) => a.run(() => request('/api/approvals/team', 'PATCH', body));
  return <HyperStatus resource={r}><div className="grid gap-3">{r.data?.enabled === false && <p role="alert">Approvals are disabled on this deployment.</p>}{r.data?.team ? <>
    {(['enforceAutoReview', 'customRulesEnabled'] as const).map(key => <label key={key}><input type="checkbox" checked={r.data!.team![key]} disabled={a.busy} onChange={e => void patch({
            [key]: e.target.checked
          })} /> {key === 'enforceAutoReview' ? 'Require automatic review' : 'Allow custom rules'}</label>)}
    <label>Host commands <select value={r.data.team.hostCommandsCap} disabled={a.busy} onChange={e => void patch({
            hostCommandsCap: e.target.value
          })}>{['ask', 'allow', 'never'].map(v => <option key={v}>{v}</option>)}</select></label>
    {['deleting', 'sending', 'sharing', 'publishing', 'payments', 'credentials', 'security_settings'].map(kind => <label key={kind}>{kind} <select disabled={a.busy} value={r.data!.team!.actionKinds?.[kind] ?? 'open'} onChange={e => void patch({
            actionKinds: {
              [kind]: e.target.value
            }
          })}>{['open', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select></label>)}
    </> : <p>Team controls are unavailable for this account or edition.</p>}
    {!r.data?.teamRules.length && <p>No team rules.</p>}{r.data?.teamRules.map(row => <article className="rounded border p-3" key={row.id}><strong>{row.toolRef}</strong><p>Bot: {row.botId === '*' ? 'Every Bot' : choices.data?.bots.find(b => b.id === row.botId)?.name || row.botId} · Action: {row.effect} · Target: {row.scope}</p><select aria-label="Rule behavior" disabled={a.busy} value={row.behaviour} onChange={e => void a.run(() => request(`/api/approvals/team/rules/${encodeURIComponent(row.id)}`, 'PATCH', {
          behaviour: e.target.value
        }))}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select><Button variant="destructive" disabled={a.busy} onClick={() => {
          if (window.confirm('Remove this team rule?')) void a.run(() => request(`/api/approvals/team/rules/${encodeURIComponent(row.id)}`, 'DELETE'));
        }}>Remove</Button></article>)}
    <form className="grid gap-2" onSubmit={e => {
        e.preventDefault();
        void a.run(() => request('/api/approvals/team/rules', 'POST', rule).then(() => setRule({
          botId: '*',
          toolRef: '',
          effect: '*',
          scope: '*',
          behaviour: 'ask'
        })));
      }}><h3>Add team rule</h3><p>Use * to match anything. Tool examples: composio-gmail/*, computer_click, host/*. A target of *.example.com matches every page on that site.</p><HyperStatus resource={choices}>{null}</HyperStatus>{(['botId', 'toolRef', 'effect', 'scope'] as const).map(key => <label key={key}>{key}<input className="rounded border bg-background p-2" required list={`team-rule-${key}`} value={rule[key]} onChange={e => setRule({
            ...rule,
            [key]: e.target.value
          })} /><datalist id={`team-rule-${key}`}>{key === 'botId' ? choices.data?.bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>) : key === 'toolRef' ? choices.data?.apps.flatMap(app => app.tools.map(t => <option key={`${app.id}/${t.name}`} value={`${app.id}/${t.name}`}>{app.name}: {t.name}</option>)) : key === 'effect' ? ['*', 'read', 'write', 'destructive', 'delegate'].map(v => <option key={v}>{v}</option>) : null}</datalist></label>)}<select aria-label="New rule behavior" value={rule.behaviour} onChange={e => setRule({
          ...rule,
          behaviour: e.target.value
        })}>{['allow', 'pre_approved', 'ask', 'hand_off'].map(v => <option key={v}>{v}</option>)}</select><Button disabled={a.busy || !r.data?.team || !rule.toolRef.trim() || r.data?.enabled === false} type="submit">Add rule</Button></form><HyperSharedUseRequests /><HyperError message={a.error} /></div></HyperStatus>;
}

// Adapted from boundaries_.new, boundaries_.$index and lib/computers/policy-translate.
export function HyperBoundaryEditor({
  policy,
  original,
  reload,
  template,
  initialOpen = false
}: {
  policy: import('./HyperGovernanceApi').HyperPolicy;
  original?: string;
  reload(): void;
  template?: RuleTemplate;
  initialOpen?: boolean;
}) {
  const initial = original ? ruleLabel(policy, original) : template;
  const [text, setText] = useState('');
  const [writtenText, setWrittenText] = useState('');
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [expression, setExpression] = useState(original || template?.rule || '');
  const [reading, setReading] = useState<{
    rule: string;
    compile: {
      ok: boolean;
    };
    summary: string | null;
    explanation: string | null;
    warning: string | null;
  }>();
  const [report, setReport] = useState<unknown>();
  const [reach, setReach] = useState<unknown>();
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [open, setOpen] = useState(initialOpen);
  const a = useHyperAction();
  const trimmed = expression.trim();
  const duplicate = policy.deny.some(rule => rule === trimmed && rule !== original);
  const broken = reading && reading.rule.trim() === trimmed && !reading.compile.ok;
  useEffect(() => {
    if (!open || !trimmed || duplicate || broken) {
      setReport(undefined);
      return;
    }
    let active = true;
    setPreviewing(true);
    setReport(undefined);
    setPreviewError('');
    const timer = setTimeout(() => {
      request('/api/computers/policy-dry-run', 'POST', {
        policy: {
          mode: policy.mode,
          deny: [trimmed],
          allow: ['true']
        }
      }).then(result => {
        if (active) setReport(result);
      }, () => {
        if (active) setPreviewError('This rule could not be evaluated against recent activity.');
      }).finally(() => {
        if (active) setPreviewing(false);
      });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, trimmed, policy.mode, duplicate, broken]);
  useEffect(() => {
    if (!open || !original) return;
    let active = true;
    request('/api/computers/policy-dry-run', 'POST', {
      policy: withoutRule(policy, original)
    }).then(result => {
      if (active) setReach(result);
    }, () => {
      if (active) setReach({
        warning: 'Could not load recently stopped actions.'
      });
    });
    return () => {
      active = false;
    };
  }, [open, original, policy]);
  const candidate = () => {
    const next = original ? withRuleReplaced(policy, original, trimmed) : {
      ...policy,
      deny: [...policy.deny, trimmed]
    };
    return {
      ...next,
      labels: {
        ...next.labels,
        [trimmed]: {
          name: name.trim(),
          description: description.trim()
        }
      },
      ...(reading ? {
        authoring: {
          source: 'english',
          text: writtenText
        }
      } : {})
    };
  };
  return <details open={open} className="rounded border p-3" onToggle={e => setOpen(e.currentTarget.open)}><summary>{original ? 'Edit rule and review recent activity' : template ? 'Use this template' : 'Add a custom or described boundary'}</summary><div className="grid gap-3 pt-3">
    {template && <p>{template.cost}</p>}
    <label>Describe what to stop<textarea disabled={a.busy} className="w-full rounded border bg-background p-2" value={text} maxLength={1000} onChange={e => setText(e.target.value)} /></label>
    <Button disabled={a.busy || !text.trim()} onClick={() => void a.run(async () => {
        const result = await request<NonNullable<typeof reading> & {
          effect: string;
        }>('/api/computers/policy-translate', 'POST', {
          text
        });
        if (result.effect !== 'deny') throw new Error('This description was interpreted as an allow rule. Describe what this boundary should stop, or edit the expression directly.');
        setReading(result);
        setWrittenText(text);
        setExpression(result.rule);
        if (!name.trim()) setName(text.slice(0, 80));
        if (!description.trim()) setDescription(result.summary?.slice(0, 300) || '');
      })}>Write boundary</Button>
    {reading && <><HyperEvidence value={reading} />{reading.rule !== expression && <p>The expression has changed since this reading.</p>}</>}
    <label>Name<input className="w-full rounded border bg-background p-2" maxLength={80} disabled={a.busy} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>What it stops<input className="w-full rounded border bg-background p-2" maxLength={300} disabled={a.busy} value={description} onChange={e => setDescription(e.target.value)} /></label>
    <label>CEL expression<textarea disabled={a.busy} className="w-full rounded border bg-background p-2 font-mono" value={expression} onChange={e => setExpression(e.target.value)} /></label>
    {duplicate && <p role="alert">This rule is already in place.</p>}{previewing && <p role="status">Checking recent activity…</p>}<HyperError message={previewError} />
    {report !== undefined && <><h4>What this rule would stop</h4><HyperBoundaryReplay value={report} /></>}
    {reach !== undefined && <><h4>Recently stopped by the saved rule</h4><HyperBoundaryReplay value={reach} saved /></>}
    <Button disabled={a.busy || !name.trim() || !trimmed || duplicate || !!broken} onClick={() => void a.run(async () => {
        await request('/api/computers/policy', 'PUT', candidate());
        reload();
      })}>Save boundary</Button><HyperError message={a.error} />
  </div></details>;
}
