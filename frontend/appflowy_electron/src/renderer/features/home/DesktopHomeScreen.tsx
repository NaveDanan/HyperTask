import { useEffect, useState } from 'react';
import type { WorkspaceLatestPB } from '@shared/protobuf/flowy-folder/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { FolderEventGetCurrentWorkspaceSetting, FolderEventGetViewAncestors, UserEventGetUserProfile } from '@/backend/events';
import { WorkspaceFailedScreen } from '@/features/auth/screens';
import { NotificationPanel } from '@/features/sidebar/notifications/NotificationPanel';
import { HomeSideBar } from '@/features/sidebar/Sidebar';
import { HomeStack } from '@/features/tabs/HomeStack';
import { CommandPaletteHost } from '@/features/search/CommandPalette';
import { SettingsDialogHost } from '@/features/settings/SettingsDialog';
import { Spinner } from '@/ui';
import { PluginType, viewPlugin } from '../tabs/plugin';
import { tabsActions, useTabsStore } from '../tabs/tabs-store';
import { homeSettingActions, useHomeLayout } from './home-setting-store';
import { startHome, useHomeStore } from './home-store';
import { useHomeHotKeys } from './hotkeys';
import { useSwitchToSpace } from './notifiers';
import { QuestionBubble } from './QuestionBubble';
import { SidebarResizer } from './SidebarResizer';
import { isSpace } from '../view/view-ext';

/** DesktopHomeScreen: loads the workspace setting and user, then shows the home. */
export function DesktopHomeScreen() {
  const [state, setState] = useState<'loading' | 'failed' | { user: UserProfilePB; setting: WorkspaceLatestPB }>('loading');

  useEffect(() => {
    void Promise.all([FolderEventGetCurrentWorkspaceSetting(), UserEventGetUserProfile()]).then(([setting, user]) => {
      if (setting.ok && user.ok) setState({ user: user.value, setting: setting.value });
      else setState('failed');
    });
  }, []);

  if (state === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }
  if (state === 'failed') return <WorkspaceFailedScreen />;
  return <HomeBody key={String(state.user.id)} user={state.user} setting={state.setting} />;
}

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

function HomeBody({ user, setting }: { user: UserProfilePB; setting: WorkspaceLatestPB }) {
  const width = useWindowWidth();
  const layout = useHomeLayout(width);
  const latestView = useHomeStore((s) => s.latestView);
  useHomeHotKeys();

  useEffect(() => {
    tabsActions.reset();
    homeSettingActions.initialize();
    return startHome(user, setting);
  }, [user, setting]);

  useEffect(() => homeSettingActions.checkScreenSize(width), [width]);

  // The workspace's last page opens in a blank tab, and the sidebar shows its space.
  useEffect(() => {
    if (!latestView) return;
    const { tabs, currentIndex } = useTabsStore.getState();
    if (tabs[currentIndex]?.plugin.type === PluginType.blank && tabs[currentIndex].plugin.kind === 'blank') {
      tabsActions.openPlugin(viewPlugin(latestView), latestView);
    }
    void FolderEventGetViewAncestors({ value: latestView.id }).then((result) => {
      if (!result.ok) return;
      const space = result.value.items.find((v) => isSpace(v));
      if (space && space.id !== useSwitchToSpace.getState().space?.id) useSwitchToSpace.setState({ space });
    });
  }, [latestView]);

  const ease = (ms: number) => `${ms}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
  return (
    <div style={{ position: 'relative', height: '100%', background: 'var(--cs-surface)', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          left: layout.homePageLOffset,
          minWidth: 500,
          transition: `left ${ease(layout.animDuration)}`,
        }}
      >
        <HomeStack />
      </div>
      <QuestionBubble />
      {layout.showNotificationPanel && (
        <NotificationPanel left={layout.showMenu ? layout.menuWidth : 0} top={layout.showMenu ? 0 : 52} />
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: layout.menuWidth,
          transform: layout.showMenu ? 'translateX(0)' : `translateX(-${layout.menuWidth}px)`,
          transition: `transform ${ease(layout.animDuration)}, width ${ease(layout.animDuration)}`,
          zIndex: 2,
        }}
      >
        <HomeSideBar user={user} />
      </div>
      {layout.showMenu && <SidebarResizer left={layout.menuWidth} />}
      <CommandPaletteHost />
      <SettingsDialogHost user={user} />
    </div>
  );
}
