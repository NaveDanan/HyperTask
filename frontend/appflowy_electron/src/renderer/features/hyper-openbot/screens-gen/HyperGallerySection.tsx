// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { hyperParseScreenDestination } from './HyperScreensDestination';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hyperOpenBotRequest } from '../transport';
import { hyperScreensApi as api } from './HyperScreensApi';
import { hyperGalleryComponent } from './HyperGalleryRegistry';
import { HyperAdminComponentPreview } from './HyperGalleryPreview';
import type { ComponentRecord, DataFunctionSummary } from './HyperScreensTypes';
export default function HyperGallerySection({initialName, path}: {initialName?: string; context?: HyperOpenBotSectionContext; path?: string}) { const destination = hyperParseScreenDestination(path); return <HyperGallery initialName={initialName ?? (destination.kind === 'gallery' ? destination.name : undefined)} />; }
export function HyperAdminComponentsSection({initialName, path}: {initialName?: string; context?: HyperOpenBotSectionContext; path?: string}) { const destination = hyperParseScreenDestination(path); return <HyperGallery admin initialName={initialName ?? (destination.kind === 'admin' ? destination.name : undefined)} />; }
function HyperGallery({admin = false, initialName}: {admin?: boolean; initialName?: string}) {
  const [rows, setRows] = useState<ComponentRecord[]>();
  const [selected, setSelected] = useState<string | undefined>(initialName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bots, setBots] = useState<{id: string; name: string}[]>([]);
  const [edition, setEdition] = useState<'team' | 'personal'>('team');
  const [functions, setFunctions] = useState<DataFunctionSummary[]>([]);
  const load = async () => { setRows(await api.components()); };
  const refresh = async () => {
    await Promise.all([
      load(),
      ...(admin ? [api.bots().then(setBots), api.functions().then(setFunctions)] : []),
    ]);
  };
  useEffect(() => {
    let live = true;
    void hyperOpenBotRequest<{edition?: string}>('/api/capabilities').then(result => {if (live) setEdition(result.edition === 'personal' ? 'personal' : 'team');}).catch(() => undefined);
    const onFocus = () => void refresh().then(() => {if (live) setError('');}).catch(() => {if (live) setError('Components could not be loaded.');});
    onFocus(); window.addEventListener('focus', onFocus);
    return () => {live = false; window.removeEventListener('focus', onFocus);};
  }, [admin]);
  const write = async (action: () => Promise<unknown>) => {setBusy(true); setError(''); try {await action(); await load();} catch {setError('The component operation failed. Check your permissions and retry.');} finally {setBusy(false);} };
  const shown = rows?.filter(row => admin || row.published);
  const row = shown?.find(row => row.name === selected);
  return <section className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-auto p-6">
    <h1 className="text-lg font-semibold">{admin ? 'UI components' : 'Components gallery'}</h1>
    {!admin && <p className="text-sm text-muted-foreground">{edition === 'personal' ? 'Browse the components your Bots can show in conversations. Every Bot can use all of them.' : 'Browse components that Bots can display in conversations. An admin controls which components each Bot can use.'}</p>}
    {error && <p role="alert" className="text-destructive">{error}<Button variant="outline" onClick={() => void refresh().then(() => setError('')).catch(() => setError('Components could not be loaded.'))}>Retry</Button></p>}
    {!rows && !error && <p role="status">Loading components…</p>}
    {selected ? <><Button variant="outline" onClick={() => setSelected(undefined)}>Back to components</Button>{row ? <HyperComponentDetail key={row.name} row={row} admin={admin} busy={busy} bots={bots} functions={functions} write={write} /> : <p>No such component. It may have been removed or unpublished.</p>}</> : <div className="grid gap-4 md:grid-cols-2">{shown?.length === 0 && <p>{admin || edition === 'personal' ? 'No components yet. Components show up here once OpenBot has loaded them.' : 'Nothing published yet. When an admin publishes a component, it will show up here.'}</p>}{shown?.map(row => <button className="rounded-xl border bg-card p-4 text-left" key={row.name} onClick={() => setSelected(row.name)}><h2>{row.title}</h2><p className="text-sm text-muted-foreground">{hyperGalleryComponent(row.name)?.summary ?? (admin ? row.draftDescription : row.publishedDescription)}</p><HyperComponentPreview row={row} admin={admin} /></button>)}</div>}
  </section>;
}
export function HyperCompiledPreview({name}: {name: string}) { const spec = hyperGalleryComponent(name); return spec?.preview ? <div className="pointer-events-none" aria-hidden="true" inert><spec.Component {...spec.preview} /></div> : <p className="text-xs text-muted-foreground">Preview unavailable in this build.</p>; }
function HyperComponentPreview({row, admin}: {row: ComponentRecord; admin: boolean}) {
  return admin && row.kind === 'sandboxed'
    ? <HyperAdminComponentPreview name={row.name} published={row.published} version={row.updatedAt} />
    : <HyperCompiledPreview name={row.name} />;
}
function HyperComponentDetail({row, admin, bots, functions, busy, write}: {row: ComponentRecord; admin: boolean; bots: {id: string; name: string}[]; functions: DataFunctionSummary[]; busy: boolean; write: (action: () => Promise<unknown>) => Promise<void>}) {
  const [draft, setDraft] = useState(row.draftDescription);
  const [editing, setEditing] = useState(false);
  return <><h2>{row.title}</h2><p>{row.publishedDescription}</p><HyperComponentPreview row={row} admin={admin} /><p>Kind: {row.kind} · Called as: {row.name}</p>{admin && !hyperGalleryComponent(row.name) && row.kind !== 'sandboxed' && <p role="status">This build cannot draw this component.</p>}{admin && <fieldset disabled={busy} className="space-y-4"><label className="flex gap-2"><input type="checkbox" checked={row.published} onChange={e => void write(() => api.publication(row.name, e.target.checked))} />Published</label>{row.hasUnpublishedChanges && <p>Unpublished changes</p>}<Button onClick={() => {setDraft(row.draftDescription); setEditing(true);}}>Edit description</Button>{editing && <div><label>Description<Textarea value={draft} onChange={e => setDraft(e.target.value)} /></label><Button onClick={() => void write(() => api.description(row.name, draft))}>Save description</Button><Button variant="ghost" onClick={() => {setDraft(row.draftDescription); setEditing(false);}}>Cancel</Button></div>}<h3>Available to</h3>{!bots.length && <p>No Bots yet.</p>}{bots.map(bot => <label className="flex gap-2" key={bot.id}><input type="checkbox" checked={!row.withheldFrom.includes(bot.id)} onChange={e => void write(() => api.grant(row.name, bot.id, e.target.checked))} />{bot.name}</label>)}<h3>Can read</h3>{!functions.length && <p>This deployment has no data functions.</p>}{functions.map(fn => <label className="flex gap-2" key={fn.name}><input type="checkbox" checked={row.functions.includes(fn.name)} onChange={e => void write(() => api.functionGrant(row.name, fn.name, e.target.checked))} />{fn.name}: {fn.description}</label>)}<p>Last changed: {row.updatedAt}{row.updatedBy ? ` by ${row.updatedBy}` : ''}</p></fieldset>}</>;
}
