// Favorites (menu/sidebar/favorites/*): FavoriteFolder with the pinned (reorderable) list,
// FavoriteHeader, the "More" popover (FavoriteMenu), FavoriteMoreActions and FavoritePinAction.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import {
  AFButton,
  AppFlowyPopover,
  FlowyButton,
  FlowyDivider,
  FlowySvg,
  FlowyText,
  Tooltip,
  VSpace,
  showAFTextFieldDialog,
  usePopoverContainer,
  type PopoverController,
} from '@/ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { isPinnedView, nameOrDefault } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { SbIconButton } from '../components';
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
      leftIconBuilder={() => <div style={{ width: 16, flexShrink: 0 }} />}
      level={0}
      hoverGated
      rightIconsBuilder={(v, bloc) => (
        <>
          <div style={{ display: 'flex' }} onMouseDown={() => bloc.setIsEditing(true)}>
            <FavoriteMoreActions view={v} bloc={bloc} />
          </div>
          <div style={{ width: 8 }} />
          <div style={{ display: 'flex' }} onMouseDown={() => bloc.setIsEditing(true)}>
            <FavoritePinAction view={v} />
          </div>
          <div style={{ width: 4 }} />
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
    <div className="sb-hover-scope" style={{ display: 'flex', flexDirection: 'column' }}>
      <FavoriteHeader onPressed={() => expand()} />
      {isExpanded && pinnedViews.length === 1 && renderItem(pinnedViews[0])}
      {isExpanded && pinnedViews.length > 1 && (
        <ReorderableList items={pinnedViews} renderItem={renderItem} onReorder={(o, n) => void favoriteActions.reorder(o, n)} />
      )}
      {isExpanded && (
        <>
          <VSpace size={2} />
          <FavoriteMoreButton />
        </>
      )}
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
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
            style={{
              transform: offset ? `translateY(${offset}px)` : undefined,
              transition: dragged || !drag?.active ? undefined : 'transform 200ms ease',
              position: 'relative',
              zIndex: dragged ? 1 : undefined,
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
function FavoriteHeader({ onPressed }: { onPressed: () => void }) {
  const { tr } = useTr();
  return (
    <AFButton
      variant="ghostPrimary"
      size="l"
      fullWidth
      justify="flex-start"
      padding="6px 4px"
      borderRadius={6}
      icon={<FlowySvg svg="favorite_header_m" blendMode={null} />}
      iconGap={8}
      text={tr('sideBar.favorites')}
      onTap={onPressed}
    />
  );
}

/** FavoriteMoreButton: "More" opens every favorite, grouped by when it was favorited. */
function FavoriteMoreButton() {
  const { tr } = useTr();
  const unpinned = useFavoriteStore((s) => s.unpinnedViews);
  if (unpinned.length === 0) return null;
  return (
    <AppFlowyPopover constraints={{ minWidth: 260 }} margin={0} popup={() => <FavoriteMenu minWidth={260} />}>
      <FlowyButton
        margin="7px 20px"
        leftIcon={<FlowySvg svg="workspace_three_dots_s" />}
        text={<FlowyText>{tr('button.more')}</FlowyText>}
      />
    </AppFlowyPopover>
  );
}

const PADDING = 10;

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
          isPinnedView(v) ? (
            <>
              <div style={{ width: 4, flexShrink: 0 }} />
              <FlowySvg svg="favorite_pin_s" blendMode={null} />
            </>
          ) : null
        }
        leftIconBuilder={() => <div style={{ width: 4, flexShrink: 0 }} />}
        rightIconsBuilder={(v, bloc) => (
          <>
            <FavoriteMoreActions view={v} bloc={bloc} />
            <div style={{ width: 6 }} />
            <FavoritePinAction view={v} />
            <div style={{ width: 4 }} />
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
        {showHeader && (
          <FlowyText fontSize={12} color="var(--th-hint)">
            {title}
          </FlowyText>
        )}
        <VSpace size={2} />
        {renderViews(views)}
        <VSpace size={8} />
      </>
    );
  const { today, thisWeek, others } = groups;
  return (
    <div style={{ padding: PADDING, display: 'flex', flexDirection: 'column' }}>
      <VSpace size={4} />
      <SpaceSearchField width={width} onSearch={setQuery} />
      <VSpace size={12} />
      <div className="sb-scroll" style={{ width, maxHeight: 300, display: 'flex', flexDirection: 'column' }}>
        {group(today, tr('sideBar.today'))}
        {thisWeek.length > 0 && (
          <>
            {today.length > 0 && (
              <>
                <FlowyDivider />
                <VSpace size={16} />
              </>
            )}
            {group(thisWeek, tr('sideBar.thisWeek'))}
          </>
        )}
        {(thisWeek.length > 0 || today.length > 0) && others.length > 0 && (
          <>
            <FlowyDivider />
            <VSpace size={16} />
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
      <div style={{ display: 'flex' }}>
        <Tooltip message={tr('menuAppHeader.moreButtonToolTip')}>
          <SbIconButton width={24} icon={<FlowySvg svg="workspace_three_dots_s" />} onPressed={() => controller.current?.show()} />
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
    <SbIconButton
      width={24}
      tooltip={tr(pinned ? 'favorite.removeFromSidebar' : 'favorite.addToSidebar')}
      icon={<FlowySvg svg={pinned ? 'favorite_section_unpin_s' : 'favorite_section_pin_s'} />}
      onPressed={() => void (pinned ? favoriteActions.unpin(view) : favoriteActions.pin(view))}
    />
  );
}
