// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { OpenGenerativeUIActivityRenderer } from '@copilotkit/react-core/v2';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { hyperDeleteSandboxed, hyperLoadSandboxed, hyperParseObject, hyperSaveSandboxed, type HyperSandboxRecord } from './HyperPlaygroundApi';
const initial = { slug: '', title: '', description: '', html: '<h3 id="title">Untitled</h3>', css: 'h3 { font: 18px system-ui; }', jsFunctions: 'document.getElementById("title").textContent = window.__args.title || "Untitled";', argumentSchema: '{"type":"object","properties":{"title":{"type":"string"}}}', sampleArguments: '{"title":"A worked example"}' };
export default function HyperPlaygroundSection() {
  const [draft, setDraft] = useState(initial);
  const [records, setRecords] = useState<HyperSandboxRecord[]>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  async function load() { try { setRecords((await hyperLoadSandboxed()).components); } catch { setError('Could not load saved components. Refresh to retry.'); } }
  useEffect(() => { void load(); }, []);
  let validation = ''; let sample: Record<string, unknown> | undefined;
  try { hyperParseObject(draft.argumentSchema); sample = hyperParseObject(draft.sampleArguments); } catch { validation = 'Arguments schema and sample arguments must each be valid JSON objects.'; }
  async function action(run: () => Promise<unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); setNotice(message); setDeleting(undefined); }
    catch { setError('Could not save this change. Check the fields and your permissions, then retry.'); }
    finally { await load(); setBusy(false); }
  }
  return <section className="flex h-full flex-col gap-4 overflow-y-auto p-6 text-sm"><header className="flex flex-wrap gap-3"><div className="flex-1"><h1 className="text-lg font-semibold">Playground</h1><p className="text-muted-foreground">Edits are drafts. Conversations show published components.</p></div><Button disabled={busy} variant="outline" onClick={() => { setDraft(initial); setNotice(''); }}>New component</Button><Button disabled={busy} variant="outline" onClick={() => void load()}>Refresh</Button>{[false, true].map(publish => <Button key={String(publish)} disabled={busy || !!validation || !draft.slug || !draft.title} onClick={() => void action(() => hyperSaveSandboxed({ ...draft, argumentSchema: hyperParseObject(draft.argumentSchema), sampleArguments: hyperParseObject(draft.sampleArguments) }, publish), publish ? 'Published.' : 'Draft saved.')}>{publish ? 'Publish' : 'Save draft'}</Button>)}</header>
  {error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status">{notice}</p>}
  <div className="grid gap-5 lg:grid-cols-2"><fieldset disabled={busy} className="space-y-3">{(Object.keys(initial) as (keyof typeof initial)[]).map(key => <label className="block space-y-2" key={key}><span>{({ slug: 'Slug', title: 'Title', description: 'Description', html: 'HTML', css: 'CSS', jsFunctions: 'JavaScript functions', argumentSchema: 'Arguments JSON Schema', sampleArguments: 'Sample arguments' })[key]}</span>{['slug', 'title', 'description'].includes(key) ? <Input value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /> : <Textarea className="font-mono text-xs" rows={6} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />}</label>)}</fieldset><div className="space-y-4"><h2 className="font-medium">Live sandbox preview</h2>{validation ? <p role="alert" className="text-destructive">{validation}</p> : <OpenGenerativeUIActivityRenderer activityType="open-generative-ui" agent={null} message={null} content={{ css: draft.css, cssComplete: true, html: [draft.html], htmlComplete: true, jsFunctions: `window.__args = ${JSON.stringify(sample)};\n${draft.jsFunctions}`, jsFunctionsComplete: true, generating: false }} key={`${draft.html}${draft.css}${draft.jsFunctions}${draft.sampleArguments}`} />}<h2 className="font-medium">Saved here</h2>{!records ? <p role="status">Loading components…</p> : !records.length ? <p>Nothing saved yet.</p> : records.map(record => <div key={record.name} className="space-y-2 rounded-lg border border-border p-4"><p>{record.title} · revision {record.revision} · {record.published ? 'Published' : 'Draft'}{record.hasUnpublishedChanges ? ' · Unpublished changes' : ''}</p><Button disabled={busy} variant="outline" onClick={() => setDraft({ slug: record.name.replace(/^custom_/, ''), title: record.title, description: record.draftDescription, html: record.draftHtml, css: record.draftCss, jsFunctions: record.draftJsFunctions, argumentSchema: JSON.stringify(record.draftArgumentSchema, null, 2), sampleArguments: JSON.stringify(record.sampleArguments, null, 2) })}>Edit</Button><Button disabled={busy} variant="destructive" onClick={() => setDeleting(record.name)}>Delete</Button></div>)}</div></div>
  {deleting && <div role="alertdialog" aria-label="Delete component" className="space-y-3 rounded-lg border border-border p-4"><p>Delete {deleting}? Conversations cannot use this component afterwards.</p><Button disabled={busy} variant="destructive" onClick={() => void action(() => hyperDeleteSandboxed(deleting), 'Component deleted.')}>Confirm delete</Button><Button disabled={busy} variant="outline" onClick={() => setDeleting(undefined)}>Cancel</Button></div>}</section>;
}
