import { HyperOutlookPresenceNotice } from '@/features/hyper-outlook/HyperOutlookPresenceNotice';
import { sidebarSpace } from '@/features/sidebar/stores/space-store';
import { ensureHyperGeneralCalendar } from '@/features/hyper-outlook/HyperGeneralCalendar';
import { showToast } from '@/ui';
import { useEffect, useState } from 'react';
import type { WorkspaceLatestPB } from '@shared/protobuf/hyper-folder/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/hyper-user/user_profile_pb';
import { FolderEventGetCurrentWorkspaceSetting, FolderEventGetViewAncestors, UserEventGetUserProfile } from '@/backend/events';
import { WorkspaceFailedScreen } from '@/features/auth/screens';
import { NotificationPanel } from '@/features/sidebar/notifications/NotificationPanel';
import { HomeSideBar } from '@/features/sidebar/Sidebar';
import { HyperSidebarRail } from '../sidebar/HyperSidebarRail';
import { HomeStack } from '@/features/tabs/HomeStack';
import { HyperChromePanel, useHyperChromePanelStore } from './HyperChromePanel';
import { CommandPaletteHost } from '@/features/search/CommandPalette';
import { SettingsDialogHost } from '@/features/settings/SettingsDialog';
import { HyperJiraBackgroundSync } from '@/features/jira/ui/HyperJiraBackgroundSync';
import { Spinner } from '@/components/ui/spinner';
import { PluginType, localToolPlugin, viewPlugin } from '../tabs/plugin';
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
      <div className="flex h-full items-center justify-center bg-sidebar text-foreground">
        <Spinner className="size-5 text-muted-foreground" />
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
  const activeTabKey = useTabsStore((s) => s.tabs[s.currentIndex]?.key ?? null);
  const chromeClaim = useHyperChromePanelStore((s) => s.claim);
  const layout = useHomeLayout(width, chromeClaim?.owner === activeTabKey ? chromeClaim.width : 0);
  const latestView = useHomeStore((s) => s.latestView);
  useHomeHotKeys();

  useEffect(() => {
    tabsActions.reset();
    // HyperHome (Hyper-Kanban + Hyper-Event) is the startup page instead of the last opened page.
    tabsActions.openPlugin(localToolPlugin('home'), undefined, false);
    homeSettingActions.initialize();
    return startHome(user, setting);
  }, [user, setting]);

  useEffect(() => {
    const update = () => {
      const { tabs, currentIndex } = useTabsStore.getState(), tab = tabs[currentIndex];
      homeSettingActions.preferCollapsedMenu(tab?.plugin.prefersCollapsedMenu ? tab.key : null);
    };
    const stop = useTabsStore.subscribe(update); update();
    return () => { stop(); homeSettingActions.preferCollapsedMenu(null); };
  }, [user, setting]);

  useEffect(() => homeSettingActions.checkScreenSize(width), [width]);
  useEffect(() => {
    const attempted = new Set<string>();
    const ensure = () => {
      const space = sidebarSpace.store.getState(), workspaceId = sidebarSpace.actions.workspaceId;
      if (!space.isInitialized || !workspaceId || attempted.has(workspaceId)) return;
      attempted.add(workspaceId);
      void ensureHyperGeneralCalendar(workspaceId).catch(error => { console.error('General calendar could not be initialized', error); showToast({ type: 'error', message: 'General calendar could not be initialized. Reopen the workspace to retry.' }); });
    };
    const stop = sidebarSpace.store.subscribe(ensure); ensure(); return stop;
  }, [user]);

  // The workspace's last page opens in a blank tab (startup shows HyperHome instead), and the sidebar shows its space.
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
    <div className="relative h-full overflow-hidden bg-sidebar text-foreground">
      <HyperChromePanel available={layout.chromePanelAvailable} activeOwner={activeTabKey} width={layout.chromePanelWidth} left={layout.railWidth} transition={`width ${ease(layout.animDuration)}`}>
      <div
        className="absolute inset-y-0 right-0 min-w-0"
        style={{
          left: layout.homePageLOffset,
          transition: `left ${ease(layout.animDuration)}`,
        }}
      >
        <HomeStack />
      </div>
      <QuestionBubble />
      <HyperOutlookPresenceNotice />
      {layout.showNotificationPanel && (
        <NotificationPanel left={layout.showMenu ? layout.menuWidth : layout.railWidth} top={layout.showMenu ? 0 : 52} />
      )}
      <div
        inert={!layout.showMenu}
        className="absolute inset-y-0 left-0 z-2"
        style={{
          width: layout.menuWidth,
          transform: layout.showMenu ? 'translateX(0)' : `translateX(-${layout.menuWidth}px)`,
          transition: `transform ${ease(layout.animDuration)}, width ${ease(layout.animDuration)}`,
        }}
      >
        <HomeSideBar user={user} />
      </div>
      {!layout.showMenu && <HyperSidebarRail user={user} />}
      {layout.showMenu && <SidebarResizer left={layout.menuWidth} />}
      <CommandPaletteHost />
      <SettingsDialogHost user={user} />
      <HyperJiraBackgroundSync userId={String(user.id)} />
      </HyperChromePanel>
    </div>
  );
}
