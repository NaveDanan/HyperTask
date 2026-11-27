// Timeline (M5 E4): a read-only wrapper over the vendored ReUI Gantt. Bars are only real plan chunks and
// verified source schedules; lone planned starts and due dates are milestones; effort is row text and never
// a span. Arrows are verified finish-to-start edges whose endpoints are both visible. No vendor file is edited.
import { useMemo, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { CalendarRange, ChevronLeft, ChevronRight, MoreHorizontal, Repeat2, SquareArrowOutUpRight } from 'lucide-react';
import type { HyperHubSnapshot, HyperHubState, HyperHubTaskView, HyperHubWriteView } from '@shared/HyperTaskHub';
import { Gantt, type GanttColumn } from '@/components/reui/gantt/gantt';
import type { GanttEvent, GanttResource } from '@/components/reui/gantt/gantt-types';
import { GanttView } from '@/components/reui/gantt/gantt-view';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { HyperHubCardSourceItems, type HyperHubCardActions } from '../board/HyperHubCard';
import { hyperHubSourceNames, HyperHubSourceBadge } from '../HyperHubSource';
import { hyperHubDueLabel, hyperHubEffortLabel } from '../HyperTaskHubFormat';
import { HyperWhyPopover } from '../HyperWhyPopover';
import { hyperSelectTimeline, type HyperHubFilters, type HyperHubTimelineGroupBy, type HyperHubTimelineRow } from '../state/HyperTaskHubSelectors';
import { HyperWriteBadge } from '../writeback/HyperWriteBadge';

export interface HyperTimelineViewProps {
  snapshot: HyperHubSnapshot;
  filters?: HyperHubFilters;
  query: string;
  nowMs: number;
  actions: HyperHubCardActions;
  writes?: ReadonlyMap<string, HyperHubWriteView>;
}

interface HyperTimelineEventData { taskId: string; kind: 'plan' | 'source' | 'planned' | 'due'; provisional?: boolean }

const hyperStateColor: Record<HyperHubState, string> = {
  review: 'var(--muted-foreground)', ready: 'var(--primary)', doing: 'var(--info)', waiting: 'var(--muted-foreground)', done: 'var(--success)', dismissed: 'var(--muted-foreground)',
};

function hyperCivilToday(nowMs: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}

function hyperShiftCivil(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A readable label for a group key: a project id or a source kind. */
function hyperGroupLabel(key: string | null, groupBy: HyperHubTimelineGroupBy, rows: readonly HyperHubTimelineRow[]): string {
  if (key === null) return groupBy === 'project' ? 'No project' : 'Other';
  if (groupBy === 'source') return hyperHubSourceNames[key as keyof typeof hyperHubSourceNames] ?? key;
  const kind = rows[0]?.task.sources[0]?.kind;
  const last = key.split(':').at(-1) ?? key;
  return kind ? `${hyperHubSourceNames[kind]} · ${last}` : last;
}

export function HyperTimelineView({ snapshot, filters, query, nowMs, actions, writes }: HyperTimelineViewProps) {
  const zone = snapshot.settings.zone;
  const today = hyperCivilToday(nowMs, zone);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState<7 | 28>(28);
  const [groupBy, setGroupBy] = useState<HyperHubTimelineGroupBy>('project');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timeline = useMemo(() => hyperSelectTimeline(snapshot, { start, days }, groupBy, filters), [snapshot, start, days, groupBy, filters]);
  const ranking = useMemo(() => new Map(snapshot.ranking.map(ranked => [ranked.taskId, ranked])), [snapshot]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (row: HyperHubTimelineRow) => !needle || row.task.title.toLocaleLowerCase().includes(needle);

  const { resources, events, rows } = useMemo(() => {
    const rows = new Map<string, HyperHubTimelineRow>();
    const incoming = new Map<string, string[]>();
    for (const edge of timeline.edges) incoming.set(edge.toBarId, [...(incoming.get(edge.toBarId) ?? []), edge.fromBarId]);
    const resources: GanttResource[] = [];
    const events: GanttEvent<HyperTimelineEventData>[] = [];
    for (const group of timeline.groups) {
      const visible = group.rows.filter(matches);
      if (!visible.length) continue;
      resources.push({ id: `group:${group.key ?? 'none'}`, title: hyperGroupLabel(group.key, groupBy, visible), children: visible.map(row => ({ id: row.task.id, title: row.task.title })) });
      for (const row of visible) {
        rows.set(row.task.id, row);
        const color = hyperStateColor[row.task.state];
        // Provisional plan blocks read lighter; the tree already names the task, so bars stay unlabelled.
        for (const bar of row.bars) events.push({
          id: bar.id, title: row.task.title, resourceId: row.task.id, readOnly: true,
          color: bar.provisional ? `color-mix(in oklab, ${color} 45%, transparent)` : color,
          start: new Date(bar.clipped.start.iso), end: new Date(bar.clipped.end.iso),
          dependencies: incoming.get(bar.id), data: { taskId: row.task.id, kind: bar.kind, provisional: bar.provisional },
        });
        for (const marker of row.markers) {
          const at = new Date(marker.at.iso);
          const overdue = marker.kind === 'due' && at.getTime() < nowMs && row.task.state !== 'done';
          events.push({
            id: `${row.task.id}:${marker.kind}`, title: '', resourceId: row.task.id, readOnly: true,
            color: marker.kind === 'due' ? (overdue ? 'var(--destructive)' : 'var(--warning)') : 'var(--muted-foreground)',
            start: at, end: at, data: { taskId: row.task.id, kind: marker.kind },
          });
        }
      }
    }
    return { resources, events, rows };
  }, [timeline, groupBy, needle, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<GanttColumn[]>(() => [
    { id: 'effort', title: 'Effort', width: 72, className: 'text-xs', render: ({ resource }) => {
      const row = rows.get(resource.id);
      if (!row) return null;
      const effort = hyperHubEffortLabel(row.task);
      return <span className="tabular-nums text-muted-foreground" title={effort.title}>{effort.text}</span>;
    } },
  ], [rows]);

  const undated = timeline.undated.filter(matches);
  const selected = selectedId ? rows.get(selectedId) ?? timeline.undated.find(row => row.task.id === selectedId) : undefined;
  const rangeStart = new TZDate(`${start}T00:00:00`, zone);
  const label = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: zone });
  const rangeText = `${label.format(Date.parse(timeline.interval.start.iso))} – ${label.format(Date.parse(timeline.interval.end.iso) - 1)}`;

  return <div data-hyper-timeline className="flex min-h-0 flex-1 flex-col gap-3 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Earlier" onClick={() => setStart(value => hyperShiftCivil(value, -days))}><ChevronLeft className="size-4 rtl:rotate-180" /></Button>
        <Button variant="outline" size="sm" disabled={start === today} onClick={() => setStart(today)}>Today</Button>
        <Button variant="outline" size="icon-sm" aria-label="Later" onClick={() => setStart(value => hyperShiftCivil(value, days))}><ChevronRight className="size-4 rtl:rotate-180" /></Button>
      </div>
      <span className="text-sm font-medium tabular-nums">{rangeText}</span>
      <div className="ms-auto flex items-center gap-2">
        <ToggleGroup aria-label="Range" variant="outline" size="sm" value={[String(days)]} onValueChange={value => { if (value[0]) setDays(Number(value[0]) as 7 | 28); }}>
          <ToggleGroupItem value="7">7 days</ToggleGroupItem>
          <ToggleGroupItem value="28">4 weeks</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup aria-label="Group by" variant="outline" size="sm" value={[groupBy]} onValueChange={value => { if (value[0]) setGroupBy(value[0] as HyperHubTimelineGroupBy); }}>
          <ToggleGroupItem value="project">By project</ToggleGroupItem>
          <ToggleGroupItem value="source">By source</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>

    <div className="relative flex min-h-80 flex-1 overflow-hidden rounded-lg border bg-background" data-hyper-timeline-frame>
      {!resources.length ? <Empty className="w-full"><EmptyHeader><EmptyMedia variant="icon"><CalendarRange className="size-5" /></EmptyMedia>
        <EmptyTitle>Nothing dated in this range</EmptyTitle>
        <EmptyDescription>{timeline.outOfRangeCount ? `${timeline.outOfRangeCount} dated ${timeline.outOfRangeCount === 1 ? 'task is' : 'tasks are'} outside this range.` : 'Tasks appear here once they have a plan block, a schedule or a due date.'}</EmptyDescription>
      </EmptyHeader></Empty>
        : <Gantt<HyperTimelineEventData>
          key={`${start}:${days}`}
          className="flex h-full min-h-0 w-full flex-col text-xs"
          events={events}
          resources={resources}
          scale={days === 7 ? 'week' : 'month'}
          date={rangeStart}
          timeZone={zone}
          interactions={{ drag: false, resize: false, selectSlot: false }}
          scheduleMode="multiple"
          barLabel="inside"
          nowIndicator
          dependencyLines
          summaryBars={false}
          baselineBars={false}
          rowCheckboxes={false}
          timelineLines={{ vertical: true, horizontal: true }}
          offDays={{ className: 'bg-muted/40' }}
          metrics={{ minRowHeight: 2.25, rowPadding: 0.5, laneHeight: 1.25 }}
          treePanel={{ width: 300, minWidth: 200, maxWidth: 520, nameColumnWidth: 228 }}
          columns={columns}
          i18n={{ labels: { resources: 'Task' } }}
          onEventClick={occurrence => setSelectedId(occurrence.event.data?.taskId ?? null)}
          onResourceClick={({ resource }) => { if (rows.has(resource.id)) setSelectedId(resource.id); }}
          selectedRows={selectedId ? [selectedId] : []}
          renderResourceLabel={({ resource }) => {
            const row = rows.get(resource.id);
            return <span className="flex min-w-0 items-center gap-1.5">
              {row?.cycle && <Repeat2 aria-label="Dependency loop" className="size-3.5 shrink-0 text-warning" />}
              <bdi dir="auto" className="truncate">{resource.title}</bdi>
              {row && row.hiddenPredecessorIds.length + row.missingPredecessorIds.length > 0 && <span className="shrink-0 text-2xs text-muted-foreground" title="Some tasks this depends on are outside the view">+{row.hiddenPredecessorIds.length + row.missingPredecessorIds.length} before</span>}
            </span>;
          }}
          classNames={{ event: 'data-selected:ring-2 data-selected:ring-ring/50' }}
        >
          <GanttView tabIndex={0} aria-label="Task timeline" className={cn('h-full w-full',
            '[&_[data-slot=gantt-tree-cell]]:sticky [&_[data-slot=gantt-tree-cell]]:start-0 [&_[data-slot=gantt-tree-cell]]:z-10 [&_[data-slot=gantt-tree-cell]]:bg-background')} />
        </Gantt>}
    </div>

    <div className="flex flex-wrap items-start gap-3">
      {selected && <HyperTimelineSelection row={selected} snapshot={snapshot} nowMs={nowMs} actions={actions} write={writes?.get(selected.task.id)} ranked={ranking.get(selected.task.id)} onClose={() => setSelectedId(null)} />}
      <div className="flex min-w-60 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-primary" />Planned work</span>
          <span className="flex items-center gap-1"><span className="size-2 rotate-45 bg-warning" />Due</span>
          <span className="flex items-center gap-1"><span className="size-2 rotate-45 bg-muted-foreground" />Planned start</span>
          <span className="flex items-center gap-1"><Repeat2 className="size-3 text-warning" />Dependency loop</span>
          {timeline.outOfRangeCount > 0 && <span className="ms-auto">{timeline.outOfRangeCount} dated outside this range</span>}
        </div>
        {undated.length > 0 && <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">No dates ({undated.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {undated.map(row => <li key={row.task.id}><button type="button" className="flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-muted/50" onClick={() => setSelectedId(row.task.id)}>
              {row.task.sources[0] && <HyperHubSourceBadge source={row.task.sources[0]} />}<bdi dir="auto" className="truncate">{row.task.title}</bdi>
              <span className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground">{hyperHubEffortLabel(row.task).text}</span>
            </button></li>)}
          </ul>
        </details>}
      </div>
    </div>
  </div>;
}

function HyperTimelineSelection({ row, snapshot, nowMs, actions, write, ranked, onClose }: {
  row: HyperHubTimelineRow; snapshot: HyperHubSnapshot; nowMs: number; actions: HyperHubCardActions; write?: HyperHubWriteView;
  ranked?: HyperHubSnapshot['ranking'][number]; onClose: () => void;
}) {
  const { task } = row;
  const zone = snapshot.settings.zone;
  const primary = task.sources[0];
  const due = task.due && hyperHubDueLabel(task.due, nowMs, zone);
  return <section aria-label={`Selected: ${task.title}`} className="flex w-full max-w-md flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs">
    <div className="flex min-w-0 items-center gap-1">
      {primary && <HyperHubSourceBadge source={primary} />}
      {row.cycle && <Badge variant="warning-light" size="sm" className="gap-1"><Repeat2 className="size-3" />Dependency loop</Badge>}
      <span className="ms-auto flex items-center">
        {ranked && <HyperWhyPopover ranked={ranked} title={task.title} zone={zone} movedByOwner={task.manualOrder !== undefined} />}
        <HyperTimelineMenu task={task} actions={actions} write={write} />
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onClose}>Close</Button>
      </span>
    </div>
    <p dir="auto" className="text-sm font-medium">{task.title}</p>
    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      {due && <span className={cn('tabular-nums', due.overdue && 'font-medium text-destructive')}>{due.text}</span>}
      <span className="tabular-nums">{hyperHubEffortLabel(task).text}</span>
      {row.bars.some(bar => bar.kind === 'source') && <span>Scheduled in the source</span>}
    </p>
    {write && <HyperWriteBadge write={write} onRelease={actions.releaseHold ? () => actions.releaseHold!(write) : undefined}
      onCheckInSource={(() => { const source = task.sources.find(item => item.evidenceId === write.evidenceId); return source?.openable ? () => actions.openSource(source) : undefined; })()} />}
  </section>;
}

function HyperTimelineMenu({ task, actions, write }: { task: HyperHubTaskView; actions: HyperHubCardActions; write?: HyperHubWriteView }) {
  const primary = task.sources[0];
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${task.title}`} className="text-muted-foreground" />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-60">
      {primary?.openable && <DropdownMenuItem onClick={() => actions.openSource(primary)}><SquareArrowOutUpRight className="size-4" /><span className="truncate">Open <bdi>{primary.label}</bdi></span></DropdownMenuItem>}
      <HyperHubCardSourceItems task={task} actions={actions} write={write} />
    </DropdownMenuContent>
  </DropdownMenu>;
}
