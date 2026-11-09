// Sidebar header pieces: SidebarTopMenu (header/sidebar_top_menu.dart), SidebarUser
// (header/sidebar_user.dart), UserSettingButton (shared/sidebar_setting.dart),
// NotificationButton + NumberedRedDot (workspace/presentation/notifications/).
import { useEffect } from 'react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useTr } from '@/i18n';
import { HyperLogo } from '@/ui/HyperLogo';
import { AFAvatar, FlowyButton, FlowySvg, FlowyText, Tooltip } from '@/ui';
import { homeSettingActions, useHomeSettingStore } from '@/features/home/home-setting-store';
import { loseFocus, openSettings } from '@/features/home/notifiers';
import { hintTooltip, isMac } from '../components';
import { useNotificationSettingsStore } from '../stores/notification-settings-store';
import { reminderActions, unreadReminderCount, useReminderStore } from '../stores/reminder-store';

/** SidebarTopMenu: the app logo (not on macOS) and the hover-only collapse button. */
export function SidebarTopMenu() {
  const { tr } = useTr();
  const panelCollapsed = useHomeSettingStore((s) => s.isNotificationPanelCollapsed);
  return (
    <div style={{ height: navigator.userAgent.includes('Windows') ? 45 : 44, display: 'flex', alignItems: 'flex-start', flexShrink: 0 }}>
      {!isMac && (
        <div style={{ paddingTop: 12, paddingLeft: 8, display: 'flex' }}>
          <HyperLogo size={19} wordmark />
        </div>
      )}
      <div style={{ flex: 1 }} />
      <div className="sb-root-reveal" style={{ paddingTop: 12, paddingRight: 6, display: 'flex' }}>
        <Tooltip
          rich={
            panelCollapsed ? (
              hintTooltip(tr('sideBar.closeSidebar'), isMac ? '⌘+.' : 'Ctrl+\\')
            ) : (
              tr('sideBar.closeSidebar')
            )
          }
        >
          {/* Fires on pointer down, even while invisible. */}
          <div
            className="flowy-hover"
            style={{ width: 24, display: 'flex', justifyContent: 'center' }}
            onMouseDown={(event) => {
              if (event.button === 0) homeSettingActions.collapseMenu();
            }}
          >
            <FlowySvg svg="double_back_arrow_m" color="var(--af-icon-secondary)" />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}

/** UserSettingButton: 28×28, settings_s at 70% (onSurface while the header is hovered). */
export function UserSettingButton({ isHover = false }: { isHover?: boolean }) {
  const { tr } = useTr();
  return (
    <div style={{ width: 28, height: 28, flexShrink: 0 }}>
      <Tooltip message={tr('settings.menu.open')}>
        <div style={{ width: 28, height: 28, display: 'flex' }}>
          <FlowyButton
            margin={0}
            style={{ width: 28, height: 28, justifyContent: 'center' }}
            expandText={false}
            text={<FlowySvg svg="settings_s" color={isHover ? 'var(--cs-on-surface)' : undefined} opacity={0.7} />}
            onTap={() => {
              loseFocus.emit();
              openSettings.emit();
            }}
          />
        </div>
      </Tooltip>
    </div>
  );
}

/** NumberedRedDot.desktop: unread reminders; 14×14, 17×14 (10–99), 24×14 ("99+"). */
export function NumberedRedDot() {
  const unread = useReminderStore(unreadReminderCount);
  if (unread === 0) return null;
  const width = unread > 99 ? 24 : unread >= 10 ? 17 : 14;
  return (
    <div
      style={{
        width,
        height: 14,
        borderRadius: 7,
        background: 'var(--af-border-error-thick)',
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        letterSpacing: 0,
      }}
    >
      {unread > 99 ? '99+' : unread}
    </div>
  );
}

/** NotificationButton: toggles the notification panel; hidden when the setting is off. */
export function NotificationButton({ isHover = false }: { isHover?: boolean }) {
  const visible = useNotificationSettingsStore((s) => s.isShowNotificationsIconEnabled);
  useEffect(() => reminderActions.started(), []);
  if (!visible) return null;
  return (
    <div style={{ width: 28, height: 28, position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FlowyButton
          useIntrinsicWidth
          margin={0}
          text={<FlowySvg svg="notification_s" color={isHover ? 'var(--cs-on-surface)' : undefined} opacity={0.7} />}
          onTap={() => homeSettingActions.collapseNotificationPanel()}
        />
      </div>
      <div style={{ position: 'absolute', top: 0, right: 0 }}>
        <NumberedRedDot />
      </div>
    </div>
  );
}

/** SidebarUser: avatar, name (or "Me"), settings and notifications (local / no-workspace mode). */
export function SidebarUser({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  const name = user.name || tr('defaultUsername');
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      <div style={{ width: 4, flexShrink: 0 }} />
      <div
        style={{
          width: 24,
          height: 24,
          flexShrink: 0,
          borderRadius: 8,
          background: '#FBE8FB',
          boxShadow: 'inset 0 0 0 0.5px #17171719',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AFAvatar url={user.iconUrl} name={user.name} size="s" />
      </div>
      <div style={{ width: 8, flexShrink: 0 }} />
      <FlowyText fontWeight={500} fontSize={15} ellipsis color="var(--cs-tertiary)" style={{ flex: 1 }}>
        {name}
      </FlowyText>
      <UserSettingButton />
      <div style={{ width: 8, flexShrink: 0 }} />
      <NotificationButton key={String(user.id)} />
      <div style={{ width: 10, flexShrink: 0 }} />
    </div>
  );
}
