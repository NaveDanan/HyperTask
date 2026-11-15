import { GanttView } from '@/components/reui/gantt/gantt-view';
import { cn } from '@/lib/utils';

/** Keep all timeline rendering in ReUI; scope the brief's visual overrides to this view. */
export function HyperGanttTimeline({ zoom }: { zoom: number }) {
  return <>
    <GanttView
      tabIndex={0}
      aria-label="Task timeline"
      className={cn(
        'h-full w-full',
        '[&_[data-slot=gantt-columns-menu]]:px-1 [&_[data-slot=gantt-columns-menu]]:z-30',
        '[&_[data-slot=gantt-tree-header]>div]:h-16 [&_[data-slot=gantt-tree-header]>div]:border-b-0 [&_[data-slot=gantt-tree-header]]:border-b-border',
        '[&_[data-slot=gantt-tree-cell]]:sticky [&_[data-slot=gantt-tree-cell]]:start-0 [&_[data-slot=gantt-tree-cell]]:z-10 [&_[data-slot=gantt-tree-cell]]:bg-background',
        '[&_[data-slot=gantt-tree-cell]]:group-data-hover/gantt-row:bg-muted/40 [&_[data-slot=gantt-tree-cell]]:group-data-selected/gantt-row:bg-primary/5',
        '[&_[data-slot=gantt-tree-header]>div>div>div:first-child]:sticky [&_[data-slot=gantt-tree-header]>div>div>div:first-child]:start-0 [&_[data-slot=gantt-tree-header]>div>div>div:first-child]:z-20 [&_[data-slot=gantt-tree-header]>div>div>div:first-child]:bg-background',
        '[&_[data-today]>span]:bg-primary [&_[data-today]>span]:text-primary-foreground',
        '[&_[data-gantt-row]]:data-hover:bg-muted/40',
        '[&_[data-slot=gantt-drag-ghost]:not([data-drop-invalid])]:border-primary [&_[data-slot=gantt-drag-ghost]:not([data-drop-invalid])]:bg-primary/10',
      )}
    />
    <span aria-label={`Zoom ${zoom}`} className="pointer-events-none absolute right-12 bottom-5 rounded-md border border-border bg-background px-2 py-1 text-2xs tabular-nums text-muted-foreground">x{zoom}</span>
  </>;
}
