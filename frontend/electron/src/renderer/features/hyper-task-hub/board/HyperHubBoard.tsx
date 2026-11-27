// HyperHubBoard: Triage, Next, In progress, Waiting, Done (today). Built on the vendored ReUI Kanban
// with the column/card recipes of HyperBoardView. Drops change local state only (spec D9.2, D10):
// Triage → Next accepts, a move between columns sets the personal state, and a move inside Next
// records a manual order. Columns cannot be reordered.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import type { HyperHubRanked, HyperHubState, HyperHubTaskView, HyperHubWriteView } from '@shared/HyperTaskHub';
import { Kanban, KanbanBoard, KanbanColumn, KanbanColumnContent, KanbanOverlay, type KanbanCommitMeta } from '@/components/reui/kanban';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { HyperHubCard, hyperHubStateLabels, type HyperHubCardActions, type HyperHubStatusDiffers } from './HyperHubCard';

export type HyperHubBoardColumnId = Extract<HyperHubState, 'review' | 'ready' | 'doing' | 'waiting' | 'done'>;
export interface HyperHubBoardColumnModel {
  id: HyperHubBoardColumnId;
  /** Visible cards in display order. */
  taskIds: string[];
  /** Cards beyond the visible cap; they keep their relative order. */
  overflow: number;
  /** The first hidden card, so a drop at the visible end lands before it rather than at the very end. */
  firstOverflowId?: string;
}
type HyperHubBoardValue = Record<string, string[]>;

interface HyperHubBoardProps {
  columns: HyperHubBoardColumnModel[];
  /** 1-based positions in ranked Next order, independent of the text search. */
  ranks: ReadonlyMap<string, number>;
  tasks: ReadonlyMap<string, HyperHubTaskView>;
  ranking: ReadonlyMap<string, HyperHubRanked>;
  nowMs: number;
  zone: string;
  workdays: readonly number[];
  actions: HyperHubCardActions;
  renderWhy?: (task: HyperHubTaskView, ranked: HyperHubRanked) => ReactNode;
  /** Fuzzy duplicates by task id, offered as Merge / Keep separate. */
  suggestions?: ReadonlyMap<string, { other: HyperHubTaskView; facts: readonly string[] }>;
  /** True when a Triage suggestion's language cohort is still in preview. */
  isPreview?: (task: HyperHubTaskView) => boolean;
  /** Task ids in a reported dependency cycle. */
  cycles?: ReadonlySet<string>;
  /** The latest source write per task (M5 E8). */
  writes?: ReadonlyMap<string, HyperHubWriteView>;
  /** Status-differs chips per task (M5 E1.9). */
  differs?: (task: HyperHubTaskView) => HyperHubStatusDiffers | undefined;
  /** Cards shown per column before "+N more". */
  visibleCap: number;
  triageCollapsed: boolean;
  onTriageCollapsed: (collapsed: boolean) => void;
}

const hyperHubColumnHints: Partial<Record<HyperHubBoardColumnId, string>> = {
  review: 'Suggested tasks. Accept or dismiss them.',
  done: 'Completed today.',
};

const hyperHubBoardValue = (columns: HyperHubBoardColumnModel[], triageCollapsed: boolean): HyperHubBoardValue =>
  Object.fromEntries(columns.filter(column => !(column.id === 'review' && triageCollapsed)).map(column => [column.id, column.taskIds]));

function HyperHubColumn({ column, children, over, visibleCap, onCollapse }: {
  column: HyperHubBoardColumnModel; children: ReactNode; over: boolean; visibleCap: number; onCollapse?: () => void;
}) {
  const label = hyperHubStateLabels[column.id];
  const total = column.taskIds.length + column.overflow;
  const triage = column.id === 'review';
  return <KanbanColumn value={column.id} aria-label={`${label} column`} data-hyper-hub-column={column.id}
    className={cn('h-full max-h-full min-h-0 w-72 shrink-0 rounded-lg bg-muted/50 dark:bg-muted/30',
      triage && 'border border-dashed border-border bg-transparent dark:bg-transparent',
      over && 'bg-muted ring-1 ring-ring/40 dark:bg-muted')}>
    <div className="flex h-10 shrink-0 items-center gap-2 px-2">
      {triage && <Inbox aria-hidden="true" className="size-4 text-muted-foreground" />}
      <span className="truncate text-sm font-semibold">{label}</span>
      <Badge variant="outline" size="sm" className="shrink-0 rounded-full tabular-nums">{total}</Badge>
      {onCollapse && <Button type="button" variant="ghost" size="icon-xs" className="ms-auto" aria-label="Collapse Triage" onClick={onCollapse}><ChevronsLeft className="size-3.5" /></Button>}
    </div>
    {hyperHubColumnHints[column.id] && <p className="px-2 pb-1.5 text-2xs text-muted-foreground">{hyperHubColumnHints[column.id]}</p>}
    <KanbanColumnContent value={column.id} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-0.5">
      {children}
      {!column.taskIds.length && <div className={cn('grid h-16 shrink-0 place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground', over && 'border-ring/40')}>
        {triage ? 'Nothing to triage' : 'No cards'}
      </div>}
    </KanbanColumnContent>
    {column.overflow > 0 && <p className="mx-2 mb-2 shrink-0 px-1 text-xs text-muted-foreground" title={`Only the first ${visibleCap} cards are shown. Search or filter by source to narrow the column.`}>
      +{column.overflow} more · narrow with search or Sources
    </p>}
  </KanbanColumn>;
}

export function HyperHubBoard({ columns, ranks, tasks, ranking, nowMs, zone, workdays, actions, renderWhy, suggestions, isPreview, cycles, writes, differs, visibleCap, triageCollapsed, onTriageCollapsed }: HyperHubBoardProps) {
  const incoming = useMemo(() => hyperHubBoardValue(columns, triageCollapsed), [columns, triageCollapsed]);
  const [value, setValue] = useState(incoming);
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragging = useRef(false);
  // A new snapshot replaces the local preview, except mid-drag (the drop commits against the drag's origin).
  useEffect(() => { if (!dragging.current) setValue(incoming); }, [incoming]);
  const triage = columns.find(column => column.id === 'review');

  const commit = (next: HyperHubBoardValue, meta: KanbanCommitMeta<string>) => {
    const revert = (message?: string) => { setValue(meta.previousValue); if (message) toast(message); };
    if (meta.kind !== 'item') return revert();
    const task = tasks.get(String(meta.event.active.id));
    if (!task) return revert();
    const from = meta.activeContainer as HyperHubBoardColumnId, to = meta.overContainer as HyperHubBoardColumnId;
    if (from === to) {
      if (to !== 'ready') return revert();
      const list = next[to], before = list[list.indexOf(task.id) + 1] ?? columns.find(column => column.id === 'ready')?.firstOverflowId;
      actions.feedback(task, { type: 'reorder', position: before ? { beforeId: before } : 'end' });
      return;
    }
    if (to === 'review') return revert('Cards cannot move back to Triage.');
    if (from === 'review') {
      if (to !== 'ready') return revert('Accept the card into Next first.');
      actions.feedback(task, { type: 'accept' });
      return;
    }
    actions.feedback(task, { type: 'set-state', state: to });
  };

  const card = (id: string, column: HyperHubBoardColumnId, overlay = false) => {
    const task = tasks.get(id);
    if (!task) return null;
    const ranked = ranking.get(id);
    return <HyperHubCard key={id} task={task} ranked={ranked} rank={column === 'ready' ? ranks.get(id) : undefined} nowMs={nowMs} zone={zone} workdays={workdays}
      actions={actions} why={ranked && renderWhy && column !== 'review' ? renderWhy(task, ranked) : undefined} overlay={overlay} dragging={!overlay && active === id}
      suggestion={suggestions?.get(id)} preview={column === 'review' ? isPreview?.(task) : undefined} inCycle={cycles?.has(id)}
      write={writes?.get(id)} differs={overlay ? undefined : differs?.(task)} />;
  };
  const columnOf = (id: string) => Object.keys(value).find(key => value[key].includes(id)) as HyperHubBoardColumnId | undefined;

  return <ScrollArea className="min-h-0 flex-1 overflow-hidden [&_[data-slot=scroll-area-viewport]]:overflow-y-hidden">
    <Kanban value={value} onValueChange={next => { setValue(next); if (active) setOver(Object.keys(next).find(key => next[key].includes(active)) ?? null); }}
      getItemValue={(id: string) => id} onValueCommit={commit} restoreOnCancel className="h-full"
      onDragStart={event => { dragging.current = true; setActive(String(event.active.id)); setOver(null); }}
      onDragEnd={() => { dragging.current = false; setActive(null); setOver(null); }}
      onDragCancel={() => { dragging.current = false; setActive(null); setOver(null); }}>
      <KanbanBoard className="flex h-full w-max min-w-full items-stretch gap-3 p-4" data-hyper-hub-board>
        {triage && triageCollapsed && <button type="button" onClick={() => onTriageCollapsed(false)} aria-label={`Show Triage, ${triage.taskIds.length + triage.overflow} items`}
          className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border py-3 text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronsRight className="size-4" /><Inbox className="size-4" />
          <span className="text-xs font-medium tabular-nums">{triage.taskIds.length + triage.overflow}</span>
          <span className="text-xs font-medium [writing-mode:vertical-rl]">Triage</span>
        </button>}
        {columns.filter(column => column.id in value).map(column =>
          <HyperHubColumn key={column.id} column={{ ...column, taskIds: value[column.id] }} over={active !== null && over === column.id}
            visibleCap={visibleCap} onCollapse={column.id === 'review' ? () => onTriageCollapsed(true) : undefined}>
            {value[column.id].map(id => card(id, column.id))}
          </HyperHubColumn>)}
      </KanbanBoard>
      <KanbanOverlay>{({ value: id, variant }) => {
        if (variant !== 'item') return null;
        const column = columnOf(String(id));
        return column ? card(String(id), column, true) : null;
      }}</KanbanOverlay>
    </Kanban>
    <ScrollBar orientation="horizontal" className="h-2.5 flex-col border-t border-transparent" />
  </ScrollArea>;
}
