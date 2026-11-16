import { create } from 'zustand';
import type { AppInfo } from '@shared/api';
import type { HyperError } from '@shared/protobuf/hyper-error/errors_pb';
import type { UserFolderPB } from '@shared/protobuf/hyper-folder/workspace_pb';
import type { HypertaskCloudSharedEnv } from './cloud-env';

export type Route =
  | { name: 'launching' }
  | { name: 'splash' }
  | { name: 'signIn' }
  | { name: 'skipLogin' }
  | { name: 'home' }
  | { name: 'workspaceError'; error: HyperError; userFolder?: UserFolderPB }
  | { name: 'fatal'; message: string };

export interface AppState {
  /** Incremented by every runHypertask(); the UI tree is keyed by it, like Flutter's restart. */
  launchId: number;
  info: AppInfo | null;
  env: HypertaskCloudSharedEnv | null;
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
