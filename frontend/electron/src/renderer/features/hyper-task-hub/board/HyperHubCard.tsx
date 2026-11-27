// HyperHubCard: one Hub task on the Board. Shows source identity, the source's own status next to the
// local column (spec D9.7), due, effort (estimates marked), priority tier, blockers, pin and snooze.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowRightLeft, Check, Clock, Lock, Merge, MoreHorizontal, PencilLine, Pin, PinOff, Repeat2, Split, SquareArrowOutUpRight, SquareKanban, X } from 'lucide-react';
import type { HyperHubFeedback, HyperHubRanked, HyperHubSourceRef, HyperHubState, HyperHubStatusIntent, HyperHubTaskView, HyperHubWriteSource, HyperHubWriteView } from '@shared/HyperTaskHub';
import { KanbanItem, KanbanItemHandle } from '@/components/reui/kanban';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { hyperHubDueLabel, hyperHubEffortLabel, hyperHubInDays, hyperHubNextWorkdayMorning, hyperHubPriorityOf, hyperHubPriorityTier, hyperHubStatusName } from '../HyperTaskHubFormat';
import { HyperHubSourceBadge } from '../HyperHubSource';
import { HyperWriteBadge } from '../writeback/HyperWriteBadge';
import { hyperWriteSourceName } from '../writeback/HyperWriteBackDialog';
import { hyperWritableSources } from '../writeback/useHyperWriteBackFlow';
import { hyperWriteRejectText } from '../writeback/hyperWriteBackText';
import type { HyperHubStatusDiffers } from '../state/HyperTaskHubSelectors';

type HyperHubDistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A feedback event before the view adds the target and snapshot version. */
export type HyperHubFeedbackInput = HyperHubDistributiveOmit<HyperHubFeedback, 'scopeGeneration' | 'expectedRevision' | 'targetId'>;

export interface HyperHubCardActions {
  feedback: (task: HyperHubTaskView, event: HyperHubFeedbackInput) => void;
  openSource: (source: HyperHubSourceRef) => void;
  /** Opens the write-back review (M5 E1.9). Never writes by itself. */
  changeStatus?: (task: HyperHubTaskView, source: HyperHubSourceRef, write: HyperHubWriteSource, intent: HyperHubStatusIntent) => void;
  /** Records the owner's release of a held task (M5 E1.7). */
  releaseHold?: (write: HyperHubWriteView) => void;
  /** Opens the explicit Add to Hyper-Kanban confirmation (M5 E7). */
  addToKanban?: (task: HyperHubTaskView) => void;
  /** Opens the task's Hyper-Kanban row. */
  openMirror?: (task: HyperHubTaskView, handle: string) => void;
}

/** A write-capable source whose status disagrees with the card's local state (M5 E1.9), from Sol's selector. */
export type { HyperHubStatusDiffers };

export const hyperHubStateLabels: Record<HyperHubState, string> = {
  review: 'Triage', ready: 'Next', doing: 'In progress', waiting: 'Waiting', done: 'Done', dismissed: 'Dismissed',
};

interface HyperHubCardProps {
  task: HyperHubTaskView;
  ranked?: HyperHubRanked;
  /** 1-based position, shown in Next only. */
  rank?: number;
  nowMs: number;
  zone: string;
  workdays: readonly number[];
  actions: HyperHubCardActions;
  why?: ReactNode;
  /** A fuzzy duplicate the owner can merge or keep separate (spec D5.3). */
  suggestion?: { other: HyperHubTaskView; facts: readonly string[] };
  /** The suggestion's language cohort has not passed the precision gate yet (spec D4.5). */
  preview?: boolean;
  /** The task is part of a reported dependency cycle (spec D5.4). */
  inCycle?: boolean;
  /** The task's latest source write (M5 E8). */
  write?: HyperHubWriteView;
  /** The first write-capable source whose status disagrees with the local state (M5 E1.9). */
  differs?: HyperHubStatusDiffers;
  overlay?: boolean;
  dragging?: boolean;
  disabled?: boolean;
}

/** The authored sentence with its trigger highlighted, when the span offsets fall inside the excerpt. */
function HyperHubExcerpt({ span }: { span: NonNullable<HyperHubTaskView['reviewSpan']> }) {
  const { excerpt, start, end } = span;
  const marked = start !== undefined && end !== undefined && start >= 0 && end > start && end <= excerpt.length;
  return <blockquote dir="auto" className="line-clamp-3 border-s-2 border-border ps-2 text-xs text-muted-foreground">
    “{marked ? <>{excerpt.slice(0, start)}<mark className="rounded-sm bg-warning/15 px-0.5 text-foreground">{excerpt.slice(start, end)}</mark>{excerpt.slice(end)}</> : excerpt}”
  </blockquote>;
}

/** Source-changing entries (M5): one status change per write-capable reference, and the Hyper-Kanban mirror. */
export function HyperHubCardSourceItems({ task, actions, write }: { task: HyperHubTaskView; actions: HyperHubCardActions; write?: HyperHubWriteView }) {
  const writable = actions.changeStatus ? hyperWritableSources(task) : [];
  const mirror = task.mirror;
  const canMirror = !!actions.addToKanban && mirror?.exists === false && mirror.eligible;
  const openMirror = !!actions.openMirror && mirror?.exists === true;
  if (!writable.length && !canMirror && !openMirror) return null;
  const held = write?.held && !write.ownerReleasedAt;
  return <>
    <DropdownMenuSeparator />
    {writable.map(({ source, write: writeSource }) => {
      const name = hyperWriteSourceName[writeSource];
      const blocked = held ? `Task Hub is waiting to confirm an earlier change in ${name}.` : source.statusWrite?.available === false && source.statusWrite.code ? hyperWriteRejectText(source.statusWrite.code, writeSource) : null;
      return <DropdownMenuItem key={source.evidenceId} title={blocked ?? undefined}
        onClick={() => actions.changeStatus!(task, source, writeSource, { kind: 'choose' })}>
        <ArrowRightLeft className="size-4" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">Change status in {name}{writable.length > 1 || writeSource === 'jira' ? <> (<bdi>{source.label}</bdi>)</> : null}…</span>
          {blocked && <span className="truncate text-2xs text-muted-foreground">{held ? `Waiting for ${name} to confirm` : 'Not available'}</span>}
        </span>
      </DropdownMenuItem>;
    })}
    {canMirror && <DropdownMenuItem onClick={() => actions.addToKanban!(task)}><SquareKanban className="size-4" />Add to Hyper-Kanban…</DropdownMenuItem>}
    {openMirror && mirror?.exists && <DropdownMenuItem onClick={() => actions.openMirror!(task, mirror.handle)}><SquareKanban className="size-4" />Open in Hyper-Kanban</DropdownMenuItem>}
  </>;
}

function HyperHubCardMenu({ task, actions, nowMs, workdays, write }: Pick<HyperHubCardProps, 'task' | 'actions' | 'nowMs' | 'workdays' | 'write'>) {
  const triage = task.state === 'review';
  const openable = task.sources.filter(source => source.openable);
  const move = (state: HyperHubState) => actions.feedback(task, { type: 'set-state', state });
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${task.title}`}
      className="opacity-0 group-hover/hub-card:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} />}>
      <MoreHorizontal className="size-3.5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      {triage ? <>
        <DropdownMenuItem onClick={() => actions.feedback(task, { type: 'accept' })}><Check className="size-4" />Accept into Next</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => actions.feedback(task, { type: 'dismiss' })}><X className="size-4" />Dismiss</DropdownMenuItem>
      </> : <>
        {task.pinned
          ? <DropdownMenuItem onClick={() => actions.feedback(task, { type: 'unpin' })}><PinOff className="size-4" />Unpin</DropdownMenuItem>
          : <DropdownMenuItem onClick={() => actions.feedback(task, { type: 'pin' })}><Pin className="size-4" />Pin to top</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => actions.feedback(task, { type: 'snooze', until: { kind: 'instant', iso: hyperHubNextWorkdayMorning(nowMs, workdays) } })}><Clock className="size-4" />Snooze until next workday</DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.feedback(task, { type: 'snooze', until: { kind: 'instant', iso: hyperHubInDays(nowMs, 7) } })}><Clock className="size-4" />Snooze for a week</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {(['ready', 'doing', 'waiting', 'done'] as const).filter(state => state !== task.state).map(state =>
            <DropdownMenuItem key={state} onClick={() => move(state)}>{state === 'done' ? 'Done for me' : hyperHubStateLabels[state]}</DropdownMenuItem>)}
        </DropdownMenuGroup>
      </>}
      {openable.length > 0 && <>
        <DropdownMenuSeparator />
        {openable.map(source => <DropdownMenuItem key={source.evidenceId} onClick={() => actions.openSource(source)}>
          <SquareArrowOutUpRight className="size-4" /><span className="truncate">Open <bdi>{source.label}</bdi></span>
        </DropdownMenuItem>)}
      </>}
      {!triage && <HyperHubCardSourceItems task={task} actions={actions} write={write} />}
      {!!task.mergeEntryIds?.length && <>
        <DropdownMenuSeparator />
        {task.mergeEntryIds.map((mergeEntryId, index) => <DropdownMenuItem key={mergeEntryId} onClick={() => actions.feedback(task, { type: 'split', mergeEntryId })}>
          <Split className="size-4" />{task.mergeEntryIds!.length > 1 ? `Undo merge ${index + 1}` : 'Split merged task'}
        </DropdownMenuItem>)}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function HyperHubCard({ task, ranked, rank, nowMs, zone, workdays, actions, why, suggestion, preview, inCycle, write, differs, overlay = false, dragging = false, disabled }: HyperHubCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const primary = task.sources[0];
  const due = task.due && hyperHubDueLabel(task.due, nowMs, zone);
  const effort = hyperHubEffortLabel(task);
  const priority = hyperHubPriorityOf(task);
  const rawStatus = primary ? task.sourceStatus[primary.evidenceId]?.rawStatus : undefined;
  const sourceStatus = rawStatus && primary ? hyperHubStatusName(primary.kind, rawStatus) : rawStatus;
  const blocked = task.blockedBy.some(edge => !edge.resolvedByOwner);
  const snoozed = task.snoozeUntil && Date.parse(task.snoozeUntil.iso) > nowMs;
  const triage = task.state === 'review';
  const className = cn(
    'group/hub-card rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    dragging ? 'border-dashed border-muted-foreground/40 bg-transparent shadow-none' : 'border-border bg-card shadow-xs hover:bg-accent/50',
    triage && !dragging && 'border-dashed',
    overlay && 'w-68 rotate-2 cursor-grabbing shadow-lg ring-1 ring-foreground/10',
  );
  const content = <div className={cn('flex flex-col gap-2', dragging && 'opacity-40')}>
    <div className="flex min-w-0 items-center gap-1">
      {rank !== undefined && <span className="w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground" aria-label={`Rank ${rank}`}>{rank}</span>}
      {primary ? <HyperHubSourceBadge source={primary} /> : <Badge variant="outline" size="sm" className="font-normal text-muted-foreground">Source unavailable</Badge>}
      {task.sources.length > 1 && <Badge variant="secondary" size="sm" title={task.sources.slice(1).map(source => source.label).join(', ')}>+{task.sources.length - 1}</Badge>}
      {task.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground" />}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {why}
        {!overlay && <HyperHubCardMenu task={task} actions={actions} nowMs={nowMs} workdays={workdays} write={write} />}
      </span>
    </div>
    {editing && !overlay
      ? <Input autoFocus dir="auto" aria-label="Task title" className="h-8 text-sm" value={draft} onChange={event => setDraft(event.target.value)}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape') { setEditing(false); setDraft(task.title); }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault(); setEditing(false);
              if (draft.trim() && draft.trim() !== task.title) actions.feedback(task, { type: 'edit', title: draft.trim() });
            }
          }}
          onBlur={() => { setEditing(false); setDraft(task.title); }} />
      : <p dir="auto" className="line-clamp-2 text-sm font-medium">{task.title}</p>}
    {triage && task.reviewSpan && <>
      <HyperHubExcerpt span={task.reviewSpan} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
        {preview && <Badge variant="info-light" size="sm" title="Suggestions in this language are still being measured for accuracy">Suggestion (preview)</Badge>}
        <span>{task.reviewSpan.rule}</span>
        {task.reviewSpan.inferredOwner && <span>· for <bdi>{task.reviewSpan.inferredOwner}</bdi></span>}
        {task.reviewSpan.resolvedDate && <span>· by {hyperHubDueLabel(task.reviewSpan.resolvedDate, nowMs, zone).text}</span>}
      </p>
    </>}
    {suggestion && !overlay && <div className="rounded-md border border-dashed px-2 py-1.5 text-xs">
      <p className="text-muted-foreground">Possibly the same as <bdi dir="auto" className="font-medium text-foreground">{suggestion.other.title}</bdi></p>
      {suggestion.facts.length > 0 && <p className="mt-0.5 text-2xs text-muted-foreground">{suggestion.facts.join(' · ')}</p>}
      <div className="mt-1.5 flex gap-1.5">
        <Button type="button" size="xs" variant="outline" onPointerDown={event => event.stopPropagation()} onClick={() => actions.feedback(task, { type: 'merge', otherTaskId: suggestion.other.id })}><Merge className="size-3.5" />Merge</Button>
        <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onPointerDown={event => event.stopPropagation()} onClick={() => actions.feedback(task, { type: 'reject-match', otherTaskId: suggestion.other.id })}>Keep separate</Button>
      </div>
    </div>}
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {priority && <Badge size="sm" variant={hyperHubPriorityTier[priority.priority].variant} title={priority.origin === 'source' ? 'From Jira priority' : 'Your priority'}>{hyperHubPriorityTier[priority.priority].label}</Badge>}
      {due && <span title={due.title} className={cn('tabular-nums', due.overdue && 'font-medium text-destructive', due.soon && 'text-foreground')}>{due.text}</span>}
      <span title={effort.title} className="tabular-nums">{effort.text}</span>
      {blocked && <span className="flex items-center gap-1" title="Waiting on a prerequisite"><Lock aria-hidden="true" className="size-3" />Blocked</span>}
      {inCycle && <span className="flex items-center gap-1 text-warning-foreground dark:text-warning" title="These tasks depend on each other in a loop. Unlink one dependency to plan them."><Repeat2 aria-hidden="true" className="size-3" />Dependency loop</span>}
      {snoozed && <span className="flex items-center gap-1"><Clock aria-hidden="true" className="size-3" />Snoozed</span>}
      {differs && !overlay && actions.changeStatus && !(write?.held && !write.ownerReleasedAt)
        ? <button type="button" className="ms-auto inline-flex max-w-40 items-center gap-1 rounded-sm text-warning-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-warning"
            title={`${hyperWriteSourceName[differs.write]} still shows ${differs.observedName}. Review a status change.`}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => actions.changeStatus!(task, differs.source, differs.write, differs.intent)}>
            <ArrowRightLeft aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{hyperWriteSourceName[differs.write]}: <bdi>{hyperHubStatusName(differs.write, differs.observedName)}</bdi></span>
          </button>
        : sourceStatus && <span className="ms-auto max-w-32 truncate" title={`${primary?.label}: ${sourceStatus}`}>{primary?.kind === 'jira' ? 'Jira: ' : ''}<bdi>{sourceStatus}</bdi></span>}
    </div>
    {write && !overlay && <div className="flex" onPointerDown={event => event.stopPropagation()}>
      <HyperWriteBadge write={write} failureText={write.code ? hyperWriteRejectText(write.code, write.source) : undefined}
        onCheckInSource={(() => { const source = task.sources.find(item => item.evidenceId === write.evidenceId); return source?.openable ? () => actions.openSource(source) : undefined; })()}
        onRelease={actions.releaseHold ? () => actions.releaseHold!(write) : undefined} />
    </div>}
    {triage && !overlay && <div className="flex gap-1.5">
      <Button type="button" size="xs" variant="outline" onPointerDown={event => event.stopPropagation()} onClick={() => actions.feedback(task, { type: 'accept' })}><Check className="size-3.5" />Accept</Button>
      <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onPointerDown={event => event.stopPropagation()} onClick={() => { setDraft(task.title); setEditing(true); }}><PencilLine className="size-3.5" />Edit</Button>
      <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onPointerDown={event => event.stopPropagation()} onClick={() => actions.feedback(task, { type: 'dismiss' })}><X className="size-3.5" />Dismiss</Button>
    </div>}
    {ranked && !ranked.feasibility.ready && ranked.feasibility.code !== 'waiting' && <span className="sr-only">Cannot be scheduled: {ranked.feasibility.code}</span>}
  </div>;
  if (overlay) return <div className={className}>{content}</div>;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target !== event.currentTarget) return;
    const key = event.key.toLowerCase();
    const run = (fn: () => void) => { event.preventDefault(); event.stopPropagation(); fn(); };
    if (event.key === 'Enter' && primary?.openable) run(() => actions.openSource(primary));
    else if (key === 'o' && primary?.openable) run(() => actions.openSource(primary));
    else if (key === 'a' && triage) run(() => actions.feedback(task, { type: 'accept' }));
    else if (key === 'd' && triage) run(() => actions.feedback(task, { type: 'dismiss' }));
    else if (key === 'e' && triage) run(() => { setDraft(task.title); setEditing(true); });
    else if (key === 'l' && suggestion) run(() => actions.feedback(task, { type: 'merge', otherTaskId: suggestion.other.id }));
    else if (key === 's' && !triage) run(() => actions.feedback(task, { type: 'snooze', until: { kind: 'instant', iso: hyperHubNextWorkdayMorning(nowMs, workdays) } }));
    else if (key === 'p' && !triage) run(() => actions.feedback(task, { type: task.pinned ? 'unpin' : 'pin' }));
    else if (key === 'x' && !triage && task.state !== 'done') run(() => actions.feedback(task, { type: 'set-state', state: 'done' }));
  };
  return <KanbanItem value={task.id} disabled={disabled} role="presentation" tabIndex={-1} className={cn('shrink-0', dragging && 'opacity-100!')}>
    <KanbanItemHandle role="button" tabIndex={0} aria-roledescription="draggable card" aria-label={task.title}
      aria-keyshortcuts={triage ? 'A D E O' : 'O P S X'} className={className} onKeyDownCapture={onKeyDown}>
      {content}
    </KanbanItemHandle>
  </KanbanItem>;
}
