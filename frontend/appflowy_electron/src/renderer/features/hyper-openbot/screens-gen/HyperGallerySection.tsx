// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hyperScreensApi as api } from './HyperScreensApi';
import { hyperGalleryComponent } from './HyperGalleryRegistry';
import type { ComponentRecord, DataFunctionSummary } from './HyperScreensTypes';
export default function HyperGallerySection() { return <HyperGallery />; }
export function HyperAdminComponentsSection() { return <HyperGallery admin />; }
function HyperGallery({admin = false}: {admin?: boolean}) {
  const [rows, setRows] = useState<ComponentRecord[]>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bots, setBots] = useState<{id: string; name: string}[]>([]);
  const [functions, setFunctions] = useState<DataFunctionSummary[]>([]);
  const load = async () => { setRows(await api.components()); };
  useEffect(() => { void load().catch(() => setError('Components could not be loaded.')); if (admin) { void api.bots().then(setBots).catch(() => setError('Bots could not be loaded.')); void api.functions().then(setFunctions).catch(() => setError('Data functions could not be loaded.')); } }, [admin]);
  const write = async (action: () => Promise<unknown>) => {setBusy(true); setError(''); try {await action(); await load();} catch {setError('The component operation failed. Check your permissions and retry.');} finally {setBusy(false);} };
  const shown = rows?.filter(row => admin || row.published);
  const row = shown?.find(row => row.name === selected);
  return <section className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-auto p-6">
    <h1 className="text-lg font-semibold">{admin ? 'UI components' : 'Components gallery'}</h1>
    {error && <p role="alert" className="text-destructive">{error}<Button variant="outline" onClick={() => void load().then(() => setError('')).catch(() => setError('Components could not be loaded.'))}>Retry</Button></p>}
    {!rows && !error && <p role="status">Loading components…</p>}
    {selected ? <><Button variant="outline" onClick={() => setSelected(undefined)}>Back to components</Button>{row ? <HyperComponentDetail key={row.name} row={row} admin={admin} busy={busy} bots={bots} functions={functions} write={write} /> : <p>No such component. It may have been removed or unpublished.</p>}</> : <div className="grid gap-4 md:grid-cols-2">{shown?.length === 0 && <p>No components yet.</p>}{shown?.map(row => <button className="rounded-xl border bg-card p-4 text-left" key={row.name} onClick={() => setSelected(row.name)}><h2>{row.title}</h2><p className="text-sm text-muted-foreground">{hyperGalleryComponent(row.name)?.summary ?? (admin ? row.draftDescription : row.publishedDescription)}</p><HyperCompiledPreview name={row.name} /></button>)}</div>}
  </section>;
}
export function HyperCompiledPreview({name}: {name: string}) { const spec = hyperGalleryComponent(name); return spec?.preview ? <div className="pointer-events-none" inert><spec.Component {...spec.preview} /></div> : <p className="text-xs text-muted-foreground">Preview unavailable in this build.</p>; }
function HyperComponentDetail({row, admin, bots, functions, busy, write}: {row: ComponentRecord; admin: boolean; bots: {id: string; name: string}[]; functions: DataFunctionSummary[]; busy: boolean; write: (action: () => Promise<unknown>) => Promise<void>}) {
  const [draft, setDraft] = useState(row.draftDescription);
  return <><h2>{row.title}</h2><p>{row.publishedDescription}</p><HyperCompiledPreview name={row.name} /><p>Kind: {row.kind} · Called as: {row.name}</p>{admin && <fieldset disabled={busy} className="space-y-4"><label className="flex gap-2"><input type="checkbox" checked={row.published} onChange={e => void write(() => api.publication(row.name, e.target.checked))} />Published</label>{row.hasUnpublishedChanges && <p>Unpublished changes</p>}<label>Description<Textarea value={draft} onChange={e => setDraft(e.target.value)} /></label><Button onClick={() => void write(() => api.description(row.name, draft))}>Save description</Button><h3>Available to</h3>{!bots.length && <p>No Bots yet.</p>}{bots.map(bot => <label className="flex gap-2" key={bot.id}><input type="checkbox" checked={!row.withheldFrom.includes(bot.id)} onChange={e => void write(() => api.grant(row.name, bot.id, e.target.checked))} />{bot.name}</label>)}<h3>Can read</h3>{!functions.length && <p>This deployment has no data functions.</p>}{functions.map(fn => <label className="flex gap-2" key={fn.name}><input type="checkbox" checked={row.functions.includes(fn.name)} onChange={e => void write(() => api.functionGrant(row.name, fn.name, e.target.checked))} />{fn.name}: {fn.description}</label>)}<p>Last changed: {row.updatedAt}{row.updatedBy ? ` by ${row.updatedBy}` : ''}</p></fieldset>}</>;
}
