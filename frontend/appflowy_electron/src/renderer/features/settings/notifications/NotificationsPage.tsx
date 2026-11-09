import { useEffect } from 'react';
import { useTr } from '@/i18n';
import { Toggle } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody } from '../shared';
import { SettingListTile } from '../shared-widgets';
import { initNotificationSettings, notificationSettingsActions, useNotificationSettingsStore } from './notification-settings-store';

/** SettingsNotificationsView (widgets/settings_notifications_view.dart). */
export function NotificationsPage(_: SettingsPageProps) {
  const { tr } = useTr();
  const state = useNotificationSettingsStore();
  useEffect(() => void initNotificationSettings(true), []);
  return (
    <SettingsBody title={tr('settings.menu.notifications')}>
      <SettingListTile
        key="enable"
        label={tr('settings.notifications.enableNotifications.label')}
        hint={tr('settings.notifications.enableNotifications.hint')}
        trailing={<Toggle value={state.isNotificationsEnabled} onChanged={() => void notificationSettingsActions.toggleNotificationsEnabled()} />}
      />
      <SettingListTile
        key="icon"
        label={tr('settings.notifications.showNotificationsIcon.label')}
        hint={tr('settings.notifications.showNotificationsIcon.hint')}
        trailing={
          <Toggle value={state.isShowNotificationsIconEnabled} onChanged={() => void notificationSettingsActions.toggleShowNotificationIconEnabled()} />
        }
      />
    </SettingsBody>
  );
}
