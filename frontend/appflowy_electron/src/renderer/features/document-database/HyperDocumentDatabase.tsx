import { useEffect, useRef, useState } from 'react';
import { Database, Plus, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';
import type { BlockPB, DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { HyperDatabasePage } from '../database/HyperDatabasePage';
import { tabsActions } from '../tabs/tabs-store';
import { ViewScopeProvider } from '../view-header/view-scope';
import { hyperReadDocumentDatabase, type HyperDocumentDatabaseReference } from './HyperDocumentDatabaseModel';
import { HyperDocumentDatabaseCreatedError, HyperDocumentDatabaseService, type HyperDocumentDatabaseIdentity, type HyperDocumentDatabaseRowScope } from './HyperDocumentDatabaseService';
import strings from './HyperDocumentDatabase.en.json';

export { default as hyperDocumentDatabaseStrings } from './HyperDocumentDatabase.en.json';
function useHyperDocumentDatabaseText() {
  const { tr } = useTr();
  return (key: keyof typeof strings) => {
    const id = `hyperDocumentDatabase.${key}`, translated = tr(id);
    return translated === id ? strings[key] : translated;
  };
}
const errorText = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? String(error);

export function HyperDocumentDatabaseBlock({ document, block, editable }: { document: DocumentDataPB; block: BlockPB; editable: boolean }) {
  const text = useHyperDocumentDatabaseText();
  let reference: HyperDocumentDatabaseReference;
  try { reference = hyperReadDocumentDatabase(document, block); }
  catch (error) { return <Alert variant="warning" className="my-4"><AlertTitle>{text('unavailable')}</AlertTitle><AlertDescription>{errorText(error)}<span>{text('kept')}</span></AlertDescription></Alert>; }
  return <HyperResolvedDocumentDatabase key={`${reference.parentId}:${reference.viewId}`} reference={reference} editable={editable} />;
}
function HyperResolvedDocumentDatabase({ reference, editable }: { reference: HyperDocumentDatabaseReference; editable: boolean }) {
  const text = useHyperDocumentDatabaseText();
  const [service] = useState(() => new HyperDocumentDatabaseService());
  const [view, setView] = useState<ViewPB | null>(null), [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [opening, setOpening] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setView(null); setError(null);
    void service.resolve(reference, controller.signal).then(value => { if (!controller.signal.aborted) setView(value); }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [service, reference.parentId, reference.viewId, attempt]);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try { const latest = await service.resolve(reference); if (alive.current) await tabsActions.openView(latest); }
    catch (error) { if (alive.current) setError(errorText(error)); }
    finally { if (alive.current) setOpening(false); }
  };
  return <section data-hyper-database={reference.viewId} aria-label={view?.name || text('insert')} className="my-4 overflow-hidden rounded-lg border bg-background">
    <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
      <Badge variant="secondary" size="sm"><Database />{text(reference.type)}</Badge>
      <Button variant="ghost" size="sm" disabled={!view || opening} onClick={() => void open()}><SquareArrowOutUpRight />{text('open')}</Button>
    </div>
    {error ? <Alert variant="warning" className="m-3 w-auto"><AlertTitle>{text('unavailable')}</AlertTitle><AlertDescription>{error}<span>{text('kept')}</span><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw />{text('retry')}</Button></AlertDescription></Alert> : view ? <div className={reference.compact ? 'h-80 overflow-auto pt-3' : 'h-96 overflow-auto pt-3'}>
      <ViewScopeProvider key={view.id} view={view} updateTabs={false}><HyperDatabasePage view={view} context={{}} readOnly={!editable} /></ViewScopeProvider>
    </div> : <p role="status" className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Spinner />{text('loading')}</p>}
  </section>;
}

export interface HyperDocumentDatabaseInsertProps {
  documentId: string;
  rowScope?: HyperDocumentDatabaseRowScope;
  editable: boolean;
  /** Capture the document insertion anchor before the dialog takes focus. */
  onPrepareInsert?(): void;
  /** Recheck editability and the captured anchor; resolve after session.flush(). */
  onInsert(reference: HyperDocumentDatabaseReference): void | Promise<void>;
}
export function HyperDocumentDatabaseInsert({ documentId, rowScope, editable, onPrepareInsert, onInsert }: HyperDocumentDatabaseInsertProps) {
  const text = useHyperDocumentDatabaseText();
  const [service] = useState(() => new HyperDocumentDatabaseService());
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'create' | 'link'>('create'), [layout, setLayout] = useState<ViewLayoutPB>(ViewLayoutPB.Grid);
  const [name, setName] = useState(''), [query, setQuery] = useState(''), [sourceId, setSourceId] = useState('');
  const [views, setViews] = useState<ViewPB[]>([]), [identity, setIdentity] = useState<HyperDocumentDatabaseIdentity | null>(null);
  const [error, setError] = useState<string | null>(null), [created, setCreated] = useState<ViewPB | null>(null), [limit, setLimit] = useState(200);
  const operation = useRef<AbortController | null>(null), editableNow = useRef(editable);
  editableNow.current = editable;
  const cancel = () => { operation.current?.abort(); operation.current = null; };
  useEffect(() => {
    setOpen(false); setBusy(false); setLoading(false); setCreated(null); setIdentity(null); setError(null);
    return () => cancel();
  }, [documentId, rowScope?.viewId, rowScope?.rowId]);
  const current = (controller: AbortController) => operation.current === controller && !controller.signal.aborted;
  const load = async () => {
    cancel(); const controller = new AbortController(); operation.current = controller;
    setLoading(true); setViews([]); setIdentity(null); setSourceId(''); setError(null);
    try {
      const result = await service.candidates(controller.signal);
      if (current(controller)) { setViews(result.views); setIdentity(result.identity); }
    } catch (error) { if (current(controller)) setError(errorText(error)); }
    finally { if (current(controller)) setLoading(false); }
  };
  const changeOpen = (value: boolean) => {
    if (busy) return;
    if (value) {
      if (!editableNow.current) return;
      setName(text('defaultName')); setQuery(''); setMode('create'); setCreated(null); setLimit(200); setOpen(true);
      try { onPrepareInsert?.(); } catch (error) { setIdentity(null); setLoading(false); setError(errorText(error)); return; }
      void load();
    } else { cancel(); setOpen(false); setLoading(false); }
  };
  const insert = async () => {
    if (!identity || !editableNow.current || busy || created) return;
    cancel(); const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null);
    let saved: ViewPB | undefined;
    try {
      const options = { documentId, rowScope, identity, layout, name, writable: () => editableNow.current, signal: controller.signal };
      const result = await (mode === 'create' ? service.create(options) : service.link(sourceId, options));
      saved = result.view;
      if (!current(controller)) return;
      if (!editableNow.current) throw new Error('This document is read-only.');
      await onInsert(result.reference);
      if (current(controller)) { setBusy(false); cancel(); setOpen(false); }
    } catch (error) {
      if (current(controller)) {
        const recovery = error instanceof HyperDocumentDatabaseCreatedError ? error.view : saved;
        setCreated(recovery ?? null); setError(recovery ? text('saveFailed') : errorText(error));
      }
    } finally { if (current(controller)) setBusy(false); }
  };
  const openCreated = async () => {
    if (!created || !identity || busy) return;
    setBusy(true);
    try { await tabsActions.openView(await service.openCreated(created, identity)); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  const visible = views.filter(view => view.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!editable} />}><Database />{text('insert')}</DialogTrigger>
    <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{text('insert')}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}{created ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void openCreated()}><SquareArrowOutUpRight />{text('openCreated')}</Button> : !busy && <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />{text('retry')}</Button>}</AlertDescription></Alert>}
      <Field><FieldLabel>{text('mode')}</FieldLabel><Select value={mode} disabled={busy || !!created} onValueChange={value => { if (value === 'create' || value === 'link') { setMode(value); setSourceId(''); } }}><SelectTrigger className="w-full" aria-label={text('mode')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="create">{text('create')}</SelectItem><SelectItem value="link">{text('link')}</SelectItem></SelectContent></Select></Field>
      <Field><FieldLabel>{text('name')}</FieldLabel><Input aria-label={text('name')} value={name} disabled={busy || !!created} onChange={event => setName(event.target.value)} /></Field>
      {mode === 'create' ? <Field><FieldLabel>{text('layout')}</FieldLabel><Select value={String(layout)} disabled={busy || !!created} onValueChange={value => { if (value !== null) setLayout(Number(value)); }}><SelectTrigger className="w-full" aria-label={text('layout')}><SelectValue /></SelectTrigger><SelectContent>{([['grid', ViewLayoutPB.Grid], ['board', ViewLayoutPB.Board], ['calendar', ViewLayoutPB.Calendar]] as const).map(([key, value]) => <SelectItem key={key} value={String(value)}>{text(key)}</SelectItem>)}</SelectContent></Select></Field> : <>
        <p className="text-xs text-muted-foreground">{text('linkedHint')}</p>
        <Input aria-label={text('search')} placeholder={text('search')} value={query} disabled={busy || !!created} onChange={event => { setQuery(event.target.value); setLimit(200); }} />
        <div aria-label={text('source')} className="max-h-64 space-y-1 overflow-y-auto">{visible.slice(0, limit).map(view => <Button key={view.id} variant={sourceId === view.id ? 'secondary' : 'ghost'} className="w-full justify-start" disabled={busy || !!created} aria-pressed={sourceId === view.id} onClick={() => setSourceId(view.id)}><Database /><span className="truncate">{view.name || text('defaultName')}</span></Button>)}{visible.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 200)}>{text('showMore')}</Button>}{!loading && !visible.length && !error && <p className="text-sm text-muted-foreground">{text('noDatabases')}</p>}</div>
      </>}
      {loading && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Spinner />{text('loading')}</p>}
      <Button className="justify-self-end" disabled={!editable || busy || loading || !identity || !name.trim() || !!created || (mode === 'link' && !sourceId)} onClick={() => void insert()}>{busy ? <Spinner /> : <Plus />}{busy ? text('working') : mode === 'create' ? text('create') : text('link')}</Button>
    </DialogContent>
  </Dialog>;
}
