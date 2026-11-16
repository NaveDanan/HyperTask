import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GanttView } from '@/components/reui/gantt/gantt-view';
import { cn } from '@/lib/utils';

/** Keep all timeline rendering in ReUI; the zoom readout joins its existing control. */
export function HyperGanttTimeline({ zoom }: { zoom: number }) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [zoomControl, setZoomControl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setZoomControl(viewRef.current?.querySelector<HTMLElement>('[data-slot=gantt-zoom]') ?? null);
  }, []);
  return <>
    <GanttView
      ref={viewRef}
      tabIndex={0}
      aria-label="Task timeline"
      className={cn(
        'h-full w-full',
        '[&_[data-slot=gantt-columns-menu]]:px-1 [&_[data-slot=gantt-columns-menu]]:z-30',
        '[&_[data-slot=gantt-tree-header]>div]:h-16 [&_[data-slot=gantt-tree-header]>div]:border-b-0 [&_[data-slot=gantt-tree-header]]:border-b-border',
        '[&_[data-slot=gantt-tree-cell]]:sticky [&_[data-slot=gantt-tree-cell]]:start-0 [&_[data-slot=gantt-tree-cell]]:z-10 [&_[data-slot=gantt-tree-cell]]:bg-background',
        '[&_[data-slot=gantt-tree-header]>div>div>div:first-child]:sticky [&_[data-slot=gantt-tree-header]>div>div>div:first-child]:start-0 [&_[data-slot=gantt-tree-header]>div>div>div:first-child]:z-20 [&_[data-slot=gantt-tree-header]>div>div>div:first-child]:bg-background',
      )}
    />
    {zoomControl && createPortal(
      <span data-hyper-gantt-zoom-readout aria-label={`Zoom ${zoom}`} className="text-2xs tabular-nums text-muted-foreground">x{zoom}</span>,
      zoomControl,
    )}
  </>;
}
