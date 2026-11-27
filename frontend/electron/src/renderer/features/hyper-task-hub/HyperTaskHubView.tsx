// HyperTaskHubView: the Hub shell over one snapshot. Header with source chips and shared filters, then the
// active view. M1 ships the Board; Focus, Meetings, Matrix and Timeline join the view switch as their
// milestones land (spec D9.2, D12). Presentational: HyperTaskHubPage connects it to the renderer store.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, CalendarDays, ChartGantt, Crosshair, Grid2x2, ListFilter, ListTodo, RefreshCw, Search, Settings, SquareCheckBig, SquareKanban, TriangleAlert, X } from 'lucide-react';
import type { HyperHubFeedback, HyperHubFeedbackEvent, HyperHubSnapshot, HyperHubSourceKind, HyperHubSourceRef, HyperHubTaskView, HyperHubWriteView } from '@shared/HyperTaskHub';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openSettings } from '@/features/home/notifiers';
import { cn } from '@/lib/utils';
import { HyperHubBoard, type HyperHubBoardColumnModel } from './board/HyperHubBoard';
import type { HyperHubCardActions, HyperHubFeedbackInput } from './board/HyperHubCard';
import { HyperFocusView } from './focus/HyperFocusView';
import { hyperFocusToday } from './focus/hyperFocusToday';
import { HyperSourceStatusBar } from './HyperSourceStatusBar';
import { HyperWhyPopover, useHyperHubReasonLocale } from './HyperWhyPopover';
import { hyperSelectBoard, hyperSelectStatusDiffers, type HyperHubFilters } from './state/HyperTaskHubSelectors';
import { useHyperHubBriefRequest } from './brief/useHyperHubBriefRequest';
import { HyperMatrixView } from './matrix/HyperMatrixView';
import { HyperMeetingsView } from './meetings/HyperMeetingsView';
import { HyperTimelineView } from './timeline/HyperTimelineView';
import { useHyperMirrorRequest } from './mirror/HyperMirrorFlow';
import { hyperReleaseHold, useHyperWriteBackRequest } from './writeback/useHyperWriteBackFlow';

export interface HyperTaskHubFilterState {
  query: string;
  /** One connection to show, or null for all. */
  connectionId: string | null;
}

export interface HyperTaskHubViewProps {
  snapshot: HyperHubSnapshot | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  nowMs?: number;
  view: HyperTaskHubViewId;
  onViewChange: (view: HyperTaskHubViewId) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onFeedback: (event: HyperHubFeedbackEvent) => void;
  onOpenSource: (source: HyperHubSourceRef) => void;
  /** Opens a main-issued handle, such as a Hyper-Kanban mirror row. */
  onOpenHandle?: (handle: string) => void;
  onSetup: () => void;
}
export type HyperTaskHubViewId = 'focus' | 'board' | 'meetings' | 'matrix' | 'timeline';
export const hyperTaskHubViews: { id: HyperTaskHubViewId; label: string; icon: ReactNode }[] = [
  { id: 'focus', label: 'Focus', icon: <Crosshair className="size-4" /> },
  { id: 'board', label: 'Board', icon: <SquareKanban className="size-4" /> },
  { id: 'meetings', label: 'Meetings', icon: <CalendarClock className="size-4" /> },
  { id: 'matrix', label: 'Matrix', icon: <Grid2x2 className="size-4" /> },
  { id: 'timeline', label: 'Timeline', icon: <ChartGantt className="size-4" /> },
];
export const hyperIsTaskHubViewId = (value: unknown): value is HyperTaskHubViewId => hyperTaskHubViews.some(view => view.id === value);

const hyperHubConnectKinds: { kind: HyperHubSourceKind; label: string; icon: ReactNode; page: string | null; note?: string }[] = [
  { kind: 'jira', label: 'Jira', icon: <SquareCheckBig className="size-4" />, page: 'connections/jira' },
  { kind: 'hypertask', label: 'HyperTask boards', icon: <ListTodo className="size-4" />, page: null },
  { kind: 'outlook-calendar', label: 'Outlook', icon: <CalendarDays className="size-4" />, page: 'connections/outlook', note: 'calendar and mail' },
  { kind: 'newsletter-task', label: 'Newsletter', icon: <ChartGantt className="size-4" />, page: 'connections/newsletter', note: 'Gantt tasks' },
];
const hyperHubVisibleCap = 50;
let hyperHubOfflineDismissed = false;

function hyperHubMatches(task: HyperHubTaskView, query: string): boolean {
  return !query || task.title.toLocaleLowerCase().includes(query) || task.sources.some(source => source.label.toLocaleLowerCase().includes(query));
}

/** Sol's board columns (Next already in ranked Focus order before the cap), with the text search applied. */
export function hyperHubBoardColumns(snapshot: HyperHubSnapshot, filters: HyperHubFilters | undefined, query: string): { columns: HyperHubBoardColumnModel[]; ranks: Map<string, number> } {
  const ranks = new Map<string, number>();
  const needle = query.trim().toLocaleLowerCase();
  const columns = hyperSelectBoard(snapshot, filters).map(column => {
    if (column.state === 'ready') column.cards.forEach((task, index) => ranks.set(task.id, index + 1));
    return { id: column.state, taskIds: column.cards.filter(task => hyperHubMatches(task, needle)).map(task => task.id), overflow: column.overflowCount, firstOverflowId: column.firstOverflowId };
  });
  return { columns, ranks };
}

function HyperTaskHubLoading() {
  return <div aria-busy="true" className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4">
    {[0, 1, 2, 3].map(id => <Skeleton key={id} className="h-72 w-72 shrink-0 rounded-lg" />)}
  </div>;
}

function HyperTaskHubConnect({ onSetup }: { onSetup: () => void }) {
  return <Empty className="flex-1">
    <EmptyHeader>
      <EmptyMedia variant="icon"><ListTodo className="size-5" /></EmptyMedia>
      <EmptyTitle>Bring your tasks together</EmptyTitle>
      <EmptyDescription>Choose which projects and boards count as yours. Task Hub reads them, ranks the work and never changes the sources.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button onClick={onSetup}><Settings className="size-4" />Set up Task Hub</Button>
      <div className="mt-2 grid w-full max-w-sm gap-1 text-start">
        {hyperHubConnectKinds.map(source => <Button key={source.kind} variant="ghost" size="sm" className="justify-start text-muted-foreground"
          onClick={() => source.page ? openSettings.emit(source.page) : onSetup()}>
          {source.icon}<span className="text-foreground">{source.label}</span>{source.note && <span className="text-xs">· {source.note}</span>}
        </Button>)}
      </div>
    </EmptyContent>
  </Empty>;
}

function HyperTaskHubFiltersBar({ snapshot, filters, onFilters }: { snapshot: HyperHubSnapshot; filters: HyperTaskHubFilterState; onFilters: (filters: HyperTaskHubFilterState) => void }) {
  const connections = snapshot.sources.filter(source => source.status !== 'unconfigured');
  const selected = connections.find(source => source.connectionId === filters.connectionId);
  return <div className="flex shrink-0 items-center gap-2">
    <InputGroup className="h-8 w-56">
      <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
      <InputGroupInput aria-label="Search tasks" placeholder="Search tasks" value={filters.query} onChange={event => onFilters({ ...filters, query: event.target.value })}
        onKeyDown={event => { if (event.key === 'Escape' && filters.query) { event.preventDefault(); onFilters({ ...filters, query: '' }); } }} />
      {filters.query && <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => onFilters({ ...filters, query: '' })}><X className="size-3.5" /></Button></InputGroupAddon>}
    </InputGroup>
    {connections.length > 1 && <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className={cn('max-w-56', selected && 'border-ring/60')} />}>
        <ListFilter className="size-4" /><span className="truncate">{selected ? <bdi>{selected.label}</bdi> : 'All sources'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show tasks from</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={filters.connectionId ?? ''} onValueChange={value => onFilters({ ...filters, connectionId: value ? String(value) : null })}>
            <DropdownMenuRadioItem value="">All sources</DropdownMenuRadioItem>
            {connections.map(source => <DropdownMenuRadioItem key={source.connectionId} value={source.connectionId}><bdi className="truncate">{source.label}</bdi></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}

export function HyperTaskHubView({ snapshot, loading, error, refreshing, nowMs = Date.now(), view, onViewChange, onRefresh, onRetry, onFeedback, onOpenSource, onOpenHandle, onSetup }: HyperTaskHubViewProps) {
  const [filters, setFilters] = useState<HyperTaskHubFilterState>({ query: '', connectionId: null });
  const [triageCollapsed, setTriageCollapsed] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(hyperHubOfflineDismissed);
  const locale = useHyperHubReasonLocale();
  // The selectors memoize by filter identity.
  const selectorFilters = useMemo<HyperHubFilters | undefined>(() => filters.connectionId ? { connectionId: filters.connectionId } : undefined, [filters.connectionId]);

  const tasks = useMemo(() => new Map((snapshot?.tasks ?? []).map(task => [task.id, task])), [snapshot]);
  const ranking = useMemo(() => new Map((snapshot?.ranking ?? []).map(ranked => [ranked.taskId, ranked])), [snapshot]);
  const board = useMemo(() => snapshot ? hyperHubBoardColumns(snapshot, selectorFilters, filters.query) : { columns: [], ranks: new Map<string, number>() }, [snapshot, selectorFilters, filters.query]);
  const today = useMemo(() => snapshot && view === 'focus' ? hyperFocusToday(snapshot, selectorFilters, locale) : null, [snapshot, selectorFilters, locale, view]);
  const suggestions = useMemo(() => new Map((snapshot?.linkSuggestions ?? []).flatMap(suggestion => {
    const other = tasks.get(suggestion.otherTaskId);
    return other ? [[suggestion.targetId, { other, facts: suggestion.facts }] as const] : [];
  })), [snapshot, tasks]);
  const cycles = useMemo(() => new Set(snapshot?.cycleTaskIds ?? []), [snapshot]);
  // The first status-differs chip per task (M5 E1.9).
  const differs = useMemo(() => snapshot ? (task: HyperHubTaskView) => hyperSelectStatusDiffers(snapshot, task)[0] : undefined, [snapshot]);
  // The latest source write per task (M5 E8).
  const writes = useMemo(() => {
    const latest = new Map<string, HyperHubWriteView>();
    for (const write of snapshot?.writes ?? []) { const previous = latest.get(write.taskId); if (!previous || write.at.iso > previous.at.iso) latest.set(write.taskId, write); }
    return latest;
  }, [snapshot]);
  const isPreview = useMemo(() => (task: HyperHubTaskView) => {
    const cohort = task.reviewSpan?.cohort;
    return !cohort || (snapshot?.settings.cohortPrecision?.[cohort]?.preview ?? true);
  }, [snapshot]);
  const actions = useMemo<HyperHubCardActions>(() => ({
    feedback: (task, event: HyperHubFeedbackInput) => {
      if (!snapshot) return;
      onFeedback({ ...event, targetId: task.id, scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision } as HyperHubFeedback);
    },
    openSource: onOpenSource,
    // M5: these only open a preview; main's native confirmation authorizes any source write.
    changeStatus: (task, source, writeSource, intent) => useHyperWriteBackRequest.getState().open({ title: task.title, writeSource, source, intent }),
    releaseHold: write => void hyperReleaseHold(write),
    addToKanban: task => useHyperMirrorRequest.getState().open(task),
    openMirror: onOpenHandle ? (_task, handle) => onOpenHandle(handle) : undefined,
  }), [snapshot, onFeedback, onOpenSource, onOpenHandle]);

  // 1 and 2 switch views when no text field has focus (spec D9.8).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]')) return;
      const next = hyperTaskHubViews[Number(event.key) - 1];
      if (next && document.querySelector('[data-hyper-task-hub]')?.getClientRects().length) { event.preventDefault(); onViewChange(next.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onViewChange]);

  const configured = snapshot?.sources.filter(source => source.status !== 'unconfigured') ?? [];
  const needsSetup = !!snapshot && (!snapshot.settings.setupComplete || !configured.length);
  const triage = board.columns.find(column => column.id === 'review');
  const triageTotal = triage ? triage.taskIds.length + triage.overflow : 0;
  const openCount = snapshot?.tasks.filter(task => task.state === 'ready' || task.state === 'doing').length ?? 0;
  const offline = configured.length > 0 && configured.every(source => source.status === 'stale' || source.status === 'error');
  const lastSuccess = configured.map(source => source.lastSuccess?.iso).filter((iso): iso is string => !!iso).sort().at(-1);
  const zone = snapshot?.settings.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).format(nowMs);

  return <div data-hyper-task-hub className="@container flex h-full min-h-0 flex-col bg-background text-foreground">
    <header className="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><ListTodo aria-hidden="true" className="size-4 text-muted-foreground" /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Task Hub</h1>
          <p className="truncate text-xs text-muted-foreground">
            {dateLabel}{snapshot && !needsSetup ? ` · ${openCount} open` : ''}
            {triageTotal > 0 && <> · <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setTriageCollapsed(false)}>{triageTotal} to triage</button></>}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-1">
          {snapshot && !needsSetup && <ToggleGroup aria-label="Task Hub view" variant="outline" size="sm" className="me-2" value={[view]} onValueChange={value => { if (value[0]) onViewChange(value[0] as HyperTaskHubViewId); }}>
            {hyperTaskHubViews.map((item, index) => <Tooltip key={item.id}><TooltipTrigger render={<ToggleGroupItem value={item.id} aria-label={item.label} aria-keyshortcuts={String(index + 1)} />}>{item.icon}<span className="@max-4xl:sr-only">{item.label}</span></TooltipTrigger><TooltipContent>{item.label} · {index + 1}</TooltipContent></Tooltip>)}
          </ToggleGroup>}
          <Button type="button" variant="outline" size="sm" disabled={!snapshot || refreshing} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" className={cn('size-4', refreshing && 'animate-spin')} />{refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          {(() => { const label = snapshot?.settings.setupComplete ? 'Task Hub settings' : 'Set up Task Hub'; return <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onSetup} />}><Settings className="size-4" /></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>; })()}
        </div>
      </div>
      {snapshot && !needsSetup && <div className="flex flex-wrap items-center justify-between gap-2">
        <HyperSourceStatusBar sources={snapshot.sources} nowMs={nowMs} onSetup={onSetup} />
        <HyperTaskHubFiltersBar snapshot={snapshot} filters={filters} onFilters={setFilters} />
      </div>}
    </header>
    {snapshot && offline && !offlineDismissed && <Alert variant="warning" className="mx-4 mt-3 w-auto">
      <TriangleAlert className="size-4" />
      <AlertTitle>Showing cached tasks</AlertTitle>
      <AlertDescription>The sources could not be refreshed{lastSuccess ? `. Last update ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short', dateStyle: 'short' }).format(Date.parse(lastSuccess))}` : ''}.</AlertDescription>
      <AlertAction><Button variant="ghost" size="sm" onClick={() => { hyperHubOfflineDismissed = true; setOfflineDismissed(true); }}>Dismiss</Button></AlertAction>
    </Alert>}
    {loading && !snapshot ? <HyperTaskHubLoading />
      : error && !snapshot ? <Empty className="flex-1"><EmptyHeader><EmptyMedia variant="icon"><TriangleAlert className="size-5 text-destructive" /></EmptyMedia><EmptyTitle>Task Hub could not be loaded</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={onRetry}>Try again</Button></EmptyContent></Empty>
      : !snapshot ? null
      : needsSetup ? <HyperTaskHubConnect onSetup={onSetup} />
      : view === 'focus' && today ? <HyperFocusView snapshot={snapshot} today={today} filters={selectorFilters} query={filters.query} nowMs={nowMs} actions={actions} writes={writes} differs={differs}
          onDeclareWindow={windows => {
            const day = snapshot.day?.date ?? { kind: 'civil-date' as const, date: new Intl.DateTimeFormat('en-CA', { timeZone: snapshot.settings.zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs), zone: snapshot.settings.zone };
            onFeedback({ type: 'declare-availability', day, windows: windows.map(window => ({ start: { kind: 'instant', iso: window.start }, end: { kind: 'instant', iso: window.end } })), scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision });
          }}
          onReschedule={(task, start, end) => actions.feedback(task, { type: 'reschedule', block: { start: { kind: 'instant', iso: start.toISOString() }, end: { kind: 'instant', iso: end.toISOString() } } })} />
      : view === 'meetings' ? <HyperMeetingsView snapshot={snapshot} nowMs={nowMs} query={filters.query} onOpenBrief={meetingId => useHyperHubBriefRequest.getState().open(meetingId)} />
      : view === 'matrix' ? <HyperMatrixView snapshot={snapshot} filters={selectorFilters} query={filters.query} nowMs={nowMs} actions={actions} writes={writes}
          onQuadrant={(task, quadrant) => onFeedback({ type: 'set-matrix-quadrant', taskId: task.id, quadrant, scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision })} />
      : view === 'timeline' ? <HyperTimelineView snapshot={snapshot} filters={selectorFilters} query={filters.query} nowMs={nowMs} actions={actions} writes={writes} />
      : <HyperHubBoard columns={board.columns} ranks={board.ranks} tasks={tasks} ranking={ranking} nowMs={nowMs} zone={zone} workdays={snapshot.settings.workdays}
          actions={actions} triageCollapsed={triageCollapsed} onTriageCollapsed={setTriageCollapsed} visibleCap={hyperHubVisibleCap}
          suggestions={suggestions} isPreview={isPreview} cycles={cycles} writes={writes} differs={differs}
          renderWhy={(task, ranked) => <HyperWhyPopover ranked={ranked} title={task.title} zone={zone} movedByOwner={task.manualOrder !== undefined} />} />}
    {error && snapshot && <p role="status" className="border-t px-4 py-1.5 text-xs text-destructive">{error}</p>}
    <span className="sr-only" aria-live="polite">{refreshing ? 'Refreshing tasks' : ''}</span>
  </div>;
}
