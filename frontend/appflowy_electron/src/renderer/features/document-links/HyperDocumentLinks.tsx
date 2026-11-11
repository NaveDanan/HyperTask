import { useEffect, useRef, useState } from 'react';
import { ArrowLeftToLine, Link, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import type { HyperTextRun } from '../document/HyperDocumentModel';
import { tabsActions } from '../tabs/tabs-store';
import { HyperDocumentLinkService, hyperPageMention, type HyperBacklinkProgress, type HyperLinkIdentity } from './HyperDocumentLinkService';

export const hyperDocumentLinkStrings = {
  insert: 'Link to page', backlinks: 'Backlinks', search: 'Search pages', choose: 'Choose a page to insert a link at the current selection.',
  scan: 'Scan workspace', scanning: 'Scanning pages…', scanHint: 'Scan accessible document pages for links to this page. Results reflect the content read during this scan.',
  noLinks: 'No backlinks found.', noPages: 'No pages match.', emptyTitle: 'Untitled', open: 'Open page', failed: 'Some pages could not be scanned. Results are incomplete.',
  progress: '{completed} / {total} pages scanned', matches: '{count} linked blocks', loading: 'Loading pages…', showMore: 'Show more',
} as const;
export interface HyperDocumentLinksProps {
  documentId: string;
  editable: boolean;
  onPrepareInsert?(): void;
  onInsert(runs: HyperTextRun[]): void | Promise<void>;
  onOpen?(view: ViewPB): void | Promise<void>;
}
export function HyperDocumentLinks({ documentId, editable, onPrepareInsert, onInsert, onOpen = view => tabsActions.openView(view) }: HyperDocumentLinksProps) {
  const { tr } = useTr();
  const t = (key: keyof typeof hyperDocumentLinkStrings, args?: Record<string, number>) => {
    const id = `hyperDocumentLinks.${key}`, translated = tr(id, { namedArgs: args });
    return translated === id ? Object.entries(args ?? {}).reduce<string>((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), hyperDocumentLinkStrings[key]) : translated;
  };
  const [service] = useState(() => new HyperDocumentLinkService());
  const [panel, setPanel] = useState<'links' | 'backlinks' | null>(null);
  const [pages, setPages] = useState<ViewPB[]>([]), [identity, setIdentity] = useState<HyperLinkIdentity | null>(null);
  const [query, setQuery] = useState(''), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(200);
  const [progress, setProgress] = useState<HyperBacklinkProgress | null>(null);
  const request = useRef<AbortController | null>(null);
  const cancel = () => { request.current?.abort(); request.current = null; };
  useEffect(() => () => cancel(), [documentId]);
  const current = (controller: AbortController) => request.current === controller && !controller.signal.aborted;
  const describe = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
  const load = async (kind: 'links' | 'backlinks') => {
    cancel();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); setProgress(null); setPages([]); setIdentity(null);
    try {
      if (kind === 'links') {
        const result = await service.pages(controller.signal);
        if (current(controller)) { setPages(result.views.filter(view => view.id !== documentId)); setIdentity(result.identity); }
      } else await service.backlinks(documentId, value => { if (current(controller)) setProgress(value); }, controller.signal);
    } catch (error) {
      if (current(controller)) { controller.abort(); setProgress(null); setError(describe(error)); }
    } finally { if (request.current === controller) setBusy(false); }
  };
  const changePanel = (kind: 'links' | 'backlinks', open: boolean) => {
    if (kind === 'links' && open) onPrepareInsert?.();
    cancel(); setPanel(open ? kind : null); setBusy(false); setError(null); setPages([]); setProgress(null); setIdentity(null);
    if (open && kind === 'links') void load(kind);
  };
  const insert = async (view: ViewPB) => {
    if (!editable || !identity || busy) return;
    cancel(); const controller = new AbortController(); request.current = controller; setBusy(true); setError(null);
    try {
      await service.insertTarget(view.id, identity, controller.signal);
      if (!current(controller)) return;
      await onInsert(hyperPageMention(view.id));
      if (current(controller)) changePanel('links', false);
    } catch (error) { if (current(controller)) { setPages([]); setIdentity(null); setError(describe(error)); } }
    finally { if (request.current === controller) setBusy(false); }
  };
  const open = async (view: ViewPB) => {
    cancel(); const controller = new AbortController(); request.current = controller; setError(null);
    try {
      const result = await service.pages(controller.signal);
      const latest = await service.insertTarget(view.id, result.identity, controller.signal);
      if (current(controller)) { await onOpen(latest); changePanel('backlinks', false); }
    } catch (error) { if (current(controller)) { setProgress(null); setError(describe(error)); } }
  };
  const visible = pages.filter(view => view.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <Dialog open={panel === 'links'} onOpenChange={open => changePanel('links', open)}>
      <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!editable} />}><Link />{t('insert')}</DialogTrigger>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t('insert')}</DialogTitle><DialogDescription>{t('choose')}</DialogDescription></DialogHeader>
        <Input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => { setQuery(event.target.value); setLimit(200); }} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {busy && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Spinner />{t('loading')}</p>}
        <div className="max-h-80 overflow-y-auto">{visible.slice(0, limit).map(view => <Button key={view.id} variant="ghost" className="w-full justify-start" disabled={busy || !editable} onClick={() => void insert(view)}><Link /><span className="truncate">{view.name || t('emptyTitle')}</span></Button>)}{visible.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 200)}>{t('showMore')}</Button>}{!busy && !visible.length && !error && <p className="text-sm text-muted-foreground">{t('noPages')}</p>}</div>
      </DialogContent>
    </Dialog>
    <Dialog open={panel === 'backlinks'} onOpenChange={open => changePanel('backlinks', open)}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}><ArrowLeftToLine />{t('backlinks')}</DialogTrigger>
      <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{t('backlinks')}</DialogTitle><DialogDescription>{t('scanHint')}</DialogDescription></DialogHeader>
        <Button variant="outline" className="self-start" disabled={busy} onClick={() => void load('backlinks')}><RefreshCw />{t('scan')}</Button>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {busy && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Spinner />{t('scanning')}</p>}
        {progress && <p aria-live="polite" className="text-xs text-muted-foreground">{t('progress', { completed: progress.completed, total: progress.total })}</p>}
        {!!progress?.failures.length && <Alert variant="warning"><AlertDescription>{t('failed')}<span>{progress.failures.length}</span></AlertDescription></Alert>}
        <div className="max-h-80 space-y-2 overflow-y-auto">{progress?.links.map(link => <div key={link.view.id} className="rounded-lg border p-3"><div className="flex items-center gap-2"><Button variant="link" className="min-w-0 flex-1 justify-start truncate px-0" aria-label={`${t('open')}: ${link.view.name}`} onClick={() => void open(link.view)}>{link.view.name || t('emptyTitle')}<SquareArrowOutUpRight /></Button><Badge variant="secondary" size="sm">{t('matches', { count: link.blockIds.length })}</Badge></div><p className="line-clamp-2 text-sm text-muted-foreground">{link.preview}</p></div>)}{progress && !busy && !progress.links.length && !progress.failures.length && <p className="text-sm text-muted-foreground">{t('noLinks')}</p>}</div>
      </DialogContent>
    </Dialog>
  </>;
}
