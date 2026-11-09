// Sidebar brand, account, settings and notification controls.
import { useEffect } from 'react';
import { Bell, PanelLeftClose, Settings } from 'lucide-react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { NavCount, NavIconButton } from '@/components/app/nav';
import { useTr } from '@/i18n';
import { HyperLogo } from '@/ui/HyperLogo';
import { AFAvatar, Tooltip } from '@/ui';
import { homeSettingActions, useHomeSettingStore } from '@/features/home/home-setting-store';
import { loseFocus, openSettings } from '@/features/home/notifiers';
import { hintTooltip, isMac } from '../components';
import { useNotificationSettingsStore } from '../stores/notification-settings-store';
import { reminderActions, unreadReminderCount, useReminderStore } from '../stores/reminder-store';

export function SidebarTopMenu() {
  const { tr } = useTr();
  const panelCollapsed = useHomeSettingStore((s) => s.isNotificationPanelCollapsed);
  return (
    <div className="drag-region flex h-10 shrink-0 items-center px-1.5">
      <HyperLogo size={18} wordmark />
      <div className="h-full flex-1" />
      <Tooltip rich={panelCollapsed
        ? hintTooltip(tr('sideBar.closeSidebar'), isMac ? '⌘+.' : 'Ctrl+\\')
        : tr('sideBar.closeSidebar')}>
        {/* Fires on pointer down, even while invisible. */}
        <NavIconButton className="no-drag opacity-0 group-hover/sidebar:opacity-100"
          aria-label={tr('sideBar.closeSidebar')}
          onMouseDown={(event) => {
            if (event.button === 0) homeSettingActions.collapseMenu();
          }}>
          <PanelLeftClose />
        </NavIconButton>
      </Tooltip>
    </div>
  );
}

export function UserSettingButton({ isHover = false }: { isHover?: boolean }) {
  const { tr } = useTr();
  return (
    <Tooltip rich={hintTooltip(tr('settings.menu.open'), isMac ? '⌘+,' : 'Ctrl+,')}>
      <NavIconButton aria-label={tr('settings.menu.open')} className={isHover ? 'text-sidebar-foreground' : undefined}
        onClick={() => {
          loseFocus.emit();
          openSettings.emit();
        }}>
        <Settings />
      </NavIconButton>
    </Tooltip>
  );
}

export function NumberedRedDot() {
  const unread = useReminderStore(unreadReminderCount);
  return <NavCount count={unread} className="absolute -top-0.5 -right-0.5 h-4 min-w-4 text-2xs" />;
}

export function NotificationButton({ isHover = false }: { isHover?: boolean }) {
  const { tr } = useTr();
  const visible = useNotificationSettingsStore((s) => s.isShowNotificationsIconEnabled);
  useEffect(() => reminderActions.started(), []);
  if (!visible) return null;
  return (
    <Tooltip message={tr('notificationHub.title')}>
      <NavIconButton className={isHover ? 'relative text-sidebar-foreground' : 'relative'}
        aria-label={tr('notificationHub.title')} onClick={() => homeSettingActions.collapseNotificationPanel()}>
        <Bell />
        <NumberedRedDot />
      </NavIconButton>
    </Tooltip>
  );
}

export function SidebarUser({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  const name = user.name || tr('defaultUsername');
  return (
    <div className="flex h-10 shrink-0 items-center gap-1">
      <button type="button" className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent">
        <AFAvatar url={user.iconUrl} name={user.name} size="s" />
        <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">{name}</span>
      </button>
      <UserSettingButton />
      <NotificationButton key={String(user.id)} />
    </div>
  );
}
