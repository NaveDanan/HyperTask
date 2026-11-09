// Space mode: SidebarSpace and _Space (space/sidebar_space.dart), SidebarSpaceHeader
// (space/sidebar_space_header.dart) and SpaceMorePopup (space/space_more_popup.dart).
import { useEffect, useRef, useState } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useTr } from '@/i18n';
import {
  AppFlowyPopover,
  FlowySvg,
  Tooltip,
  VSpace,
  showAFTextFieldDialog,
  showConfirmDeletionDialog,
  type PopoverController,
} from '@/ui';
import { switchToNextSpace, useSwitchToSpace } from '@/features/home/notifiers';
import { tabsActions } from '@/features/tabs/tabs-store';
import { viewCreatedBy } from '@/features/view/view-ext';
import { ActionListPopover, MenuDivider, MenuItem, SbIconButton, hintTooltip, isMac } from '../components';
import { FavoriteFolder } from '../favorites/FavoriteFolder';
import { openFromSidebar } from '../folder/SidebarFolder';
import { IconEmojiPicker, type SelectedEmojiIconResult } from '../icon-picker/IconEmojiPicker';
import { parseIconsData } from '../icon-picker/icon-groups';
import { SharedSection, isSharedSectionOn } from '../shared-section/SharedSection';
import { useFavoriteStore } from '../stores/favorite-store';
import { sidebarSpace, spaceDeleteDisabledReason } from '../stores/space-store';
import { useWorkspaceStore, workspaceRole } from '../stores/workspace-store';
import { ViewAddButton } from '../view/ViewAddButton';
import { CurrentSpace, SpacePages, SpacePopup, showCreateSpaceDialog, showManageSpaceDialog } from './SpaceWidgets';
import { useSpaceState } from './space-context';

export function SidebarSpace() {
  const favorites = useFavoriteStore((s) => s.views);
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const role = workspaceRole(currentWorkspace);
  // Guests see no spaces.
  const shouldShowSpaces = role === AFRolePB.Member || role === AFRolePB.Owner;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <VSpace size={4} />
      {favorites.length > 0 && (
        <div style={{ paddingBottom: 16 }}>
          <FavoriteFolder views={favorites.map((f) => f.item)} />
        </div>
      )}
      {isSharedSectionOn() && <SharedSection key={currentWorkspace?.workspaceId ?? ''} workspaceId={currentWorkspace?.workspaceId ?? ''} />}
      {shouldShowSpaces && <Space />}
      <VSpace size={200} />
    </div>
  );
}

function Space() {
  const spaces = useSpaceState((s) => s.spaces);
  const stateSpace = useSpaceState((s) => s.currentSpace);
  const isExpanded = useSpaceState((s) => s.isExpanded);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.workspaceId ?? '');
  // isExpandedNotifier: each "collapse all" notifies every root row.
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);

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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SidebarSpaceHeader
        isExpanded={isExpanded}
        space={currentSpace}
        onAdded={(layout) => {
          void sidebarSpace.actions.createPage({ name: '', layout, index: 0, openAfterCreate: true });
          void sidebarSpace.actions.expand(currentSpace, true);
        }}
        onCreateNewSpace={() => showCreateSpaceDialog(sidebarSpace)}
        onCollapseAllPages={() => setCollapseAllSignal((n) => n + 1)}
      />
      {isExpanded && (
        <div className="sb-hover-scope">
          <SpacePages
            key={`${workspaceId} ${currentSpace.id}`}
            space={currentSpace}
            hoverGated
            collapseAllSignal={collapseAllSignal}
            onSelected={openFromSidebar}
            onTertiarySelected={(view) => tabsActions.openViewInNewTab(view)}
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
  onAdded: (layout: ViewLayoutPB) => void;
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
      style={{
        height: 32,
        borderRadius: 6,
        background: hovered ? 'var(--cs-secondary)' : undefined,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'absolute', left: 3, top: 3, bottom: 3, right: reveal ? 88 : 0, display: 'flex' }}>
        <SpacePopup showCreateButton height={26} style={{ maxWidth: '100%' }}>
          <Tooltip rich={hintTooltip(tr('space.quicklySwitch'), isMac ? '⌘+O' : 'Ctrl+O')}>
            <div style={{ display: 'flex', minWidth: 0 }}>
              <CurrentSpace space={space} isHovered={hovered} />
            </div>
          </Tooltip>
        </SpacePopup>
      </div>
      <div
        style={{ position: 'absolute', right: 4, top: 0, bottom: 0, display: 'flex', alignItems: 'center', opacity: reveal ? 1 : 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        <SpaceMorePopup isHovered={hovered} onEditing={setEditing} onAction={onAction} />
        <div style={{ width: 8 }} />
        <ViewAddButton
          parentViewId={space.id}
          isHovered={hovered}
          tooltip={tr('sideBar.addAPage')}
          onEditing={() => {}}
          onSelected={(layout, createNewView) => {
            if (createNewView) onAdded(layout);
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

const SPACE_ACTION_META: Record<Exclude<SpaceMoreActionType, 'divider'>, { key: string; icon: FlowySvgName }> = {
  rename: { key: 'space.rename', icon: 'view_item_rename_s' },
  changeIcon: { key: 'space.changeIcon', icon: 'change_icon_s' },
  manage: { key: 'space.manage', icon: 'space_manage_s' },
  duplicate: { key: 'space.duplicate', icon: 'duplicate_s' },
  addNewSpace: { key: 'space.addNewSpace', icon: 'space_add_s' },
  collapseAllPages: { key: 'space.collapseAllSubPages', icon: 'collapse_all_page_s' },
  delete: { key: 'space.delete', icon: 'trash_s' },
};

function SpaceMorePopup({
  isHovered,
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
      constraints={{ minWidth: 260 }}
      onClose={() => onEditing(false)}
      popup={(close) => (
        <>
          {SPACE_ACTIONS.map((type, index) => {
            if (type === 'divider') return <MenuDivider key={index} />;
            const meta = SPACE_ACTION_META[type];
            if (type === 'changeIcon') {
              return (
                <AppFlowyPopover
                  key={type}
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
                  <MenuItem icon={meta.icon} name={tr(meta.key)} />
                </AppFlowyPopover>
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
                  icon={meta.icon}
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
                icon={meta.icon}
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
      <div style={{ display: 'flex' }}>
        <SbIconButton
          width={24}
          tooltip={tr('space.manage')}
          icon={<FlowySvg svg="workspace_three_dots_s" color={isHovered ? 'var(--cs-on-surface)' : undefined} />}
          onPressed={() => {
            onEditing(true);
            controller.current?.show();
          }}
        />
      </div>
    </ActionListPopover>
  );
}
