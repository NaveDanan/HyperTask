// HomeSideBar (workspace/presentation/home/menu/sidebar/sidebar.dart): the bloc wiring, its
// listeners, and the _Sidebar column.
import { useEffect, useState } from 'react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FlowyDivider, VSpace } from '@/ui';
import { useHomeStore } from '@/features/home/home-store';
import { renameSelectedView } from '@/features/home/notifiers';
import { blankPlugin } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import { workspaceChanged as commandPaletteWorkspaceChanged } from '@/features/search/command-palette-store';
import { resetRecentViews } from '@/features/search/recent-views-store';
import { showLoading } from './components';
import { SidebarFolder } from './folder/SidebarFolder';
import { SidebarTopMenu, SidebarUser } from './header/SidebarHeader';
import { JiraButton, SidebarFooter, SidebarNewPageButton, SidebarSearchButton } from './SidebarButtons';
import { SidebarSpace } from './space/SidebarSpace';
import { useSpaceState } from './space/space-context';
import { favoriteActions } from './stores/favorite-store';
import { notificationSettingsActions } from './stores/notification-settings-store';
import { reminderActions } from './stores/reminder-store';
import { sectionsActions, useSectionsStore } from './stores/sections-store';
import { sidebarSpace } from './stores/space-store';
import { useWorkspaceStore, workspaceActions, workspaceRole } from './stores/workspace-store';
import { openRenamePopover } from './view/RenameViewPopover';
import { SidebarWorkspace } from './workspace/SidebarWorkspace';
import './sidebar.css';

/** The sidebar's stores, for other features (command palette, view header, settings). */
export { sidebarSpace } from './stores/space-store';
export { useWorkspaceStore, workspaceActions } from './stores/workspace-store';
export { favoriteActions, useFavoriteStore } from './stores/favorite-store';
export { useReminderStore, reminderActions } from './stores/reminder-store';
export { notificationSettingsActions } from './stores/notification-settings-store';
export { performOpenViewAction } from './navigation';
export { createNewPageInSidebar } from './SidebarButtons';

export function HomeSideBar({ user }: { user: UserProfilePB }) {
  // UserWorkspaceBloc: one per user session (created by the home screen in Flutter).
  useEffect(() => {
    void workspaceActions.initialize(user);
    return () => workspaceActions.dispose();
  }, [user]);
  // FavoriteBloc and NotificationSettingsCubit live at home level; ReminderBloc is app-wide.
  useEffect(() => favoriteActions.initial(), []);
  useEffect(() => notificationSettingsActions.load(), []);
  useEffect(() => () => reminderActions.dispose(), []);
  // F2 → RenameViewEvent.open().
  useEffect(() => renameSelectedView.on(() => openRenamePopover()), []);

  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspace?.workspaceId);
  const settingWorkspaceId = useHomeStore((s) => s.workspaceSetting?.workspaceId ?? '');
  // currentWorkspace == null → an empty sidebar.
  if (!currentWorkspaceId) return null;
  return <SidebarScope user={user} workspaceId={currentWorkspaceId || settingWorkspaceId} />;
}

/**
 * The un-keyed MultiBlocProvider: SidebarSectionsBloc and SpaceBloc are created once and then
 * re-pointed by the UserWorkspaceBloc listener on create/delete/open.
 */
function SidebarScope({ user, workspaceId }: { user: UserProfilePB; workspaceId: string }) {
  const [initialWorkspaceId] = useState(workspaceId);

  useEffect(() => {
    // #1: open the root view the sections bloc just created.
    const stopSections = useSectionsStore.subscribe((state, prev) => {
      const view = state.lastCreatedRootView;
      if (view && view.id !== prev.lastCreatedRootView?.id) tabsActions.openView(view);
    });
    // #2: open the space's requested page (or the blank page); loading overlay while duplicating.
    let loading: (() => void) | null = null;
    const stopSpace = sidebarSpace.store.subscribe((state, prev) => {
      if (!state.isInitialized) return;
      if (state.lastCreatedPage?.id === prev.lastCreatedPage?.id && state.isDuplicatingSpace === prev.isDuplicatingSpace) return;
      const page = state.lastCreatedPage;
      if (!page || page.id === '') tabsActions.openPlugin(blankPlugin());
      else tabsActions.openView(page);
      if (state.isDuplicatingSpace) loading ??= showLoading();
      else if (loading) {
        loading();
        loading = null;
      }
    });
    // #4: workspace create/delete/open → reload the sections or reset the spaces, refetch favorites.
    // Flutter's listener has no listenWhen; it runs once per finished action here.
    const stopWorkspace = useWorkspaceStore.subscribe((state, prev) => {
      // CommandPalette.updateBlocs / CachedRecentService.reset on a workspace change (§1.1, §4.1).
      const workspaceId = state.currentWorkspace?.workspaceId;
      if (workspaceId && prev.currentWorkspace && workspaceId !== prev.currentWorkspace.workspaceId) {
        commandPaletteWorkspaceChanged();
        resetRecentViews();
      }
      const result = state.actionResult;
      if (result === prev.actionResult || !result || result.isLoading) return;
      if (result.actionType !== 'create' && result.actionType !== 'delete' && result.actionType !== 'open') return;
      const wsId = state.currentWorkspace?.workspaceId ?? useHomeStore.getState().workspaceSetting?.workspaceId ?? '';
      if (sidebarSpace.store.getState().spaces.length === 0) void sectionsActions.reload(user, wsId);
      else void sidebarSpace.actions.reset(user, wsId, true);
      void favoriteActions.fetchFavorites();
    });

    void sectionsActions.initial(user, initialWorkspaceId);
    void sidebarSpace.actions.initial(user, initialWorkspaceId, false);
    return () => {
      stopSections();
      stopSpace();
      stopWorkspace();
      loading?.();
      sectionsActions.dispose();
      sidebarSpace.actions.dispose();
    };
  }, [user, initialWorkspaceId]);

  return <SidebarBody user={user} />;
}

/** _Sidebar: the column (top → bottom). */
function SidebarBody({ user }: { user: UserProfilePB }) {
  const showWorkspace = useWorkspaceStore((s) => s.isCollabWorkspaceOn && s.workspaces.length > 0);
  // The role is read once (context.read), not watched.
  const [role] = useState(() => workspaceRole(useWorkspaceStore.getState().currentWorkspace));
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      className="sb-root"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--cs-surface-container-highest)',
        borderRight: '1px solid var(--th-divider)',
      }}
    >
      <div style={{ padding: '0 8px', flexShrink: 0 }}>
        <SidebarTopMenu />
      </div>
      <div style={{ height: 32, padding: '0 2px 0 8px', flexShrink: 0 }}>
        {showWorkspace ? <SidebarWorkspace user={user} /> : <SidebarUser user={user} />}
      </div>
      <VSpace size={6} />
      <div style={{ padding: '0 8px', height: 30, flexShrink: 0 }}>
        <SidebarSearchButton />
      </div>
      {role !== AFRolePB.Guest && (
        <>
          <VSpace size={6} />
          <SidebarNewPageButton />
        </>
      )}
      <JiraButton />
      <VSpace size={12} />
      <div style={{ padding: '0 12px', opacity: scrolled ? 1 : 0, flexShrink: 0 }}>
        <FlowyDivider />
      </div>
      <FolderOrSpace onScrolled={setScrolled} />
      <div style={{ padding: '0 12px', flexShrink: 0 }}>
        <FlowyDivider />
      </div>
      <VSpace size={8} />
      {/* SpaceMigration and the app-update banner are unreachable in this checkout. */}
      <VSpace size={8} />
      <div style={{ padding: '0 12px', flexShrink: 0 }}>
        <SidebarFooter />
      </div>
      <VSpace size={14} />
    </div>
  );
}

/** _renderFolderOrSpace: legacy sections unless the (collab) workspace has spaces. */
function FolderOrSpace({ onScrolled }: { onScrolled: (scrolled: boolean) => void }) {
  const isInitialized = useSpaceState((s) => s.isInitialized);
  const spacesEmpty = useSpaceState((s) => s.spaces.length === 0);
  const containsSpace = useSectionsStore((s) => s.containsSpace);
  const isCollab = useWorkspaceStore((s) => s.isCollabWorkspaceOn);

  useEffect(() => {
    if (isInitialized && containsSpace && spacesEmpty) void sidebarSpace.actions.didReceiveSpaceUpdate();
  }, [isInitialized, containsSpace, spacesEmpty]);

  if (!isInitialized) return null;
  const useFolder = !containsSpace || spacesEmpty || !isCollab;
  return (
    <div style={{ flex: 1, minHeight: 0, padding: '0 2px 0 8px', display: 'flex', flexDirection: 'column' }}>
      <div
        className={`sb-scroll${useFolder ? '' : ' sb-scroll-hover-thumb'}`}
        style={{ flex: 1, minHeight: 0, paddingRight: 6 }}
        onScroll={(event) => onScrolled(event.currentTarget.scrollTop > 0)}
      >
        {useFolder ? <SidebarFolder /> : <SidebarSpace />}
      </div>
    </div>
  );
}
