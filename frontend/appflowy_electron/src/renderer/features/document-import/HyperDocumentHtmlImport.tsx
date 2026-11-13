import { useEffect, useRef, useState } from 'react';
import { FileCode } from 'lucide-react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { HyperDocumentHtmlImporter, HyperHtmlImportWriteError, HyperHtmlThumbnailImportError, type HyperHtmlImportIdentity } from './HyperDocumentHtmlImporter';
import { hyperParseHtmlImport, type HyperHtmlImportResult } from './HyperDocumentHtmlParser';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { useAppStore } from '@/startup/app-store';

export const hyperDocumentHtmlImportStrings = {
  label: 'HTML / Notion HTML', title: 'Import HTML pages', description: 'Review the pages before importing. Each file creates a new page. Website layout and stylesheets are not reproduced.',
  choose: 'Choose HTML files', reading: 'Reading HTML…', review: 'Content to review', unsupported: 'Some content needs review',
  assets: 'Embedded bookmark thumbnails are copied when you import. Other images and attachments are kept as text references. Scripts, frames and external resources are never loaded during import.', copyRecovery: 'Copy import recovery details',
  name: 'Page title', blocks: '{count} blocks', issues: '{count} notices', imported: 'Imported', import: 'Import pages', close: 'Close', importing: 'Importing…',
  detailsLimit: 'Showing the first {count} notices.',
  failed: 'Import failed', unreadable: 'This file could not be read.', partial: 'Some pages may have been created. Check the sidebar before importing these files again.',
};
const errorText = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
interface HyperHtmlReview { path: string; filename: string; page: HyperHtmlImportResult; imported: boolean }
interface HyperHtmlImportProps { parentViewId: string; editable?: boolean; onImported(views: ViewPB[]): void; onClose?(): void }
export function HyperDocumentHtmlImport(props: HyperHtmlImportProps) {
  const owner = useHyperDocumentOwner(), launch = useAppStore(state => state.launchId);
  return <HyperOwnedDocumentHtmlImport key={JSON.stringify([hyperDocumentOwnerKey(owner), launch, props.parentViewId])} {...props} />;
}
function HyperOwnedDocumentHtmlImport({ parentViewId, editable = true, onImported, onClose }: HyperHtmlImportProps) {
  const { tr } = useTr();
  const owner = useHyperDocumentOwner(), ownerKey = hyperDocumentOwnerKey(owner), launch = useAppStore(state => state.launchId);
  const text = (key: keyof typeof hyperDocumentHtmlImportStrings, count?: number) => { const id = `hyperDocumentHtmlImport.${key}`, value = tr(id, { namedArgs: { count: count ?? 0 } }); return (value === id ? hyperDocumentHtmlImportStrings[key] : value).replaceAll('{count}', String(count ?? 0)); };
  const [importer] = useState(() => new HyperDocumentHtmlImporter());
  const [open, setOpen] = useState(false), [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<HyperHtmlReview[]>([]), [failures, setFailures] = useState<string[]>([]), [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState('');
  const identity = useRef<HyperHtmlImportIdentity | null>(null), generation = useRef(0), editableNow = useRef(editable);
  const destination = useRef(parentViewId);
  useEffect(() => { generation.current++; setOpen(false); setReading(false); setBusy(false); setReviews([]); setFailures([]); setError(null); setRecovery(''); identity.current = null; }, [ownerKey, launch]);
  editableNow.current = editable;
  useEffect(() => {
    if (destination.current !== parentViewId) {
      destination.current = parentViewId;
      setOpen(false); setReading(false); setBusy(false); setReviews([]); setFailures([]); setError(null); identity.current = null;
    }
    return () => { generation.current++; };
  }, [parentViewId]);
  const close = () => { if (!busy) { generation.current++; setOpen(false); onClose?.(); } };
  const choose = async () => {
    if (!editableNow.current || reading || busy) return;
    const version = ++generation.current; setReading(true); setError(null); setRecovery(''); setReviews([]); setFailures([]);
    try {
      const actor = await importer.identity();
      const paths = await window.appflowy.dialog.pickFiles({ filters: [{ name: 'HTML', extensions: ['html', 'htm'] }], multiple: true });
      if (version !== generation.current || !paths.length) return;
      identity.current = actor; setOpen(true);
      const prepared: HyperHtmlReview[] = [], failed: string[] = [];
      for (const path of paths) {
        if (version !== generation.current) return;
        const filename = path.split(/[\\/]/).at(-1) || path;
        try {
          const source = await window.appflowy.fs.readText(path);
          if (source === null) throw new Error(text('unreadable'));
          prepared.push({ path, filename, page: hyperParseHtmlImport(source, filename.replace(/\.[^.]+$/, '')), imported: false });
        } catch (error) { failed.push(`${filename}: ${errorText(error)}`); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (version === generation.current) { setReviews(prepared); setFailures(failed); }
    } catch (error) { if (version === generation.current) { setError(errorText(error)); setOpen(true); } }
    finally { if (version === generation.current) setReading(false); }
  };
  const save = async () => {
    if (!identity.current || !editableNow.current || busy || reading || error) return;
    setBusy(true); const version = generation.current, imported: ViewPB[] = [];
    try {
      for (const review of reviews) {
        if (review.imported) continue;
        if (version !== generation.current) return;
        const view = await importer.importPage(parentViewId, review.page, identity.current, () => version === generation.current && editableNow.current);
        imported.push(view);
        if (version === generation.current) setReviews(current => current.map(item => item.path === review.path ? { ...item, imported: true } : item));
      }
      if (version === generation.current) {
        const views = [...imported]; imported.length = 0; if (views.length) onImported(views);
        setBusy(false); setOpen(false); onClose?.();
      }
    } catch (error) { if (version === generation.current) { setError(`${error instanceof HyperHtmlImportWriteError || imported.length ? `${text('partial')} ` : ''}${errorText(error)}`); if (error instanceof HyperHtmlThumbnailImportError) setRecovery(error.details); } }
    finally { if (version === generation.current) { setBusy(false); if (imported.length) onImported(imported); } }
  };
  return <>
    <Item variant="outline" render={<button type="button" disabled={!editable || reading || busy} />} className="cursor-default hover:bg-accent" onClick={() => void choose()}><ItemMedia variant="icon">{reading ? <Spinner /> : <FileCode className="size-5 text-muted-foreground" />}</ItemMedia><ItemContent><ItemTitle>{text('label')}</ItemTitle></ItemContent></Item>
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent className="sm:max-w-2xl" showCloseButton={!busy} onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <DialogHeader><DialogTitle>{text('title')}</DialogTitle><DialogDescription>{text('description')}</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">{text('assets')}</p>
      {reading && <p role="status" className="flex items-center gap-2 text-sm"><Spinner />{text('reading')}</p>}
      {(error || failures.length > 0) && <Alert variant="destructive"><AlertTitle>{text('failed')}</AlertTitle><AlertDescription>{error}{failures.map(failure => <p key={failure}>{failure}</p>)}</AlertDescription></Alert>}
      <div className="max-h-96 space-y-4 overflow-y-auto" aria-label={text('review')}>{reviews.map(review => <section key={review.path} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap items-center gap-2"><span className="mr-auto break-all text-xs text-muted-foreground">{review.filename}</span><Badge variant="secondary" size="sm">{text('blocks', review.page.blockCount)}</Badge>{review.imported && <Badge variant="success-light" size="sm">{text('imported')}</Badge>}</div><Input aria-label={`${text('name')}: ${review.filename}`} value={review.page.title} maxLength={255} disabled={busy || review.imported} onChange={event => { const title = event.target.value; setReviews(current => current.map(item => item.path === review.path ? { ...item, page: { ...item.page, title } } : item)); }} />{review.page.issueCount > 0 && <Alert variant="warning"><AlertTitle>{text('unsupported')} <Badge variant="warning-light" size="sm">{text('issues', review.page.issueCount)}</Badge></AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-4">{review.page.issues.map((issue, index) => <li key={index} className="break-words">{issue.detail}</li>)}</ul>{review.page.issueCount > review.page.issues.length && <p>{text('detailsLimit', review.page.issues.length)}</p>}</AlertDescription></Alert>}</section>)}</div>
      <div className="flex flex-wrap justify-end gap-2">{recovery && <Button variant="outline" disabled={busy} onClick={() => { if (owner?.isCurrent()) window.appflowy.clipboard.writeText(recovery); }}>{text('copyRecovery')}</Button>}<Button variant="outline" disabled={busy} onClick={close}>{text('close')}</Button><Button disabled={!editable || busy || reading || !!error || !reviews.some(review => !review.imported) || reviews.some(review => !review.page.title.trim())} onClick={() => void save()}>{busy && <Spinner />}{busy ? text('importing') : text('import')}</Button></div>
    </DialogContent></Dialog>
  </>;
}
