import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Files, RefreshCw, Search, SearchX, Tags, SlidersHorizontal } from 'lucide-react';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { listen, NotificationSource } from '@/backend/notifications';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTr } from '@/i18n';
import { tabsActions } from '../tabs/tabs-store';
import { nameOrDefault } from '../view/view-ext';
import { HyperLayoutIcon } from '../plugins/PlaceholderPage';
import { isEditable } from '../view-header/page-access-level-store';
import { ViewScopeProvider, usePageAccessLevel } from '../view-header/view-scope';
import { useWorkspaceStore, workspaceRole } from '../sidebar/stores/workspace-store';
import {
  hyperFilterOrganizationPages, hyperIsJournalDate, hyperLocalJournalDate, hyperNormalizeTags,
  hyperOrganizationMetadata, type HyperOrganizationFilter,
} from './HyperOrganizationModel';
import { hyperOrganizationService } from './HyperOrganizationService';
import { HyperCreateCollectionDialog } from './HyperCreateCollectionDialog';
import { HyperPagePropertiesDialog } from './HyperPagePropertiesDialog';
import { hyperIsCollectionView } from './HyperCollectionModel';
import { useHyperCollectionText } from './HyperCollectionStrings';
import { hyperDocumentOwnerKey, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { useHyperOrganizationOwner } from './HyperOrganizationOwner';

const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
const PAGE_SIZE = 100;

export function HyperOrganizationPage() {
  const workspace = useWorkspaceStore(s => s.currentWorkspace);
  const owner = useHyperOrganizationOwner();
  if (!workspace || !owner || !owner.isCurrent() || owner.workspaceId !== workspace.workspaceId) return null;
  return <HyperWorkspaceOrganization key={hyperDocumentOwnerKey(owner)} owner={owner} workspaceId={workspace.workspaceId} readOnly={workspaceRole(workspace) === AFRolePB.Guest} />;
}

function HyperWorkspaceOrganization({ workspaceId, readOnly, owner }: { workspaceId: string; readOnly: boolean; owner: HyperDocumentOwner }) {
  const { tr } = useTr();
  const collectionText = useHyperCollectionText();
  const [creatingCollection, setCreatingCollection] = useState(false), [propertyView, setPropertyView] = useState<ViewPB | null>(null);
  const [pages, setPages] = useState<ViewPB[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<HyperOrganizationFilter>({ query: '', tag: null, journalsOnly: false, sort: 'edited' });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [journalDate, setJournalDate] = useState(hyperLocalJournalDate), [creatingJournal, setCreatingJournal] = useState(false);
  const [taggedView, setTaggedView] = useState<ViewPB | null>(null);
  useEffect(() => {
    let disposed = false, request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      const current = ++request;
      try {
        const result = await hyperOrganizationService.pages(workspaceId, owner);
        if (!disposed && owner.isCurrent() && current === request) { setPages(result); setError(null); }
      } catch (error) { if (!disposed && owner.isCurrent() && current === request) setError(errorText(error)); }
      finally { if (!disposed && owner.isCurrent() && current === request) setLoading(false); }
    };
    setLoading(true);
    void reload();
    const stop = listen<FolderNotification>(NotificationSource.Folder, (type, result) => {
      if (!result.ok || ![FolderNotification.DidUpdateView, FolderNotification.DidUpdateChildViews, FolderNotification.DidUpdateSectionViews, FolderNotification.DidUpdateTrash, FolderNotification.DidRestoreView, FolderNotification.DidDeleteView].includes(type)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void reload(); }, 150);
    });
    return () => { disposed = true; stop(); clearTimeout(timer); };
  }, [workspaceId, refreshKey, owner]);
  useEffect(() => setLimit(PAGE_SIZE), [filter]);
  const visible = useMemo(() => hyperFilterOrganizationPages(pages, filter), [pages, filter]);
  const tags = useMemo(() => hyperNormalizeTags(pages.flatMap(view => hyperOrganizationMetadata(view).tags)).sort((a, b) => a.localeCompare(b)), [pages]);
  const open = (view: ViewPB) => {
    if (owner.isCurrent()) tabsActions.openView(view);
  };
  const journal = async () => {
    if (!owner.isCurrent() || creatingJournal || readOnly || !hyperIsJournalDate(journalDate)) return;
    setCreatingJournal(true); setError(null);
    try {
      const section = useWorkspaceStore.getState().isCollabWorkspaceOn ? ViewSectionPB.Private : ViewSectionPB.Public;
      const userId = useWorkspaceStore.getState().userProfile?.id;
      const view = await hyperOrganizationService.ensureJournal(workspaceId, journalDate, section, userId === undefined ? undefined : String(userId), owner);
      if (!owner.isCurrent()) return;
      open(view);
      setRefreshKey(value => value + 1);
    } catch (error) { if (owner.isCurrent()) setError(errorText(error)); }
    finally { if (owner.isCurrent()) setCreatingJournal(false); }
  };
  const dateLabel = (value: bigint) => {
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
  };
  return <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6">
    <header className="flex flex-wrap items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted"><Files className="size-5 text-muted-foreground" /></span>
      <div><h1 className="text-lg font-semibold tracking-tight">{tr('hyperOrganization.title')}</h1><p className="text-xs text-muted-foreground">{tr('hyperOrganization.count', { namedArgs: { count: pages.length } })}</p></div>
      <Button variant="outline" size="sm" className="ml-auto" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />{tr('hyperOrganization.refresh')}</Button>
      <Button size="sm" disabled={readOnly || loading} onClick={() => setCreatingCollection(true)}>{collectionText('create')}</Button>
    </header>
    {error && <Alert variant="destructive"><AlertTitle>{tr('hyperOrganization.loadError')}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {pages.some(hyperIsCollectionView) && <div className="flex flex-wrap items-center gap-2" aria-label={collectionText('collections')}><span className="text-xs text-muted-foreground">{collectionText('collections')}</span>{pages.filter(hyperIsCollectionView).map(page => <Button key={page.id} size="sm" variant="outline" onClick={() => open(page)}>{nameOrDefault(page)}</Button>)}</div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={!filter.journalsOnly ? 'default' : 'outline'} size="sm" aria-pressed={!filter.journalsOnly} onClick={() => setFilter({ ...filter, journalsOnly: false })}>{tr('hyperOrganization.title')}</Button>
      <Button variant={filter.journalsOnly ? 'default' : 'outline'} size="sm" aria-pressed={filter.journalsOnly} onClick={() => setFilter({ ...filter, journalsOnly: true })}><CalendarDays />{tr('hyperOrganization.journals')}</Button>
      <InputGroup className="ml-auto w-64"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput aria-label={tr('hyperOrganization.search')} placeholder={tr('hyperOrganization.search')} value={filter.query} onChange={event => setFilter({ ...filter, query: event.target.value })} /></InputGroup>
      <Select value={filter.sort} onValueChange={value => { if (value) setFilter({ ...filter, sort: value as HyperOrganizationFilter['sort'] }); }}>
        <SelectTrigger size="sm" aria-label={tr('hyperOrganization.sort')}><SelectValue /></SelectTrigger>
        <SelectContent>{(['edited', 'name', 'created'] as const).map(sort => <SelectItem key={sort} value={sort}>{tr(`hyperOrganization.sort_${sort}`)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <form className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3" onSubmit={event => { event.preventDefault(); void journal(); }}>
      <CalendarDays className="size-4 text-muted-foreground" />
      <label className="text-sm" htmlFor={`hyper-journal-date-${workspaceId}`}>{tr('hyperOrganization.journalDate')}</label>
      <Input id={`hyper-journal-date-${workspaceId}`} type="date" className="w-auto" required value={journalDate} onChange={event => setJournalDate(event.target.value)} />
      <Button type="submit" size="sm" disabled={readOnly || creatingJournal || !hyperIsJournalDate(journalDate)}>{tr(creatingJournal ? 'hyperOrganization.openingJournal' : 'hyperOrganization.openJournal')}</Button>
    </form>
    {tags.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label={tr('hyperOrganization.tags')}>
      <Tags className="mr-1 size-4 text-muted-foreground" />
      <Button size="xs" variant={filter.tag === null ? 'secondary' : 'ghost'} aria-pressed={filter.tag === null} onClick={() => setFilter({ ...filter, tag: null })}>{tr('hyperOrganization.allTags')}</Button>
      {tags.map(tag => <Button key={tag.toLocaleLowerCase()} size="xs" variant={filter.tag?.toLocaleLowerCase() === tag.toLocaleLowerCase() ? 'secondary' : 'ghost'} aria-pressed={filter.tag?.toLocaleLowerCase() === tag.toLocaleLowerCase()} onClick={() => setFilter({ ...filter, tag })}>{tag}</Button>)}
    </div>}
    {loading && !pages.length ? <div className="grid gap-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div> : !visible.length ? <Empty><EmptyHeader><EmptyMedia variant="icon"><SearchX /></EmptyMedia><EmptyTitle>{tr('hyperOrganization.empty')}</EmptyTitle><EmptyDescription>{tr('hyperOrganization.emptyDescription')}</EmptyDescription></EmptyHeader></Empty> : <div className="rounded-lg border">
      <Table><TableHeader><TableRow><TableHead>{tr('hyperOrganization.page')}</TableHead><TableHead>{tr('hyperOrganization.tags')}</TableHead><TableHead>{tr('hyperOrganization.edited')}</TableHead><TableHead><span className="sr-only">{tr('hyperOrganization.editTags')}</span></TableHead></TableRow></TableHeader>
        <TableBody>{visible.slice(0, limit).map(view => {
          const metadata = hyperOrganizationMetadata(view), locked = view.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value;
          return <TableRow key={view.id}><TableCell><button type="button" className="flex max-w-96 items-center gap-2 rounded-md text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => open(view)}><HyperLayoutIcon layout={view.layout} /><span className="truncate">{nameOrDefault(view)}</span>{metadata.journalDate && <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />}</button></TableCell>
            <TableCell><div className="flex max-w-72 flex-wrap gap-1">{metadata.tags.map(tag => <Badge variant="secondary" size="sm" key={tag.toLocaleLowerCase()}>{tag}</Badge>)}</div></TableCell><TableCell className="text-xs text-muted-foreground">{dateLabel(view.lastEdited)}</TableCell>
            <TableCell><div className="flex gap-1"><Button variant="ghost" size="icon-sm" aria-label={tr('hyperOrganization.editTagsFor', { namedArgs: { name: nameOrDefault(view) } })} disabled={readOnly || locked} onClick={() => setTaggedView(view)}><Tags /></Button><Button variant="ghost" size="icon-sm" aria-label={collectionText('editProperties')} disabled={readOnly || locked} onClick={() => setPropertyView(view)}><SlidersHorizontal /></Button></div></TableCell></TableRow>;
        })}</TableBody></Table>
    </div>}
    {visible.length > limit && <Button variant="outline" className="self-center" onClick={() => setLimit(value => value + PAGE_SIZE)}>{tr('hyperOrganization.showMore')}</Button>}
    {taggedView && <ViewScopeProvider key={taggedView.id} view={taggedView} updateTabs={false}><HyperPageTagsDialog owner={owner} workspaceId={workspaceId} view={taggedView} onClose={() => setTaggedView(null)} onSaved={updated => { if (owner.isCurrent()) { setPages(pages => pages.map(page => page.id === updated.id ? updated : page)); setTaggedView(null); } }} /></ViewScopeProvider>}
    {propertyView && <ViewScopeProvider key={propertyView.id} view={propertyView} updateTabs={false}><HyperPagePropertiesDialog workspaceId={workspaceId} view={propertyView} onClose={() => setPropertyView(null)} onSaved={updated => setPages(pages => pages.map(page => page.id === updated.id ? updated : page))} /></ViewScopeProvider>}
    {creatingCollection && <HyperCreateCollectionDialog workspaceId={workspaceId} pages={pages} onClose={() => setCreatingCollection(false)} onCreated={view => { setCreatingCollection(false); setRefreshKey(value => value + 1); open(view); }} />}
  </div>;
}

function HyperPageTagsDialog({ workspaceId, view, onClose, onSaved, owner }: { workspaceId: string; view: ViewPB; owner: HyperDocumentOwner; onClose(): void; onSaved(view: ViewPB): void }) {
  const { tr } = useTr();
  const access = usePageAccessLevel();
  const editable = access !== null && !access.isLoadingLockStatus && isEditable(access);
  const [text, setText] = useState(() => hyperOrganizationMetadata(view).tags.join(', '));
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!owner.isCurrent() || saving || !editable) return;
    setSaving(true); setError(null);
    try { const updated = await hyperOrganizationService.setTags(workspaceId, view.id, text.split(','), owner); if (owner.isCurrent()) onSaved(updated); }
    catch (error) { if (owner.isCurrent()) setError(errorText(error)); }
    finally { if (owner.isCurrent()) setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{tr('hyperOrganization.editTags')}</DialogTitle><DialogDescription>{nameOrDefault(view)}</DialogDescription></DialogHeader>
    <form className="contents" onSubmit={event => { event.preventDefault(); void save(); }}><Field><FieldLabel htmlFor="hyper-page-tags">{tr('hyperOrganization.tags')}</FieldLabel><Input id="hyper-page-tags" autoFocus value={text} onChange={event => setText(event.target.value)} disabled={saving || !editable} /><FieldDescription>{tr('hyperOrganization.tagsHelp')}</FieldDescription></Field>
      {access && !access.isLoadingLockStatus && !editable && <p className="text-xs text-muted-foreground">{tr('hyperOrganization.readOnly')}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>{tr('button.cancel')}</Button><Button type="submit" disabled={saving || !editable}>{tr('button.save')}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
