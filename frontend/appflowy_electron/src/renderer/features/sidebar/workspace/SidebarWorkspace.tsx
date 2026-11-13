// Collab-mode header: SidebarWorkspace (workspace/sidebar_workspace.dart), the switcher popup
// WorkspacesMenu (_sidebar_workspace_menu.dart), WorkspaceIcon (_sidebar_workspace_icon.dart),
// WorkspaceMoreActionList (_sidebar_workspace_actions.dart) and NotionImporter.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, DoorOpen, Import, Info, LogOut, MoreHorizontal, PencilLine, Plus, SmilePlus, Trash2 } from 'lucide-react';
import { NavIconButton } from '@/components/app/nav';
import { floatingSurfaceClass, MenuLabel, MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/reui/badge';
import { cn } from '@/lib/utils';
import type { UserProfilePB, UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FolderEventImportZipFile, UserEventGetWorkspaceMembers, UserEventSignOut } from '@/backend/events';
import { useTr, plural as pluralTr, tr as translate } from '@/i18n';
import {
  AppFlowyPopover,
  MaterialDialog,
  PopoverMutex,
  Tooltip,
  showAFTextFieldDialog,
  showConfirmDeletionDialog,
  showConfirmDialog,
  showDialog,
  showToast,
  usePopoverContainer,
  type PopoverController,
} from '@/ui';
import { runHyperTask } from '@/startup/HyperLauncher';
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
  fontSize: _fontSize,
  emojiSize: _emojiSize,
  isEditable,
  showBorder = true,
  borderRadius: _borderRadius,
  figmaLineHeight: _figmaLineHeight,
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
    <Avatar className={cn('rounded-md after:rounded-md', iconSize === 24 ? 'size-6' : 'size-8',
      !showBorder && 'after:border-0')}
      style={{ ...(iconSize === 24 || iconSize === 32 ? null : { width: iconSize, height: iconSize }) }}>
      <AvatarFallback className="rounded-md text-sm font-semibold"
        style={{ color: textColor, backgroundColor: workspaceIcon ? undefined : background }}>
        {workspaceIcon ? <span className="text-base leading-none">{workspaceIcon}</span>
          : workspaceName ? workspaceName.charAt(0) : ''}
      </AvatarFallback>
    </Avatar>
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
      <button type="button" className="flex shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {icon}
      </button>
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
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="flex h-10 shrink-0 items-center gap-1">
      <div className="min-w-0 flex-1">
        <SidebarSwitchWorkspaceButton user={user} currentWorkspace={currentWorkspace} isHover={hover} />
      </div>
      <UserSettingButton isHover={hover} />
      <NotificationButton key={currentWorkspace.workspaceId} isHover={hover} />
    </div>
  );
}

function SidebarSwitchWorkspaceButton({ user, currentWorkspace, isHover: _isHover }: {
  user: UserProfilePB;
  currentWorkspace: UserWorkspacePB;
  isHover: boolean;
}) {
  const controller = useRef<PopoverController>(null);
  const [open, setOpen] = useState(false);
  return (
    <AppFlowyPopover controllerRef={controller} trigger="none" direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 5 }} constraints={{ width: 288, maxWidth: 288, maxHeight: 600 }} margin={0} plain
      onOpen={() => {
        setOpen(true);
        void workspaceActions.fetchWorkspaces();
      }}
      onClose={() => setOpen(false)}
      popup={() => <WorkspacesMenuHost user={user} />}>
      <button type="button" aria-expanded={open}
        className="flex h-9 w-full min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
        onClick={() => {
          void workspaceActions.fetchWorkspaces();
          controller.current?.show();
        }}>
        <WorkspaceIcon workspaceIcon={currentWorkspace.icon} workspaceName={currentWorkspace.name}
          iconSize={24} fontSize={16} emojiSize={20} isEditable={false} showBorder={false}
          borderRadius={8} figmaLineHeight={18}
          onSelected={(icon) => void workspaceActions.updateWorkspaceIcon(currentWorkspace.workspaceId, icon)} />
        <Tooltip message={currentWorkspace.name}>
          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-sidebar-accent-foreground">{currentWorkspace.name}</span>
        </Tooltip>
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
      </button>
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
  const { tr } = useTr();
  return (
    <div className={cn(floatingSurfaceClass, 'flex max-h-[min(37.5rem,calc(100vh-1rem))] w-72 min-h-0 flex-col p-1')}>
      <MenuLabel><span className="block truncate">{userInfo(user)}</span></MenuLabel>
      <MenuSeparator />
      <MenuLabel>{tr('workspace.menuTitle')}</MenuLabel>
      <div className="min-h-0 overflow-y-auto">
        {workspaces.map((workspace) => (
          <WorkspaceMenuItem key={workspace.workspaceId} user={user} workspace={workspace}
            isSelected={workspace.workspaceId === currentWorkspace.workspaceId} mutex={mutex} />
        ))}
      </div>
      <MenuSeparator />
      <CreateWorkspaceButton />
      <ImportNotionButton />
      <MenuSeparator />
      <WorkspaceMoreButton mutex={mutex} />
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
    <Item size="sm" className="group/workspace relative flex-nowrap gap-2 rounded-md p-1.5 hover:bg-accent">
      <button type="button" className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={workspace.name} onClick={() => {
          if (isSelected) return;
          tabsActions.switchWorkspace();
          void workspaceActions.openWorkspace(workspace.workspaceId, workspace.workspaceType);
          popover?.closeAll();
        }} />
      <ItemMedia className="relative">
        <Tooltip message={tr('document.plugins.cover.changeIcon')}>
          <WorkspaceIcon workspaceName={workspace.name} workspaceIcon={workspace.icon}
            iconSize={32} emojiSize={24} fontSize={18} figmaLineHeight={26} borderRadius={12} isEditable
            onSelected={(icon) => void workspaceActions.updateWorkspaceIcon(workspace.workspaceId, icon)} />
        </Tooltip>
      </ItemMedia>
      <ItemContent className="pointer-events-none min-w-0 gap-0.5">
        <ItemTitle className="w-full min-w-0"><span className="truncate">{workspace.name}</span>
          {role === AFRolePB.Guest && <GuestTag />}
        </ItemTitle>
        {role !== AFRolePB.Guest && <ItemDescription className="text-xs">
          {memberCount === 0 ? '' : pluralTr('settings.appearance.members.membersCount', memberCount)}
        </ItemDescription>}
      </ItemContent>
      <ItemActions className="relative gap-1">
        {!member.isLoading && <div className="opacity-0 group-hover/workspace:opacity-100 has-aria-expanded:opacity-100 has-focus-visible:opacity-100">
          <WorkspaceMoreActionList workspace={workspace} myRole={member.myRole} mutex={mutex} />
        </div>}
        {isSelected && <Check className="pointer-events-none size-4 text-foreground" />}
      </ItemActions>
    </Item>
  );
}

/** GuestTag (features/share_tab/presentation/widgets/guest_tag.dart). */
function GuestTag() {
  const { tr } = useTr();
  return <Badge variant="secondary" size="xs" className="text-2xs">{tr('shareTab.guest')}</Badge>;
}

type WorkspaceMoreAction = 'rename' | 'changeIcon' | 'divider' | 'delete' | 'leave';

/** WorkspaceMoreActionList: owners rename/delete, others can leave. */
function WorkspaceMoreActionList({ workspace, myRole, mutex }: { workspace: UserWorkspacePB; myRole: AFRolePB; mutex: PopoverMutex }) {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  const [open, setOpen] = useState(false);
  const container = usePopoverContainer();
  const actions: WorkspaceMoreAction[] =
    myRole === AFRolePB.Owner ? ['rename', 'changeIcon', 'divider', 'delete'] : ['changeIcon', 'leave']; // canLeave = role != Owner
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
      constraints={{ minWidth: 192, maxWidth: 192 }}
      mutex={mutex}
      asBarrier
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      popup={() => (
        <>
          {actions.map((action, index) => action === 'divider' ? <MenuSeparator key={index} /> : action === 'changeIcon' ? (
            <AppFlowyPopover key={action} direction="rightWithTopAligned" offset={{ x: 4, y: 0 }} margin={0}
              constraints={{ maxWidth: 364, maxHeight: 356 }}
            popup={(close) => <IconEmojiPicker tabs={['emoji']} onSelected={(result) => {
              void workspaceActions.updateWorkspaceIcon(workspace.workspaceId, result.data.emoji);
              if (!result.keepOpen) close();
            }} />}>
            <MenuRow icon={<SmilePlus />} label={tr('document.plugins.cover.changeIcon')} />
          </AppFlowyPopover>
          ) : (
            <MenuRow key={action} icon={action === 'rename' ? <PencilLine /> : action === 'delete' ? <Trash2 /> : <DoorOpen />}
              destructive={action !== 'rename'} onClick={() => run(action)}
              label={tr(action === 'rename' ? 'button.rename' : action === 'delete' ? 'button.delete' : 'workspace.leaveCurrentWorkspace')} />
          ))}
        </>
      )}
    >
      <NavIconButton aria-expanded={open} aria-label={tr('workspace.menuTitle')} onClick={() => {
        if (!controller.current?.isOpen()) controller.current?.show();
      }}>
        <MoreHorizontal />
      </NavIconButton>
    </ActionListPopover>
  );
}

/** WorkspaceMoreButton: log out, sign out and restart the app. */
function WorkspaceMoreButton({ mutex: _mutex }: { mutex: PopoverMutex }) {
  const { tr } = useTr();
  return <MenuRow icon={<LogOut />} label={tr('button.logout')} onClick={async () => {
    await UserEventSignOut();
    await runHyperTask();
  }} />;
}

function CreateWorkspaceButton() {
  const { tr } = useTr();
  const container = usePopoverContainer();
  return <MenuRow icon={<Plus />} label={tr('workspace.create')} onClick={() => {
    showAFTextFieldDialog({
      title: tr('workspace.create'),
      initialValue: '',
      onConfirm: (name) => void workspaceActions.createWorkspace(name, WorkspaceTypePB.ServerW),
    });
    container?.closeAll();
  }} />;
}

function ImportNotionButton() {
  const { tr } = useTr();
  const container = usePopoverContainer();
  return (
    <div className="relative">
      <MenuRow icon={<Import />} label={tr('workspace.importFromNotion')} className="pr-8" onClick={async () => {
        const paths = await window.appflowy.dialog.pickFiles({ filters: [{ name: 'zip', extensions: ['zip'] }] });
        const path = paths[0];
        if (!path) return;
        container?.closeAll();
        showDialog((close) => (
          <MaterialDialog radius={12}>
            <div className="min-w-72 p-4">
              <NotionImporter filePath={path} />
              <div className="mt-4 flex justify-end">
                <Button variant="ghost" onClick={close}>{tr('button.ok')}</Button>
              </div>
            </div>
          </MaterialDialog>
        ));
      }} />
      <div className="absolute top-0.5 right-1">
        <SbIconButton tooltip={tr('workspace.learnMore')} preferBelow icon={<Info />}
          onPressed={() => void window.appflowy.shell.openExternal('https://docs.appflowy.io/docs/guides/import-from-notion').catch(() => {})} />
      </div>
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
    <div className="flex min-h-8 max-h-52 flex-col items-center justify-center gap-3 text-sm text-foreground">
      {state === 'uploading' ? <><Spinner /><span className="text-base">{tr('settings.common.uploadingFile')}</span></>
        : state === 'success' ? <span className="line-clamp-[10] text-base">{tr('settings.common.uploadNotionSuccess')}</span>
        : <span className="line-clamp-[10]">{state.error}</span>}
    </div>
  );
}
