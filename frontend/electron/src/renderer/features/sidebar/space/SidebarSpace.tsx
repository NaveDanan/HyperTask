// Space mode: SidebarSpace and _Space (space/sidebar_space.dart), SidebarSpaceHeader
// (space/sidebar_space_header.dart) and SpaceMorePopup (space/space_more_popup.dart).
import { useEffect, useRef, useState } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { AFRolePB } from '@shared/protobuf/hyper-user/workspace_pb';
import { ChevronsDownUp, Copy, MoreHorizontal, PencilLine, Plus, SlidersHorizontal, SmilePlus, Trash2, type LucideIcon } from 'lucide-react';
import { NavIconButton } from '@/components/app/nav';
import { cn } from '@/lib/utils';
import { useTr } from '@/i18n';
import {
  HypertaskPopover,
  Tooltip,
  showAFTextFieldDialog,
  showConfirmDeletionDialog,
  type PopoverController,
} from '@/ui';
import { switchToNextSpace, useSwitchToSpace } from '@/features/home/notifiers';
import { tabsActions } from '@/features/tabs/tabs-store';
import { viewCreatedBy } from '@/features/view/view-ext';
import { ActionListPopover, MenuDivider, MenuItem, hintTooltip, isMac } from '../components';
import { FavoriteFolder } from '../favorites/FavoriteFolder';
import { openFromSidebar } from '../folder/SidebarFolder';
import { IconEmojiPicker, type SelectedEmojiIconResult } from '../icon-picker/IconEmojiPicker';
import { parseIconsData } from '../icon-picker/icon-groups';
import { SharedSection, isSharedSectionOn } from '../shared-section/SharedSection';
import {
  filterHyperProjectViews,
  hyperProjectsFilterActions,
  isHyperProjectsFilterActive,
  useHyperProjectsFilterStore,
  type HyperProjectsFilterCriteria,
} from '../stores/HyperProjectsFilter';
import { useFavoriteStore } from '../stores/favorite-store';
import { sidebarSpace, spaceDeleteDisabledReason } from '../stores/space-store';
import { useWorkspaceStore, workspaceRole } from '../stores/workspace-store';
import { ViewAddButton } from '../view/ViewAddButton';
import { CurrentSpace, SpacePages, SpacePopup, showCreateSpaceDialog, showManageSpaceDialog } from './SpaceWidgets';
import { useSpaceState } from './space-context';

export function SidebarSpace() {
  const favorites = useFavoriteStore((s) => s.views);
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const query = useHyperProjectsFilterStore((s) => s.query);
  const layout = useHyperProjectsFilterStore((s) => s.layout);
  const role = workspaceRole(currentWorkspace);
  // Guests see no spaces.
  const shouldShowSpaces = role === AFRolePB.Member || role === AFRolePB.Owner;
  const criteria: HyperProjectsFilterCriteria = { query, layout };
  const activeFilter = isHyperProjectsFilterActive(criteria) ? criteria : undefined;
  const filteredFavorites = activeFilter
    ? filterHyperProjectViews(favorites.map((f) => f.item), activeFilter)
    : favorites.map((f) => f.item);
  return (
    <div className="flex flex-col">
      {filteredFavorites.length > 0 && (
        <div>
          <FavoriteFolder views={filteredFavorites} projectFilter={activeFilter} />
        </div>
      )}
      {isSharedSectionOn() && <SharedSection key={currentWorkspace?.workspaceId ?? ''} workspaceId={currentWorkspace?.workspaceId ?? ''} projectFilter={activeFilter} />}
      {shouldShowSpaces && <Space projectFilter={activeFilter} />}
    </div>
  );
}

function Space({ projectFilter }: { projectFilter?: HyperProjectsFilterCriteria }) {
  const { tr } = useTr();
  const spaces = useSpaceState((s) => s.spaces);
  const stateSpace = useSpaceState((s) => s.currentSpace);
  const isExpanded = useSpaceState((s) => s.isExpanded);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.workspaceId ?? '');
  // isExpandedNotifier: each "collapse all" notifies every root row.
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const filterActive = isHyperProjectsFilterActive(projectFilter);
  const expanded = filterActive || isExpanded;

  // switchToTheNextSpace (Mod+O) and switchToSpaceNotifier.
  useEffect(() => switchToNextSpace.on(() => sidebarSpace.actions.switchToNextSpace()), []);
  useEffect(
    () =>
      useSwitchToSpace.subscribe((state, prev) => {
        if (state.space && state.space !== prev.space) void sidebarSpace.actions.open(state.space);
      }),
    [],
  );

  if (spaces.length === 0) return null;
  const currentSpace = stateSpace ?? spaces[0];
  return (
    <div className="mt-3 flex flex-col">
      <SidebarSpaceHeader
        isExpanded={expanded}
        space={currentSpace}
        onAdded={(layout, hyperLayout) => {
          void sidebarSpace.actions.createPage({ name: '', layout, hyperLayout, index: 0, openAfterCreate: true });
          void sidebarSpace.actions.expand(currentSpace, true);
        }}
        onCreateNewSpace={() => showCreateSpaceDialog(sidebarSpace)}
        onCollapseAllPages={() => setCollapseAllSignal((n) => n + 1)}
      />
      {expanded && (
        <div>
          <SpacePages
            key={`${workspaceId} ${currentSpace.id}`}
            space={currentSpace}
            hoverGated
            collapseAllSignal={collapseAllSignal}
            onSelected={openFromSidebar}
            onTertiarySelected={(view) => tabsActions.openViewInNewTab(view)}
            projectFilter={projectFilter}
            emptyFilterState={
              <div className="mt-1.5 flex flex-col items-start gap-1.5 rounded-md border border-dashed border-sidebar-border px-2.5 py-2.5 text-xs text-sidebar-muted-foreground">
                <span>{tr('sideBar.projects.empty')}</span>
                <button
                  type="button"
                  onClick={() => hyperProjectsFilterActions.clearFilter()}
                  className="text-xs font-medium text-sidebar-foreground underline underline-offset-2 hover:opacity-80"
                >
                  {tr('sideBar.projects.clear')}
                </button>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}

function SidebarSpaceHeader({
  space,
  isExpanded,
  onAdded,
  onCreateNewSpace,
  onCollapseAllPages,
}: {
  space: ViewPB;
  isExpanded: boolean;
  onAdded: (layout: ViewLayoutPB, hyperLayout?: 'gantt') => void;
  onCreateNewSpace: () => void;
  onCollapseAllPages: () => void;
}) {
  const { tr } = useTr();
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const reveal = hovered || editing;

  const onAction = (type: SpaceMoreActionType, data: SelectedEmojiIconResult | null) => {
    switch (type) {
      case 'rename':
        showAFTextFieldDialog({
          title: tr('space.rename'),
          initialValue: space.name,
          hintText: tr('space.spaceName'),
          onConfirm: (name) => void sidebarSpace.actions.rename(space, name),
        });
        break;
      case 'changeIcon':
        if (data && data.data.type === 'icon') {
          const icon = parseIconsData(data.data.emoji);
          if (icon) void sidebarSpace.actions.changeIcon({ icon: `${icon.groupName}/${icon.iconName}`, iconColor: icon.color ?? null });
          else void sidebarSpace.actions.changeIcon({ icon: '' });
        }
        break;
      case 'manage':
        showManageSpaceDialog(sidebarSpace);
        break;
      case 'addNewSpace':
        onCreateNewSpace();
        break;
      case 'collapseAllPages':
        onCollapseAllPages();
        break;
      case 'delete': {
        const current = sidebarSpace.store.getState().currentSpace;
        showConfirmDeletionDialog({
          name: current ? current.name : '',
          description: tr('space.deleteConfirmationDescription'),
          onConfirm: () => void sidebarSpace.actions.delete(null),
        });
        break;
      }
      case 'duplicate':
        void sidebarSpace.actions.duplicate();
        break;
      default:
        break;
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(event) => {
        if (event.currentTarget.contains(event.target as Node)) void sidebarSpace.actions.expand(space, !isExpanded);
      }}
      className="group/space relative flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-sidebar-accent"
    >
      <div className="flex min-w-0 flex-1">
        <SpacePopup showCreateButton height={32}>
          <Tooltip rich={hintTooltip(tr('space.quicklySwitch'), isMac ? '⌘+O' : 'Ctrl+O')}>
            <div className="flex min-w-0">
              <CurrentSpace space={space} isHovered={hovered} />
            </div>
          </Tooltip>
        </SpacePopup>
      </div>
      <div
        className={cn('flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/space:opacity-100 has-aria-expanded:opacity-100', reveal && 'opacity-100')}
        onClick={(event) => event.stopPropagation()}
      >
        <SpaceMorePopup isHovered={hovered} onEditing={setEditing} onAction={onAction} />
        <ViewAddButton
          parentViewId={space.id}
          isHovered={hovered}
          tooltip={tr('sideBar.addAPage')}
          onEditing={() => {}}
          onSelected={(layout, createNewView, hyperLayout) => {
            if (createNewView) onAdded(layout, hyperLayout);
          }}
        />
      </div>
    </div>
  );
}

type SpaceMoreActionType = 'rename' | 'changeIcon' | 'manage' | 'duplicate' | 'divider' | 'addNewSpace' | 'collapseAllPages' | 'delete';

const SPACE_ACTIONS: SpaceMoreActionType[] = [
  'rename',
  'changeIcon',
  'manage',
  'duplicate',
  'divider',
  'addNewSpace',
  'collapseAllPages',
  'divider',
  'delete',
];

const SPACE_ACTION_META: Record<Exclude<SpaceMoreActionType, 'divider'>, { key: string; icon: LucideIcon }> = {
  rename: { key: 'space.rename', icon: PencilLine },
  changeIcon: { key: 'space.changeIcon', icon: SmilePlus },
  manage: { key: 'space.manage', icon: SlidersHorizontal },
  duplicate: { key: 'space.duplicate', icon: Copy },
  addNewSpace: { key: 'space.addNewSpace', icon: Plus },
  collapseAllPages: { key: 'space.collapseAllSubPages', icon: ChevronsDownUp },
  delete: { key: 'space.delete', icon: Trash2 },
};

function SpaceMorePopup({
  isHovered: _isHovered,
  onEditing,
  onAction,
}: {
  isHovered: boolean;
  onEditing: (value: boolean) => void;
  onAction: (type: SpaceMoreActionType, data: SelectedEmojiIconResult | null) => void;
}) {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  const spaces = useSpaceState((s) => s.spaces);
  const currentSpace = useSpaceState((s) => s.currentSpace);
  const role = workspaceRole(useWorkspaceStore((s) => s.currentWorkspace));
  const user = sidebarSpace.actions.userProfile;
  const reason = spaceDeleteDisabledReason({
    spaceCount: spaces.length,
    isOwner: role === AFRolePB.Owner,
    currentSpaceCreatedBy: currentSpace ? viewCreatedBy(currentSpace) : null,
    userId: user?.id ?? null,
  });
  return (
    <ActionListPopover
      controllerRef={controller}
      direction="bottomWithLeftAligned"
      offset={{ x: 0, y: 8 }}
      constraints={{ minWidth: 224, maxWidth: 224 }}
      onClose={() => onEditing(false)}
      popup={(close) => (
        <>
          {SPACE_ACTIONS.map((type, index) => {
            if (type === 'divider') return <MenuDivider key={index} />;
            const meta = SPACE_ACTION_META[type];
            if (type === 'changeIcon') {
              return (
                <HypertaskPopover
                  key={type}
                  plain
                  constraints={{ maxWidth: 360, maxHeight: 432 }}
                  margin={0}
                  offset={{ x: 0, y: -40 }}
                  popup={() => (
                    <IconEmojiPicker
                      tabs={['icon']}
                      width={360}
                      height={432}
                      onSelected={(result) => {
                        onAction(type, result);
                        close();
                      }}
                    />
                  )}
                >
                  <MenuItem iconNode={<meta.icon className="size-4" />} name={tr(meta.key)} />
                </HypertaskPopover>
              );
            }
            if (type === 'delete') {
              const message =
                reason === 'last'
                  ? tr('space.unableToDeleteLastSpace')
                  : reason === 'notCreator'
                    ? tr('space.unableToDeleteSpaceNotCreatedByYou')
                    : '';
              return (
                <MenuItem
                  key={type}
                  iconNode={<meta.icon className="size-4" />}
                  name={tr(meta.key)}
                  danger
                  disabled={reason !== null}
                  tooltip={message || undefined}
                  onTap={() => {
                    onAction(type, null);
                    close();
                  }}
                />
              );
            }
            return (
              <MenuItem
                key={type}
                iconNode={<meta.icon className="size-4" />}
                name={tr(meta.key)}
                onTap={() => {
                  onAction(type, null);
                  close();
                }}
              />
            );
          })}
        </>
      )}
    >
      <div className="flex">
        <Tooltip message={tr('space.manage')}><NavIconButton aria-label={tr('space.manage')} onClick={(event) => {
          event.stopPropagation();
          onEditing(true);
          controller.current?.show();
        }}><MoreHorizontal className="size-3.5" /></NavIconButton></Tooltip>
      </div>
    </ActionListPopover>
  );
}
