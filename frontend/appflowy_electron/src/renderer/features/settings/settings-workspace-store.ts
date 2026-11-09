import { create as createMessage, fromBinary } from '@bufbuild/protobuf';
import { create } from 'zustand';
import { UserNotification } from '@shared/protobuf/flowy-user/notification_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema, type UserProfilePB, type UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import {
  FolderEventReadCurrentWorkspace,
  UserEventDeleteWorkspace,
  UserEventGetAllWorkspace,
  UserEventLeaveWorkspace,
  UserEventOpenWorkspace,
} from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { tr } from '@/i18n';
import { showToast } from '@/ui';

// The part of UserWorkspaceBloc (features/workspace/logic/workspace_bloc.dart) the settings
// dialog reads: the live user profile, the current workspace and its role. The sidebar owns
// the full bloc; the dialog keeps its own copy so it does not depend on the sidebar.

interface SettingsWorkspaceState {
  user: UserProfilePB | null;
  current: UserWorkspacePB | null;
  workspaces: UserWorkspacePB[];
}

export const useSettingsWorkspaceStore = create<SettingsWorkspaceState>(() => ({ user: null, current: null, workspaces: [] }));

/** UserWorkspaceBloc._fetchWorkspaces: the current folder workspace, matched in the workspace list. */
export async function fetchWorkspaces(): Promise<{ current: UserWorkspacePB | null; workspaces: UserWorkspacePB[] }> {
  const [currentResult, listResult] = await Promise.all([FolderEventReadCurrentWorkspace(), UserEventGetAllWorkspace()]);
  const currentId = currentResult.ok ? currentResult.value.id : '';
  const workspaces = listResult.ok ? [...listResult.value.items] : [];
  if (workspaces.length === 0 && currentResult.ok) {
    // _convertWorkspacePBToUserWorkspace
    workspaces.push(
      createMessage(UserWorkspacePBSchema, {
        workspaceId: currentResult.value.id,
        name: currentResult.value.name,
        createdAtTimestamp: currentResult.value.createTime,
        workspaceType: WorkspaceTypePB.LocalW,
      }),
    );
  }
  const current = workspaces.find((w) => w.workspaceId === currentId) ?? workspaces[0] ?? null;
  return { current, workspaces };
}

export async function refreshSettingsWorkspace(): Promise<void> {
  const { current, workspaces } = await fetchWorkspaces();
  useSettingsWorkspaceStore.setState({ current, workspaces });
}

/** Starts following the profile (UserListener) while the dialog is open. */
export function startSettingsWorkspace(user: UserProfilePB): () => void {
  useSettingsWorkspaceStore.setState({ user });
  void refreshSettingsWorkspace();
  const stopProfile = listen<UserNotification>(
    NotificationSource.User,
    (ty, result) => {
      if (!result.ok) return;
      if (ty === UserNotification.DidUpdateUserProfile || ty === UserNotification.DidOpenWorkspace) {
        useSettingsWorkspaceStore.setState({ user: fromBinary(UserProfilePBSchema, result.value) });
      }
      if (ty === UserNotification.DidOpenWorkspace) void refreshSettingsWorkspace();
    },
    String(user.id),
  );
  const stopWorkspaces = listen<UserNotification>(NotificationSource.User, (ty) => {
    if (ty === UserNotification.DidUpdateUserWorkspaces || ty === UserNotification.DidUpdateUserWorkspace) void refreshSettingsWorkspace();
  });
  return () => {
    stopProfile();
    stopWorkspaces();
  };
}

export function setSettingsUser(user: UserProfilePB) {
  useSettingsWorkspaceStore.setState({ user });
}

async function openFirstWorkspace(excludeId: string): Promise<boolean> {
  const { workspaces } = await fetchWorkspaces();
  const next = workspaces.find((w) => w.workspaceId !== excludeId);
  if (!next) return false;
  const result = await UserEventOpenWorkspace({ workspaceId: next.workspaceId, workspaceType: next.workspaceType });
  return result.ok;
}

/**
 * UserWorkspaceEvent.deleteWorkspace: refuses to delete the only workspace, then deletes and
 * opens the first remaining one. Returns true when the app should reload the home screen.
 */
export async function deleteWorkspace(workspaceId: string): Promise<boolean> {
  const local = useSettingsWorkspaceStore.getState().workspaces;
  const { workspaces: remote } = await fetchWorkspaces();
  if (local.length <= 1 || remote.length <= 1) {
    showToast({ message: tr('workspace.cannotDeleteTheOnlyWorkspace'), type: 'error' });
    return false;
  }
  const result = await UserEventDeleteWorkspace({ workspaceId });
  if (!result.ok) {
    showToast({ message: result.error.msg, type: 'error' });
    return false;
  }
  await openFirstWorkspace(workspaceId);
  return true;
}

/** UserWorkspaceEvent.leaveWorkspace: leaves, then opens the first remaining workspace. */
export async function leaveWorkspace(workspaceId: string): Promise<boolean> {
  const result = await UserEventLeaveWorkspace({ workspaceId });
  if (!result.ok) {
    showToast({ message: result.error.msg, type: 'error' });
    return false;
  }
  await openFirstWorkspace(workspaceId);
  return true;
}
