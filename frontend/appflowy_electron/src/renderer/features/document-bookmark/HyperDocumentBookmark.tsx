import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { Copy, ExternalLink, Link2, Pencil, Play, RefreshCw, X, Video } from 'lucide-react';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { HyperBookmarkThumbnailImage } from './HyperBookmarkThumbnailImage';
import { useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperChildren } from '../document/HyperDocumentModel';
import { hyperGetSelection, hyperSetSelection, type HyperTextSelection } from '../document/HyperDocumentDom';
import { hyperCaptureBookmarkInsertion, hyperCaptureDocumentBookmark, hyperReadDocumentBookmark, type HyperBookmarkInsertion } from './HyperDocumentBookmarkModel';
import { hyperBookmarkLimits, hyperBookmarkUrl, hyperBookmarkYoutubeId } from './HyperDocumentBookmarkValue';
import { createHyperDocumentBookmarkStore, type HyperDocumentBookmarkStore } from './HyperDocumentBookmarkStore';
export const hyperDocumentBookmarkStrings = {
  insert: 'Link card', edit: 'Edit link card', title: 'Link card', description: 'Save a readable card. Load metadata or a YouTube player only when you choose.',
  url: 'Link address', cardTitle: 'Title', cardDescription: 'Description', site: 'Site', caption: 'Caption', mode: 'Display', card: 'Card', youtube: 'YouTube',
  metadata: 'Load metadata', refresh: 'Refresh metadata', loading: 'Loading metadata…', save: 'Save card', saving: 'Saving card…', cancel: 'Cancel', copy: 'Copy card source',
  loadVideo: 'Load video', unloadVideo: 'Unload video', video: 'YouTube video', open: 'Open link', unsupported: 'This link card has an unsupported format. Its source was kept.',
  thumbnail: 'Thumbnail', thumbnailAddress: 'Thumbnail address', loadThumbnail: 'Load thumbnail', loadingThumbnail: 'Loading thumbnail…', removeThumbnail: 'Remove thumbnail', thumbnailUnavailable: 'The saved thumbnail is unavailable. Edit the card to keep or remove its reference.',
} as const;
const eventName = 'hyper-bookmark-open';
export function hyperOpenDocumentBookmark(host: HTMLElement, target: { blockId: string } | { insertion: HyperBookmarkInsertion }) { host.dispatchEvent(new CustomEvent(eventName, { detail: target })); }
function useBookmarkText() { const { tr } = useTr(); return (name: keyof typeof hyperDocumentBookmarkStrings) => { const key = `hyperDocumentBookmark.${name}`, translated = tr(key); return translated === key ? hyperDocumentBookmarkStrings[name] : translated; }; }
export function HyperDocumentBookmarkBlock({ document: doc, blockId, documentId, editable, onEdit, children }: { document: DocumentDataPB; blockId: string; documentId: string; editable: boolean; onEdit(): void; children?: ReactNode }) {
  const owner = useHyperDocumentOwner(), launch = useAppStore(state => state.launchId), t = useBookmarkText();
  try {
    const read = hyperReadDocumentBookmark(doc, blockId);
    return <HyperResolvedBookmark key={JSON.stringify([hyperDocumentOwnerKey(owner), launch, documentId, blockId, doc.blocks[blockId].data])} owner={owner} blockId={blockId} fields={read.fields} editable={editable} onEdit={onEdit} />;
  } catch { return <div className="my-3"><Alert variant="warning"><AlertDescription>{t('unsupported')}<Button variant="outline" size="sm" onClick={() => window.appflowy.clipboard.writeText(doc.blocks[blockId]?.data || '')}><Copy />{t('copy')}</Button></AlertDescription></Alert>{children}</div>; }
}
function HyperResolvedBookmark({ owner, fields, blockId, editable, onEdit }: { owner: ReturnType<typeof useHyperDocumentOwner>; fields: ReturnType<typeof hyperReadDocumentBookmark>['fields']; blockId: string; editable: boolean; onEdit(): void }) {
  const t = useBookmarkText(), [player, setPlayer] = useState<ReturnType<typeof hyperCaptureDuplicateOwner>>(null);
  let url = ''; try { url = hyperBookmarkUrl(fields.url); } catch { /* Preserve invalid old addresses as readable text until edited. */ }
  const video = hyperBookmarkYoutubeId(fields.url), loaded = fields.mode === 'youtube' && !!video && !!player?.isCurrent() && !!owner?.isCurrent();
  return <Card data-hyper-bookmark-block={blockId} className="my-3 min-w-0 gap-3 py-4">
    <CardHeader className="gap-2 px-4"><div className="flex items-start gap-2"><Link2 className="mt-1 size-4 shrink-0 text-muted-foreground" /><CardTitle className="min-w-0 flex-1 break-words text-sm">{fields.title || fields.url}</CardTitle>{editable && <Button variant="ghost" size="icon-sm" data-hyper-bookmark-edit={blockId} aria-label={t('edit')} onClick={onEdit}><Pencil /></Button>}</div>{fields.site && <p className="break-words text-xs text-muted-foreground">{fields.site}</p>}</CardHeader>
    {(fields.thumbnail || fields.description || fields.caption || fields.mode === 'youtube') && <CardContent className="grid gap-3 px-4">
      {fields.thumbnail && <HyperBookmarkThumbnailImage thumbnail={fields.thumbnail} alt={fields.title || t('thumbnail')} unavailable={t('thumbnailUnavailable')} />}
      {fields.description && <p className="whitespace-pre-wrap break-words text-sm">{fields.description}</p>}
      {fields.caption && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{fields.caption}</p>}
      {fields.mode === 'youtube' && (loaded ? <><HyperBookmarkPlayer video={video!} title={fields.title || t('video')} /><Button variant="outline" size="sm" className="justify-self-start" onClick={() => setPlayer(null)}><X />{t('unloadVideo')}</Button></> : <Button variant="outline" size="sm" className="justify-self-start" disabled={!video || !owner?.isCurrent()} onClick={() => { const captured = hyperCaptureDuplicateOwner(owner); if (captured?.isCurrent()) setPlayer(captured); }}><Play />{t('loadVideo')}</Button>)}
    </CardContent>}
    <CardFooter className="flex flex-wrap gap-2 px-4"><p className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{fields.url}</p>{url && <Button variant="ghost" size="sm" onClick={() => { if (owner?.isCurrent()) void window.appflowy.shell.openExternal(url).catch(() => {}); }}><ExternalLink />{t('open')}</Button>}</CardFooter>
  </Card>;
}
function HyperBookmarkPlayer({ video, title }: { video: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    if (!frame.current) return;
    frame.current.setAttribute('credentialless', '');
    frame.current.src = `https://www.youtube-nocookie.com/embed/${video}`;
  }, [video]);
  return <div role="region" aria-label={title} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><iframe ref={frame} title={title} sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video min-h-52 w-full min-w-52 rounded-md border" /></div>;
}
export function HyperDocumentBookmark({ session, editable, isEditable, editorHost, onPrepareInsert, rowScope, onApplied }: { session: HyperDocumentSession; editable: boolean; isEditable(): boolean; editorHost: { current: HTMLElement | null }; onPrepareInsert?(): HyperBookmarkInsertion | null; rowScope?: { viewId: string; rowId: string }; onApplied?(focus: { id: string; offset: number }): void }) {
  const owner = useHyperDocumentOwner(), launch = useAppStore(state => state.launchId), key = hyperDocumentOwnerKey(owner), latest = useRef({ isEditable, onPrepareInsert }); latest.current = { isEditable, onPrepareInsert };
  const restoreTarget = useRef<{ element: HTMLElement; selection: HyperTextSelection | null } | null>(null), t = useBookmarkText();
  const store = useMemo(() => owner ? createHyperDocumentBookmarkStore({ session, owner, editable: () => latest.current.isEditable(), rowScope }) : null, [session, key, launch, rowScope?.viewId, rowScope?.rowId]);
  const open = (target: ReturnType<typeof hyperCaptureDocumentBookmark> | HyperBookmarkInsertion) => {
    const id = 'blockId' in target ? target.blockId : target.previousId, element = editorHost.current?.querySelector<HTMLElement>(`[data-hyper-bookmark-edit="${CSS.escape(id)}"],[data-hyper-text="${CSS.escape(id)}"]`);
    restoreTarget.current = element ? { element, selection: element.hasAttribute('data-hyper-text') ? hyperGetSelection(element) : null } : null;
    if (restoreTarget.current && 'slash' in target && target.slash && !restoreTarget.current.selection) restoreTarget.current.selection = { start: target.slash.query.length + 1, end: target.slash.query.length + 1 };
    void store?.open(target);
  };
  const restore = () => { const captured = restoreTarget.current; requestAnimationFrame(() => { if (captured?.element.isConnected && owner?.isCurrent()) { captured.element.focus(); if (captured.selection) hyperSetSelection(captured.element, captured.selection); } }); };
  useLayoutEffect(() => { if (!store) return; store.activate(); return () => { store.dispose(); restoreTarget.current = null; }; }, [store]);
  useEffect(() => {
    if (!store) return; const host = editorHost.current;
    const listener = (event: Event) => {
      if (!latest.current.isEditable()) return;
      try { const detail = (event as CustomEvent<{ blockId?: string; insertion?: HyperBookmarkInsertion }>).detail, doc = session.store.getState().document; if (!doc) throw Error(t('unsupported')); const target = detail.blockId ? hyperCaptureDocumentBookmark(doc, detail.blockId) : detail.insertion; if (target) open(target); }
      catch (error) { store.fail(error); }
    };
    host?.addEventListener(eventName, listener); return () => host?.removeEventListener(eventName, listener);
  }, [store, session, editorHost]);
  return store && owner?.isCurrent() ? <HyperBookmarkControl store={store} editable={editable} onInsert={() => {
    try { const doc = session.store.getState().document; if (!doc) throw Error(t('unsupported')); const target = latest.current.onPrepareInsert ? latest.current.onPrepareInsert() : hyperCaptureBookmarkInsertion(doc, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) || ''); if (target) open(target); }
    catch (error) { store.fail(error); }
  }} onApplied={onApplied} onDismiss={restore} /> : null;
}
function HyperBookmarkControl({ store, editable, onInsert, onApplied, onDismiss }: { store: HyperDocumentBookmarkStore; editable: boolean; onInsert(): void; onApplied?(focus: { id: string; offset: number }): void; onDismiss(): void }) {
  const state = useStore(store), t = useBookmarkText(), input = useRef<HTMLInputElement>(null), busy = state.status === 'loading' || state.status === 'saving' || state.thumbnailPreparing, editing = state.status === 'editing' && !state.thumbnailPreparing;
  useLayoutEffect(() => { if (editing) { input.current?.focus(); input.current?.setSelectionRange(input.current.value.length, input.current.value.length); } }, [state.status]);
  const dismiss = () => { store.close(); onDismiss(); };
  return <><Button variant="ghost" size="sm" disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={onInsert}><Link2 />{t('insert')}</Button>
    <Dialog open={state.status !== 'idle'} onOpenChange={open => { if (!open && !busy) dismiss(); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy} finalFocus={false}><DialogHeader><DialogTitle>{t('title')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">{t('url')}<Input ref={input} aria-label={t('url')} value={state.fields.url} maxLength={hyperBookmarkLimits.url} disabled={!editing} onChange={event => store.setField('url', event.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={!editing || state.metadataLoading || state.thumbnailLoading || !state.fields.url.trim()} onClick={() => void store.loadMetadata()}>{state.metadataLoading ? <Spinner /> : <RefreshCw />}{state.metadataLoading ? t('loading') : state.fields.title || state.fields.description || state.fields.site ? t('refresh') : t('metadata')}</Button><Select value={state.fields.mode} disabled={!editing} onValueChange={mode => { if (mode === 'card' || mode === 'youtube') store.setField('mode', mode); }}><SelectTrigger aria-label={t('mode')}><SelectValue>{state.fields.mode === 'youtube' ? t('youtube') : t('card')}</SelectValue></SelectTrigger><SelectContent><SelectItem value="card"><Link2 />{t('card')}</SelectItem><SelectItem value="youtube"><Video />{t('youtube')}</SelectItem></SelectContent></Select></div>
      <label className="grid gap-2 text-sm">{t('thumbnailAddress')}<Input aria-label={t('thumbnailAddress')} value={state.thumbnailUrl} maxLength={hyperBookmarkLimits.url} disabled={!editing || state.thumbnailLoading} onChange={event => store.setThumbnailUrl(event.target.value)} /></label>
      <div className="grid gap-3">{state.fields.thumbnail && <HyperBookmarkThumbnailImage thumbnail={state.fields.thumbnail} alt={state.fields.title || t('thumbnail')} unavailable={t('thumbnailUnavailable')} />}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!editing || state.metadataLoading || state.thumbnailLoading || !state.thumbnailUrl.trim()} onClick={() => void store.loadThumbnail()}>{state.thumbnailLoading ? <Spinner /> : <RefreshCw />}{state.thumbnailLoading ? t('loadingThumbnail') : t('loadThumbnail')}</Button>{state.fields.thumbnail && <Button variant="outline" size="sm" disabled={!editing || state.thumbnailLoading} onClick={() => store.removeThumbnail()}><X />{t('removeThumbnail')}</Button>}</div></div>
      {(['title', 'description', 'site', 'caption'] as const).map(name => <label key={name} className="grid gap-2 text-sm">{t(name === 'title' ? 'cardTitle' : name === 'description' ? 'cardDescription' : name)}{name === 'description' || name === 'caption' ? <Textarea aria-label={t(name === 'description' ? 'cardDescription' : 'caption')} value={state.fields[name]} maxLength={hyperBookmarkLimits[name]} disabled={!editing} onChange={event => store.setField(name, event.target.value)} /> : <Input aria-label={t(name === 'title' ? 'cardTitle' : 'site')} value={state.fields[name]} maxLength={hyperBookmarkLimits[name]} disabled={!editing} onChange={event => store.setField(name, event.target.value)} />}</label>)}
      {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { const details = store.details(); if (details) window.appflowy.clipboard.writeText(details); }}><Copy />{t('copy')}</Button><Button variant="outline" disabled={busy} onClick={dismiss}>{t('cancel')}</Button><Button disabled={!editable || !editing || state.metadataLoading || state.thumbnailLoading || !state.fields.url.trim()} onClick={() => void store.save().then(focus => { if (focus) onApplied?.(focus); })}>{state.status === 'saving' ? <Spinner /> : <Link2 />}{state.status === 'saving' ? t('saving') : t('save')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
