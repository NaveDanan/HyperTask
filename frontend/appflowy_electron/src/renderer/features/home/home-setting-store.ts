import { create } from 'zustand';
import { appearanceActions, useAppearanceStore } from '@/theme/appearance-store';

export enum MenuStatus {
  hidden = 'hidden',
  expanded = 'expanded',
}

interface HomeSettingState {
  menuStatus: MenuStatus;
  isNotificationPanelCollapsed: boolean;
  isScreenSmall: boolean;
  /** 0..200 added to the 268px minimum sidebar width. */
  resizeOffset: number;
  resizeStart: number;
  resizeType: 'slide' | 'drag';
}

/** HomeSettingBloc (workspace/application/home/home_setting_bloc.dart). */
export const useHomeSettingStore = create<HomeSettingState>(() => {
  const { appearance } = useAppearanceStore.getState();
  return {
    menuStatus: appearance.isMenuCollapsed ? MenuStatus.hidden : MenuStatus.expanded,
    isNotificationPanelCollapsed: true,
    isScreenSmall: window.innerWidth < 1024,
    resizeOffset: appearance.menuOffset,
    resizeStart: 0,
    resizeType: 'slide',
  };
});

const get = useHomeSettingStore.getState;
const set = useHomeSettingStore.setState;

export const homeSettingActions = {
  /** Re-reads the persisted sidebar state (a new home screen mounts per launch). */
  initialize() {
    const { appearance } = useAppearanceStore.getState();
    set({
      menuStatus: appearance.isMenuCollapsed ? MenuStatus.hidden : MenuStatus.expanded,
      isNotificationPanelCollapsed: true,
      isScreenSmall: window.innerWidth < 1024,
      resizeOffset: appearance.menuOffset,
      resizeType: 'slide',
    });
  },
  changeMenuStatus(status: MenuStatus) {
    if (get().menuStatus === status) return;
    void appearanceActions.saveIsMenuCollapsed(status !== MenuStatus.expanded);
    set({ menuStatus: status });
  },
  /** collapseMenu(): toggles expanded ↔ hidden. */
  collapseMenu() {
    homeSettingActions.changeMenuStatus(get().menuStatus === MenuStatus.expanded ? MenuStatus.hidden : MenuStatus.expanded);
  },
  /** A toggle despite its name, as in Flutter. */
  collapseNotificationPanel() {
    set({ isNotificationPanelCollapsed: !get().isNotificationPanelCollapsed });
  },
  /** Crossing 1024px auto-hides/shows the sidebar without persisting it. */
  checkScreenSize(width: number) {
    const small = width < 1024;
    if (small === get().isScreenSmall) return;
    const { menuStatus } = get();
    if (small && menuStatus === MenuStatus.expanded) set({ isScreenSmall: small, menuStatus: MenuStatus.hidden });
    else if (!small && menuStatus === MenuStatus.hidden) set({ isScreenSmall: small, menuStatus: MenuStatus.expanded });
    else set({ isScreenSmall: small });
  },
  resizeStart() {
    set({ resizeType: 'drag', resizeStart: get().resizeOffset });
  },
  resized(dx: number) {
    set({ resizeOffset: Math.min(200, Math.max(0, get().resizeStart + dx)) });
  },
  resizeEnd() {
    void appearanceActions.saveMenuOffset(get().resizeOffset);
    set({ resizeType: 'slide' });
  },
};

export const MINIMUM_SIDEBAR_WIDTH = 268;
export const NOTIFICATION_PANEL_WIDTH = 380;

/** HomeLayout (home/home_layout.dart). */
export function useHomeLayout(windowWidth: number) {
  const state = useHomeSettingStore();
  const menuWidth = Math.max(MINIMUM_SIDEBAR_WIDTH + state.resizeOffset, MINIMUM_SIDEBAR_WIDTH);
  const showMenu = state.menuStatus === MenuStatus.expanded;
  const menuIsDrawer = showMenu && windowWidth <= 768;
  return {
    menuWidth,
    showMenu,
    menuIsDrawer,
    homePageLOffset: showMenu && !menuIsDrawer ? menuWidth : 0,
    menuSpacing: !showMenu && navigator.userAgent.includes('Mac') ? 80 : 0,
    animDuration: state.resizeType === 'drag' ? 30 : 350,
    showNotificationPanel: !state.isNotificationPanelCollapsed,
  };
}
