// Focus (spec D9.2): the default Hub view. Left: "Do this first" with its reason and actions, then the ranked
// Next list (pins and manual order first; drag to reorder; new rankings wait behind an Apply pill). Right:
// today's plan around real meetings, capacity, and what did not fit. Without availability coverage it asks
// for a manual window (D7.6) instead of inventing free time.
import { useMemo, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ArrowDownUp, ArrowRightLeft, CalendarClock, Clock, GripVertical, Lock, Pin, PinOff, Play, SquareArrowOutUpRight, Sunset } from 'lucide-react';
import type { HyperHubAgendaItem, HyperHubBlockerCode, HyperHubFacts, HyperHubInstant, HyperHubPlacementReason, HyperHubPlanBlock, HyperHubRanked, HyperHubSnapshot, HyperHubTaskView, HyperHubWriteView } from '@shared/HyperTaskHub';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import type { HyperHubCardActions, HyperHubStatusDiffers } from '../board/HyperHubCard';
import { HyperWriteBadge } from '../writeback/HyperWriteBadge';
import { hyperWriteSourceName } from '../writeback/HyperWriteBackDialog';
import { HyperHubSourceBadge } from '../HyperHubSource';
import { hyperHubDueLabel, hyperHubEffortLabel, hyperHubNextWorkdayMorning, hyperHubPriorityOf, hyperHubPriorityTier } from '../HyperTaskHubFormat';
import { HyperWhyPopover, useHyperHubReasonLocale } from '../HyperWhyPopover';
import { hyperFormatOverflow, type HyperHubReasonLocale } from '../state/HyperTaskHubReasons';
import type { HyperHubFilters } from '../state/HyperTaskHubSelectors';
import { HyperDayPlan } from './HyperDayPlan';
import { useHyperHubBriefRequest } from '../brief/useHyperHubBriefRequest';
import { HyperOwnerWindowPrompt } from './HyperOwnerWindowPrompt';
import { useHyperHubStableOrder } from './useHyperHubStableOrder';

/** What Focus renders for today; produced by Sol's hyperSelectToday. */
export interface HyperFocusToday {
  recommendation: { task: HyperHubTaskView; ranked?: HyperHubRanked; kind: 'start-now' | 'start-later'; start: HyperHubInstant; block?: HyperHubPlanBlock; reasons: readonly HyperHubPlacementReason[]; text: string } | null;
  /** Why there is no recommendation, when there is none. */
  emptyReason?: string;
  blocks: readonly { block: HyperHubPlanBlock; task: HyperHubTaskView }[];
  agenda: readonly HyperHubAgendaItem[];
  capacity: { freeMinutes: number; plannedMinutes: number; unplacedMinutes: number; provisional: boolean; text: string };
  unscheduled: readonly { task: HyperHubTaskView; code: HyperHubBlockerCode; facts: HyperHubFacts }[];
  coverage: 'complete' | 'provisional' | 'missing';
  needsOwnerWindow: boolean;
}

interface HyperFocusViewProps {
  snapshot: HyperHubSnapshot;
  today: HyperFocusToday;
  filters?: HyperHubFilters;
  query: string;
  nowMs: number;
  actions: HyperHubCardActions;
  onDeclareWindow: (windows: { start: string; end: string }[]) => void;
  onReschedule: (task: HyperHubTaskView, start: Date, end: Date) => void;
  /** The latest source write per task (M5 E8). */
  writes?: ReadonlyMap<string, HyperHubWriteView>;
  /** Status-differs chip per task (M5 E1.9). */
  differs?: (task: HyperHubTaskView) => HyperHubStatusDiffers | undefined;
}
const hyperFocusListCap = 100;

function HyperTaskMeta({ task, nowMs, zone }: { task: HyperHubTaskView; nowMs: number; zone: string }) {
  const due = task.due && hyperHubDueLabel(task.due, nowMs, zone);
  const effort = hyperHubEffortLabel(task);
  const priority = hyperHubPriorityOf(task);
  const blocked = task.blockedBy.some(edge => !edge.resolvedByOwner);
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
    {priority && <Badge size="sm" variant={hyperHubPriorityTier[priority.priority].variant} title={priority.origin === 'source' ? 'From Jira priority' : 'Your priority'}>{hyperHubPriorityTier[priority.priority].label}</Badge>}
    {due && <span title={due.title} className={cn('tabular-nums', due.overdue && 'font-medium text-destructive', due.soon && 'text-foreground')}>{due.text}</span>}
    <span title={effort.title} className="tabular-nums">{effort.text}</span>
    {blocked && <span className="flex items-center gap-1"><Lock aria-hidden="true" className="size-3" />Blocked</span>}
    {task.state === 'doing' && <span className="text-info-foreground dark:text-info">In progress</span>}
  </span>;
}

/** The card's write state, with Check in <source> and the owner release (M5 E8). */
function HyperRowWrite({ task, write, actions }: { task: HyperHubTaskView; write?: HyperHubWriteView; actions: HyperHubCardActions }) {
  if (!write) return null;
  const source = task.sources.find(item => item.evidenceId === write.evidenceId);
  return <HyperWriteBadge write={write} onCheckInSource={source?.openable ? () => actions.openSource(source) : undefined}
    onRelease={actions.releaseHold ? () => actions.releaseHold!(write) : undefined} />;
}

function HyperDoFirstCard({ today, snapshot, nowMs, actions, differs }: Pick<HyperFocusViewProps, 'today' | 'snapshot' | 'nowMs' | 'actions' | 'differs'>) {
  const zone = snapshot.settings.zone;
  const recommendation = today.recommendation;
  if (!recommendation) return <section aria-label="Do this first" className="rounded-xl border border-dashed p-4">
    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Do this first</p>
    <p className="mt-2 text-sm text-muted-foreground">{today.emptyReason ?? 'Nothing is ready to start right now.'}</p>
  </section>;
  const { task, ranked } = recommendation;
  const primary = task.sources[0];
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(Date.parse(recommendation.start.iso));
  const startNow = recommendation.kind === 'start-now';
  return <section aria-label="Do this first" data-hyper-do-first className="rounded-xl border bg-card p-4 shadow-xs">
    <div className="flex items-center gap-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Do this first</p>
      {!startNow && <Badge variant="info-light" size="sm"><CalendarClock className="size-3" />From {time}</Badge>}
      {today.coverage === 'provisional' && <Badge variant="warning-light" size="sm" title="Based on a calendar read that is not fully current">Provisional</Badge>}
      <span className="ms-auto flex items-center gap-1">
        {primary && <HyperHubSourceBadge source={primary} />}
        {ranked && <HyperWhyPopover ranked={ranked} title={task.title} zone={zone} placement={recommendation.reasons} movedByOwner={task.manualOrder !== undefined} />}
      </span>
    </div>
    <h2 dir="auto" className="mt-2 text-lg font-semibold tracking-tight">{task.title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{recommendation.text}</p>
    <div className="mt-2"><HyperTaskMeta task={task} nowMs={nowMs} zone={zone} /></div>
    <div className="mt-4 flex flex-wrap gap-2">
      {task.state !== 'doing' && <Button size="sm" onClick={() => actions.feedback(task, { type: 'set-state', state: 'doing' })}><Play className="size-4" />{startNow ? 'Start' : `Start now`}</Button>}
      <Button size="sm" variant="outline" onClick={() => actions.feedback(task, { type: 'snooze', until: { kind: 'instant', iso: hyperHubNextWorkdayMorning(nowMs, snapshot.settings.workdays) } })}><Clock className="size-4" />Snooze</Button>
      <Button size="sm" variant="ghost" onClick={() => actions.feedback(task, { type: 'not-today' })}><Sunset className="size-4" />Not today</Button>
      {primary?.openable && <Button size="sm" variant="ghost" onClick={() => actions.openSource(primary)}><SquareArrowOutUpRight className="size-4" />Open <bdi>{primary.label}</bdi></Button>}
      {(() => { const chip = differs?.(task); return chip && actions.changeStatus ? <Button size="sm" variant="ghost" className="text-warning-foreground dark:text-warning" title={`${hyperWriteSourceName[chip.write]} still shows ${chip.observedName}. Review a status change.`}
        onClick={() => actions.changeStatus!(task, chip.source, chip.write, chip.intent)}><ArrowRightLeft className="size-4" />{hyperWriteSourceName[chip.write]}: <bdi>{chip.observedName}</bdi></Button> : null; })()}
    </div>
  </section>;
}

function HyperRankedRow({ task, rank, ranked, nowMs, zone, actions, recommended, write }: { task: HyperHubTaskView; rank: number; ranked?: HyperHubRanked; nowMs: number; zone: string; actions: HyperHubCardActions; recommended: boolean; write?: HyperHubWriteView }) {
  const sortable = useSortable({ id: task.id });
  const primary = task.sources[0];
  return <li ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    className={cn('group/row flex items-start gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:bg-muted/50', sortable.isDragging && 'z-10 border-border bg-card shadow-md', recommended && 'bg-muted/40')}>
    <button type="button" aria-label={`Reorder ${task.title}`} className="mt-0.5 cursor-grab rounded text-muted-foreground/60 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...sortable.attributes} {...sortable.listeners}>
      <GripVertical className="size-4" />
    </button>
    <span className="mt-0.5 w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{rank}</span>
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        {primary && <HyperHubSourceBadge source={primary} />}
        {task.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground" />}
      </div>
      <p dir="auto" className="mt-1 truncate text-sm font-medium">{task.title}</p>
      <div className="mt-1"><HyperTaskMeta task={task} nowMs={nowMs} zone={zone} /></div>
      {write && <div className="mt-1"><HyperRowWrite task={task} write={write} actions={actions} /></div>}
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      {ranked && <HyperWhyPopover ranked={ranked} title={task.title} zone={zone} movedByOwner={task.manualOrder !== undefined} />}
      <Button variant="ghost" size="icon-xs" aria-label={task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`} className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        onClick={() => actions.feedback(task, { type: task.pinned ? 'unpin' : 'pin' })}>{task.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</Button>
    </div>
  </li>;
}

function HyperRankedList({ snapshot, filters, query, nowMs, actions, recommendedId, writes }: Pick<HyperFocusViewProps, 'snapshot' | 'filters' | 'query' | 'nowMs' | 'actions' | 'writes'> & { recommendedId?: string }) {
  const stable = useHyperHubStableOrder(snapshot, filters);
  const tasks = useMemo(() => new Map(snapshot.tasks.map(task => [task.id, task])), [snapshot]);
  const ranking = useMemo(() => new Map(snapshot.ranking.map(rank => [rank.taskId, rank])), [snapshot]);
  const needle = query.trim().toLocaleLowerCase();
  const ids = stable.order.filter(id => {
    const task = tasks.get(id);
    return task && (!needle || task.title.toLocaleLowerCase().includes(needle) || task.sources.some(source => source.label.toLocaleLowerCase().includes(needle)));
  });
  const visible = ids.slice(0, hyperFocusListCap);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const task = tasks.get(String(active.id));
    if (!task) return;
    const from = visible.indexOf(String(active.id)), to = visible.indexOf(String(over.id));
    // Dropping below a row places the task before the row after it.
    const before = from < to ? visible[to + 1] : visible[to];
    actions.feedback(task, { type: 'reorder', position: before ? { beforeId: before } : 'end' });
  };
  return <section aria-label="Next" className="flex min-h-0 flex-col">
    <div className="flex h-8 items-center gap-2 px-2">
      <h3 className="text-sm font-semibold">Next</h3>
      <Badge variant="outline" size="sm" className="rounded-full tabular-nums">{ids.length}</Badge>
      {stable.pendingMoves > 0 && <Button size="xs" variant="secondary" className="ms-auto" onClick={stable.apply}><ArrowDownUp className="size-3.5" />New order ({stable.pendingMoves} moved) · Apply</Button>}
    </div>
    <span className="sr-only" aria-live="polite">{stable.pendingMoves > 0 ? `New order available, ${stable.pendingMoves} moved` : ''}</span>
    {!ids.length ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">{needle ? 'No tasks match your search.' : 'Nothing in Next. Accept tasks from Triage or move them from the Board.'}</p>
      : <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          <ol {...stable.listProps} className="flex flex-col gap-0.5">
            {visible.map((id, index) => {
              const task = tasks.get(id)!;
              return <HyperRankedRow key={id} task={task} rank={index + 1} ranked={ranking.get(id)} nowMs={nowMs} zone={snapshot.settings.zone} actions={actions} recommended={id === recommendedId} write={writes?.get(id)} />;
            })}
          </ol>
        </SortableContext>
      </DndContext>}
    {ids.length > visible.length && <p className="px-2 pt-2 text-xs text-muted-foreground">+{ids.length - visible.length} more · narrow with search or Sources</p>}
  </section>;
}

function HyperOverflow({ today, locale, zone }: { today: HyperFocusToday; locale: HyperHubReasonLocale; zone: string }) {
  // Waiting work uses no planned time (spec D2), so it is not "didn't fit".
  const entries = today.unscheduled.filter(entry => entry.task.state !== 'waiting');
  if (!entries.length) return null;
  return <section aria-label="Didn't fit today" className="rounded-lg border p-3">
    <h3 className="text-xs font-medium text-muted-foreground">Didn&apos;t fit today · {entries.length}</h3>
    <ul className="mt-2 flex flex-col gap-1.5">
      {entries.map(({ task, code, facts }) => <li key={task.id} className="flex min-w-0 items-baseline gap-2 text-sm">
        <bdi dir="auto" className="min-w-0 flex-1 truncate">{task.title}</bdi>
        <span className="shrink-0 text-xs text-muted-foreground">{hyperFormatOverflow({ code, facts }, locale, zone)}</span>
      </li>)}
    </ul>
  </section>;
}

export function HyperFocusView({ snapshot, today, filters, query, nowMs, actions, onDeclareWindow, onReschedule, writes, differs }: HyperFocusViewProps) {
  const locale = useHyperHubReasonLocale();
  const [promptOpen, setPromptOpen] = useState(false);
  const zone = snapshot.settings.zone;
  const left: ReactNode = <div className="flex min-h-0 min-w-0 flex-col gap-4">
    <HyperDoFirstCard today={today} snapshot={snapshot} nowMs={nowMs} actions={actions} differs={differs} />
    <HyperRankedList snapshot={snapshot} filters={filters} query={query} nowMs={nowMs} actions={actions} recommendedId={today.recommendation?.task.id} writes={writes} />
  </div>;
  return <div data-hyper-focus className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="order-2 lg:order-1">{left}</div>
      <aside aria-label="Today" className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
        {today.needsOwnerWindow || promptOpen
          ? <HyperOwnerWindowPrompt snapshot={snapshot} reason={today.needsOwnerWindow ? 'missing' : 'manual'} onDeclare={windows => { onDeclareWindow(windows); setPromptOpen(false); }} onCancel={today.needsOwnerWindow ? undefined : () => setPromptOpen(false)} />
          : null}
        {!today.needsOwnerWindow && <HyperDayPlan snapshot={snapshot} today={today} nowMs={nowMs} onReschedule={onReschedule} onDeclare={() => setPromptOpen(true)} onOpenMeeting={meetingId => useHyperHubBriefRequest.getState().open(meetingId)} />}
        <HyperOverflow today={today} locale={locale} zone={zone} />
      </aside>
    </div>
  </div>;
}

export function HyperFocusEmpty() {
  return <Empty className="flex-1"><EmptyHeader><EmptyMedia variant="icon"><Play className="size-5" /></EmptyMedia><EmptyTitle>Nothing to focus on</EmptyTitle><EmptyDescription>Accept tasks from Triage or connect more sources to plan your day.</EmptyDescription></EmptyHeader></Empty>;
}
