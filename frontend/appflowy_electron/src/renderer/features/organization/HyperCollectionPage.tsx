import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderSearch, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { listen, NotificationSource } from '@/backend/notifications';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { PluginContext } from '../plugins/registry';
import { tabsActions } from '../tabs/tabs-store';
import { nameOrDefault } from '../view/view-ext';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { isEditable, ShareAccessLevel } from '../view-header/page-access-level-store';
import { usePageAccessLevel, useViewPluginNotifier } from '../view-header/view-scope';
import { HyperCollectionEditor } from './HyperCollectionEditor';
import { hyperCollectionPages, hyperReadCollection, type HyperCollectionConfig } from './HyperCollectionModel';
import { useHyperCollectionText } from './HyperCollectionStrings';
import { hyperOrganizationService } from './HyperOrganizationService';
import { hyperOrganizationMetadata } from './HyperOrganizationModel';
import { hyperDocumentOwnerKey, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { useHyperOrganizationOwner } from './HyperOrganizationOwner';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';

export function HyperCollectionPage({ view, context }: { view: ViewPB; context: PluginContext }) {
  const workspace = useWorkspaceStore(state => state.currentWorkspace), owner = useHyperOrganizationOwner();
  if (!workspace || !owner || owner.workspaceId !== workspace.workspaceId || !owner.isCurrent()) return null;
  return <HyperCollectionContent key={`${hyperDocumentOwnerKey(owner)}:${view.id}`} view={view} context={context} workspaceId={workspace.workspaceId} owner={owner} />;
}
function HyperCollectionContent({ view, context, workspaceId, owner }: { view: ViewPB; context: PluginContext; workspaceId: string; owner: HyperDocumentOwner }) {
  const t = useHyperCollectionText(), access = usePageAccessLevel(), notifier = useViewPluginNotifier();
  const [current, setCurrent] = useState<ViewPB | null>(null), [pages, setPages] = useState<ViewPB[]>([]), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [limit, setLimit] = useState(100), [editing, setEditing] = useState(false);
  const [deleted, setDeleted] = useState(false), authoritative = useRef<ViewPB | null>(null), notifiedDeleted = useRef(false), plugin = useRef(context); plugin.current = context;
  const editable = !deleted && !!access && !access.isLoadingLockStatus && isEditable(access) && [ShareAccessLevel.fullAccess, ShareAccessLevel.readAndWrite].includes(access.accessLevel);
  useEffect(() => {
    let cancelled = false, revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      const request = ++revision;
      const active = () => !cancelled && owner.isCurrent() && request === revision;
      try {
        const [pages, trashed] = await Promise.all([hyperOrganizationService.pages(workspaceId, owner), hyperOrganizationService.isTrashed(workspaceId, view.id, owner)]);
        if (!active()) return;
        const latest = await hyperOrganizationService.page(workspaceId, view.id, owner);
        if (!active()) return;
        authoritative.current = latest;
        if (trashed) {
          const deletion = notifier?.isDeleted;
          if (!notifiedDeleted.current && deletion?.oneOfIndex.case === 'index') { notifiedDeleted.current = true; plugin.current.onDeleted?.(latest, deletion.oneOfIndex.value); }
          setDeleted(true); setCurrent(null); setPages([]); setError('This collection is in Trash. Restore it to open it again.'); return;
        }
        notifiedDeleted.current = false; setDeleted(false); setCurrent(latest); setPages(pages); setError(null);
      }
      catch (error) {
        if (!active()) return;
        const deletion = notifier?.isDeleted;
        if (authoritative.current && !notifiedDeleted.current && (error as { code?: ErrorCode })?.code === ErrorCode.RecordNotFound && deletion?.oneOfIndex.case === 'index') { notifiedDeleted.current = true; plugin.current.onDeleted?.(authoritative.current, deletion.oneOfIndex.value); }
        setCurrent(null); setPages([]); setEditing(false);
        setError((error as { msg?: string })?.msg ?? (error instanceof Error ? error.message : String(error)));
      }
      finally { if (active()) setLoading(false); }
    };
    void reload();
    const stop = listen(NotificationSource.Folder, () => { clearTimeout(timer); timer = setTimeout(() => { void reload(); }, 150); });
    return () => { cancelled = true; stop(); clearTimeout(timer); };
  }, [workspaceId, refresh, owner, view.id, notifier?.view, notifier?.isDeleted]);
  const result = useMemo(() => {
    try {
      if (!current) return { config: null, matches: [], error: null };
      const config = hyperReadCollection(current);
      if (!config) throw new Error('This page no longer contains a collection. Reopen it from the sidebar.');
      return { config, matches: hyperCollectionPages(pages, config, current.id), error: null };
    } catch (error) { return { config: null, matches: [], error: error instanceof Error ? error.message : String(error) }; }
  }, [current, pages]);
  if (!current) return <div className="flex min-h-0 flex-1 flex-col gap-4 p-8">{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{loading ? <Spinner /> : <Button variant="outline" className="self-start" onClick={() => setRefresh(value => value + 1)}><RefreshCw />{t('refresh')}</Button>}</div>;
  return <div className="mx-auto flex h-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6">
    <header className="flex flex-wrap items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-muted"><FolderSearch className="size-5 text-muted-foreground" /></span><div><h1 className="text-lg font-semibold">{nameOrDefault(current)}</h1><p className="text-xs text-muted-foreground">{t('count', { count: result.matches.length })}</p></div><Button variant="outline" size="sm" className="ml-auto" aria-label={t('refresh')} onClick={() => setRefresh(value => value + 1)}><RefreshCw /></Button><Button variant="outline" size="sm" disabled={!editable || !result.config} onClick={() => setEditing(true)}><SlidersHorizontal />{t('edit')}</Button></header>
    {(error || result.error) && <Alert variant="destructive"><AlertDescription>{error || result.error}</AlertDescription></Alert>}
    {loading && <Spinner />}
    {!loading && !result.matches.length && !result.error && <Empty><EmptyHeader><EmptyTitle>{t('empty')}</EmptyTitle><EmptyDescription>{t('emptyHelp')}</EmptyDescription></EmptyHeader></Empty>}
    <div className="divide-y rounded-lg border">{result.matches.slice(0, limit).map(page => <div key={page.id} className="flex items-center gap-3 px-3 py-2.5"><button type="button" className="min-w-0 flex-1 truncate rounded-md text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { if (owner.isCurrent()) tabsActions.openView(page); }}>{nameOrDefault(page)}</button><div className="flex flex-wrap gap-1">{hyperOrganizationMetadata(page).tags.map(tag => <Badge key={tag} size="sm" variant="secondary">{tag}</Badge>)}</div></div>)}</div>
    {result.matches.length > limit && <Button variant="outline" className="self-center" onClick={() => setLimit(value => value + 100)}>{t('showMore')}</Button>}
    {editing && result.config && <HyperEditCollectionDialog workspaceId={workspaceId} view={current} owner={owner} initial={result.config} editable={editable} onClose={() => setEditing(false)} onSaved={updated => { if (owner.isCurrent()) { setCurrent(updated); setEditing(false); } }} />}
  </div>;
}
function HyperEditCollectionDialog({ workspaceId, view, initial, editable, onClose, onSaved, owner }: { workspaceId: string; view: ViewPB; owner: HyperDocumentOwner; initial: HyperCollectionConfig; editable: boolean; onClose(): void; onSaved(view: ViewPB): void }) {
  const t = useHyperCollectionText(), [config, setConfig] = useState(initial), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!owner.isCurrent() || !editable || saving) return;
    setSaving(true); setError(null);
    try { const updated = await hyperOrganizationService.saveCollection(workspaceId, view.id, config, owner); if (owner.isCurrent()) onSaved(updated); }
    catch (error) { if (owner.isCurrent()) setError((error as { msg?: string })?.msg ?? (error instanceof Error ? error.message : String(error))); }
    finally { if (owner.isCurrent()) setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{t('edit')}</DialogTitle><DialogDescription>{nameOrDefault(view)}</DialogDescription></DialogHeader><HyperCollectionEditor value={config} onChange={setConfig} disabled={!editable || saving} />{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button disabled={!editable || saving} onClick={() => void save()}>{t('save')}</Button></DialogFooter></DialogContent></Dialog>;
}
