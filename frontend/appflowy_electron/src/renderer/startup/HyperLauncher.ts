import { fromBinary } from '@bufbuild/protobuf';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import { UserFolderPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { AuthStateChangedPBSchema, AuthStatePB } from '@shared/protobuf/flowy-user/auth_pb';
import { UserNotification } from '@shared/protobuf/flowy-user/notification_pb';
import { NetworkTypePB } from '@shared/protobuf/flowy-user/user_setting_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import {
  FolderEventGetCurrentWorkspaceSetting,
  UserEventGetUserProfile,
  UserEventSignOut,
  UserEventSignUp,
  UserEventUpdateNetworkState,
} from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { tr } from '@/i18n';
import { loadAppearance } from '@/theme/appearance-store';
import { showToast } from '@/ui/toast';
import { handleDeepLink, startDeepLinks } from './deep-link';
import { startFileStorageService } from './file-storage';
import { isCloudEnabledType, isLocalType, loadCloudSharedEnv } from './cloud-env';
import { KVKeys, KeyValueStorage, loadKeyValueStorage } from './kv';
import { navigate, useAppStore } from './app-store';

let disposers: Array<() => void> = [];

function joinPath(...parts: string[]): string {
  return parts.join(useAppStore.getState().info?.platform === 'win32' ? '\\' : '/');
}

/** appFlowyApplicationDataDirectory(): `<support>\data` (release) or `<support>\data_dev` (development). */
function defaultDataDirectory(): string {
  const { info } = useAppStore.getState();
  return joinPath(info!.paths.support, info!.isPackaged ? 'data' : 'data_dev');
}

/**
 * ApplicationDataStorage.getPath(): the custom data location, else the default one. A custom
 * location that no longer exists falls back to the default. (The Flutter app also wipes all
 * shared preferences in that case; this only forgets the stale location.)
 */
async function applicationDataPath(): Promise<string> {
  const custom = KeyValueStorage.get(KVKeys.pathLocation);
  if (custom) {
    if (await window.appflowy.fs.exists(custom)) return custom;
    await KeyValueStorage.remove(KVKeys.pathLocation);
  }
  return defaultDataDirectory();
}

/** AuthService.signUpAsGuest(): the local guest account. */
export async function signUpAsGuest() {
  return UserEventSignUp({
    email: 'anon@appflowy.io',
    name: tr('defaultUsername'),
    password: 'Guest!@123456',
    authType: AuthTypePB.Local,
    deviceId: await window.appflowy.app.deviceId(),
  });
}

function startNetworkListener() {
  const report = () =>
    void UserEventUpdateNetworkState({ ty: navigator.onLine ? NetworkTypePB.Ethernet : NetworkTypePB.NetworkUnknown });
  report();
  window.addEventListener('online', report);
  window.addEventListener('offline', report);
  disposers.push(() => {
    window.removeEventListener('online', report);
    window.removeEventListener('offline', report);
  });
}

/** UserAuthStateListener: an invalid session restarts the app (self-hosted mode only). */
function startAuthStateListener() {
  disposers.push(
    listen<UserNotification>(
      NotificationSource.User,
      (ty, result) => {
        if (ty !== UserNotification.UserAuthStateChanged || !result.ok) return;
        const state = fromBinary(AuthStateChangedPBSchema, result.value);
        if (state.state === AuthStatePB.InvalidAuth) {
          console.error(state.message);
          void runHyperTask();
        }
      },
      'auth_state_change_notification',
    ),
  );
}

/**
 * runHyperTask(): the full (soft) restart the Flutter app performs on launch, sign-in,
 * sign-out and server switches.
 */
export async function runHyperTask({ isAnon = false }: { isAnon?: boolean } = {}): Promise<void> {
  disposers.forEach((dispose) => dispose());
  disposers = [];
  useAppStore.setState((state) => ({ launchId: state.launchId + 1, route: { name: 'launching' } }));

  try {
    const [info, deviceId] = await Promise.all([window.appflowy.app.info(), window.appflowy.app.deviceId()]);
    useAppStore.setState({ info, deviceId });
    await loadKeyValueStorage();

    const env = await loadCloudSharedEnv();
    useAppStore.setState({ env });
    if (isCloudEnabledType(env.authenticatorType)) {
      window.appflowy.app.registerDeepLinkScheme();
      disposers.push(startDeepLinks());
    }

    const dataDirectory = await applicationDataPath();
    useAppStore.setState({ dataDirectory });

    const code = await window.appflowy.core.init({
      root: info.paths.support,
      app_version: info.version,
      custom_app_path: dataDirectory,
      origin_app_path: defaultDataDirectory(),
      device_id: deviceId,
      platform: info.platform === 'win32' ? 'windows' : info.platform === 'darwin' ? 'macos' : 'linux',
      authenticator_type: isLocalType(env.authenticatorType) ? 0 : 2,
      appflowy_cloud_config: env.appflowyCloudConfig,
      envs: {},
    });
    if (code !== 0) throw new Error('Failed to initialize the SDK');

    disposers.push(startFileStorageService());
    await loadAppearance();
    startNetworkListener();
    if (isCloudEnabledType(env.authenticatorType)) startAuthStateListener();
  } catch (error) {
    navigate({ name: 'fatal', message: error instanceof Error ? error.message : String(error) });
    return;
  }

  await routeFromSplash(isAnon || isLocalType(useAppStore.getState().env!.authenticatorType));
}

/** The root redirect plus SplashScreen logic. */
async function routeFromSplash(isAnon: boolean) {
  const user = await UserEventGetUserProfile();
  if (user.ok) {
    navigate({ name: 'home' });
    return;
  }

  navigate({ name: 'splash' });
  if (isAnon) await signUpAsGuest();

  const profile = await UserEventGetUserProfile();
  if (!profile.ok) {
    const { env } = useAppStore.getState();
    const authEnabled = env && !isLocalType(env.authenticatorType) && env.appflowyCloudConfig.base_url !== '';
    navigate({ name: authEnabled ? 'signIn' : 'skipLogin' });
    return;
  }
  await openWorkspaceOrHandleError();
}

/** AuthRouter.goHomeScreen / Splash: open the workspace or handle the failure. */
export async function openWorkspaceOrHandleError(): Promise<void> {
  const workspace = await FolderEventGetCurrentWorkspaceSetting();
  if (workspace.ok) {
    navigate({ name: 'home' });
    return;
  }
  handleOpenWorkspaceError(workspace.error);
}

/** handleOpenWorkspaceError (user/presentation/helpers/handle_open_workspace_error.dart). */
export function handleOpenWorkspaceError(error: FlowyError) {
  switch (error.code) {
    case ErrorCode.WorkspaceDataNotSync: {
      const userFolder = fromBinary(UserFolderPBSchema, error.payload);
      navigate({ name: 'workspaceError', error, userFolder });
      break;
    }
    case ErrorCode.InvalidEncryptSecret:
    case ErrorCode.NetworkError:
      showToast({ message: error.msg, type: 'error' });
      break;
    default:
      showToast({
        message: error.msg,
        type: 'error',
        onDismissed: async () => {
          await UserEventSignOut();
          await runHyperTask();
        },
      });
  }
}

export { handleDeepLink };
