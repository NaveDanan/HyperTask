import { HyperPeopleDisplay } from '@/features/hyper-people/HyperPeoplePicker';
import { hyperIsPeopleField } from '@/features/hyper-people/HyperPeopleProperty';
import { HyperMentionText } from '@/features/hyper-people/HyperMentionText';
import './gantt/HyperGanttView.css';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { GanttChart, Plus } from 'lucide-react';
import { Gantt, type GanttApi, type GanttColumn } from '@/components/reui/gantt/gantt';
import { HyperGanttTimeline } from './gantt/HyperGanttTimeline';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { showToast } from '@/ui/toast';
import { cn } from '@/lib/utils';
import type { HyperDatabaseViewProps } from '../HyperDatabaseTypes';
import { hyperGanttWeekStartsOn } from './gantt/HyperGanttMapping';
import { useHyperGanttData } from './gantt/useHyperGanttData';
import { HyperGanttToolbar } from './gantt/HyperGanttToolbar';
import { HyperGanttAvatars } from './gantt/HyperGanttAvatars';
import { HyperGanttRowDetail } from './gantt/HyperGanttRowDetail';
import { HyperGanttMenu } from './gantt/HyperGanttMenu';

/** Live rows and Rust-backed mutations; timeline rendering and gestures belong to MIT ReUI. */
export function HyperGanttView(props: HyperDatabaseViewProps) {
  const { controller, state } = props;
  const data = useHyperGanttData(props);
  const apiRef = useRef<GanttApi | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const run = (work: () => Promise<unknown>, message: string) => { void work().catch(error => showToast({ type: 'error', message: error instanceof Error && error.message.includes('check both') ? error.message : message })); };
  const create = () => {
    if (creating) return;
    setCreating(true);
    void data.createTask().then(id => {
      setSelectedId(id); setDetailId(id); apiRef.current?.today();
      requestAnimationFrame(() => { rootRef.current?.querySelector(`[data-gantt-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }); });
    }).catch(() => showToast({ type: 'error', message: "Couldn't create task" })).finally(() => setCreating(false));
  };
  const primaryId = state.fields.find(field => field.isPrimary)?.id ?? '';
  const mentionTitle = (id: string, fallback: string) => data.tasks.get(id)?.title || state.cells[id]?.[primaryId]?.display || fallback;
  const columns = useMemo<GanttColumn[]>(() => [
    { id: 'due', title: 'Due', width: 96, className: 'text-xs', render: ({ resource }) => {
      const task = data.tasks.get(resource.id);
      return <span className={cn('tabular-nums text-muted-foreground', task?.due && startOfDay(task.due) < startOfDay(new Date()) && !task.done && 'text-destructive')}>{task?.due ? format(task.due, 'MMM d') : '—'}</span>;
    } },
    { id: 'assignee', title: 'Assignee', width: 80, render: ({ resource }) => { const field = state.fields.find(item => item.id === data.config.assignee_field_id), cell = field ? state.cells[resource.id]?.[field.id] : undefined; return field && hyperIsPeopleField(field.proto) && cell?.kind === 'text' ? <HyperPeopleDisplay value={cell.text} /> : <HyperGanttAvatars names={data.tasks.get(resource.id)?.assignees ?? []} />; } },
  ], [data.tasks, state.fields, state.cells, data.config.assignee_field_id]);
  const menu = (id: string) => {
    const index = state.rowIds.indexOf(id);
    return <HyperGanttMenu
    open={() => { setSelectedId(id); setDetailId(id); }}
    clear={() => run(() => data.clearDates(id), "Couldn't clear dates")}
    duplicate={() => run(() => controller.duplicateRow(id), "Couldn't duplicate task")}
    remove={() => setDeleteId(id)}
    moveUp={index > 0 ? () => run(() => controller.moveRow(id, state.rowIds[index - 1]), "Couldn't move task") : undefined}
    moveDown={index < state.rowIds.length - 1 ? () => run(() => controller.moveRow(id, state.rowIds[index + 1]), "Couldn't move task") : undefined}
  />;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [role=combobox], [contenteditable=true]') || !data.config.start_field_id) return;
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); apiRef.current?.today(); }
    if ((e.key === '+' || e.key === '-' || e.key === '=') && target.closest('[data-slot=gantt-timeline-pane]')) {
      e.preventDefault(); void data.saveConfig({ zoom: Math.max(0.5, Math.min(3, data.config.zoom + (e.key === '-' ? -0.25 : 0.25))) }).catch(() => {});
    }
    const bar = target.closest('[data-slot=gantt-bar]');
    const rowId = bar?.closest<HTMLElement>('[data-gantt-row-id]')?.dataset.ganttRowId;
    const event = data.events.find(event => event.id === rowId);
    if (!rowId || !event) return;
    if (e.key === 'Enter') { e.preventDefault(); setDetailId(rowId); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); const amount = e.key === 'ArrowLeft' ? -1 : 1;
      data.commit({ event, occurrence: null, source: 'keyboard', start: e.shiftKey ? event.start : addDays(event.start, amount), end: addDays(event.end, amount), allDay: !!event.allDay, resourceId: rowId });
    }
  };
  const hasDateField = state.fields.some(field => field.id === data.config.start_field_id);
  const loading = state.status === 'loading' || state.status === 'idle' || !data.initialized;
  const detailTask = detailId ? data.tasks.get(detailId) : undefined;
  useEffect(() => {
    if (loading || !rootRef.current) return;
    const observer = new IntersectionObserver(entries => {
      const ids = entries.filter(entry => entry.isIntersecting).map(entry => (entry.target as HTMLElement).dataset.ganttRowId!).filter(Boolean);
      if (ids.length) void controller.loadRows(ids, data.fieldIds);
    }, { root: rootRef.current.querySelector('[data-slot=gantt-tree-pane]'), rootMargin: '180px' });
    rootRef.current.querySelectorAll('[data-slot=gantt-row-group]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [controller, loading, state.rowIds, data.fieldKey, state.fields]);
  const weekStartsOn = hyperGanttWeekStartsOn(navigator.language);
  return <Gantt
    ref={rootRef}
    className="flex h-full min-h-0 flex-col gap-2 px-4 pb-4 text-xs"
    data-hyper-gantt-view
    apiRef={apiRef}
    events={data.events}
    resources={data.resources}

    scale={data.config.scale}
    onScaleChange={scale => { if (scale !== 'day') void data.saveConfig({ scale }).catch(() => {}); }}
    date={date}
    onDateChange={setDate}
    zoom={data.config.zoom}
    onZoomChange={zoom => { void data.saveConfig({ zoom }).catch(() => {}); }}

    weekStartsOn={weekStartsOn}
    scheduleMode="single"
    barLabel="auto"
    nowIndicator
    i18n={{ labels: { resources: 'Name' } }}
    timelineLines={{ vertical: true, horizontal: true }}
    zoomControl
    offscreenIndicators
    offDays={{ className: 'bg-muted/40' }}
    rowCheckboxes={false}
    summaryBars={false}
    baselineBars={false}
    dependencyLines={false}

    metrics={{ minRowHeight: 2.25, rowPadding: 0.5, laneHeight: 1.25 }}
    treePanel={{ width: data.config.list_width, minWidth: 180, maxWidth: 640, nameColumnWidth: 208, onWidthChange: list_width => { void data.saveConfig({ list_width }).catch(() => {}); } }}

    columns={columns}
    columnsMenu={<Button
      variant="ghost"
      size="icon-xs"
      aria-label="Configure Gantt fields"
      onClick={() => setSettingsOpen(true)}
    >
      <Plus className="size-4" />
    </Button>}

    displayScheduleHint
    dragCreate
    displayCreateTaskHint
    onCreateTask={create}
    slotDuration={1440}
    snapDuration={1440}

    onEventUpdate={data.commit}
    canDropEvent={update => update.end >= update.start}
    enforceCanDrop

    onSlotClick={slot => { if (slot.resourceId && !data.tasks.get(slot.resourceId)?.event) run(() => data.setDates(slot.resourceId!, startOfDay(slot.date), addDays(startOfDay(slot.date), 1)), "Couldn't schedule task"); }}

    onSelectSlot={slot => { if (slot.resourceId) run(() => data.setDates(slot.resourceId!, slot.start, slot.end), "Couldn't schedule task"); }}

    onEventClick={occurrence => setSelectedId(occurrence.event.id)}
    onEventDoubleClick={occurrence => { setSelectedId(occurrence.event.id); setDetailId(occurrence.event.id); }}

    onResourceClick={({ resource }) => setSelectedId(resource.id)}
    onResourceDoubleClick={({ resource }) => { setSelectedId(resource.id); setDetailId(resource.id); }}
    selectedRows={selectedId ? [selectedId] : []}

    onResourceReorder={proposal => { const index = proposal.resources.findIndex(r => r.id === proposal.resourceId); const target = state.rowIds[index]; if (target && target !== proposal.resourceId) run(() => controller.moveRow(proposal.resourceId, target), "Couldn't reorder task"); }}

    renderEvent={({ occurrence }) => <span className="min-w-0 truncate"><HyperMentionText value={mentionTitle(occurrence.event.id, occurrence.event.title)} /></span>}
    renderEventMenu={({ occurrence }) => menu(occurrence.event.id)}
    renderResourceMenu={({ resource }) => menu(resource.id)}

    renderResourceLabel={({ resource }) => <span className="flex min-w-0 items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: resource.color }} />{state.rows[resource.id]?.icon && <span className="shrink-0">{state.rows[resource.id].icon}</span>}<span className="truncate"><HyperMentionText value={mentionTitle(resource.id, resource.title)} /></span>
    </span>}

    renderDragPreview={({ occurrence, valid }) => <div data-hyper-gantt-drag-preview data-valid={valid} className="flex h-full items-center px-2 text-foreground">
      <span className="truncate font-medium"><HyperMentionText value={mentionTitle(occurrence.event.id, occurrence.event.title)} /></span>
    </div>}

    renderScheduleHint={({ resource, start, end }) => <Button
      variant="ghost" size="sm" data-slot="gantt-schedule-hint-tile"
      className="pointer-events-none h-5 rounded-sm border border-dashed border-border bg-background px-2 text-xs text-muted-foreground"
      onClick={e => { e.stopPropagation(); run(() => data.setDates(resource.id, start, end), "Couldn't schedule task"); }}
    >Click to schedule</Button>}
    classNames={{ event: 'data-selected:ring-2 data-selected:ring-ring/50' }}
    onKeyDown={onKeyDown}
  >
    <HyperGanttToolbar
      config={data.config}
      fields={state.fields}
      save={data.saveConfig}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      createTask={create}
      creating={creating}
      hasDateField={hasDateField}
    />
    <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background" data-hyper-gantt-frame>
      {state.status === 'error' ? <Alert variant="destructive" className="m-4 self-start">
        <AlertDescription>{state.error ?? 'Could not load tasks'}</AlertDescription>
        <Button
          variant="outline"
          size="sm"
          onClick={() => run(() => controller.open(), 'Could not reload tasks')}
        >Retry</Button>
      </Alert> : loading ? <div className="flex w-full flex-col" aria-label="Loading tasks">{Array.from({ length: 8 }, (_, index) => <div key={index} className="grid h-9 grid-cols-2 items-center gap-8 border-b px-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>)}</div> : !data.config.start_field_id ? <Empty className="w-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GanttChart className="size-5" />
          </EmptyMedia>
          <EmptyTitle>Add a date field</EmptyTitle>
          <EmptyDescription>The timeline needs a date or date range for each task.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => run(data.addDateField, "Couldn't add Dates field")}>Add Dates field</Button>
        </EmptyContent>
      </Empty> : !state.rowIds.length ? <Empty className="w-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GanttChart className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No tasks yet</EmptyTitle>
          <EmptyDescription>Add a task to see it on the timeline.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            size="sm"
            onClick={create}
            disabled={creating}
          >
            <Plus className="size-4" />New task
          </Button>
        </EmptyContent>
      </Empty> : <HyperGanttTimeline zoom={data.config.zoom} />}
    </div>
    {detailId && detailTask && <HyperGanttRowDetail
      key={detailId}
      rowId={detailId}
      state={state}
      controller={controller}
      config={data.config}
      task={detailTask}
      fraction={data.fraction}
      close={() => setDetailId(null)}
      setDates={data.setDates}
      remove={() => setDeleteId(detailId)}
    />}
    <AlertDialog open={!!deleteId} onOpenChange={open => { if (!open && !deleting) setDeleteId(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete task?</AlertDialogTitle>
          <AlertDialogDescription>This removes the task from every view of this database.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={() => { if (!deleteId) return; setDeleting(true); void controller.deleteRows([deleteId]).then(() => { if (detailId === deleteId) setDetailId(null); setDeleteId(null); }).catch(() => showToast({ type: 'error', message: "Couldn't delete task" })).finally(() => setDeleting(false)); }}
          >{deleting ? 'Deleting…' : 'Delete task'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

  </Gantt>;
}
