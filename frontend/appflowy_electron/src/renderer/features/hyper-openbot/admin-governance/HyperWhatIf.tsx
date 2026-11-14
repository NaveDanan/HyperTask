// Adapted from OpenBot admin/what-if and components/what-if. Copyright (c) 2026 CopilotKit. MIT licensed.
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { hyperGovernanceRequest as request } from './HyperGovernanceApi';
import { HyperField, HyperStatus, HyperError, useHyperAction, useHyperResource } from './HyperGovernanceSection';
import { EMPTY_WHAT_IF_ACTION, missingFrom, WHAT_IF_INITIATOR_WORDS, WHAT_IF_INTENT_WORDS, type WhatIfAction, type WhatIfVocabulary, type WhatIfResult } from './HyperWhatIfModel';
export function HyperVerdict({ result, navigate }: { result: WhatIfResult; navigate?(page: string): void }) {
  const pages: Record<string, string> = { '/admin/permissions': 'Permissions', '/admin/boundaries': 'Boundaries', '/admin/approvals': 'Approvals' };
  return <div className="grid gap-3"><h3 className="font-semibold">{result.headline}</h3>{result.layers.map(layer => <article className={`rounded border p-3 ${layer.unreached ? 'opacity-60' : ''}`} key={layer.id}><strong>{layer.title}: {layer.verdict}{layer.decides ? ' · Decides this action' : ''}</strong><p>{layer.summary}</p>{layer.unreached && <p>A preceding control stops the action first.</p>}{layer.basis && <p>{layer.basis}</p>}{layer.rule && <code className="break-all">{layer.rule}</code>}{layer.caveat && <p>{layer.caveat}</p>}{layer.page && pages[layer.page] && navigate && <Button variant="outline" onClick={() => navigate(pages[layer.page!])}>Open {pages[layer.page]}</Button>}</article>)}{result.notApplicable.length > 0 && <p>Does not apply: {result.notApplicable.join(', ')}</p>}{result.notChecked.map(note => <p key={note}>{note}</p>)}</div>;
}
export function HyperWhatIf({ initial, navigate }: { initial?: WhatIfAction; navigate?(page: string): void }) {
  const v = useHyperResource<WhatIfVocabulary>('/api/admin/what-if/vocabulary');
  const a = useHyperAction();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string>();
  const [action, setAction] = useState(initial || EMPTY_WHAT_IF_ACTION);
  const [unclear, setUnclear] = useState('');
  const [result, setResult] = useState<WhatIfResult>();
  function change(key: keyof WhatIfAction, value: string) { setAction(old => ({ ...old, [key]: value, ...(key === 'person' ? { group: '' } : key === 'group' ? { person: '' } : key === 'app' ? { tool: '' } : {}) })); setResult(undefined); }
  function select(key: keyof WhatIfAction, label: string, entries: { id: string; name: string }[]) { return <label className="grid gap-1">{label}<select disabled={a.busy} className="rounded border bg-background p-2" value={action[key]} onChange={e => change(key, e.target.value)}><option value="">Choose…</option>{entries.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>; }
  const missing = v.data ? missingFrom(action, v.data) : 'Loading available actions.';
  return <div className="grid gap-3"><HyperField label="Ask what would happen" value={question} onChange={setQuestion} maxLength={500} /><Button disabled={a.busy || !question.trim()} onClick={() => void a.run(async () => { setResult(undefined); setUnclear(''); const read = await request<{ understood: string; unclear?: string; action: WhatIfAction }>('/api/admin/what-if/ask', 'POST', { question: question.trim() }); if (read.understood === 'yes') { setAction(read.action); setAsked(question.trim()); } else setUnclear(read.unclear || 'Please clarify the action.'); })}>Read question</Button>{unclear && <p role="status">{unclear}</p>}<HyperStatus resource={v}>{v.data && <div className="grid gap-3 sm:grid-cols-2">
    {select('bot', 'Bot', v.data.bots)}{select('person', 'Person', v.data.people.map(p => ({ id: p.id, name: p.name || p.email })))}{select('group', 'Or directory group', v.data.groups.map(id => ({ id, name: id })))}{select('initiator', 'What starts the run', Object.entries(WHAT_IF_INITIATOR_WORDS).map(([id, name]) => ({ id, name })))}{select('surface', 'Where', [{ id: 'app', name: 'Connected app' }, { id: 'computer', name: 'Bot computer' }])}
    {action.surface === 'app' ? <>{select('app', 'App', v.data.apps)}{select('tool', 'Tool', (v.data.apps.find(app => app.id === action.app)?.tools || []).map(t => ({ id: t.name, name: `${t.name} · ${t.effect}${t.destructive ? ' · destructive' : ''}` })))}</> : <>{select('intent', 'Action', Object.entries(WHAT_IF_INTENT_WORDS).map(([id, name]) => ({ id, name })))}{(['host', 'label', 'command', 'file'] as const).map(key => <HyperField key={key} label={key} value={action[key]} required={false} maxLength={300} onChange={value => change(key, value)} />)}</>}
  </div>}</HyperStatus>{missing && <p>{missing}</p>}<Button disabled={a.busy || !!missing} onClick={() => void a.run(async () => { setResult(undefined); const checked = await request<{ result: WhatIfResult }>('/api/admin/what-if/check', 'POST', { action, ...(asked ? { question: asked } : {}) }); setResult(checked.result); })}>Check action</Button><HyperError message={a.error} />{result && <HyperVerdict result={result} navigate={navigate} />}</div>;
}
