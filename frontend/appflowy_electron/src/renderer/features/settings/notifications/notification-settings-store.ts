import { create } from 'zustand';
import { UserEventGetNotificationSettings, UserEventSetNotificationSettings } from '@/backend/events';
import { KeyValueStorage } from '@/startup/kv';

/** KVKeys.showNotificationIcon. */
export const SHOW_NOTIFICATION_ICON_KEY = 'showNotificationIcon';

interface NotificationSettingsState {
  isNotificationsEnabled: boolean;
  /** Read by the sidebar's notification button. */
  isShowNotificationsIconEnabled: boolean;
  loaded: boolean;
}

/**
 * NotificationSettingsCubit (workspace/application/settings/notifications/notification_settings_cubit.dart),
 * app-global as in Dart. Deliberate deviation: "Show notifications icon" is saved when toggled;
 * the Dart cubit only saved it when the other toggle changed afterwards (C.12 bug).
 */
export const useNotificationSettingsStore = create<NotificationSettingsState>(() => ({
  isNotificationsEnabled: true,
  isShowNotificationsIconEnabled: true,
  loaded: false,
}));

let initializing: Promise<void> | null = null;

export function initNotificationSettings(reload = false): Promise<void> {
  if (reload) initializing = null;
  initializing ??= (async () => {
    const result = await UserEventGetNotificationSettings();
    const stored = KeyValueStorage.get(SHOW_NOTIFICATION_ICON_KEY);
    useNotificationSettingsStore.setState({
      isNotificationsEnabled: result.ok ? result.value.notificationsEnabled : true,
      isShowNotificationsIconEnabled: stored === null ? true : stored === 'true',
      loaded: true,
    });
  })();
  return initializing;
}

async function save() {
  const state = useNotificationSettingsStore.getState();
  await KeyValueStorage.set(SHOW_NOTIFICATION_ICON_KEY, String(state.isShowNotificationsIconEnabled));
  const result = await UserEventSetNotificationSettings({ notificationsEnabled: state.isNotificationsEnabled });
  if (!result.ok) console.error(result.error.msg);
}

export const notificationSettingsActions = {
  async toggleNotificationsEnabled() {
    await initNotificationSettings();
    useNotificationSettingsStore.setState((s) => ({ isNotificationsEnabled: !s.isNotificationsEnabled }));
    await save();
  },
  async toggleShowNotificationIconEnabled() {
    await initNotificationSettings();
    useNotificationSettingsStore.setState((s) => ({ isShowNotificationsIconEnabled: !s.isShowNotificationsIconEnabled }));
    await save();
  },
};

/** Called by the home screen: re-reads the settings once per launch. */
export function loadNotificationSettings() {
  void initNotificationSettings(true);
}
