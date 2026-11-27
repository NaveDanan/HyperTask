// Matrix (M5 E3): Sol's D6 axes as four quadrants plus a Needs details tray. A drag, or "Move to" in the
// card menu, records a named local override with Undo. It never changes scores, the plan, eligibility or a
// source. Waiting and blocked cards stay in their quadrant with their blocker shown.
import { useMemo, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Hand, Info, Lock, MoreHorizontal, Repeat2, SquareArrowOutUpRight } from 'lucide-react';
import type { HyperHubMatrixQuadrant, HyperHubSnapshot, HyperHubTaskView, HyperHubWriteView } from '@shared/HyperTaskHub';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { HyperHubCardSourceItems, type HyperHubCardActions } from '../board/HyperHubCard';
import { HyperHubSourceBadge } from '../HyperHubSource';
import { hyperHubDueLabel, hyperHubEffortLabel } from '../HyperTaskHubFormat';
import { useHyperHubReasonLocale } from '../HyperWhyPopover';
import { hyperFormatMatrixReason } from '../state/HyperTaskHubReasons';
import { hyperSelectMatrix, type HyperHubFilters, type HyperHubMatrixCard } from '../state/HyperTaskHubSelectors';
import { HyperWriteBadge } from '../writeback/HyperWriteBadge';

export const hyperMatrixQuadrants: { id: HyperHubMatrixQuadrant; title: string; caption?: string }[] = [
  { id: 'urgent-important', title: 'Urgent and important' },
  { id: 'important', title: 'Important', caption: 'Schedule' },
  { id: 'urgent', title: 'Urgent', caption: 'Fit in' },
  { id: 'neither', title: 'Neither', caption: 'Later' },
];
const hyperMatrixTitle = (id: HyperHubMatrixQuadrant) => hyperMatrixQuadrants.find(item => item.id === id)!.title;

export interface HyperMatrixViewProps {
  snapshot: HyperHubSnapshot;
  filters?: HyperHubFilters;
  query: string;
  nowMs: number;
  actions: HyperHubCardActions;
  writes?: ReadonlyMap<string, HyperHubWriteView>;
  /** Records the owner's quadrant override (feedback `set-matrix-quadrant`). */
  onQuadrant: (task: HyperHubTaskView, quadrant: HyperHubMatrixQuadrant) => void;
}

function hyperBlockerLabel(card: HyperHubMatrixCard): { text: string; icon: ReactNode } | null {
  if (!card.blocker) return null;
  if (card.blocker.code === 'waiting') return { text: 'Waiting', icon: <Hand className="size-3" /> };
  if (card.blocker.code === 'cycle') return { text: 'Dependency loop', icon: <Repeat2 className="size-3" /> };
  return { text: 'Blocked', icon: <Lock className="size-3" /> };
}

function HyperMatrixReasons({ card }: { card: HyperHubMatrixCard }) {
  const locale = useHyperHubReasonLocale();
  if (!card.reasons.length) return null;
  return <Popover>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`Why is "${card.task.title}" here?`} className="text-muted-foreground" onPointerDown={event => event.stopPropagation()} />}>
      <Info className="size-3.5" />
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 gap-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground">Why it is here</p>
      <ul className="flex flex-col gap-1.5">
        {card.reasons.map((reason, index) => <li key={index} dir="auto" className="text-sm">{hyperFormatMatrixReason(reason, locale)}</li>)}
      </ul>
    </PopoverContent>
  </Popover>;
}

function HyperMatrixCardBody({ card, quadrant, nowMs, zone, actions, write, onQuadrant, overlay }: {
  card: HyperHubMatrixCard; quadrant: HyperHubMatrixQuadrant | null; nowMs: number; zone: string; actions: HyperHubCardActions;
  write?: HyperHubWriteView; onQuadrant: HyperMatrixViewProps['onQuadrant']; overlay?: boolean;
}) {
  const { task } = card;
  const primary = task.sources[0];
  const due = task.due && hyperHubDueLabel(task.due, nowMs, zone);
  const effort = hyperHubEffortLabel(task);
  const blocker = hyperBlockerLabel(card);
  const locale = useHyperHubReasonLocale();
  const missing = quadrant === null ? card.reasons.filter(reason => reason.kind === 'missing') : [];
  return <div className={cn('flex flex-col gap-1.5 rounded-md border bg-card p-2 text-start shadow-xs', overlay && 'w-64 rotate-1 shadow-lg ring-1 ring-foreground/10', !!blocker && 'bg-muted/30')}>
    <div className="flex min-w-0 items-center gap-1">
      {primary && <HyperHubSourceBadge source={primary} />}
      {card.override && <Badge variant="primary-light" size="sm">Moved by you</Badge>}
      {blocker && <Badge variant="outline" size="sm" className="gap-1 font-normal text-muted-foreground">{blocker.icon}{blocker.text}</Badge>}
      {!overlay && <span className="ms-auto flex shrink-0 items-center">
        <HyperMatrixReasons card={card} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${task.title}`} className="text-muted-foreground" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} />}>
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {hyperMatrixQuadrants.filter(item => item.id !== quadrant).map(item => <DropdownMenuItem key={item.id} onClick={() => onQuadrant(task, item.id)}>
                {item.title}{item.caption && <span className="ms-auto text-xs text-muted-foreground">{item.caption}</span>}
              </DropdownMenuItem>)}
            </DropdownMenuGroup>
            {primary?.openable && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => actions.openSource(primary)}><SquareArrowOutUpRight className="size-4" /><span className="truncate">Open <bdi>{primary.label}</bdi></span></DropdownMenuItem></>}
            <HyperHubCardSourceItems task={task} actions={actions} write={write} />
          </DropdownMenuContent>
        </DropdownMenu>
      </span>}
    </div>
    <p dir="auto" className="line-clamp-2 text-sm font-medium">{task.title}</p>
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      {due && <span title={due.title} className={cn('tabular-nums', due.overdue && 'font-medium text-destructive')}>{due.text}</span>}
      <span title={effort.title} className="tabular-nums">{effort.text}</span>
    </p>
    {missing.length > 0 && <p className="text-xs text-muted-foreground">{missing.map(reason => hyperFormatMatrixReason(reason, locale)).join(' · ')}</p>}
    {write && !overlay && <div onPointerDown={event => event.stopPropagation()}><HyperWriteBadge write={write}
      onCheckInSource={(() => { const source = task.sources.find(item => item.evidenceId === write.evidenceId); return source?.openable ? () => actions.openSource(source) : undefined; })()}
      onRelease={actions.releaseHold ? () => actions.releaseHold!(write) : undefined} /></div>}
  </div>;
}

function HyperMatrixDraggable(props: Parameters<typeof HyperMatrixCardBody>[0] & { active: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: props.card.task.id });
  return <li ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="draggable card" aria-label={props.card.task.title}
    className={cn('cursor-grab rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', props.active && 'opacity-40')}>
    <HyperMatrixCardBody {...props} />
  </li>;
}

function HyperMatrixCell({ id, title, caption, count, overflow, children }: { id: string; title: string; caption?: string; count: number; overflow: number; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return <section ref={setNodeRef} aria-label={title} data-hyper-matrix-quadrant={id}
    className={cn('flex min-h-48 min-w-0 flex-col gap-2 rounded-xl border bg-muted/20 p-3 transition-colors', isOver && 'border-ring bg-accent/40', id === 'urgent-important' && 'bg-muted/40')}>
    <header className="flex items-baseline gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
      <Badge variant="outline" size="sm" className="ms-auto rounded-full tabular-nums">{count + overflow}</Badge>
    </header>
    {count === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Nothing here</p> : <ul className="flex flex-col gap-1.5">{children}</ul>}
    {overflow > 0 && <p className="text-xs text-muted-foreground">+{overflow} more · narrow with search or Sources</p>}
  </section>;
}

export function HyperMatrixView({ snapshot, filters, query, nowMs, actions, writes, onQuadrant }: HyperMatrixViewProps) {
  const matrix = useMemo(() => hyperSelectMatrix(snapshot, filters), [snapshot, filters]);
  const [active, setActive] = useState<string | null>(null);
  const zone = snapshot.settings.zone;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (card: HyperHubMatrixCard) => !needle || card.task.title.toLocaleLowerCase().includes(needle) || card.task.sources.some(source => source.label.toLocaleLowerCase().includes(needle));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const placement = useMemo(() => {
    const where = new Map<string, { card: HyperHubMatrixCard; quadrant: HyperHubMatrixQuadrant | null }>();
    for (const cell of matrix.quadrants) for (const card of cell.cards) where.set(card.task.id, { card, quadrant: cell.quadrant });
    for (const card of matrix.needsDetails) where.set(card.task.id, { card, quadrant: null });
    return where;
  }, [matrix]);
  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActive(null);
    const target = over?.id as HyperHubMatrixQuadrant | undefined;
    const entry = placement.get(String(dragged.id));
    if (!entry || !target || target === entry.quadrant || !hyperMatrixQuadrants.some(item => item.id === target)) return;
    onQuadrant(entry.card.task, target);
  };
  const cell = (id: HyperHubMatrixQuadrant) => {
    const data = matrix.quadrants.find(item => item.quadrant === id);
    const cards = (data?.cards ?? []).filter(matches);
    const meta = hyperMatrixQuadrants.find(item => item.id === id)!;
    return <HyperMatrixCell key={id} id={id} title={meta.title} caption={meta.caption} count={cards.length} overflow={data?.overflowCount ?? 0}>
      {cards.map(card => <HyperMatrixDraggable key={card.task.id} card={card} quadrant={id} nowMs={nowMs} zone={zone} actions={actions} write={writes?.get(card.task.id)} onQuadrant={onQuadrant} active={active === card.task.id} />)}
    </HyperMatrixCell>;
  };
  const details = matrix.needsDetails.filter(matches);
  const dragged = active ? placement.get(active) : undefined;

  return <DndContext sensors={sensors} onDragStart={event => setActive(String(event.active.id))} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
    <div data-hyper-matrix className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[auto_auto_auto] gap-3">
          <span />
          <p className="text-center text-xs font-medium text-muted-foreground">Urgent</p>
          <p className="text-center text-xs font-medium text-muted-foreground">Not urgent</p>
          <p className="flex items-center justify-center text-xs font-medium text-muted-foreground [writing-mode:vertical-rl] rotate-180">Important</p>
          {cell('urgent-important')}
          {cell('important')}
          <p className="flex items-center justify-center text-xs font-medium text-muted-foreground [writing-mode:vertical-rl] rotate-180">Not important</p>
          {cell('urgent')}
          {cell('neither')}
        </div>
        {details.length > 0 && <section aria-label="Needs details" className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          <header className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">Needs details</h3>
            <span className="text-xs text-muted-foreground">Task Hub can&apos;t place these yet. Drag one to a quadrant to place it yourself.</span>
            <Badge variant="outline" size="sm" className="ms-auto rounded-full tabular-nums">{details.length}</Badge>
          </header>
          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {details.map(card => <HyperMatrixDraggable key={card.task.id} card={card} quadrant={null} nowMs={nowMs} zone={zone} actions={actions} write={writes?.get(card.task.id)} onQuadrant={onQuadrant} active={active === card.task.id} />)}
          </ul>
        </section>}
        <p className="text-xs text-muted-foreground">Moving a card here changes only where it sits in the Matrix. Its rank, its plan and its sources stay the same.</p>
      </div>
    </div>
    <DragOverlay dropAnimation={null}>
      {dragged && <HyperMatrixCardBody card={dragged.card} quadrant={dragged.quadrant} nowMs={nowMs} zone={zone} actions={actions} onQuadrant={onQuadrant} overlay />}
    </DragOverlay>
  </DndContext>;
}

export { hyperMatrixTitle };
