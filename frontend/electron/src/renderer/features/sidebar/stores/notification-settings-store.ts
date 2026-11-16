// The sidebar reads the app-global NotificationSettingsCubit, which the settings page owns.
import {
  SHOW_NOTIFICATION_ICON_KEY,
  loadNotificationSettings,
  useNotificationSettingsStore,
} from '@/features/settings/notifications/notification-settings-store';

export { SHOW_NOTIFICATION_ICON_KEY, useNotificationSettingsStore };

export const notificationSettingsActions = {
  /** Re-reads the settings (the cubit loads when the home screen mounts). */
  load() {
    loadNotificationSettings();
  },
};
