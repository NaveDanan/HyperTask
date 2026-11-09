// Collab-mode header: SidebarWorkspace (workspace/sidebar_workspace.dart), the switcher popup
// WorkspacesMenu (_sidebar_workspace_menu.dart), WorkspaceIcon (_sidebar_workspace_icon.dart),
// WorkspaceMoreActionList (_sidebar_workspace_actions.dart) and NotionImporter.
import { useEffect, useRef, useState } from 'react';
import type { UserProfilePB, UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FolderEventImportZipFile, UserEventGetWorkspaceMembers, UserEventSignOut } from '@/backend/events';
import { useTr, plural as pluralTr, tr as translate } from '@/i18n';
import {
  AppFlowyPopover,
  FlowyButton,
  FlowySvg,
  FlowyText,
  MaterialDialog,
  PopoverMutex,
  Spinner,
  Tooltip,
  showAFTextFieldDialog,
  showConfirmDeletionDialog,
  showConfirmDialog,
  showDialog,
  showToast,
  usePopoverContainer,
  type PopoverController,
} from '@/ui';
import { runAppFlowy } from '@/startup/launcher';
import { useDeepLinkStore } from '@/startup/deep-link';
import { homeSettingActions, useHomeSettingStore } from '@/features/home/home-setting-store';
import { tabsActions } from '@/features/tabs/tabs-store';
import { ActionListPopover, SbIconButton, showLoading } from '../components';
import { NotificationButton, UserSettingButton } from '../header/SidebarHeader';
import { IconEmojiPicker } from '../icon-picker/IconEmojiPicker';
import { useWorkspaceStore, workspaceActions, workspaceIconColors, workspaceRole, type UserWorkspaceState } from '../stores/workspace-store';

// ---- WorkspaceIcon ------------------------------------------------------------------------

export function WorkspaceIcon({
  workspaceIcon,
  workspaceName,
  iconSize,
  fontSize,
  emojiSize,
  isEditable,
  showBorder = true,
  borderRadius,
  figmaLineHeight,
  onSelected,
}: {
  workspaceIcon: string;
  workspaceName: string;
  iconSize: number;
  fontSize: number;
  emojiSize: number;
  isEditable: boolean;
  showBorder?: boolean;
  borderRadius: number;
  figmaLineHeight: number;
  onSelected: (emoji: string) => void;
}) {
  const [textColor, background] = workspaceIconColors(workspaceName);
  const icon = (
    <div
      style={{
        width: iconSize,
        height: iconSize,
        flexShrink: 0,
        borderRadius,
        background: workspaceIcon ? undefined : background,
        boxShadow: showBorder ? 'inset 0 0 0 1px #7171711A' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: isEditable ? 'pointer' : undefined,
      }}
    >
      {workspaceIcon ? (
        <span className="sb-emoji" style={{ fontSize: emojiSize * 0.9, lineHeight: `${figmaLineHeight}px` }}>
          {workspaceIcon}
        </span>
      ) : (
        <FlowyText fontWeight={600} fontSize={fontSize} color={textColor}>
          {workspaceName ? workspaceName.charAt(0) : ''}
        </FlowyText>
      )}
    </div>
  );
  if (!isEditable) return icon;
  return (
    <AppFlowyPopover
      offset={{ x: 0, y: 8 }}
      direction="bottomWithLeftAligned"
      constraints={{ maxWidth: 364, maxHeight: 356 }}
      margin={0}
      popup={(close) => (
        <IconEmojiPicker
          tabs={['emoji']}
          onSelected={(result) => {
            onSelected(result.data.emoji);
            if (!result.keepOpen) close();
          }}
        />
      )}
    >
      {icon}
    </AppFlowyPopover>
  );
}

// ---- SidebarWorkspace ---------------------------------------------------------------------

let loadingIndicator: (() => void) | null = null;

/** _showResultDialog: loading overlay, limit dialog and the result toasts. */
function showResultDialog(state: UserWorkspaceState) {
  const actionResult = state.actionResult;
  if (!actionResult) return;
  if (!useHomeSettingStore.getState().isNotificationPanelCollapsed) homeSettingActions.collapseNotificationPanel();
  if (actionResult.isLoading) {
    loadingIndicator ??= showLoading();
    return;
  }
  loadingIndicator?.();
  loadingIndicator = null;
  const result = actionResult.result;
  if (!result) return;
  if (actionResult.actionType === 'create' && !result.ok && result.error.code === ErrorCode.WorkspaceLimitExceeded) {
    showConfirmDialog({ title: '', description: translate('workspace.createLimitExceeded') });
    return;
  }
  const messages: Partial<Record<string, [string, string]>> = {
    create: ['workspace.createSuccess', 'workspace.createFailed'],
    delete: ['workspace.deleteSuccess', 'workspace.deleteFailed'],
    open: ['workspace.openSuccess', 'workspace.openFailed'],
    updateIcon: ['workspace.updateIconSuccess', 'workspace.updateIconFailed'],
    rename: ['workspace.renameSuccess', 'workspace.renameFailed'],
  };
  const keys = messages[actionResult.actionType];
  if (!keys) return;
  showToast({
    message: result.ok ? translate(keys[0]) : `${translate(keys[1])}: ${result.error.msg}`,
    type: result.ok ? 'success' : 'error',
  });
}

/** _openWorkspaceFromInvitation: the invitation deep link (openWorkspaceNotifier), with retries. */
function useInvitationDeepLink(user: UserProfilePB) {
  const invitation = useDeepLinkStore((s) => s.invitation);
  const retryCount = useRef(0);
  useEffect(() => {
    if (!invitation) return;
    let timer: number | undefined;
    const attempt = () => {
      const { workspaceId, email } = invitation;
      const state = useWorkspaceStore.getState();
      if (state.currentWorkspace?.workspaceId === workspaceId) return;
      if (email !== user.email) return;
      const workspace = state.workspaces.find((w) => w.workspaceId === workspaceId);
      if (!workspace) {
        void workspaceActions.fetchWorkspaces(workspaceId);
        timer = window.setTimeout(() => {
          if (retryCount.current >= 3) {
            useDeepLinkStore.setState({ invitation: null });
            retryCount.current = 0;
            return;
          }
          retryCount.current++;
          attempt();
        }, 250 + retryCount.current * 250);
        return;
      }
      void workspaceActions.openWorkspace(workspaceId, workspace.workspaceType);
      useDeepLinkStore.setState({ invitation: null });
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [invitation, user]);
}

export function SidebarWorkspace({ user }: { user: UserProfilePB }) {
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const [hover, setHover] = useState(false);
  useInvitationDeepLink(user);
  useEffect(
    () =>
      useWorkspaceStore.subscribe((state, prev) => {
        if (state.actionResult !== prev.actionResult) showResultDialog(state);
      }),
    [],
  );
  if (!currentWorkspace) return null;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: '100%',
        marginRight: 8,
        borderRadius: 8,
        background: hover ? 'var(--cs-secondary)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <SidebarSwitchWorkspaceButton user={user} currentWorkspace={currentWorkspace} isHover={hover} />
      </div>
      <UserSettingButton isHover={hover} />
      <div style={{ width: 8, flexShrink: 0 }} />
      <NotificationButton key={currentWorkspace.workspaceId} isHover={hover} />
      <div style={{ width: 4, flexShrink: 0 }} />
    </div>
  );
}

function SidebarSwitchWorkspaceButton({
  user,
  currentWorkspace,
  isHover,
}: {
  user: UserProfilePB;
  currentWorkspace: UserWorkspacePB;
  isHover: boolean;
}) {
  const controller = useRef<PopoverController>(null);
  return (
    <AppFlowyPopover
      controllerRef={controller}
      trigger="none"
      direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 5 }}
      // The menu rows expand to the 300px max width, as in Flutter.
      constraints={{ width: 300, maxWidth: 300, maxHeight: 600 }}
      margin={0}
      onOpen={() => void workspaceActions.fetchWorkspaces()}
      popup={() => <WorkspacesMenuHost user={user} />}
    >
      <div
        style={{ height: 30, display: 'flex', alignItems: 'center', cursor: 'pointer', minWidth: 0 }}
        onClick={() => {
          void workspaceActions.fetchWorkspaces();
          controller.current?.show();
        }}
      >
        <div style={{ width: 4, flexShrink: 0 }} />
        <WorkspaceIcon
          workspaceIcon={currentWorkspace.icon}
          workspaceName={currentWorkspace.name}
          iconSize={26}
          fontSize={16}
          emojiSize={20}
          isEditable={false}
          showBorder={false}
          borderRadius={8}
          figmaLineHeight={18}
          onSelected={(icon) => void workspaceActions.updateWorkspaceIcon(currentWorkspace.workspaceId, icon)}
        />
        <div style={{ width: 6, flexShrink: 0 }} />
        <FlowyText
          fontWeight={500}
          fontSize={15}
          ellipsis
          withTooltip
          color={isHover ? 'var(--cs-on-surface)' : undefined}
          style={{ flexShrink: 1 }}
        >
          {currentWorkspace.name}
        </FlowyText>
        {isHover && (
          <>
            <div style={{ width: 4, flexShrink: 0 }} />
            <FlowySvg svg="workspace_drop_down_menu_show_s" color="var(--cs-on-surface)" />
          </>
        )}
      </div>
    </AppFlowyPopover>
  );
}

function WorkspacesMenuHost({ user }: { user: UserProfilePB }) {
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  if (!currentWorkspace) return null;
  return <WorkspacesMenu user={user} currentWorkspace={currentWorkspace} workspaces={workspaces} />;
}

const userInfo = (user: UserProfilePB) => user.email || user.name || translate('defaultUsername');

function WorkspacesMenu({
  user,
  currentWorkspace,
  workspaces,
}: {
  user: UserProfilePB;
  currentWorkspace: UserWorkspacePB;
  workspaces: UserWorkspacePB[];
}) {
  const [mutex] = useState(() => new PopoverMutex());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '6px 10px 0', display: 'flex', alignItems: 'center' }}>
        <FlowyText fontWeight={500} fontSize={12} ellipsis color="var(--th-hint)" style={{ flex: 1 }}>
          {userInfo(user)}
        </FlowyText>
        <div style={{ width: 4 }} />
        <WorkspaceMoreButton mutex={mutex} />
        <div style={{ width: 8 }} />
      </div>
      <div style={{ padding: '8px 6px' }}>
        <div style={{ height: 1, background: 'var(--th-divider)' }} />
      </div>
      <div className="sb-scroll" style={{ padding: '0 6px', flexShrink: 1, minHeight: 0 }}>
        {workspaces.map((workspace) => (
          <div key={workspace.workspaceId} style={{ paddingBottom: 6 }}>
            <WorkspaceMenuItem
              user={user}
              workspace={workspace}
              isSelected={workspace.workspaceId === currentWorkspace.workspaceId}
              mutex={mutex}
            />
          </div>
        ))}
      </div>
      <div style={{ padding: '0 6px' }}>
        <CreateWorkspaceButton />
      </div>
      <div style={{ padding: '6px 6px 0' }}>
        <ImportNotionButton />
      </div>
      <div style={{ height: 6, flexShrink: 0 }} />
    </div>
  );
}

/** WorkspaceMemberBloc (initial): my role in the workspace, from the member list. */
function useMyRole(workspace: UserWorkspacePB, user: UserProfilePB) {
  const [state, setState] = useState<{ isLoading: boolean; myRole: AFRolePB }>({ isLoading: true, myRole: AFRolePB.Guest });
  useEffect(() => {
    let alive = true;
    void UserEventGetWorkspaceMembers({ workspaceId: workspace.workspaceId }).then((result) => {
      if (!alive) return;
      const members = result.ok ? result.value.items : [];
      const role = members.find((m) => m.email === user.email)?.role ?? AFRolePB.Guest;
      setState({ isLoading: false, myRole: role });
    });
    return () => {
      alive = false;
    };
  }, [workspace.workspaceId, user.email]);
  return state;
}

function WorkspaceMenuItem({
  user,
  workspace,
  isSelected,
  mutex,
}: {
  user: UserProfilePB;
  workspace: UserWorkspacePB;
  isSelected: boolean;
  mutex: PopoverMutex;
}) {
  const { tr } = useTr();
  const popover = usePopoverContainer();
  const member = useMyRole(workspace, user);
  const role = workspaceRole(workspace);
  const memberCount = Number(workspace.memberCount);
  return (
    <div className="sb-ws-item" style={{ height: 44, position: 'relative', display: 'flex', alignItems: 'center' }}>
      <FlowyButton
        style={{ width: '100%', height: '100%' }}
        iconPadding={10}
        leftIconSize={32}
        leftIcon={<div style={{ width: 32, height: 32 }} />}
        rightIcon={<div style={{ width: 32 }} />}
        onTap={() => {
          if (isSelected) return;
          tabsActions.switchWorkspace();
          void workspaceActions.openWorkspace(workspace.workspaceId, workspace.workspaceType);
          popover?.closeAll();
        }}
        text={
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, flexShrink: 1 }}>
              <FlowyText fontWeight={500} lineHeight={17} ellipsis withTooltip>
                {workspace.name}
              </FlowyText>
              {role !== AFRolePB.Guest && (
                <FlowyText fontSize={10} lineHeight={12} color="var(--th-hint)">
                  {memberCount === 0 ? '' : pluralTr('settings.appearance.members.membersCount', memberCount)}
                </FlowyText>
              )}
            </div>
            {role === AFRolePB.Guest && (
              <>
                <div style={{ width: 6, flexShrink: 0 }} />
                <GuestTag />
              </>
            )}
          </div>
        }
      />
      <div style={{ position: 'absolute', left: 4, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        <Tooltip message={tr('document.plugins.cover.changeIcon')}>
          <div style={{ display: 'flex' }}>
            <WorkspaceIcon
              workspaceName={workspace.name}
              workspaceIcon={workspace.icon}
              iconSize={36}
              emojiSize={24}
              fontSize={18}
              figmaLineHeight={26}
              borderRadius={12}
              isEditable
              onSelected={(icon) => void workspaceActions.updateWorkspaceIcon(workspace.workspaceId, icon)}
            />
          </div>
        </Tooltip>
      </div>
      <div style={{ position: 'absolute', right: 4, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        {!member.isLoading && (
          <div className="sb-ws-item-reveal" style={{ paddingLeft: 8, display: 'flex' }}>
            <WorkspaceMoreActionList workspace={workspace} myRole={member.myRole} mutex={mutex} />
          </div>
        )}
        <div style={{ width: 8 }} />
        {isSelected && (
          <>
            <div style={{ padding: 5, display: 'flex' }}>
              <FlowySvg svg="workspace_selected_s" blendMode={null} size={14} />
            </div>
            <div style={{ width: 8 }} />
          </>
        )}
      </div>
    </div>
  );
}

/** GuestTag (features/share_tab/presentation/widgets/guest_tag.dart). */
function GuestTag() {
  const { tr } = useTr();
  return (
    <div style={{ padding: '0 8px 2px', borderRadius: 6, background: 'var(--af-fill-warning-light)', flexShrink: 0 }}>
      <span style={{ fontSize: 'calc(12px * var(--text-scale, 1))', lineHeight: '16px', color: 'var(--af-text-warning)' }}>
        {tr('shareTab.guest')}
      </span>
    </div>
  );
}

type WorkspaceMoreAction = 'rename' | 'divider' | 'delete' | 'leave';

/** WorkspaceMoreActionList: owners rename/delete, others can leave. */
function WorkspaceMoreActionList({ workspace, myRole, mutex }: { workspace: UserWorkspacePB; myRole: AFRolePB; mutex: PopoverMutex }) {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  const container = usePopoverContainer();
  const actions: WorkspaceMoreAction[] =
    myRole === AFRolePB.Owner ? ['rename', 'divider', 'delete'] : ['leave']; // canLeave = role != Owner
  if (actions.length === 0) return null;
  const run = (action: WorkspaceMoreAction) => {
    container?.closeAll();
    switch (action) {
      case 'delete':
        showConfirmDeletionDialog({
          name: workspace.name,
          description: tr('workspace.deleteWorkspaceHintText'),
          onConfirm: () => void workspaceActions.deleteWorkspace(workspace.workspaceId),
        });
        break;
      case 'rename':
        showAFTextFieldDialog({
          title: tr('workspace.renameWorkspace'),
          initialValue: workspace.name,
          hintText: '',
          onConfirm: (name) => void workspaceActions.renameWorkspace(workspace.workspaceId, name),
        });
        break;
      case 'leave':
        showConfirmDialog({
          title: tr('workspace.leaveCurrentWorkspace'),
          description: tr('workspace.leaveCurrentWorkspacePrompt'),
          confirmLabel: tr('button.yes'),
          onConfirm: () => void workspaceActions.leaveWorkspace(workspace.workspaceId),
        });
        break;
      default:
        break;
    }
  };
  return (
    <ActionListPopover
      controllerRef={controller}
      direction="bottomWithLeftAligned"
      constraints={{ minWidth: 220 }}
      mutex={mutex}
      asBarrier
      popup={() => (
        <>
          {actions.map((action, index) =>
            action === 'divider' ? (
              <div key={index} style={{ height: 16, display: 'flex', alignItems: 'center' }}>
                <div style={{ height: 1, width: '100%', background: 'var(--th-divider)' }} />
              </div>
            ) : (
              <div
                key={action}
                className={`flowy-hover${action === 'rename' ? '' : ' sb-danger'}`}
                onClick={() => run(action)}
                style={{ padding: 6, display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <FlowySvg svg={action === 'rename' ? 'view_item_rename_s' : action === 'delete' ? 'trash_s' : 'logout_s'} />
                <FlowyText lineHeight={18}>
                  {tr(action === 'rename' ? 'button.rename' : action === 'delete' ? 'button.delete' : 'workspace.leaveCurrentWorkspace')}
                </FlowyText>
              </div>
            ),
          )}
        </>
      )}
    >
      <div style={{ width: 24, height: 24 }}>
        <FlowyButton
          margin="0 4px"
          style={{ height: 24 }}
          text={<FlowySvg svg="workspace_three_dots_s" />}
          onTap={() => {
            if (!controller.current?.isOpen()) controller.current?.show();
          }}
        />
      </div>
    </ActionListPopover>
  );
}

/** WorkspaceMoreButton: "Log out" (sign out and restart the app). */
function WorkspaceMoreButton({ mutex }: { mutex: PopoverMutex }) {
  const { tr } = useTr();
  return (
    <AppFlowyPopover
      direction="bottomWithLeftAligned"
      offset={{ x: 0, y: 6 }}
      constraints={{ width: 240, maxWidth: 240, maxHeight: 600 }}
      mutex={mutex}
      asBarrier
      popup={() => (
        <FlowyButton
          margin="7px 6px"
          leftIcon={<FlowySvg svg="workspace_logout_s" />}
          iconPadding={10}
          text={<FlowyText>{tr('button.logout')}</FlowyText>}
          onTap={async () => {
            await UserEventSignOut();
            await runAppFlowy();
          }}
        />
      )}
    >
      <div style={{ width: 24, height: 24, flexShrink: 0 }}>
        <FlowyButton
          useIntrinsicWidth
          margin={0}
          style={{ height: 24 }}
          text={<FlowySvg svg="workspace_three_dots_s" size={16} />}
        />
      </div>
    </AppFlowyPopover>
  );
}

function AddWorkspaceIconBox() {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        padding: 7,
        borderRadius: 12,
        boxShadow: 'inset 0 0 0 0.8px #7171711F',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <FlowySvg svg="add_workspace_s" />
    </div>
  );
}

function CreateWorkspaceButton() {
  const { tr } = useTr();
  const container = usePopoverContainer();
  return (
    <div style={{ height: 40 }}>
      <FlowyButton
        margin="0 4px"
        style={{ height: 40 }}
        onTap={() => {
          showAFTextFieldDialog({
            title: tr('workspace.create'),
            initialValue: '',
            onConfirm: (name) => void workspaceActions.createWorkspace(name, WorkspaceTypePB.ServerW),
          });
          container?.closeAll();
        }}
        text={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <AddWorkspaceIconBox />
            <div style={{ width: 8 }} />
            <FlowyText>{tr('workspace.create')}</FlowyText>
          </div>
        }
      />
    </div>
  );
}

function ImportNotionButton() {
  const { tr } = useTr();
  const container = usePopoverContainer();
  return (
    <div style={{ height: 40 }}>
      <FlowyButton
        margin="0 4px"
        style={{ height: 40 }}
        onTap={async () => {
          const paths = await window.appflowy.dialog.pickFiles({ filters: [{ name: 'zip', extensions: ['zip'] }] });
          const path = paths[0];
          if (!path) return;
          container?.closeAll();
          showDialog((close) => (
            <MaterialDialog radius={4} style={{ padding: 20, minWidth: 300 }}>
              <NotionImporter filePath={path} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <FlowyButton useIntrinsicWidth text={<FlowyText color="var(--cs-primary)">{tr('button.ok')}</FlowyText>} onTap={close} />
              </div>
            </MaterialDialog>
          ));
        }}
        text={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <AddWorkspaceIconBox />
            <div style={{ width: 8 }} />
            <FlowyText>{tr('workspace.importFromNotion')}</FlowyText>
          </div>
        }
        rightIcon={
          <Tooltip message={tr('workspace.learnMore')} preferBelow>
            <SbIconButton
              icon={<FlowySvg svg="information_s" />}
              onPressed={() => void window.appflowy.shell.openExternal('https://docs.appflowy.io/docs/guides/import-from-notion').catch(() => {})}
            />
          </Tooltip>
        }
      />
    </div>
  );
}

/** NotionImporter (_sidebar_import_notion.dart): uploads the zip (FolderEventImportZipFile). */
function NotionImporter({ filePath }: { filePath: string }) {
  const { tr } = useTr();
  const [state, setState] = useState<'uploading' | 'success' | { error: string }>('uploading');
  useEffect(() => {
    void FolderEventImportZipFile({ filePath }).then((result) =>
      setState(result.ok ? 'success' : { error: result.error.msg }),
    );
  }, [filePath]);
  return (
    <div style={{ minHeight: 30, maxHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {state === 'uploading' ? (
        <>
          <Spinner />
          <div style={{ height: 12 }} />
          <FlowyText fontSize={16}>{tr('settings.common.uploadingFile')}</FlowyText>
        </>
      ) : state === 'success' ? (
        <FlowyText fontSize={16} maxLines={10}>
          {tr('settings.common.uploadNotionSuccess')}
        </FlowyText>
      ) : (
        <FlowyText maxLines={10}>{state.error}</FlowyText>
      )}
    </div>
  );
}

