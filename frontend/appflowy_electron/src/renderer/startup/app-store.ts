import { create } from 'zustand';
import type { AppInfo } from '@shared/api';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import type { UserFolderPB } from '@shared/protobuf/flowy-folder/workspace_pb';
import type { AppFlowyCloudSharedEnv } from './cloud-env';

export type Route =
  | { name: 'launching' }
  | { name: 'splash' }
  | { name: 'signIn' }
  | { name: 'skipLogin' }
  | { name: 'home' }
  | { name: 'workspaceError'; error: FlowyError; userFolder?: UserFolderPB }
  | { name: 'fatal'; message: string };

export interface AppState {
  /** Incremented by every runAppFlowy(); the UI tree is keyed by it, like Flutter's restart. */
  launchId: number;
  info: AppInfo | null;
  env: AppFlowyCloudSharedEnv | null;
  deviceId: string;
  /** ApplicationDataStorage path passed to the core as custom_app_path. */
  dataDirectory: string;
  route: Route;
}

export const useAppStore = create<AppState>(() => ({
  launchId: 0,
  info: null,
  env: null,
  deviceId: '',
  dataDirectory: '',
  route: { name: 'launching' },
}));

export const navigate = (route: Route) => useAppStore.setState({ route });
