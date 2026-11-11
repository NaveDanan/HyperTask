import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ArrowDownWideNarrow, Plus, RefreshCw, SquareArrowOutUpRight, Table2 } from 'lucide-react';
import { CalendarLayoutPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { DatabaseLayoutPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { SortConditionPB } from '@shared/protobuf/flowy-database2/sort_entities_pb';
import { CalculationType } from '@shared/protobuf/flowy-database2/calculation_entities_pb';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import type { GroupPB } from '@shared/protobuf/flowy-database2/group_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { nameOrDefault } from '../view/view-ext';
import type { PluginContext } from '../plugins/registry';
import { ShareAccessLevel, viewIsLocked } from '../view-header/page-access-level-store';
import { usePageAccessLevel, useViewPluginNotifier } from '../view-header/view-scope';
import { HyperRowDocument } from '../document/HyperRowDocument';
import { createHyperDatabaseStore, hyperDatabaseError, type HyperDatabaseStore } from './HyperDatabaseStore';
import { useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperDatabaseDraftOwnerKey, hyperDatabaseDrafts, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { HyperDatabaseDraftRecovery, useHyperDatabaseDraftRecords } from './HyperDatabaseDraftRecovery';
import { HyperDatabaseCell } from './HyperDatabaseCell';
import { HyperDatabaseFieldSettings, HyperRelationTarget } from './HyperDatabaseFieldSettings';
import { hyperDatabaseDateOptions, hyperDatabaseDateZone } from './HyperDatabaseDate';
import { HyperDatabaseDateFilters } from './HyperDatabaseDateFilters';
import { HyperDatabaseFilters, HyperDatabaseFilterGroups } from './HyperDatabaseFilters';
import { HyperDatabaseCalendarDay } from './HyperDatabaseCalendarDay';
import { HyperDatabaseCalendarSpanIndex } from './HyperDatabaseCalendarSpans';
import { hyperSelectOptions } from './HyperDatabaseCells';
import { HyperCalendarPeriodControls, useHyperCalendarPeriodText } from './HyperCalendarPeriodControls';
import { HyperCalendarPeriodError, hyperCalendarPeriodFrame, hyperCalendarPeriodSettingsEditable, hyperCalendarPeriodToday } from './HyperCalendarPeriodModel';
import { hyperUpdateCalendarPeriod, hyperUpdateCalendarWeekStart } from './HyperCalendarPeriodSettings';
import { HyperCalendarWeekStart, useHyperCalendarWeekStartText } from './HyperCalendarWeekStart';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import { HyperDatabaseWindowNavigation, HyperDatabaseWindowPending, useHyperDatabaseWindow, useHyperDatabaseWindowText } from './HyperDatabaseWindow';
import { hyperDatabaseWindowScope, hyperDatabaseWindowSizes } from './HyperDatabaseWindowModel';
import { HyperDatabaseRowDuplicateAction, HyperDatabaseRowDuplicateRecovery } from './HyperDatabaseRowDuplicate';
import { HyperDatabaseRowActivityProvider, HyperDatabaseRowActivityRows, HyperDatabaseRowActivityNotice } from './HyperDatabaseRowActivityView';

interface HyperDatabasePageProps { view: ViewPB; context: PluginContext; readOnly?: boolean }
export function HyperDatabasePage(props: HyperDatabasePageProps) {
  const owner = useHyperDocumentOwner(), text = useHyperDatabaseText();
  if (!owner?.isCurrent()) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />{text('loading')}</div>;
  return <HyperDatabaseOwnedPage key={JSON.stringify([props.view.id, hyperDatabaseDraftOwnerKey(owner)])} {...props} owner={owner} />;
}
function HyperDatabaseOwnedPage({ view, context, readOnly = false, owner }: HyperDatabasePageProps & { owner: HyperDatabaseDraftOwner }) {
  const store = useMemo(() => createHyperDatabaseStore(view.id), [view.id]);
  const state = useStore(store);
  const access = usePageAccessLevel(), notifier = useViewPluginNotifier();
  const [selectedRow, setSelectedRow] = useState<RowMetaPB | null>(null);
  const rowRequest = useRef(0);
  const [newField, setNewField] = useState(false);
  const pending = useRef(new Set<string>()), [localPendingCount, setPendingCount] = useState(0);
  const databaseId = state.snapshot?.database.id ?? '';
  const draftRecords = useHyperDatabaseDraftRecords(owner, databaseId);
  const pendingCount = localPendingCount + draftRecords.length;
  const hasPending = () => pending.current.size > 0 || hyperDatabaseDrafts.pending(owner, databaseId).length > 0;
  const reportPending = useCallback((id: string, value: boolean) => {
    if (pending.current.has(id) === value) return;
    if (value) pending.current.add(id); else pending.current.delete(id);
    setPendingCount(pending.current.size);
  }, []);
  const navigate = (operation: () => void) => { if (!hasPending()) operation(); };
  const text = useHyperDatabaseText();
  const windowText = useHyperDatabaseWindowText();
  useEffect(() => store.start(), [store]);
  useEffect(() => () => { rowRequest.current++; }, []);
  useEffect(() => {
    const deleted = notifier?.isDeleted;
    if (deleted?.oneOfIndex.case === 'index') context.onDeleted?.(notifier!.view, deleted.oneOfIndex.value);
  }, [notifier?.isDeleted]);
  const editable = !readOnly && !notifier?.isDeleted && (access ? !access.isLoadingLockStatus && !access.isLocked && [ShareAccessLevel.fullAccess, ShareAccessLevel.readAndWrite].includes(access.accessLevel) : !viewIsLocked(view));
  const snapshot = state.snapshot;
  const fieldMap = useMemo(() => new Map(snapshot?.fields.map(field => [field.id, field])), [snapshot?.fields]);
  const visibility = useMemo(() => new Map(snapshot?.fieldSettings.map(setting => [setting.fieldId, setting.visibility])), [snapshot?.fieldSettings]);
  const fields = snapshot?.fields.filter(field => field.isPrimary || visibility.get(field.id) !== FieldVisibility.AlwaysHidden) ?? [];
  const rows = snapshot?.database.rows ?? [];
  const queryScope = hyperDatabaseWindowScope(view.id, snapshot?.database.layoutType, snapshot?.settings.filters, snapshot?.settings.sorts, snapshot?.settings.groupSettings);
  const rowWindow = useHyperDatabaseWindow(rows, queryScope, hyperDatabaseWindowSizes.rows);
  const primary = fields.find(field => field.isPrimary);
  const propertyWindow = useHyperDatabaseWindow(fields.filter(field => field.id !== primary?.id), `${view.id}:properties`, hyperDatabaseWindowSizes.properties);
  const gridFields = primary ? [primary, ...propertyWindow.items] : propertyWindow.items;
  const groupWindow = useHyperDatabaseWindow(state.groups.filter(group => group.isVisible), queryScope, hyperDatabaseWindowSizes.groups);
  const detailWindow = useHyperDatabaseWindow(snapshot?.fields ?? [], `${view.id}:${selectedRow?.id ?? ''}`, hyperDatabaseWindowSizes.detailProperties);
  const noGroup = text('noGroup');
  const groupNames = useMemo(() => {
    const options = new Map<string, Map<string, string>>();
    const fields = new Map(snapshot?.fields.map(field => [field.id, field]));
    return new Map(state.groups.map(group => {
      const field = fields.get(group.fieldId);
      if (field && !options.has(field.id)) {
        try { options.set(field.id, new Map(hyperSelectOptions(field).map(option => [option.id, option.name]))); }
        catch { options.set(field.id, new Map()); }
      }
      return [group.groupId, group.isDefault ? noGroup : field?.fieldType === FieldType.Checkbox ? group.groupId === 'Yes' ? '✓' : '○' : options.get(group.fieldId)?.get(group.groupId) ?? group.groupId];
    }));
  }, [state.groups, snapshot?.fields, noGroup]);
  const saved = () => { void store.refresh(); };
  const cell = (rowId: string, fieldId: string, allowEdit = editable) => {
    const field = fieldMap.get(fieldId);
    return field ? <HyperDatabaseCell key={`${rowId}:${fieldId}`} repository={store.repository} viewId={view.id} rowId={rowId} field={field} editable={allowEdit && !!owner} revision={state.cellRevision} onSaved={saved} onPendingChange={reportPending} draftScope={owner && databaseId ? { owner, databaseId } : undefined} /> : null;
  };
  const openRow = (row: RowMetaPB) => {
    const scope = hyperCaptureDuplicateOwner(owner);
    if (!scope?.isCurrent() || hasPending()) return;
    const request = ++rowRequest.current;
    const current = () => scope.isCurrent() && request === rowRequest.current && store.getState().snapshot?.database.id === databaseId;
    // Bulk database rows may contain only IDs. Read the body binding before opening.
    void store.repository.rowMetadata(view.id, row.id).then(fresh => {
      if (!current() || hasPending()) return;
      if (fresh.id !== row.id) throw new Error('The requested row is no longer available.');
      setSelectedRow(fresh);
    }).catch(error => { if (current()) store.setState({ error: hyperDatabaseError(error) }); });
  };
  const copiedRow = async (row: RowMetaPB, scope: HyperDatabaseDraftOwner) => { if (!scope.isCurrent()) return; const request = ++rowRequest.current; await store.refresh(); if (scope.isCurrent() && request === rowRequest.current && !hasPending()) setSelectedRow(row); };
  if (state.loading) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />{text('loading')}</div>;
  return <HyperDatabaseRowActivityProvider owner={owner} databaseId={databaseId} viewId={view.id} contextId={snapshot?.database.rowActivityContext ?? ''} backend={store.repository} activated={() => store.setState(value => ({ cellRevision: value.cellRevision + 1 }))} refreshContext={async () => {
    if (!owner.isCurrent()) throw new Error('The dataset owner changed.');
    await store.refresh();
    if (!owner.isCurrent()) throw new Error('The dataset owner changed.');
    return store.getState().snapshot?.database.rowActivityContext ?? '';
  }}><div className="flex h-full min-h-0 flex-col gap-4 px-8 pb-6">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="mr-auto text-lg font-semibold tracking-tight">{nameOrDefault(notifier?.view ?? view)}</h1>
      {snapshot && <><Select value={String(snapshot.database.layoutType)} disabled={!editable || state.writing || pendingCount > 0} onValueChange={layout => { if (layout !== null && !hasPending()) void store.write(() => store.repository.layout(view.id, Number(layout))); }}><SelectTrigger aria-label={text('layout')}><SelectValue /></SelectTrigger><SelectContent>{[DatabaseLayoutPB.Grid, DatabaseLayoutPB.Board, DatabaseLayoutPB.Calendar].map(layout => <SelectItem key={layout} value={String(layout)}>{text(layout === DatabaseLayoutPB.Grid ? 'grid' : layout === DatabaseLayoutPB.Board ? 'board' : 'calendar')}</SelectItem>)}</SelectContent></Select><HyperDatabaseControls store={store} owner={owner} canWrite={editable && !pendingCount} editable={editable && !state.writing && !pendingCount} /><Button variant="outline" size="sm" disabled={!editable || state.writing} onClick={() => setNewField(true)}><Plus />{text('addField')}</Button></>}
      <Button variant="ghost" size="icon-sm" aria-label={text('retry')} disabled={state.writing} onClick={() => void store.refresh()}><RefreshCw /></Button>
      <Button size="sm" disabled={!editable || state.writing || !snapshot} onClick={() => { void store.write(() => store.repository.createRow(view.id)); }}><Plus />{text('addRow')}</Button>
    </div>
    {!editable && <p className="text-xs text-muted-foreground">{text('readOnly')}</p>}
    <HyperDatabaseRowActivityNotice />
    <HyperDatabaseWindowPending visible={pendingCount > 0} />
    {owner && databaseId && <HyperDatabaseDraftRecovery owner={owner} databaseId={databaseId} repository={store.repository} viewId={view.id} editable={editable} saved={saved} records={draftRecords} />}
    {databaseId && <HyperDatabaseRowDuplicateRecovery owner={owner} databaseId={databaseId} viewId={view.id} editable={editable} hasPending={hasPending} onCopied={copiedRow} />}
    {state.error && <Alert variant="destructive"><AlertTitle>{text('error')}</AlertTitle><AlertDescription>{state.error}</AlertDescription><Button variant="outline" size="sm" onClick={() => { store.clearError(); void store.refresh(); }}>{text('retry')}</Button></Alert>}
    {snapshot && <>
      {snapshot.database.layoutType === DatabaseLayoutPB.Grid && <>
        <HyperDatabaseRowActivityRows rowIds={rowWindow.items.map(row => row.id)} />
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <Table className="w-max min-w-full"><TableHeader><TableRow><TableHead className="w-10"><span className="sr-only">{text('openRow')}</span></TableHead>{gridFields.map(field => <TableHead key={field.id} className="min-w-40 text-xs font-medium"><HyperDatabaseFieldSettings store={store} field={field} editable={editable} /></TableHead>)}<TableHead><Button size="sm" variant="ghost" disabled={!editable || state.writing} onClick={() => setNewField(true)}><Plus />{text('addField')}</Button></TableHead></TableRow></TableHeader>
            <TableBody>{rowWindow.items.map(row => <TableRow key={row.id}><TableCell className="p-1"><Button variant="ghost" size="icon-xs" aria-label={`${text('openRow')} ${row.id}`} onClick={() => openRow(row)}><SquareArrowOutUpRight /></Button></TableCell>{gridFields.map(field => <TableCell key={field.id} className="p-0 align-top">{cell(row.id, field.id)}</TableCell>)}<TableCell /></TableRow>)}</TableBody>
            <TableFooter><TableRow><TableCell />{gridFields.map(field => {
              const calculation = snapshot.calculations.find(item => item.fieldId === field.id);
              const choices = field.fieldType === FieldType.Number ? [CalculationType.Count, CalculationType.Sum, CalculationType.Average, CalculationType.Min, CalculationType.Max, CalculationType.Median, CalculationType.CountEmpty, CalculationType.CountNonEmpty] : [CalculationType.Count, CalculationType.CountEmpty, CalculationType.CountNonEmpty];
              return <TableCell key={field.id} className="p-1"><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="w-full justify-end font-normal text-muted-foreground" disabled={!editable || state.writing} />}>{calculation ? `${CalculationType[calculation.calculationType]}: ${calculation.value}` : text('calculate')}</DropdownMenuTrigger><DropdownMenuContent>{choices.map(type => <DropdownMenuItem key={type} onClick={() => { void store.write(() => store.repository.calculate(view.id, field.id, type, calculation?.id)); }}>{CalculationType[type]}</DropdownMenuItem>)}{calculation && <DropdownMenuItem onClick={() => { void store.write(() => store.repository.removeCalculation(view.id, field.id, calculation.id)); }}>{text('noCalculation')}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></TableCell>;
            })}<TableCell /></TableRow></TableFooter>
          </Table>
          {!rows.length && <HyperDatabaseEmpty />}
        </div>
        <HyperDatabaseWindowNavigation window={propertyWindow} label={windowText(primary ? 'additionalProperties' : 'properties')} disabled={!!pendingCount} onPage={page => navigate(() => propertyWindow.setPage(page))} />
        <HyperDatabaseWindowNavigation window={rowWindow} label={windowText('rows')} hideSingle={false} disabled={!!pendingCount} onPage={page => navigate(() => rowWindow.setPage(page))} />
      </>}
      {snapshot.database.layoutType === DatabaseLayoutPB.Board && <>
        <div className="min-h-0 flex-1 overflow-auto"><div className="flex min-h-full items-start gap-4">{groupWindow.items.map(group => <HyperBoardColumn key={`${queryScope}:${group.fieldId}:${group.groupId}`} title={groupNames.get(group.groupId) ?? group.groupId} rows={group.rows} scope={`${queryScope}:${group.groupId}`} disabledNavigation={!!pendingCount} onOpen={openRow} cell={cell} primaryId={primary?.id} actions={row => <HyperBoardMove store={store} rowId={row.id} fromGroupId={group.groupId} groups={state.groups} names={groupNames} editable={editable && !state.writing} />} footer={<Button variant="ghost" size="sm" className="w-full justify-start" disabled={!editable || state.writing} onClick={() => { void store.write(() => store.repository.createRow(view.id, group.groupId)); }}><Plus />{text('addRow')}</Button>} />)}{!groupWindow.total && <HyperDatabaseEmpty />}</div>{state.groups.some(group => !group.isVisible) && <p className="py-2 text-xs text-muted-foreground">{text('hiddenGroups')}: {state.groups.filter(group => !group.isVisible).length}</p>}</div>
        <HyperDatabaseWindowNavigation window={groupWindow} label={windowText('groups')} disabled={!!pendingCount} onPage={page => navigate(() => groupWindow.setPage(page))} />
      </>}
      {snapshot.database.layoutType === DatabaseLayoutPB.Calendar && <HyperCalendar key={view.id} store={store} owner={owner} editable={editable} hasPending={hasPending} onOpen={openRow} />}
    </>}
    <HyperNewField store={store} open={newField} setOpen={setNewField} />
    <Dialog open={selectedRow !== null} onOpenChange={open => { if (!open && !hasPending()) { rowRequest.current++; setSelectedRow(null); } }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{text('rowDetails')}</DialogTitle><DialogDescription>{nameOrDefault(view)}</DialogDescription></DialogHeader>{selectedRow && <><HyperDatabaseRowActivityRows rowIds={[selectedRow.id]} /><HyperDatabaseRowDuplicateAction owner={owner} databaseId={databaseId} viewId={view.id} rowId={selectedRow.id} editable={editable && !state.writing} hasPending={hasPending} onCopied={copiedRow} /><HyperDatabaseWindowPending visible={pendingCount > 0} />{detailWindow.items.map(field => <div key={field.id} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-start gap-4"><HyperDatabaseFieldSettings store={store} field={field} editable={editable} />{cell(selectedRow.id, field.id)}</div>)}<HyperDatabaseWindowNavigation window={detailWindow} label={windowText('properties')} disabled={!!pendingCount} onPage={page => navigate(() => detailWindow.setPage(page))} /><HyperRowDocument key={selectedRow.id} row={selectedRow} viewId={view.id} editable={editable} /></>}</DialogContent></Dialog>
  </div></HyperDatabaseRowActivityProvider>;
}
function HyperDatabaseEmpty() {
  const text = useHyperDatabaseText();
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><Table2 /></EmptyMedia><EmptyTitle>{text('empty')}</EmptyTitle><EmptyDescription>{text('emptyDescription')}</EmptyDescription></EmptyHeader></Empty>;
}
function HyperBoardColumn({ title, rows, scope, disabledNavigation, primaryId, cell, onOpen, actions, footer }: { title: string; rows: RowMetaPB[]; scope: string; disabledNavigation: boolean; primaryId?: string; cell(rowId: string, fieldId: string, editable?: boolean): React.ReactNode; onOpen(row: RowMetaPB): void; actions(row: RowMetaPB): React.ReactNode; footer: React.ReactNode }) {
  const text = useHyperDatabaseText(), windowText = useHyperDatabaseWindowText();
  const window = useHyperDatabaseWindow(rows, scope, hyperDatabaseWindowSizes.cards);
  return <section className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-3"><HyperDatabaseRowActivityRows rowIds={window.items.map(row => row.id)} /><h2 className="flex items-center gap-2 px-1 text-sm font-medium">{title}<Badge size="sm" variant="secondary">{rows.length}</Badge></h2>{window.items.map(row => <div key={row.id} className="rounded-lg border bg-card p-2">{primaryId && cell(row.id, primaryId, false)}<div className="mt-2 flex justify-between gap-1"><Button size="sm" variant="ghost" onClick={() => onOpen(row)}>{text('openRow')}</Button>{actions(row)}</div></div>)}<HyperDatabaseWindowNavigation window={window} label={windowText('cards', { title })} compact disabled={disabledNavigation} onPage={window.setPage} />{footer}</section>;
}

function HyperBoardMove({ store, rowId, fromGroupId, groups, names, editable }: { store: HyperDatabaseStore; rowId: string; fromGroupId: string; groups: GroupPB[]; names: Map<string, string>; editable: boolean }) {
  const text = useHyperDatabaseText(), windowText = useHyperDatabaseWindowText();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  // Closed cards allocate no target controls, including on boards with many groups.
  const choices = open ? groups.filter(group => group.isVisible && group.groupId !== fromGroupId && (names.get(group.groupId) ?? group.groupId).toLocaleLowerCase().includes(query.toLocaleLowerCase())) : [];
  const window = useHyperDatabaseWindow(choices, `${fromGroupId}:${query}`, hyperDatabaseWindowSizes.moveTargets);
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setQuery(''); }}><PopoverTrigger render={<Button variant="ghost" size="sm" disabled={!editable} />}>{text('moveCard')}</PopoverTrigger><PopoverContent>
    <Input aria-label={windowText('searchGroups')} placeholder={windowText('searchGroups')} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="max-h-64 overflow-y-auto">{window.items.map(group => <Button key={group.groupId} variant="ghost" size="sm" className="w-full justify-start" disabled={!editable} onClick={() => { if (editable) { setOpen(false); void store.write(() => store.repository.moveCard(store.viewId, rowId, fromGroupId, group.groupId)); } }}>{names.get(group.groupId) ?? group.groupId}</Button>)}</div>
    <HyperDatabaseWindowNavigation window={window} label={windowText('targets')} compact onPage={window.setPage} />
  </PopoverContent></Popover>;
}
function HyperNewField({ store, open, setOpen }: { store: HyperDatabaseStore; open: boolean; setOpen(open: boolean): void }) {
  const text = useHyperDatabaseText(), [name, setName] = useState(''), [type, setType] = useState<FieldType>(FieldType.RichText), [relatedDatabaseId, setRelatedDatabaseId] = useState('');
  const writing = useStore(store, state => state.writing);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{text('addField')}</DialogTitle></DialogHeader><form className="flex flex-col gap-4" onSubmit={event => {
    event.preventDefault(); if (!name.trim() || (type === FieldType.Relation && !relatedDatabaseId)) return;
    void store.write(() => store.repository.createField(store.viewId, name.trim(), type, relatedDatabaseId)).then(field => { if (field) { setOpen(false); setName(''); } });
  }}><label className="flex flex-col gap-2 text-sm">{text('fieldName')}<Input required autoFocus value={name} onChange={event => setName(event.target.value)} /></label><label className="flex flex-col gap-2 text-sm">{text('fieldType')}<Select value={String(type)} onValueChange={value => { if (value !== null) setType(Number(value)); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[FieldType.RichText, FieldType.Number, FieldType.Checkbox, FieldType.DateTime, FieldType.URL, FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checklist, FieldType.Relation, FieldType.Media, FieldType.CreatedTime, FieldType.LastEditedTime, FieldType.Summary, FieldType.Translate].map(type => <SelectItem value={String(type)} key={type}>{FieldType[type]}</SelectItem>)}</SelectContent></Select></label>{type === FieldType.Relation && <HyperRelationTarget repository={store.repository} value={relatedDatabaseId} disabled={writing} onChange={setRelatedDatabaseId} />}<div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setOpen(false)}>{text('cancel')}</Button><Button type="submit" disabled={writing || !name.trim() || (type === FieldType.Relation && !relatedDatabaseId)}>{text('save')}</Button></div></form></DialogContent></Dialog>;
}

function HyperDatabaseControls({ store, owner, editable, canWrite }: { store: HyperDatabaseStore; owner: HyperDatabaseDraftOwner; editable: boolean; canWrite: boolean }) {
  const state = useStore(store), snapshot = state.snapshot!, text = useHyperDatabaseText();
  const filters = snapshot.settings.filters?.items ?? [];
  return <>
    <Popover><PopoverTrigger render={<Button variant="outline" size="sm" />}>{text('filter')}<Badge variant="secondary" size="sm">{filters.length}</Badge></PopoverTrigger><PopoverContent className="max-h-[80vh] w-80 overflow-y-auto">
      <HyperDatabaseFilterGroups store={store} owner={owner} editable={editable} canWrite={canWrite} />
      <HyperDatabaseFilters store={store} owner={owner} editable={editable} canWrite={canWrite} />
      <HyperDatabaseDateFilters store={store} owner={owner} editable={editable} canWrite={canWrite} />
    </PopoverContent></Popover>
    <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><ArrowDownWideNarrow />{text('sort')}</DropdownMenuTrigger><DropdownMenuContent>{snapshot.fields.flatMap(field => [SortConditionPB.Ascending, SortConditionPB.Descending].map(condition => <DropdownMenuItem key={`${field.id}:${condition}`} disabled={!editable} onClick={() => {
      const existing = snapshot.settings.sorts?.items.find(sort => sort.fieldId === field.id);
      void store.write(() => store.repository.setting({ viewId: store.viewId, oneOfUpdateSort: { case: 'updateSort', value: { viewId: store.viewId, fieldId: field.id, condition, ...(existing ? { oneOfSortId: { case: 'sortId', value: existing.id } } : {}) } } }));
    }}>{field.name} · {text(condition === SortConditionPB.Ascending ? 'ascending' : 'descending')}</DropdownMenuItem>))}{snapshot.settings.sorts?.items.map(sort => <DropdownMenuItem key={sort.id} disabled={!editable} onClick={() => { void store.write(() => store.repository.setting({ viewId: store.viewId, oneOfDeleteSort: { case: 'deleteSort', value: { viewId: store.viewId, sortId: sort.id } } })); }}>{text('clearSort')} · {snapshot.fields.find(field => field.id === sort.fieldId)?.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <Popover><PopoverTrigger render={<Button size="sm" variant="outline" />}>{text('properties')}</PopoverTrigger><PopoverContent>{snapshot.fields.map(field => <label key={field.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"><Checkbox checked={field.isPrimary || snapshot.fieldSettings.find(setting => setting.fieldId === field.id)?.visibility !== FieldVisibility.AlwaysHidden} disabled={!editable || field.isPrimary} onCheckedChange={checked => { void store.write(() => store.repository.fieldVisibility(store.viewId, field.id, checked === true)); }} />{field.name}</label>)}</PopoverContent></Popover>
    {snapshot.database.layoutType === DatabaseLayoutPB.Board && <Popover><PopoverTrigger render={<Button size="sm" variant="outline" />}>{text('group')}</PopoverTrigger><PopoverContent><Select disabled={!editable} value={snapshot.settings.groupSettings?.items[0]?.fieldId ?? ''} onValueChange={fieldId => { if (fieldId) void store.write(() => store.repository.groupBy(store.viewId, fieldId)); }}><SelectTrigger aria-label={text('group')}><SelectValue /></SelectTrigger><SelectContent>{snapshot.fields.filter(field => [FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox].includes(field.fieldType)).map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">{text('hiddenGroups')}</p>{state.groups.map(group => {
      const field = snapshot.fields.find(field => field.id === group.fieldId);
      let label = group.isDefault ? text('noGroup') : group.groupId;
      try { label = field && hyperSelectOptions(field).find(option => option.id === group.groupId)?.name || label; } catch { /* Preserve unsupported group ids. */ }
      return <label key={group.groupId} className="flex items-center gap-2 p-1 text-sm"><Checkbox disabled={!editable} checked={group.isVisible} onCheckedChange={checked => { void store.write(() => store.repository.showGroup(store.viewId, group.groupId, checked === true)); }} />{label}</label>;
    })}</PopoverContent></Popover>}
  </>;
}

function HyperCalendar({ store, owner, editable, hasPending, onOpen }: { store: HyperDatabaseStore; owner: HyperDatabaseDraftOwner; editable: boolean; hasPending(): boolean; onOpen(row: RowMetaPB): void }) {
  const state = useStore(store), text = useHyperDatabaseText(), windowText = useHyperDatabaseWindowText();
  const periodText = useHyperCalendarPeriodText(), weekStartText = useHyperCalendarWeekStartText(), latest = useRef({ editable, hasPending }); latest.current = { editable, hasPending };
  const calendarSetting = state.snapshot!.settings.layoutSetting?.oneOfCalendar;
  const setting = calendarSetting?.case === 'calendar' ? calendarSetting.value : null;
  const selectedField = setting?.fieldId ?? '';
  let dateZone = 'UTC';
  try { const field = state.snapshot!.fields.find(field => field.id === selectedField); if (field) dateZone = hyperDatabaseDateZone(hyperDatabaseDateOptions(field.typeOptionData).timezoneId); } catch { /* Invalid field settings stay unchanged. */ }
  const [anchorDay, setAnchorDay] = useState(() => hyperCalendarPeriodToday(dateZone));
  const period = useMemo(() => { try { return hyperCalendarPeriodFrame(anchorDay, setting?.layoutTy ?? CalendarLayoutPB.MonthLayout, setting?.firstDayOfWeek ?? 0); } catch { return null; } }, [anchorDay, setting?.layoutTy, setting?.firstDayOfWeek]);
  const days = useMemo(() => period?.days ?? [], [period]);
  const spans = useMemo(() => new HyperDatabaseCalendarSpanIndex(state.calendar.events, event => event.rowMeta && event.oneOfTimestamp.case === 'timestamp' ? { start: event.oneOfTimestamp.value, end: event.oneOfEndTimestamp.value, includeTime: event.includeTime } : {}, days, dateZone), [state.calendar.events, days, dateZone]);
  const scope = hyperDatabaseWindowScope(store.viewId, state.snapshot!.database.layoutType, state.snapshot!.settings.filters, state.snapshot!.settings.sorts, [selectedField, dateZone]);
  const undated = useHyperDatabaseWindow(state.calendar.undated, scope, hyperDatabaseWindowSizes.undated);
  const changePeriod = (layout: CalendarLayoutPB) => {
    const captured = hyperCaptureDuplicateOwner(owner), source = setting, databaseId = state.snapshot!.database.id;
    const current = () => !!captured?.isCurrent() && latest.current.editable && !latest.current.hasPending() && store.getState().snapshot?.database.id === databaseId;
    if (!source || !current()) return;
    void store.write(async () => {
      try { await hyperUpdateCalendarPeriod(store.viewId, databaseId, source, layout, captured!, current); }
      catch (error) { throw new Error(error instanceof HyperCalendarPeriodError ? periodText(error.reason) : hyperDatabaseError(error)); }
    });
  };
  const changeWeekStart = (firstDay: 0 | 1) => {
    const captured = hyperCaptureDuplicateOwner(owner), source = setting, databaseId = state.snapshot!.database.id;
    const current = () => {
      const latestState = store.getState(), layout = latestState.snapshot?.settings.layoutSetting?.oneOfCalendar;
      return !!captured?.isCurrent() && latest.current.editable && !latest.current.hasPending() && latestState.snapshot?.database.id === databaseId && layout?.case === 'calendar' && [CalendarLayoutPB.WeekLayout, CalendarLayoutPB.MonthLayout].includes(layout.value.layoutTy);
    };
    if (!source || !current()) return;
    void store.write(async () => {
      try { await hyperUpdateCalendarWeekStart(store.viewId, databaseId, source, firstDay, captured!, current); }
      catch (error) { throw new Error(error instanceof HyperCalendarPeriodError ? weekStartText(error.reason === 'invalidDate' ? 'changed' : error.reason) : hyperDatabaseError(error)); }
    });
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto"><HyperDatabaseRowActivityRows rowIds={undated.items.map(event => event.rowId)} />
    <div className="flex flex-wrap items-center gap-2"><HyperCalendarPeriodControls anchorDay={anchorDay} setting={setting} timezoneId={dateZone} editable={editable && !hasPending()} writing={state.writing} onAnchorChange={setAnchorDay} onLayoutChange={changePeriod} /><HyperCalendarWeekStart setting={setting} editable={editable && !hasPending()} writing={state.writing} onChange={changeWeekStart} /><Select value={selectedField} disabled={!editable || state.writing || !!setting && !hyperCalendarPeriodSettingsEditable(setting)} onValueChange={fieldId => { if (fieldId) void store.write(() => store.repository.calendarField(store.viewId, fieldId, state.snapshot!.settings)); }}><SelectTrigger aria-label={text('dateField')}><SelectValue /></SelectTrigger><SelectContent>{state.snapshot!.fields.filter(field => field.fieldType === FieldType.DateTime).map(field => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent></Select></div>
    {!selectedField && <p className="text-sm text-muted-foreground">{text('noCalendarField')}</p>}
    <div role="grid" aria-label={text('calendar')} data-hyper-calendar-layout={period?.kind ?? 'unsupported'} className={period?.columns === 1 ? 'grid grid-cols-1 rounded-lg border' : 'grid min-w-3xl grid-cols-7 rounded-lg border'}>{days.map(day => <HyperDatabaseCalendarDay key={`${scope}:${day}`} day={day} currentMonth={period?.kind === 'month' ? period.currentMonth : Number(day.slice(5, 7))} index={spans} onOpen={onOpen} />)}</div>
    {!!state.calendar.undated.length && <section><h2 className="mb-2 text-sm font-medium">{text('noDate')}</h2><div className="flex flex-wrap gap-2">{undated.items.map(event => <Button key={event.rowId} variant="outline" size="sm" onClick={() => { const row = state.snapshot!.database.rows.find(row => row.id === event.rowId); if (row) onOpen(row); }}>{event.title || text('openRow')}</Button>)}</div><HyperDatabaseWindowNavigation window={undated} label={windowText('undated')} className="mt-2" onPage={undated.setPage} /></section>}
  </div>;
}
