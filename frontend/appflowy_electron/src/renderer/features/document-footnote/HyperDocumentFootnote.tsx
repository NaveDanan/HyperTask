import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, ExternalLink, ListOrdered, RefreshCw } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperCaptureDocumentFootnote, hyperDocumentFootnoteIndex, type HyperFootnoteAnchor, type HyperFootnoteInsertion } from './HyperDocumentFootnoteModel';
import { createHyperDocumentFootnoteStore, type HyperDocumentFootnoteStore } from './HyperDocumentFootnoteStore';
import { hyperDocumentFootnoteUrl } from './HyperDocumentFootnoteValue';
import { hyperDocumentFootnoteStrings, useHyperDocumentFootnoteText } from './HyperDocumentFootnoteStrings';
const eventName = 'hypertask:document-footnote-open';
export function hyperOpenDocumentFootnote(host: HTMLElement, detail: { insertion: HyperFootnoteInsertion } | { blockId: string; offset: number }) { host.dispatchEvent(new CustomEvent(eventName, { detail })); }
export function HyperDocumentFootnote({ session, editable, isEditable, editorHost, onPrepareInsert, onApplied, rowScope }: {
  session: HyperDocumentSession; editable: boolean; isEditable(): boolean; editorHost: { current: HTMLElement | null }; onPrepareInsert(): HyperFootnoteInsertion | null; onApplied?(focus: { id: string; offset: number }): void; rowScope?: { viewId: string; rowId: string };
}) {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), latest = useRef({ isEditable, onPrepareInsert }); latest.current = { isEditable, onPrepareInsert };
  const store = useMemo(() => owner ? createHyperDocumentFootnoteStore({ session, owner, editable: () => latest.current.isEditable(), rowScope }) : null, [session, key, rowScope?.viewId, rowScope?.rowId]);
  useLayoutEffect(() => { if (!store) return; store.activate(); return () => store.dispose(); }, [store]);
  useEffect(() => {
    if (!store) return; const host = editorHost.current;
    const open = (target: HyperFootnoteAnchor) => store.open(target);
    const custom = (event: Event) => { try { const detail = (event as CustomEvent<{ insertion?: HyperFootnoteInsertion; blockId?: string; offset?: number }>).detail, doc = session.store.getState().document; if (!doc) throw Error('notReady'); if (detail.insertion) { if (latest.current.isEditable()) open(detail.insertion); } else if (detail.blockId !== undefined && detail.offset !== undefined) open(hyperCaptureDocumentFootnote(doc, detail.blockId, detail.offset)); } catch (error) { store.fail(error); } };
    const click = (event: MouseEvent) => {
      const atom = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-hyper-footnote]') : null;
      if (!atom || !host?.contains(atom)) return; event.preventDefault(); event.stopPropagation();
      try {
        const block = atom.closest<HTMLElement>('[data-hyper-text]'), doc = session.store.getState().document; if (!block?.dataset.hyperText || !doc) throw Error('changed');
        const atoms = Array.from(block.querySelectorAll('[data-hyper-footnote]')), ordinal = atoms.indexOf(atom), entries = hyperDocumentFootnoteIndex(doc).entries.filter(entry => entry.blockId === block.dataset.hyperText && entry.read.atomic);
        if (ordinal < 0 || !entries[ordinal]) throw Error('changed'); open(hyperCaptureDocumentFootnote(doc, block.dataset.hyperText, entries[ordinal].offset));
      } catch (error) { store.fail(error); }
    };
    const keyboard = (event: KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement && event.target.matches('[data-hyper-footnote]')) { event.preventDefault(); event.stopPropagation(); event.target.click(); } };
    host?.addEventListener(eventName, custom); host?.addEventListener('click', click); host?.addEventListener('keydown', keyboard, true);
    return () => { host?.removeEventListener(eventName, custom); host?.removeEventListener('click', click); host?.removeEventListener('keydown', keyboard, true); };
  }, [store, session, editorHost]);
  const text = useHyperDocumentFootnoteText();
  if (!store || !owner?.isCurrent()) return null;
  return <><Button type="button" variant="ghost" size="sm" disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => { try { const target = latest.current.onPrepareInsert(); if (target) store.open(target); } catch (error) { store.fail(error); } }}><ListOrdered />{text('insert')}</Button><HyperDocumentFootnoteInspector store={store} editable={editable} onApplied={onApplied} /></>;
}
export function HyperDocumentFootnoteInspector({ store, editable, onApplied }: { store: HyperDocumentFootnoteStore; editable: boolean; onApplied?(focus: { id: string; offset: number }): void }) {
  const state = useStore(store), text = useHyperDocumentFootnoteText(), [pageQuery, setPageQuery] = useState(''), [pageNumber, setPageNumber] = useState(0), [existingQuery, setExistingQuery] = useState(''), [existingPage, setExistingPage] = useState(0), [copyError, setCopyError] = useState('');
  const busy = state.status === 'saving', locked = !editable || state.status !== 'editing', opaque = state.existing && (!state.read?.supported || state.read.value?.kind === 'citation' && state.read.value.data.reference.type === 'attachment');
  useEffect(() => { setPageQuery(''); setPageNumber(0); setExistingQuery(''); setExistingPage(0); setCopyError(''); }, [state.status === 'idle', state.label]);
  const explain = (error: string) => Object.hasOwn(hyperDocumentFootnoteStrings, error) ? text(error as keyof typeof hyperDocumentFootnoteStrings) : error;
  const pages = state.pages.filter(page => page.name.toLocaleLowerCase().includes(pageQuery.toLocaleLowerCase()));
  const pageIndex = Math.min(pageNumber, Math.max(0, Math.ceil(pages.length / 20) - 1)), existing = state.choices.filter(choice => `${choice.label} ${choice.value.kind === 'note' ? choice.value.data.text : choice.value.data.reference.title ?? ''}`.toLocaleLowerCase().includes(existingQuery.toLocaleLowerCase())), existingIndex = Math.min(existingPage, Math.max(0, Math.ceil(existing.length / 20) - 1));
  useEffect(() => { if (pageIndex !== pageNumber) setPageNumber(pageIndex); }, [pageIndex, pageNumber]);
  useEffect(() => { if (existingIndex !== existingPage) setExistingPage(existingIndex); }, [existingIndex, existingPage]);
  const reference = state.read?.value?.kind === 'citation' ? state.read.value.data.reference : null;
  const close = () => { const focus = store.close(); if (focus) onApplied?.(focus); };
  return <Dialog open={state.status !== 'idle'} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy} finalFocus={false}>
    <DialogHeader><DialogTitle>{text('title')}{state.label && <Badge variant="secondary" size="sm" className="ml-2">{state.label}</Badge>}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
    {locked && state.status !== 'partial' && <Alert variant="info"><AlertDescription>{text(opaque ? 'unsupported' : 'readOnly')}</AlertDescription></Alert>}
    {state.status === 'partial' && <Alert variant="destructive"><AlertDescription>{text('partial')}</AlertDescription></Alert>}
    {state.references > 1 && !opaque && <p className="text-xs text-muted-foreground">{text('references', { count: state.references })}</p>}
    {opaque ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs">{state.source}</pre> : <>
      <label className="grid gap-2 text-sm">{text('sourceType')}<Select value={state.draft.kind} disabled={locked || state.existing} onValueChange={kind => { if (kind === 'note' || kind === 'doc' || kind === 'url' || kind === 'existing') store.setDraft({ kind }); }}><SelectTrigger aria-label={text('sourceType')} className="w-full"><SelectValue>{text(state.draft.kind)}</SelectValue></SelectTrigger><SelectContent>{(['note', 'doc', 'url', ...(!state.existing && state.choices.length ? ['existing'] : [])] as const).map(kind => <SelectItem key={kind} value={kind}>{text(kind as 'note' | 'doc' | 'url' | 'existing')}</SelectItem>)}</SelectContent></Select></label>
      {state.draft.kind === 'note' && <label className="grid gap-2 text-sm">{text('text')}<Textarea aria-label={text('text')} className="min-h-24" value={state.draft.text} readOnly={locked} onChange={event => store.setDraft({ text: event.currentTarget.value })} /></label>}
      {state.draft.kind === 'existing' && <><Input aria-label={text('searchExisting')} placeholder={text('searchExisting')} value={existingQuery} disabled={locked} onChange={event => { setExistingQuery(event.target.value); setExistingPage(0); }} /><label className="grid gap-2 text-sm">{text('chooseExisting')}<Select value={state.draft.existingLabel} disabled={locked} onValueChange={label => store.setDraft({ existingLabel: label ?? '' })}><SelectTrigger aria-label={text('chooseExisting')} className="w-full"><SelectValue>{state.draft.existingLabel}</SelectValue></SelectTrigger><SelectContent>{existing.slice(existingIndex * 20, existingIndex * 20 + 20).map(choice => <SelectItem key={choice.label} value={choice.label}>{choice.label}</SelectItem>)}</SelectContent></Select></label><HyperFootnotePagination total={existing.length} page={existingIndex} label={text('chooseExisting')} disabled={locked} onPage={setExistingPage} /></>}
      {state.draft.kind === 'doc' && <div className="grid gap-2">
        <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={locked || state.pagesLoading} onClick={() => void store.loadPages()}>{state.pagesLoading ? <Spinner /> : <RefreshCw />}{text(state.pagesLoading ? 'loading' : 'loadPages')}</Button><span className="text-xs text-muted-foreground">{state.pages.find(page => page.id === state.draft.docId)?.name || state.draft.title || (state.draft.docId ? text('page') : text('choosePage'))}</span></div>
        {state.pages.length > 0 && <><Input aria-label={text('searchPages')} placeholder={text('searchPages')} value={pageQuery} disabled={locked} onChange={event => { setPageQuery(event.target.value); setPageNumber(0); }} /><div className="flex flex-col gap-1">{pages.slice(pageIndex * 20, pageIndex * 20 + 20).map(page => <Button type="button" variant={page.id === state.draft.docId ? 'secondary' : 'ghost'} size="sm" className="justify-start truncate" key={page.id} disabled={locked} onClick={() => store.setDraft({ docId: page.id })}>{page.name || text('page')}</Button>)}{!pages.length && <p className="text-xs text-muted-foreground">{text('noPages')}</p>}</div><HyperFootnotePagination total={pages.length} page={pageIndex} label={text('pages')} disabled={locked} onPage={setPageNumber} /></>}
      </div>}
      {state.draft.kind === 'url' && <label className="grid gap-2 text-sm">{text('address')}<Input aria-label={text('address')} value={state.draft.url} readOnly={locked} onChange={event => store.setDraft({ url: event.currentTarget.value })} /></label>}
      {(state.draft.kind === 'url' || state.draft.kind === 'doc') && <><label className="grid gap-2 text-sm">{text('sourceTitle')}<Input aria-label={text('sourceTitle')} value={state.draft.title} readOnly={locked} onChange={event => store.setDraft({ title: event.currentTarget.value })} /></label><label className="grid gap-2 text-sm">{text('sourceDescription')}<Textarea aria-label={text('sourceDescription')} value={state.draft.description} readOnly={locked} onChange={event => store.setDraft({ description: event.currentTarget.value })} /></label></>}
    </>}
    {(state.error || copyError) && <Alert variant="destructive"><AlertDescription>{explain(copyError || state.error)}</AlertDescription></Alert>}
    {!opaque && !state.changed && reference && (reference.type === 'doc' && reference.docId || reference.type === 'url' && reference.url && hyperDocumentFootnoteUrl(reference.url)) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void store.openReference()}><ExternalLink />{text(reference.type === 'doc' ? 'openPage' : 'openUrl')}</Button>}
    <DialogFooter className="flex-wrap">
      {state.source && <Button type="button" variant="outline" disabled={busy} onClick={() => { try { void Promise.resolve(window.appflowy.clipboard.writeText(state.source)).catch(() => setCopyError('copyFailed')); } catch { setCopyError('copyFailed'); } }}><Copy />{text('copy')}</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={close}>{text('cancel')}</Button>
      {!locked && state.existing && <Button type="button" variant="ghost" onClick={() => void store.remove().then(focus => { if (focus) onApplied?.(focus); })}>{text('remove')}</Button>}
      {!locked && <Button type="button" disabled={state.existing && !state.changed} onClick={() => void store.save().then(focus => { if (focus) onApplied?.(focus); })}>{text('save')}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
function HyperFootnotePagination({ total, page, label, disabled = false, onPage }: { total: number; page: number; label: string; disabled?: boolean; onPage(page: number): void }) {
  const text = useHyperDocumentFootnoteText(), pages = Math.max(1, Math.ceil(total / 20));
  if (pages <= 1) return null;
  return <nav aria-label={label} className="flex items-center gap-2 text-xs text-muted-foreground" onKeyDown={event => { if (disabled || !(event.target instanceof HTMLButtonElement)) return; const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages - 1 : event.key === 'ArrowLeft' ? page - 1 : event.key === 'ArrowRight' ? page + 1 : null; if (next !== null) { event.preventDefault(); onPage(Math.max(0, Math.min(pages - 1, next))); } }}><span className="mr-auto" aria-live="polite">{text('range', { start: page * 20 + 1, end: Math.min(total, page * 20 + 20), total })}</span><Button type="button" variant="outline" size="icon-xs" aria-label={text('previous')} disabled={disabled || page <= 0} onClick={() => onPage(page - 1)}>‹</Button><Button type="button" variant="outline" size="icon-xs" aria-label={text('next')} disabled={disabled || page + 1 >= pages} onClick={() => onPage(page + 1)}>›</Button></nav>;
}
export function HyperDocumentFootnoteList({ document: doc, onInspect }: { document: DocumentDataPB; onInspect(target: { blockId: string; offset: number }): void }) {
  const text = useHyperDocumentFootnoteText(), [page, setPage] = useState(0);
  const result = useMemo(() => { try { const index = hyperDocumentFootnoteIndex(doc), seen = new Set<string>(); return { entries: index.entries.filter(entry => { const key = entry.read.label ? JSON.stringify([entry.read.label, entry.signature]) : `${entry.blockId}:${entry.offset}`; if (seen.has(key)) return false; seen.add(key); return true; }), error: index.conflict ? 'conflict' : '' }; } catch { return { entries: [], error: 'changed' }; } }, [doc]);
  const position = Math.min(page, Math.max(0, Math.ceil(result.entries.length / 20) - 1));
  useEffect(() => { if (position !== page) setPage(position); }, [position, page]);
  if (!result.entries.length && !result.error) return null;
  return <section className="mt-4 flex flex-col gap-2 border-t pt-4" aria-label={text('list')}><h2 className="text-sm font-medium">{text('list')}</h2>{result.error && <Alert variant="info"><AlertDescription>{text(result.error as 'changed' | 'conflict')}</AlertDescription></Alert>}
    {result.entries.slice(position * 20, position * 20 + 20).map(entry => { const value = entry.read.value, label = !entry.read.supported ? text('unknown') : value?.kind === 'note' ? value.data.text : value?.data.reference.title || value?.data.reference.url || value?.data.reference.fileName || text(value?.data.reference.type === 'attachment' ? 'attachment' : 'page'); return <Button type="button" variant="ghost" size="sm" className="h-auto justify-start whitespace-normal text-left" key={`${entry.blockId}:${entry.offset}`} onClick={() => onInspect({ blockId: entry.blockId, offset: entry.offset })}><Badge variant="secondary" size="sm">{entry.read.label || '?'}</Badge><span className="line-clamp-2 min-w-0">{label}</span></Button>; })}
    <HyperFootnotePagination total={result.entries.length} page={position} label={text('list')} onPage={setPage} />
  </section>;
}
