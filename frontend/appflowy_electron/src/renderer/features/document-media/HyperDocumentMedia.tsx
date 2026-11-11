import { useEffect, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, ImagePlus, Paperclip, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { BlockPB, DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { hyperReadDocumentMedia, type HyperDocumentMediaKind, type HyperDocumentMediaReference } from './HyperDocumentMediaModel';
import { HyperDocumentMediaPreparedError, HyperDocumentMediaService, type HyperDocumentMediaIdentity, type HyperPreparedDocumentMedia, type HyperDocumentMediaRowScope } from './HyperDocumentMediaService';
import { hyperCloudAssetIsProtected } from '../cloud-assets/HyperCloudAssetPreview';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import strings from './HyperDocumentMedia.en.json';

export { default as hyperDocumentMediaStrings } from './HyperDocumentMedia.en.json';
function useMediaText() {
  const { tr } = useTr();
  return (name: keyof typeof strings) => {
    const key = `hyperDocumentMedia.${name}`, translated = tr(key);
    return translated === key ? strings[name] : translated;
  };
}
const errorText = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);

export function HyperDocumentMediaBlock({ document, block, documentId, editable, onRemove, service, rowScope }: {
  document: DocumentDataPB; block: BlockPB; documentId: string; editable: boolean;
  /** Remove only the block reference; shared local or cloud files must not be deleted. */
  onRemove?(): void;
  service?: HyperDocumentMediaService;
  rowScope?: HyperDocumentMediaRowScope;
}) {
  const text = useMediaText(), owner = useHyperDocumentOwner(), ownerKey = hyperDocumentOwnerKey(owner);
  let media: HyperDocumentMediaReference;
  try { media = hyperReadDocumentMedia(document, block); }
  catch (error) { return <Alert variant="warning" className="my-3"><AlertTitle>{text('unavailable')}</AlertTitle><AlertDescription>{errorText(error)}<span>{text('kept')}</span></AlertDescription></Alert>; }
  return <HyperResolvedDocumentMedia key={`${ownerKey}:${documentId}:${rowScope?.viewId}:${rowScope?.rowId}:${block.id}:${media.source}:${media.url}`} owner={owner} media={media} documentId={documentId} editable={editable} onRemove={onRemove} service={service} rowScope={rowScope} />;
}
function HyperResolvedDocumentMedia({ media, documentId, editable, onRemove, service: provided, rowScope, owner }: {
  owner: HyperDocumentOwner | null; media: HyperDocumentMediaReference; documentId: string; editable: boolean; onRemove?(): void; service?: HyperDocumentMediaService; rowScope?: HyperDocumentMediaRowScope;
}) {
  const text = useMediaText();
  const [service] = useState(() => provided ?? new HyperDocumentMediaService());
  const [src, setSrc] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false);
  const protectedRemote = media.source !== 'local' && hyperCloudAssetIsProtected(media.url), downloadOnly = media.source === 'cloud' || protectedRemote;
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    let current = true; const captured = hyperCaptureDuplicateOwner(owner); setError(null); setSrc(null);
    const valid = () => current && (!owner || !!captured?.isCurrent());
    if (media.kind === 'image') void service.preview(media).then(value => { if (valid()) setSrc(value); }).catch(error => { if (valid()) setError(errorText(error)); });
    return () => { current = false; };
  }, [service, media.url, media.source, media.kind, attempt, owner]);
  const open = async (download = false) => {
    if (operation.current) return;
    const controller = new AbortController(), captured = hyperCaptureDuplicateOwner(owner); operation.current = controller; setBusy(true); setError(null);
    try {
      if (owner && !captured?.isCurrent()) throw new Error(text('contextChanged'));
      await (download ? service.download(media, documentId, controller.signal, undefined, rowScope) : service.open(media, documentId, controller.signal, undefined, rowScope)); }
    catch (error) { if (!controller.signal.aborted && (!owner || captured?.isCurrent())) setError(errorText(error)); }
    finally { if (!controller.signal.aborted) { operation.current = null; setBusy(false); } }
  };
  return <figure data-hyper-media={media.id} className="my-3 rounded-lg border bg-background p-3">
    {media.kind === 'image' && <div className={cn('flex', media.align === 'left' ? 'justify-start' : media.align === 'right' ? 'justify-end' : 'justify-center')}>
      {src && !error ? <img referrerPolicy="no-referrer" src={src} alt={media.alt || media.caption || media.name} loading="lazy" className={cn('max-w-full rounded-md object-contain', !media.height && 'max-h-96')} style={media.width || media.height ? { width: media.width, height: media.height } : undefined} onError={() => setError(text('unavailable'))} /> : !error && <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Spinner />{text('loading')}</p>}
    </div>}
    <figcaption className="flex flex-wrap items-center gap-2">
      {media.kind === 'file' && <Paperclip className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 break-words text-sm">{media.kind === 'image' ? media.caption || media.name : media.name}</span>
      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`${downloadOnly ? text('download') : text('open')}: ${media.name}`} onClick={() => void open()}>{downloadOnly ? <Download /> : <ExternalLink />}</Button>
      {media.source === 'network' && !protectedRemote && <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`${text('download')}: ${media.name}`} onClick={() => void open(true)}><Download /></Button>}
      {editable && onRemove && <Button variant="ghost" size="icon-sm" aria-label={`${text('remove')}: ${media.name}`} onClick={onRemove}><Trash2 /></Button>}
    </figcaption>
    {error && <Alert variant="warning" className="mt-2"><AlertDescription>{error}{media.kind === 'image' && <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw />{text('retry')}</Button>}</AlertDescription></Alert>}
  </figure>;
}

export interface HyperDocumentMediaInsertProps {
  documentId: string;
  editable: boolean;
  /** Capture the insertion anchor before the dialog takes focus. */
  onPrepareInsert?(): void;
  /** Recheck permissions and the captured anchor, then await document session.flush(). */
  onInsert(media: HyperDocumentMediaReference): void | Promise<void>;
  service?: HyperDocumentMediaService;
  rowScope?: HyperDocumentMediaRowScope;
}
export function HyperDocumentMediaInsert({ documentId, editable, onPrepareInsert, onInsert, service: provided, rowScope }: HyperDocumentMediaInsertProps) {
  const text = useMediaText();
  const [service] = useState(() => provided ?? new HyperDocumentMediaService());
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<HyperDocumentMediaKind>('image'), [source, setSource] = useState<'local' | 'network'>('local');
  const [path, setPath] = useState(''), [url, setUrl] = useState(''), [name, setName] = useState(''), [caption, setCaption] = useState(''), [alt, setAlt] = useState('');
  const [identity, setIdentity] = useState<HyperDocumentMediaIdentity | null>(null), [prepared, setPrepared] = useState<HyperPreparedDocumentMedia | null>(null);
  const [error, setError] = useState<string | null>(null), [copied, setCopied] = useState(false);
  const rowKey = `${rowScope?.viewId ?? ''}:${rowScope?.rowId ?? ''}`;
  const operation = useRef<AbortController | null>(null), scope = useRef({ documentId, editable, rowKey });
  scope.current = { documentId, editable, rowKey };
  const cancel = () => { operation.current?.abort(); operation.current = null; };
  const current = (controller: AbortController) => operation.current === controller && !controller.signal.aborted;
  useEffect(() => {
    setOpen(false); setBusy(false); setLoading(false); setIdentity(null); setPrepared(null); setError(null);
    return cancel;
  }, [documentId, rowKey]);
  const writable = () => scope.current.documentId === documentId && scope.current.rowKey === rowKey && scope.current.editable;
  const load = async () => {
    cancel(); const controller = new AbortController(); operation.current = controller; setLoading(true); setError(null);
    try { const identity = await service.start(documentId, writable, controller.signal, rowScope); if (current(controller)) setIdentity(identity); }
    catch (error) { if (current(controller)) setError(errorText(error)); }
    finally { if (current(controller)) { setLoading(false); operation.current = null; } }
  };
  const changeOpen = (value: boolean) => {
    if (busy) return;
    if (!value) { cancel(); setOpen(false); return; }
    if (!writable()) return;
    setOpen(true); setPath(''); setUrl(''); setName(''); setCaption(''); setAlt(''); setKind('image'); setSource('local'); setPrepared(null); setCopied(false); setIdentity(null);
    try { onPrepareInsert?.(); } catch (error) { setLoading(false); setError(errorText(error)); return; }
    void load();
  };
  const choose = async () => {
    if (busy || !identity || !writable()) return;
    cancel(); const controller = new AbortController(); operation.current = controller; setBusy(true); setError(null);
    try {
      const paths = await window.appflowy.dialog.pickFiles({ title: text('choose'), multiple: false, ...(kind === 'image' ? { filters: [{ name: text('image'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'] }] } : {}) });
      await service.assertIdentity(identity, controller.signal);
      if (!writable()) throw new Error(text('contextChanged'));
      if (current(controller) && paths[0]) { setPath(paths[0]); setName(paths[0].split(/[\\/]/).at(-1) ?? ''); }
    } catch (error) { if (current(controller)) setError(errorText(error)); }
    finally { if (current(controller)) { setBusy(false); operation.current = null; } }
  };
  const insert = async () => {
    if (busy || loading || !identity || prepared || !writable()) return;
    cancel(); const controller = new AbortController(); operation.current = controller; setBusy(true); setError(null);
    let saved: HyperPreparedDocumentMedia | null = null;
    try {
      const values = { name, caption, alt }, options = { documentId, identity, writable, signal: controller.signal, rowScope };
      saved = await (source === 'local' ? service.prepareLocal(path, kind, values, options) : service.prepareNetwork(url, kind, values, options));
      if (!current(controller)) return;
      if (!writable()) throw new Error(text('contextChanged'));
      await service.assertIdentity(identity, controller.signal);
      if (!writable()) throw new Error(text('contextChanged'));
      await onInsert(saved.media);
      if (current(controller)) { setOpen(false); setBusy(false); cancel(); }
    } catch (error) {
      if (current(controller)) {
        const recovery = error instanceof HyperDocumentMediaPreparedError ? error.prepared : saved;
        setPrepared(recovery); setError(recovery ? text('saveFailed') : errorText(error));
      }
    } finally { if (current(controller)) { setBusy(false); operation.current = null; } }
  };
  const recover = async (copy: boolean) => {
    if (!prepared || busy) return;
    cancel(); const controller = new AbortController(); operation.current = controller; setBusy(true);
    try {
      await service.assertIdentity(prepared.identity, controller.signal);
      if (copy) { window.appflowy.clipboard.writeText(prepared.media.url); if (current(controller)) setCopied(true); }
      else await service.open(prepared.media, documentId, controller.signal, prepared.identity, rowScope);
    } catch (error) { if (current(controller)) setError(errorText(error)); }
    finally { if (current(controller)) { setBusy(false); operation.current = null; } }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!editable} />}><ImagePlus />{text('insert')}</DialogTrigger>
    <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{text('insert')}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}{prepared ? <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void recover(false)}><ExternalLink />{prepared.media.source === 'cloud' ? text('download') : text('open')}</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => void recover(true)}><Copy />{text('copy')}</Button>{copied && <span role="status">{text('copied')}</span>}</div> : !busy && !identity && <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />{text('retry')}</Button>}</AlertDescription></Alert>}
      <Field><FieldLabel>{text('kind')}</FieldLabel><Select value={kind} disabled={busy || !!prepared} onValueChange={value => { if (value === 'image' || value === 'file') { setKind(value); setPath(''); } }}><SelectTrigger className="w-full" aria-label={text('kind')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="image">{text('image')}</SelectItem><SelectItem value="file">{text('file')}</SelectItem></SelectContent></Select></Field>
      <Field><FieldLabel>{text('source')}</FieldLabel><Select value={source} disabled={busy || !!prepared} onValueChange={value => { if (value === 'local' || value === 'network') setSource(value); }}><SelectTrigger className="w-full" aria-label={text('source')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local">{text('local')}</SelectItem><SelectItem value="network">{text('network')}</SelectItem></SelectContent></Select></Field>
      {source === 'local' ? <div className="flex items-center gap-2"><Button variant="outline" disabled={busy || !identity || !!prepared || !editable} onClick={() => void choose()}><Upload />{text('choose')}</Button><span className="min-w-0 truncate text-sm text-muted-foreground">{path.split(/[\\/]/).at(-1)}</span></div> : <Field><FieldLabel>{text('url')}</FieldLabel><Input type="url" aria-label={text('url')} placeholder="https://" value={url} disabled={busy || !!prepared} onChange={event => setUrl(event.target.value)} /></Field>}
      <Field><FieldLabel>{text('name')}</FieldLabel><Input aria-label={text('name')} value={name} disabled={busy || !!prepared} onChange={event => setName(event.target.value)} /></Field>
      {kind === 'image' && <><Field><FieldLabel>{text('caption')}</FieldLabel><Input aria-label={text('caption')} value={caption} disabled={busy || !!prepared} onChange={event => setCaption(event.target.value)} /></Field><Field><FieldLabel>{text('alt')}</FieldLabel><Input aria-label={text('alt')} value={alt} disabled={busy || !!prepared} onChange={event => setAlt(event.target.value)} /></Field></>}
      {loading && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Spinner />{text('loading')}</p>}
      <Button className="justify-self-end" disabled={busy || loading || !!prepared || !identity || !editable || !(source === 'local' ? path : url.trim())} onClick={() => void insert()}>{busy ? <Spinner /> : <ImagePlus />}{busy ? text('working') : text('insertButton')}</Button>
    </DialogContent>
  </Dialog>;
}
