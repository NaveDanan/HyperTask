import { fromBinary } from '@bufbuild/protobuf';
import { create } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema, type WorkspaceLatestPB } from '@shared/protobuf/flowy-folder/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { NotificationSource, listen } from '@/backend/notifications';
import { isSpace } from '../view/view-ext';

interface HomeState {
  user: UserProfilePB | null;
  workspaceSetting: WorkspaceLatestPB | null;
  /** HomeBloc.latestView: the workspace's last opened page (spaces are ignored). */
  latestView: ViewPB | null;
}

/** HomeBloc (workspace/application/home/home_bloc.dart) plus the screen's user profile. */
export const useHomeStore = create<HomeState>(() => ({ user: null, workspaceSetting: null, latestView: null }));

function didReceiveWorkspaceSetting(setting: WorkspaceLatestPB) {
  const latest = setting.oneOfLatestView.case === 'latestView' ? setting.oneOfLatestView.value : null;
  if (latest && isSpace(latest)) return;
  useHomeStore.setState({ workspaceSetting: setting, latestView: latest });
}

/** HomeEvent.initial: re-dispatches the initial setting after 300 ms and follows updates. */
export function startHome(user: UserProfilePB, setting: WorkspaceLatestPB): () => void {
  useHomeStore.setState({ user, workspaceSetting: setting, latestView: null });
  const timer = window.setTimeout(() => didReceiveWorkspaceSetting(setting), 300);
  const stop = listen<FolderNotification>(NotificationSource.Folder, (ty, result) => {
    if (ty !== FolderNotification.DidUpdateWorkspaceSetting || !result.ok) return;
    didReceiveWorkspaceSetting(fromBinary(WorkspaceLatestPBSchema, result.value));
  });
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}

export function setHomeUser(user: UserProfilePB) {
  useHomeStore.setState({ user });
}
