import { useEffect } from 'react';
import { useTr } from '@/i18n';
import { Switch } from '@/components/ui/switch';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import type { SettingsPageProps } from '../page-props';
import { initNotificationSettings, notificationSettingsActions, useNotificationSettingsStore } from './notification-settings-store';

/** SettingsNotificationsView (widgets/settings_notifications_view.dart). */
export function NotificationsPage(_: SettingsPageProps) {
  const { tr } = useTr();
  const state = useNotificationSettingsStore();
  useEffect(() => void initNotificationSettings(true), []);
  return (
    <>
      <SettingsPageHeader title={tr('settings.menu.notifications')} />
      <SettingsSection><SettingsGroup>
      <SettingsRow
        key="enable"
        label={tr('settings.notifications.enableNotifications.label')}
        description={tr('settings.notifications.enableNotifications.hint')}
        control={<Switch aria-label={tr('settings.notifications.enableNotifications.label')} checked={state.isNotificationsEnabled} onCheckedChange={() => void notificationSettingsActions.toggleNotificationsEnabled()} />}
      />
      <SettingsRow
        key="icon"
        label={tr('settings.notifications.showNotificationsIcon.label')}
        description={tr('settings.notifications.showNotificationsIcon.hint')}
        control={
          <Switch aria-label={tr('settings.notifications.showNotificationsIcon.label')} checked={state.isShowNotificationsIconEnabled} onCheckedChange={() => void notificationSettingsActions.toggleShowNotificationIconEnabled()} />
        }
      />
    </SettingsGroup></SettingsSection>
    </>
  );
}
