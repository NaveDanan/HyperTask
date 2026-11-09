// Favorites (menu/sidebar/favorites/*): FavoriteFolder with the pinned (reorderable) list,
// FavoriteHeader, the "More" popover (FavoriteMenu), FavoriteMoreActions and FavoritePinAction.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavIconButton, NavSectionHeader } from '@/components/app/nav';
import { floatingSurfaceClass, MenuLabel, MenuSeparator } from '@/components/app/menu-row';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import {
  AppFlowyPopover,
  Tooltip,
  showAFTextFieldDialog,
  usePopoverContainer,
  type PopoverController,
} from '@/ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { isPinnedView, nameOrDefault } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { openFromSidebar, useFolderExpanded } from '../folder/SidebarFolder';
import { SpaceSearchField } from '../space/SpaceWidgets';
import {
  favoriteActions,
  filterFavoriteViews,
  groupFavorites,
  readFavorites,
  reorderNewIndex,
  useFavoriteStore,
  type FavoriteGroups,
} from '../stores/favorite-store';
import type { ViewBloc } from '../stores/view-bloc';
import { ViewItem } from '../view/ViewItem';
import { ViewMoreActionPopover } from '../view/ViewMoreActions';

export function FavoriteFolder({ views }: { views: ViewPB[] }) {
  const [isExpanded, expand] = useFolderExpanded('favorite');
  const pinned = useFavoriteStore((s) => s.pinnedViews);
  if (views.length === 0) return null;
  const firstId = views[0].id;
  const renderItem = (view: ViewPB) => (
    <ViewItem
      key={`favorite ${view.id}`}
      spaceType="favorite"
      isDraggable={false}
      isFirstChild={view.id === firstId}
      isFeedback={false}
      view={view}
      enableRightClickContext
      leftPadding={16}
      leftIconBuilder={() => <span className="size-5 shrink-0" />}
      level={0}
      hoverGated
      rightIconsBuilder={(v, bloc) => (
        <>
          <div className="flex" onMouseDown={() => bloc.setIsEditing(true)}>
            <FavoriteMoreActions view={v} bloc={bloc} />
          </div>
          <div className="flex" onMouseDown={() => bloc.setIsEditing(true)}>
            <FavoritePinAction view={v} />
          </div>
        </>
      )}
      shouldRenderChildren={false}
      shouldLoadChildViews={false}
      onTertiarySelected={(v) => tabsActions.openViewInNewTab(v)}
      onSelected={openFromSidebar}
    />
  );
  const pinnedViews = pinned.map((p) => p.item);
  return (
    <div className="flex flex-col">
      <FavoriteHeader isExpanded={isExpanded} onPressed={() => expand()} />
      <div className="mt-0.5 flex flex-col gap-px">
        {isExpanded && pinnedViews.length === 1 && renderItem(pinnedViews[0])}
        {isExpanded && pinnedViews.length > 1 && (
          <ReorderableList items={pinnedViews} renderItem={renderItem} onReorder={(o, n) => void favoriteActions.reorder(o, n)} />
        )}
      </div>
    </div>
  );
}

/**
 * ReorderableListView with ReorderableDragStartListener rows: dragging starts on press-move;
 * the other rows make room while dragging.
 */
function ReorderableList({
  items,
  renderItem,
  onReorder,
}: {
  items: ViewPB[];
  renderItem: (view: ViewPB) => ReactNode;
  onReorder: (oldIndex: number, newIndex: number) => void;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState<{ index: number; dy: number; height: number; active: boolean } | null>(null);
  const target = drag?.active ? Math.min(items.length - 1, Math.max(0, Math.round(drag.index + drag.dy / drag.height))) : -1;

  const start = (index: number, startY: number) => {
    const height = refs.current[index]?.getBoundingClientRect().height ?? 32;
    let state = { index, dy: 0, height, active: false };
    setDrag(state);
    const move = (event: MouseEvent) => {
      const dy = event.clientY - startY;
      state = { ...state, dy, active: state.active || Math.abs(dy) > 4 };
      setDrag(state);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (state.active) {
        const swallow = (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        const final = Math.min(items.length - 1, Math.max(0, Math.round(index + state.dy / height)));
        if (final !== index) onReorder(index, reorderNewIndex(index, final));
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="flex flex-col gap-px">
      {items.map((view, i) => {
        let offset = 0;
        if (drag?.active) {
          if (i === drag.index) offset = drag.dy;
          else if (drag.index < target && i > drag.index && i <= target) offset = -drag.height;
          else if (drag.index > target && i >= target && i < drag.index) offset = drag.height;
        }
        const dragged = drag?.active && i === drag.index;
        return (
          <div
            key={view.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onMouseDown={(event) => {
              if (event.button === 0 && event.currentTarget.contains(event.target as Node)) start(i, event.clientY);
            }}
            className={cn('relative', dragged ? 'z-10' : drag?.active && 'transition-transform duration-200 ease-out')}
            style={{
              transform: offset ? `translateY(${offset}px)` : undefined,
            }}
          >
            {renderItem(view)}
          </div>
        );
      })}
    </div>
  );
}

/** FavoriteHeader: AFGhostIconTextButton.primary, size l, padding h4 v6, radius 6. */
function FavoriteHeader({ onPressed, isExpanded }: { onPressed: () => void; isExpanded: boolean }) {
  const { tr } = useTr();
  return (
    <NavSectionHeader label={tr('sideBar.favorites')} collapsed={!isExpanded} onToggle={onPressed} actions={isExpanded ? <FavoriteMoreButton /> : undefined} />
  );
}

/** FavoriteMoreButton: "More" opens every favorite, grouped by when it was favorited. */
function FavoriteMoreButton() {
  const { tr } = useTr();
  const unpinned = useFavoriteStore((s) => s.unpinnedViews);
  const [open, setOpen] = useState(false);
  if (unpinned.length === 0) return null;
  return (
    <AppFlowyPopover plain onOpen={() => setOpen(true)} onClose={() => setOpen(false)} constraints={{ minWidth: 256, maxWidth: 256 }} margin={0} popup={() => <FavoriteMenu minWidth={256} />}>
      <Tooltip message={tr('button.more')}><NavIconButton aria-expanded={open} aria-label={tr('button.more')}><MoreHorizontal className="size-3.5" /></NavIconButton></Tooltip>
    </AppFlowyPopover>
  );
}

const PADDING = 4;

/** FavoriteMenu + FavoriteMenuBloc: a one-shot read (it does not follow later changes). */
function FavoriteMenu({ minWidth }: { minWidth: number }) {
  const { tr } = useTr();
  const container = usePopoverContainer();
  const [source, setSource] = useState<ReturnType<typeof groupFavorites> | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void readFavorites().then((result) => {
      if (result.ok) setSource(groupFavorites(result.value));
    });
  }, []);
  const groups: FavoriteGroups = useMemo(() => {
    if (!source) return { today: [], thisWeek: [], others: [] };
    if (!query) return source;
    return {
      today: filterFavoriteViews(source.today, query),
      thisWeek: filterFavoriteViews(source.thisWeek, query),
      others: filterFavoriteViews(source.others, query),
    };
  }, [source, query]);

  const width = minWidth - 2 * PADDING;
  const renderViews = (views: ViewPB[]) =>
    views.map((view) => (
      <ViewItem
        key={view.id}
        view={view}
        spaceType="favorite"
        level={0}
        isFeedback={false}
        isDraggable={false}
        shouldRenderChildren={false}
        extendBuilder={(v) =>
          isPinnedView(v) ? <Pin className="size-3.5 text-muted-foreground" /> : null
        }
        leftIconBuilder={() => <span className="size-5 shrink-0" />}
        rightIconsBuilder={(v, bloc) => (
          <>
            <FavoriteMoreActions view={v} bloc={bloc} />
            <FavoritePinAction view={v} />
          </>
        )}
        onSelected={(v) => {
          tabsActions.openView(v);
          container?.close();
        }}
      />
    ));
  const group = (views: ViewPB[], title: string, showHeader = true) =>
    views.length === 0 ? null : (
      <>
        {showHeader && <MenuLabel>{title}</MenuLabel>}
        {renderViews(views)}
      </>
    );
  const { today, thisWeek, others } = groups;
  return (
    <div className={cn(floatingSurfaceClass, 'flex w-64 flex-col gap-2 p-1')}>
      <SpaceSearchField width={width} onSearch={setQuery} />
      <div className="flex max-h-80 flex-col gap-px overflow-y-auto">
        {group(today, tr('sideBar.today'))}
        {thisWeek.length > 0 && (
          <>
            {today.length > 0 && (
              <>
                <MenuSeparator />
              </>
            )}
            {group(thisWeek, tr('sideBar.thisWeek'))}
          </>
        )}
        {(thisWeek.length > 0 || today.length > 0) && others.length > 0 && (
          <>
            <MenuSeparator />
          </>
        )}
        {others.length > 0 && (today.length > 0 || thisWeek.length > 0)
          ? group(others, tr('sideBar.others'))
          : group(others, tr('sideBar.others'), false)}
      </div>
    </div>
  );
}

/** FavoriteMoreActions: Remove from Favorites, Rename, Open in a new tab. */
function FavoriteMoreActions({ view, bloc }: { view: ViewPB; bloc: ViewBloc }) {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  const container = usePopoverContainer();
  return (
    <ViewMoreActionPopover
      view={view}
      spaceType="favorite"
      isExpanded={false}
      controllerRef={controller}
      onEditing={(value) => bloc.setIsEditing(value)}
      onAction={(type) => {
        switch (type) {
          case 'favorite':
          case 'unFavorite':
            void favoriteActions.toggle(view);
            container?.closeAll();
            break;
          case 'rename':
            showAFTextFieldDialog({
              title: tr('disclosureAction.rename'),
              initialValue: nameOrDefault(view),
              maxLength: 256,
              onConfirm: (name) => void ViewBackendService.updateView({ viewId: view.id, name }),
            });
            container?.closeAll();
            break;
          case 'openInNewTab':
            tabsActions.openViewInNewTab(view);
            break;
          default:
            break;
        }
      }}
    >
      <div className="flex">
        <Tooltip message={tr('menuAppHeader.moreButtonToolTip')}>
          <NavIconButton aria-label={tr('menuAppHeader.moreButtonToolTip')} onClick={(event) => { event.stopPropagation(); controller.current?.show(); }}><MoreHorizontal className="size-3.5" /></NavIconButton>
        </Tooltip>
      </div>
    </ViewMoreActionPopover>
  );
}

/** FavoritePinAction: pin to / remove from the sidebar. */
function FavoritePinAction({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  const pinned = isPinnedView(view);
  return (
    <Tooltip rich={tr(pinned ? 'favorite.removeFromSidebar' : 'favorite.addToSidebar')}>
      <NavIconButton aria-label={tr(pinned ? 'favorite.removeFromSidebar' : 'favorite.addToSidebar')}
        onClick={(event) => { event.stopPropagation(); void (pinned ? favoriteActions.unpin(view) : favoriteActions.pin(view)); }}>
        {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </NavIconButton>
    </Tooltip>
  );
}
