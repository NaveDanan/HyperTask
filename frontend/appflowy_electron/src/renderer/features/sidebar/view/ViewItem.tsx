// ViewItem (workspace/presentation/home/menu/view/view_item.dart) and DraggableViewItem
// (menu/view/draggable_view_item.dart): one node of the sidebar page tree.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { useBrightness } from '@/theme/appearance-store';
import { AppFlowyPopover, FlowySvg, FlowyText, Tooltip, type PopoverController } from '@/ui';
import { useTabsStore } from '@/features/tabs/tabs-store';
import { useSwitchToSpace } from '@/features/home/notifiers';
import {
  isReferencedDatabaseView,
  isViewLocked,
  nameOrDefault,
  viewIconData,
  type EmojiIconData,
} from '@/features/view/view-ext';
import { layoutIcon } from '@/features/tabs/plugin';
import { ViewBackendService } from '@/features/view/view-service';
import { SbIconButton } from '../components';
import { IconEmojiPicker } from '../icon-picker/IconEmojiPicker';
import { sectionsActions } from '../stores/sections-store';
import { sidebarSpace } from '../stores/space-store';
import type { FolderSpaceType, IgnoreViewType } from '../stores/types';
import { toViewSectionPB } from '../stores/types';
import { useViewBloc, type ViewBloc } from '../stores/view-bloc';
import { computeHoverPosition, computeMoveTarget, shouldAcceptDrop, type DraggableHoverPosition } from './dnd';
import { RenameViewPopover, registerRenameAnchor } from './RenameViewPopover';
import { ViewAddButton } from './ViewAddButton';
import { ViewMoreActionPopover, handleViewMoreAction } from './ViewMoreActions';
import { ViewIcon } from './ViewIcon';

/** MIME type set on sidebar drags (the document editor inserts a page mention on drop). */
export const VIEW_DRAG_MIME = 'application/x-appflowy-view';

export type ViewItemOnSelected = (view: ViewPB, event: MouseEvent) => void;

export interface ViewItemProps {
  view: ViewPB;
  parentView?: ViewPB | null;
  spaceType: FolderSpaceType;
  /** Depth; the indent is level × leftPadding. */
  level: number;
  /** Per-level indent: 10 by default, 16 (HomeSpaceViewSizes.leftPadding) in the sidebar. */
  leftPadding?: number;
  onSelected: ViewItemOnSelected;
  /** Middle-button press. */
  onTertiarySelected?: (view: ViewPB) => void;
  isFirstChild?: boolean;
  isDraggable?: boolean;
  isFeedback?: boolean;
  height?: number;
  /** An empty section's 4px drop zone. */
  isPlaceholder?: boolean;
  /** A section MouseRegion drives the expand arrow's visibility (isHovered notifier). */
  hoverGated?: boolean;
  shouldRenderChildren?: boolean;
  leftIconBuilder?: (view: ViewPB) => ReactNode;
  /** Replaces the default `···` and `+` buttons. */
  rightIconsBuilder?: (view: ViewPB, bloc: ViewBloc) => ReactNode;
  shouldLoadChildViews?: boolean;
  /** isExpandedNotifier: every change collapses all pages (not forwarded to children). */
  collapseAllSignal?: number;
  extendBuilder?: (view: ViewPB) => ReactNode;
  disableSelectedStatus?: boolean;
  shouldIgnoreView?: (view: ViewPB) => IgnoreViewType;
  enableRightClickContext?: boolean;
  engagedInExpanding?: boolean;
}

/** ViewItem: provides the row's ViewBloc and filters ignored children. */
export function ViewItem(props: ViewItemProps) {
  const { tr } = useTr();
  const { view, shouldLoadChildViews = true, engagedInExpanding = false, shouldIgnoreView } = props;
  const bloc = useViewBloc(view, { shouldLoadChildViews, engagedInExpanding });
  const state = useStore(bloc.store);
  let childViews = state.view.childViews;
  if (shouldIgnoreView) childViews = childViews.filter((v) => shouldIgnoreView(v) !== 'hide');

  const inner = (
    <InnerViewItem
      {...props}
      bloc={bloc}
      view={state.view}
      childViews={childViews}
      isExpanded={state.isExpanded}
      showActions={state.isEditing}
    />
  );
  if (shouldIgnoreView?.(view) === 'disable') {
    return (
      <Tooltip message={tr('space.cannotMovePageToDatabase')}>
        <div style={{ opacity: 0.5, cursor: 'not-allowed' }}>
          <div style={{ pointerEvents: 'none' }}>{inner}</div>
        </div>
      </Tooltip>
    );
  }
  return inner;
}

interface InnerProps extends ViewItemProps {
  bloc: ViewBloc;
  childViews: ViewPB[];
  isExpanded: boolean;
  showActions: boolean;
}

function InnerViewItem(props: InnerProps) {
  const {
    bloc,
    view,
    parentView,
    childViews,
    spaceType,
    level,
    leftPadding = 10,
    isExpanded,
    shouldRenderChildren = true,
    isDraggable = true,
    isPlaceholder = false,
    isFirstChild = false,
    isFeedback = false,
    collapseAllSignal,
    disableSelectedStatus,
  } = props;

  // isExpandedNotifier: react to later notifications only.
  const firstSignal = useRef(collapseAllSignal);
  useEffect(() => {
    if (collapseAllSignal === undefined || collapseAllSignal === firstSignal.current) return;
    void bloc.collapseAllPages();
  }, [bloc, collapseAllSignal]);

  const isSelected = useTabsStore((s) => s.latestOpenView?.id === view.id) && !disableSelectedStatus;

  let child: ReactNode = <SingleInnerViewItem {...props} isSelected={isSelected} />;

  if (isExpanded && shouldRenderChildren && childViews.length > 0) {
    child = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {child}
        {childViews.map((childView) => (
          <ViewItem
            key={`${spaceType} ${childView.id}`}
            parentView={view}
            spaceType={spaceType}
            isFirstChild={childView.id === childViews[0].id}
            view={childView}
            level={level + 1}
            enableRightClickContext={props.enableRightClickContext}
            onSelected={props.onSelected}
            onTertiarySelected={props.onTertiarySelected}
            isDraggable={isDraggable}
            disableSelectedStatus={disableSelectedStatus}
            leftPadding={leftPadding}
            isFeedback={isFeedback}
            isPlaceholder={isPlaceholder}
            hoverGated={props.hoverGated}
            leftIconBuilder={props.leftIconBuilder}
            rightIconsBuilder={props.rightIconsBuilder}
            extendBuilder={props.extendBuilder}
            shouldIgnoreView={props.shouldIgnoreView}
            engagedInExpanding={props.engagedInExpanding}
          />
        ))}
      </div>
    );
  }

  if ((isDraggable || isPlaceholder) && !isReferencedDatabaseView(view, parentView)) {
    return (
      <DraggableNode
        view={view}
        bloc={bloc}
        isFirstChild={isFirstChild}
        isPlaceholder={isPlaceholder}
        onMove={
          isPlaceholder
            ? (from, to) => moveViewCrossSpace(bloc, null, view, parentView ?? null, from, to.parentViewId)
            : undefined
        }
      >
        {child}
      </DraggableNode>
    );
  }
  // Keeps the same height as a draggable node's divider.
  return <div style={{ paddingTop: 2 }}>{child}</div>;
}

// ---- the 30px row ------------------------------------------------------------------------

const CLICK_THROTTLE_MS = 200;

function SingleInnerViewItem(props: InnerProps & { isSelected: boolean }) {
  const { tr } = useTr();
  const {
    bloc,
    view,
    parentView,
    level,
    leftPadding = 10,
    height = 30,
    isExpanded,
    showActions,
    isSelected,
    isPlaceholder,
    isFeedback,
    spaceType,
    enableRightClickContext,
  } = props;
  const moreController = useRef<PopoverController>(null);
  const renameController = useRef<PopoverController>(null);
  const lastClick = useRef(0);

  // F2: only the selected row anchors the rename popover (the last one built wins).
  useEffect(() => {
    if (!isSelected || isFeedback || isPlaceholder) return;
    return registerRenameAnchor(() => renameController.current?.show());
  }, [isSelected, isFeedback, isPlaceholder]);

  if (isPlaceholder) return <div style={{ height: 4, width: '100%' }} />;

  const hoverable = !isFeedback;
  const selected = hoverable && (showActions || isSelected);

  const rightIcons = props.rightIconsBuilder ? (
    props.rightIconsBuilder(view, bloc)
  ) : (
    <>
      <ViewMoreActionPopover
        view={view}
        spaceType={spaceType}
        isExpanded={isExpanded}
        controllerRef={moreController}
        onEditing={(value) => bloc.setIsEditing(value)}
        onAction={(type, data) => handleViewMoreAction(type, data, { view, parentView: parentView ?? null, bloc })}
      >
        <div style={{ display: 'flex' }}>
          <Tooltip message={tr('menuAppHeader.moreButtonToolTip')}>
            <SbIconButton
              width={24}
              icon={<FlowySvg svg="workspace_three_dots_s" />}
              onPressed={() => moreController.current?.show()}
            />
          </Tooltip>
        </div>
      </ViewMoreActionPopover>
      {view.layout === ViewLayoutPB.Document && (
        <>
          <div style={{ width: 8 }} />
          <ViewAddButton
            parentViewId={view.id}
            tooltip={tr('menuAppHeader.addPageTooltip')}
            onEditing={(value) => bloc.setIsEditing(value)}
            onSelected={(layout) => {
              // The new document/chat name is empty, other layouts are "Untitled".
              const name = layout === ViewLayoutPB.Document || layout === ViewLayoutPB.Chat ? '' : tr('menuAppHeader.defaultNewPageName');
              void bloc.createView(name, layout, { openAfterCreated: true, section: toViewSectionPB(spaceType) });
              void bloc.setIsExpanded(true);
            }}
          />
        </>
      )}
      <div style={{ width: 4 }} />
    </>
  );

  const row = (
    <div
      className="sb-row"
      data-hoverable={hoverable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-actions={hoverable && showActions ? 'true' : undefined}
      style={{ height, paddingLeft: level * leftPadding }}
      onClick={(event) => {
        // Popover content is portaled but still bubbles through the React tree.
        if (isFeedback || !event.currentTarget.contains(event.target as Node)) return;
        const now = Date.now();
        if (now - lastClick.current < CLICK_THROTTLE_MS) return;
        lastClick.current = now;
        props.onSelected(view, event);
      }}
      onMouseDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (event.button === 1) {
          event.preventDefault();
          props.onTertiarySelected?.(view);
        } else if (event.button === 2 && enableRightClickContext) {
          moreController.current?.showAt({ x: event.clientX + 4, y: event.clientY });
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div style={{ width: 2, flexShrink: 0 }} />
      {props.leftIconBuilder ? (
        props.leftIconBuilder(view)
      ) : (
        <ViewItemDefaultLeftIcon
          view={view}
          parentView={parentView ?? null}
          hasChildren={view.childViews.length > 0}
          isExpanded={isExpanded}
          leftPadding={leftPadding}
          hoverGated={!!props.hoverGated}
          onToggle={() => void bloc.setIsExpanded(!isExpanded)}
        />
      )}
      <div style={{ width: 2, flexShrink: 0 }} />
      <ViewIconButton view={view} />
      <div style={{ width: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        {props.extendBuilder ? (
          <>
            <FlowyText lineHeight={18} ellipsis style={{ flexShrink: 1 }}>
              {nameOrDefault(view)}
            </FlowyText>
            {props.extendBuilder(view)}
          </>
        ) : (
          <FlowyText lineHeight={18} ellipsis style={{ flex: 1 }}>
            {nameOrDefault(view)}
          </FlowyText>
        )}
      </div>
      <div className="sb-row-actions" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
        {rightIcons}
      </div>
    </div>
  );

  if (isSelected && !isFeedback) {
    return (
      <AppFlowyPopover
        controllerRef={renameController}
        trigger="none"
        offset={{ x: 0, y: 5 }}
        direction="bottomWithLeftAligned"
        popup={(close) => <RenameViewPopover view={view} close={close} />}
      >
        {row}
      </AppFlowyPopover>
    );
  }
  return row;
}

/** ViewItemDefaultLeftIcon: a dot for linked database views, blank without children, else the arrow. */
function ViewItemDefaultLeftIcon({
  view,
  parentView,
  hasChildren,
  isExpanded,
  leftPadding,
  hoverGated,
  onToggle,
}: {
  view: ViewPB;
  parentView: ViewPB | null;
  hasChildren: boolean;
  isExpanded: boolean;
  leftPadding: number;
  hoverGated: boolean;
  onToggle: () => void;
}) {
  if (isReferencedDatabaseView(view, parentView)) {
    return (
      <div style={{ padding: 6, flexShrink: 0 }}>
        <div style={{ width: 4, height: 4, borderRadius: 2, background: 'var(--icon-color)' }} />
      </div>
    );
  }
  if (!hasChildren) return <div style={{ width: leftPadding, flexShrink: 0 }} />;
  return (
    <div
      className={`flowy-hover${hoverGated ? ' sb-arrow-gated' : ''}`}
      style={{ display: 'flex', flexShrink: 0 }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <FlowySvg svg={isExpanded ? 'view_item_expand_s' : 'view_item_unexpand_s'} size={16} />
    </div>
  );
}

/** _buildViewIconButton: the page icon (or the layout's default icon at 60%), opens the icon picker. */
function ViewIconButton({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  const iconData = viewIconData(view);
  const locked = isViewLocked(view);
  const icon =
    iconData.emoji !== '' ? (
      <ViewIcon icon={iconData} size={16} lineHeight={18} />
    ) : (
      <FlowySvg svg={layoutIcon(view.layout)} opacity={0.6} />
    );
  const button = (
    <AppFlowyPopover
      direction="rightWithCenterAligned"
      offset={{ x: 20, y: 0 }}
      constraints={{ maxWidth: 364, maxHeight: 356 }}
      margin={0}
      popup={(close) => (
        <IconEmojiPicker
          tabs={['emoji', 'icon', 'custom']}
          initialType={iconData.type}
          onSelected={(result) => {
            void ViewBackendService.updateViewIcon(view, result.data);
            if (!result.keepOpen) close();
          }}
        />
      )}
    >
      <div
        style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerEvents: locked ? 'none' : undefined }}
        onClick={(event) => event.stopPropagation()}
      >
        <Tooltip message={tr('document.plugins.cover.changeIcon')}>
          <div style={{ display: 'flex' }}>{icon}</div>
        </Tooltip>
      </div>
    </AppFlowyPopover>
  );
  if (locked) {
    return (
      <Tooltip message={tr('lockPage.lockedOperationTooltip')}>
        <div style={{ display: 'flex', flexShrink: 0 }}>{button}</div>
      </Tooltip>
    );
  }
  return button;
}

// ---- drag and drop ---------------------------------------------------------------------

interface DragState {
  view: ViewPB;
  /** The pointer's offset in the dragged node when the drag started (the ghost keeps it). */
  grabX: number;
  grabY: number;
}

let dragging: DragState | null = null;
let activeTarget: { id: symbol; reset: () => void } | null = null;

function setActiveTarget(target: { id: symbol; reset: () => void } | null) {
  if (activeTarget && activeTarget.id !== target?.id) activeTarget.reset();
  activeTarget = target;
}

/** Only one target is "entered" at a time (Flutter enters the innermost accepting DragTarget). */
function startDragSession() {
  const onDragOver = (event: DragEvent) => {
    const target = event.target as Element | null;
    if (!target?.closest?.('[data-sb-node]')) setActiveTarget(null);
  };
  const end = () => {
    dragging = null;
    setActiveTarget(null);
    document.removeEventListener('dragover', onDragOver, true);
    document.removeEventListener('dragend', end, true);
    document.removeEventListener('drop', end, false);
  };
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('dragend', end, true);
  document.addEventListener('drop', end, false);
}

function DraggableNode({
  view,
  bloc,
  isFirstChild,
  isPlaceholder,
  onMove,
  children,
}: {
  view: ViewPB;
  bloc: ViewBloc;
  isFirstChild: boolean;
  isPlaceholder: boolean;
  onMove?: (from: ViewPB, to: ViewPB) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DraggableHoverPosition>('none');
  const positionRef = useRef<DraggableHoverPosition>('none');
  const id = useRef(Symbol('node'));
  const light = useBrightness() === 'light';
  const update = (next: DraggableHoverPosition) => {
    positionRef.current = next;
    setPosition(next);
  };
  useEffect(() => () => {
    if (activeTarget?.id === id.current) activeTarget = null;
  }, []);

  /** _move: dispatched on this (the target's) ViewBloc. */
  const move = (from: ViewPB, to: ViewPB, at: DraggableHoverPosition) => {
    if (at === 'center' && to.layout !== ViewLayoutPB.Document) return;
    if (onMove) {
      onMove(from, to);
      return;
    }
    const target = computeMoveTarget(at, to);
    if (!target) return;
    void bloc.move(from, target.newParentId, target.prevId, sectionsActions.getViewSection(from), sectionsActions.getViewSection(to));
  };

  return (
    <div
      ref={ref}
      data-sb-node=""
      draggable={!isPlaceholder}
      style={{ display: 'flex', flexDirection: 'column' }}
      onDragStart={(event) => {
        const el = ref.current;
        if (!el || !el.contains(event.target as Node)) return;
        event.stopPropagation();
        const rect = el.getBoundingClientRect();
        dragging = { view, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(VIEW_DRAG_MIME, JSON.stringify({ id: view.id, name: view.name, layout: view.layout }));
        // Feedback: the row in a 250px card at 50% opacity.
        const row = el.querySelector('.sb-row') as HTMLElement | null;
        if (row) {
          const ghost = document.createElement('div');
          ghost.style.cssText = `position:fixed;left:-2000px;top:-2000px;width:250px;border-radius:8px;opacity:0.5;pointer-events:none;background:${
            light ? '#FFFFFF' : 'rgba(0,0,0,0.54)'
          }`;
          const clone = row.cloneNode(true) as HTMLElement;
          clone.removeAttribute('data-selected');
          clone.removeAttribute('data-actions');
          clone.removeAttribute('data-hoverable');
          ghost.appendChild(clone);
          document.body.appendChild(ghost);
          event.dataTransfer.setDragImage(ghost, dragging.grabX, dragging.grabY);
          window.setTimeout(() => ghost.remove(), 0);
        }
        startDragSession();
      }}
      onDragOver={(event) => {
        if (!dragging || !ref.current?.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setActiveTarget({ id: id.current, reset: () => update('none') });
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dx = event.clientX - dragging.grabX - rect.left;
        const dy = event.clientY - dragging.grabY - rect.top;
        if (dx > rect.width) return;
        const next = computeHoverPosition(dy, rect.height, isFirstChild);
        if (!shouldAcceptDrop(dragging.view, view, next)) return;
        if (next !== positionRef.current) update(next);
      }}
      onDrop={(event) => {
        if (!dragging || !ref.current?.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        const from = dragging.view;
        const at = positionRef.current;
        update('none');
        // The source may unmount after the move, so its dragend never reaches the document.
        dragging = null;
        setActiveTarget(null);
        move(from, view, at);
      }}
    >
      {isFirstChild && <div className="sb-drop-line" data-active={position === 'top' ? 'true' : undefined} />}
      <div style={{ borderRadius: 6, background: position === 'center' ? 'rgba(0, 200, 255, 0.5)' : undefined }}>{children}</div>
      <div className="sb-drop-line" data-active={position === 'bottom' ? 'true' : undefined} />
    </div>
  );
}

/**
 * moveViewCrossSpace: moving into another space unpublishes the page and switches the sidebar
 * to that space; the page becomes the first child of the target.
 */
export function moveViewCrossSpace(
  bloc: ViewBloc,
  toSpace: ViewPB | null,
  view: ViewPB,
  parentView: ViewPB | null,
  from: ViewPB,
  toId: string,
) {
  if (isReferencedDatabaseView(view, parentView)) return;
  if (from.id === toId) return;
  const currentSpace = sidebarSpace.store.getState().currentSpace;
  if (currentSpace && toSpace && currentSpace.id !== toSpace.id) {
    void bloc.unpublish(false);
    // switchToSpaceNotifier is a ValueNotifier: an equal value does not notify.
    if (useSwitchToSpace.getState().space?.id !== toSpace.id) useSwitchToSpace.setState({ space: toSpace });
  }
  void bloc.move(from, toId, null, null, null);
}

export type { EmojiIconData };
