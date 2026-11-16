import { CalendarX2, Copy, SquareArrowOutUpRight, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
export function HyperGanttMenu({ open, clear, duplicate, remove, moveUp, moveDown }: {
  open: () => void; clear: () => void; duplicate: () => void; remove: () => void; moveUp?: () => void; moveDown?: () => void;
}) {
  return <>
    <ContextMenuItem onClick={open}>
      <SquareArrowOutUpRight />Open
    </ContextMenuItem>
    <ContextMenuItem onClick={clear}>
      <CalendarX2 />Clear dates
    </ContextMenuItem>
    <ContextMenuItem onClick={duplicate}>
      <Copy />Duplicate
    </ContextMenuItem>
    <ContextMenuItem disabled={!moveUp} onClick={moveUp}>
      <ArrowUp />Move up
    </ContextMenuItem>
    <ContextMenuItem disabled={!moveDown} onClick={moveDown}>
      <ArrowDown />Move down
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem variant="destructive" onClick={remove}>
      <Trash2 />Delete
    </ContextMenuItem>

  </>;
}
