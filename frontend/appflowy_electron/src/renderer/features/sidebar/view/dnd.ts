// Sidebar drag and drop rules (menu/view/draggable_view_item.dart).
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { containsView, isDatabaseLayout } from '@/features/view/view-ext';

export type DraggableHoverPosition = 'none' | 'top' | 'center' | 'bottom';

/** Divider height around every draggable node. */
export const kDraggableViewItemDividerHeight = 2;

/**
 * _computeHoverPosition. `offsetY` is the drag ghost's top edge (pointer minus the grab offset)
 * relative to the target node's top; `height` is the whole node (row, children and dividers).
 */
export function computeHoverPosition(offsetY: number, height: number, isFirstChild: boolean): DraggableHoverPosition {
  const threshold = height / 5;
  if (isFirstChild && offsetY < -5) return 'top';
  if (offsetY > threshold) return 'bottom';
  return 'center';
}

/** _shouldAccept: no dropping into a database, onto itself, or into its own (loaded) subtree. */
export function shouldAcceptDrop(dragged: ViewPB, target: ViewPB, position: DraggableHoverPosition): boolean {
  if (isDatabaseLayout(target.layout) && position === 'center') return false;
  if (dragged.id === target.id) return false;
  if (containsView(dragged, target)) return false;
  return true;
}

export interface MoveTarget {
  newParentId: string;
  /** null: first child of the new parent. */
  prevId: string | null;
}

/**
 * _move's destination: top → first child of the target's parent; bottom → right after the
 * target; center → last child of the target (documents only).
 */
export function computeMoveTarget(position: DraggableHoverPosition, to: ViewPB): MoveTarget | null {
  if (position === 'center' && to.layout !== ViewLayoutPB.Document) return null;
  switch (position) {
    case 'top':
      return { newParentId: to.parentViewId, prevId: null };
    case 'bottom':
      return { newParentId: to.parentViewId, prevId: to.id };
    case 'center':
      return { newParentId: to.id, prevId: to.childViews.at(-1)?.id ?? null };
    default:
      return null;
  }
}
