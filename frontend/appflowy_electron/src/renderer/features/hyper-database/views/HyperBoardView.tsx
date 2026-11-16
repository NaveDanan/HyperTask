import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Eye, MoreHorizontal, Plus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { Kanban, KanbanBoard, KanbanOverlay, type KanbanCommitMeta } from '@/components/reui/kanban';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useHyperDatabaseScan } from '../useHyperDatabaseScan';
import type { HyperDatabaseViewProps } from '../HyperDatabaseTypes';
import { HyperBoardToolbar } from './board/HyperBoardToolbar';
import { HyperBoardColumn } from './board/HyperBoardColumn';
import { HyperBoardCard } from './board/HyperBoardCard';
import { HyperBoardCardDetail } from './board/HyperBoardCardDetail';
import { HyperBoardDragMonitor } from './board/HyperBoardDragMonitor';
import { hyperBoardCreateOptions, hyperBoardDefaultFields, hyperBoardFieldsInitialized, hyperBoardGroupField, hyperBoardGroupFields, hyperBoardGroupName, hyperBoardOrderedGroups, hyperBoardPersistMove, hyperBoardValue, hyperBoardVisibleFields, type HyperBoardValue } from './board/hyperBoardModel';
import { hyperBoardGroupDot } from './board/hyperBoardColors';

const hyperBoardColumnModifiers = [restrictToHorizontalAxis];
const hyperBoardItemId = (id: string) => id;
export function HyperBoardView({ controller, state }: HyperDatabaseViewProps) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [excluded, setExcluded] = useState(new Set<string>());
  const [hideEmpty, setHideEmpty] = useState(false);
  const [value, setValue] = useState<HyperBoardValue>(() => hyperBoardValue(state));
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [fieldsBusy, setFieldsBusy] = useState(false);
  const [adding, setAdding] = useState<{ groupId: string; position: 'top' | 'bottom' } | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const focusReturn = useRef<HTMLElement | null>(null);
  const initialized = useRef(false);
  const grouping = useRef(false);
  const groupField = hyperBoardGroupField(state);
  const fields = useMemo(() => hyperBoardVisibleFields(state), [state.fields, state.view]);
  const groups = useMemo(() => hyperBoardOrderedGroups(state.groups), [state.groups]);
  const scan = useHyperDatabaseScan(controller, state, state.rowIds, state.fields.filter(f => f.isPrimary || f.type === FieldType.SingleSelect || f.type === FieldType.MultiSelect).map(f => f.id), Boolean(query.trim()));
  const authoritative = useMemo(() => hyperBoardValue(query.trim() ? { ...state, cells: scan.cells } : state, query, excluded, hideEmpty), [state.groups, state.rowIds, scan.cells, query, excluded, hideEmpty]);
  const closeDetail = useCallback(() => setDetail(null), []);
  const openDetail = useCallback((rowId: string, element: HTMLElement) => { focusReturn.current = element; setDetail(rowId); }, []);

  useEffect(() => { const timer = setTimeout(() => setQuery(search), 150); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!active && !moving) setValue(authoritative); }, [state.revision, authoritative, active, moving]);
  useEffect(() => {
    if (state.status !== 'ready') return;
    // Preload a small card viewport; search uses the retained scan above.
    const rows = [...new Set(groups.filter(group => group.isVisible).flatMap(group => group.rows.slice(0, 20).map(row => row.id)))];
    const wanted = [...new Set([...fields.map(field => field.id), ...state.fields.filter(field => field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect).map(field => field.id)])];
    void controller.loadRows(rows, wanted).catch(() => toast.error('Could not load cards'));
  }, [controller, groups, fields, state.status, state.fields]);
  useEffect(() => {
    if (state.status !== 'ready' || groupField || grouping.current) return;
    const candidate = hyperBoardGroupFields(state.fields)[0];
    if (!candidate) return;
    grouping.current = true;
    void controller.setGroupByField(candidate.id).catch(() => toast.error('Could not group board')).finally(() => { grouping.current = false; });
  }, [controller, state.status, state.fields, groupField]);
  useEffect(() => {
    if (state.status !== 'ready' || !state.fields.length || hyperBoardFieldsInitialized(state) || initialized.current) return;
    initialized.current = true;
    setFieldsBusy(true);
    void (async () => {
      const defaults = new Set(hyperBoardDefaultFields(state.fields).map(field => field.id));
      for (const field of state.fields) {
        const visibility = defaults.has(field.id) ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden;
        if (field.settings.visibility !== visibility) await controller.updateFieldSettings(field.id, { visibility });
      }
      await controller.updateViewExtra({ hyper_board_card_fields_initialized: true });
    })().catch(() => { initialized.current = false; toast.error('Could not save card field settings'); }).finally(() => setFieldsBusy(false));
  }, [controller, state.status, state.fields, state.view]);

  const firstGroup = Object.keys(value)[0] ?? groups.find(group => group.isVisible && !excluded.has(group.groupId))?.groupId;
  const newCard = async () => {
    if (!firstGroup || creating) return;
    setCreating(true);
    try { const row = await controller.createRow(hyperBoardCreateOptions(controller.state, firstGroup, '')); focusReturn.current = document.querySelector('[data-hyper-board]'); setDetail(row.id); }
    catch { toast.error('Could not add card'); }
    finally { setCreating(false); }
  };
  const commit = (next: HyperBoardValue, meta: KanbanCommitMeta<string>) => {
    if (meta.kind === 'column' && groups.find(group => group.groupId === meta.overContainer)?.isDefault) { setValue(meta.previousValue); return; }
    setMoving(true);
    void hyperBoardPersistMove(controller, next, meta).catch(async () => {
      setValue(meta.previousValue);
      toast.error(meta.kind === 'column' ? 'Could not move group' : 'Could not move card');
      await controller.refresh();
    }).finally(() => setMoving(false));
  };
  const addGroup = async () => {
    if (!newGroup?.trim() || groupBusy) return;
    setGroupBusy(true);
    try { await controller.createGroup(newGroup.trim()); setNewGroup(null); }
    catch { toast.error('Could not add group'); }
    finally { setGroupBusy(false); }
  };
  const loading = state.status === 'idle' || state.status === 'loading';
  const checkbox = groupField?.type === FieldType.Checkbox;
  const hidden = groups.filter(group => !group.isVisible);
  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground focus-visible:outline-none" data-hyper-board="true" tabIndex={0} aria-label="Kanban board" onKeyDown={event => {
    if (event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest('input, textarea, button, [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [contenteditable=true]')) return;
    event.preventDefault(); void newCard();
  }}>
    <HyperBoardToolbar fields={state.fields} groupField={groupField} groups={groups} visibleFields={fields} search={search} onSearch={setSearch} excluded={excluded} onExcluded={(id, hide) => setExcluded(previous => { const next = new Set(previous); if (hide) next.add(id); else next.delete(id); return next; })} hideEmpty={hideEmpty} onHideEmpty={setHideEmpty} onGroupField={id => { setExcluded(new Set()); void controller.setGroupByField(id).catch(() => toast.error('Could not change grouping')); }} onFieldVisibility={(id, visible) => { setFieldsBusy(true); void controller.updateFieldSettings(id, { visibility: visible ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden }).catch(() => toast.error('Could not save card fields')).finally(() => setFieldsBusy(false)); }} onNew={() => void newCard()} loading={loading} disabled={!groupField || !firstGroup || creating || moving} fieldsBusy={fieldsBusy} />
    {state.error ? <Alert variant="destructive" className="mx-4 mt-4 w-auto"><TriangleAlert className="size-4" /><AlertTitle>Could not load board</AlertTitle><AlertDescription>{state.error}</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={() => void controller.refresh()}>Retry</Button></AlertAction></Alert> : null}
    {loading ? <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4">{[0, 1, 2].map(id => <Skeleton key={id} className="h-64 w-72 shrink-0 rounded-lg" />)}</div> : !hyperBoardGroupFields(state.fields).length ? <Empty className="flex-1"><EmptyHeader><EmptyMedia variant="icon"><Columns3 className="size-5" /></EmptyMedia><EmptyTitle>Board needs a status field</EmptyTitle><EmptyDescription>Add a single-select field to organize cards into groups.</EmptyDescription></EmptyHeader><EmptyContent><Button disabled={groupBusy} onClick={async () => { setGroupBusy(true); try { const field = await controller.createField('Status', FieldType.SingleSelect); await controller.setGroupByField(field.id); } catch { toast.error('Could not add Status field'); } finally { setGroupBusy(false); } }}><Plus className="size-4" />Add Status field</Button></EmptyContent></Empty> : groupField ?
      <ScrollArea className="min-h-0 flex-1 overflow-hidden [&_[data-slot=scroll-area-viewport]]:overflow-y-hidden"><Kanban value={value} onValueChange={setValue} getItemValue={hyperBoardItemId} modifiers={active && active in value ? hyperBoardColumnModifiers : undefined} onValueCommit={commit} restoreOnCancel onDragStart={event => { setActive(String(event.active.id)); setOver(null); }} onDragEnd={() => { setActive(null); setOver(null); }} onDragCancel={() => { setActive(null); setOver(null); }} className="h-full">
        <HyperBoardDragMonitor value={value} onOver={setOver} />
        <KanbanBoard className="flex h-full w-max min-w-full items-stretch gap-3 p-4">
          {Object.keys(value).map(groupId => { const group = groups.find(item => item.groupId === groupId); return group ? <HyperBoardColumn key={groupId} controller={controller} state={state} group={group} rowIds={value[groupId]} fields={fields} groupField={groupField} search={Boolean(query.trim())} over={active !== null && over === groupId} busy={moving} draggedRowId={active} addPosition={adding?.groupId === groupId ? adding.position : undefined} onAdd={position => setAdding(position ? { groupId, position } : null)} onOpen={openDetail} /> : null; })}
          {!Object.keys(value).length ? <Empty className="w-72 shrink-0 border border-dashed border-border"><EmptyHeader><EmptyTitle>No groups shown</EmptyTitle><EmptyDescription>Change filters or show a hidden group.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" size="sm" onClick={() => { setExcluded(new Set()); setHideEmpty(false); setSearch(''); }}>Clear filters</Button></EmptyContent></Empty> : null}
          {!checkbox ? <div className="w-72 shrink-0">{newGroup !== null ? <Input autoFocus aria-label="New group name" placeholder="Group name" value={newGroup} disabled={groupBusy} onChange={event => setNewGroup(event.target.value)} onBlur={() => { if (!newGroup.trim()) setNewGroup(null); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void addGroup(); } if (event.key === 'Escape') setNewGroup(null); }} /> : <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setNewGroup('')}><Plus className="size-4" />Add group</Button>}</div> : null}
          {hidden.length ? <div className="w-56 shrink-0 space-y-2 p-2"><p className="text-xs font-medium text-muted-foreground">Hidden groups</p>{hidden.map(group => <div key={group.groupId} className="flex items-center gap-1"><Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => { void controller.hideGroup(group.groupId, false).catch(() => toast.error('Could not show group')); }}><span className={cn('size-2 shrink-0 rounded-full', hyperBoardGroupDot(group, checkbox))} /><span className="truncate">{hyperBoardGroupName(group, checkbox)}</span><span className="ml-auto text-xs text-muted-foreground">{group.rows.length}</span></Button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Hidden ${hyperBoardGroupName(group, checkbox)} group actions`} />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent className="w-56"><DropdownMenuItem onClick={() => { void controller.hideGroup(group.groupId, false).catch(() => toast.error('Could not show group')); }}><Eye className="size-4" />Show</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div> : null}
        </KanbanBoard>
        <KanbanOverlay>{({ value: id, variant }) => { if (variant === 'item') return <HyperBoardCard state={state} rowId={String(id)} fields={fields} groupFieldId={groupField.id} overlay />; const group = groups.find(item => item.groupId === id); return group ? <HyperBoardColumn controller={controller} state={state} group={group} rowIds={value[group.groupId] ?? []} fields={fields} groupField={groupField} search={false} overlay onAdd={() => {}} onOpen={openDetail} /> : null; }}</KanbanOverlay>
      </Kanban><ScrollBar orientation="horizontal" className="h-2.5 flex-col border-t border-transparent" /></ScrollArea> : <div className="flex gap-3 p-4"><Skeleton className="h-64 w-72" /></div>}
    <HyperBoardCardDetail controller={controller} state={state} rowId={detail} returnFocus={focusReturn.current} onClose={closeDetail} />
  </div>;
}
