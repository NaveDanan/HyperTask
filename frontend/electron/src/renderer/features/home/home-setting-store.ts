import { create } from 'zustand';
import { HYPER_CHROME_PANEL_MIN_WIDTH } from './HyperChromePanel';
import { appearanceActions, useAppearanceStore } from '@/theme/appearance-store';
import { useAppearancePrefsStore } from '@/features/settings/appearance/appearance-prefs';

export enum MenuStatus {
  hidden = 'hidden',
  expanded = 'expanded',
}

interface HomeSettingState {
  menuStatus: MenuStatus;
  menuPreference: { owner: number; restoreStatus: MenuStatus; userChanged: boolean } | null;
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
    menuPreference: null,
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
      menuPreference: null,
      isNotificationPanelCollapsed: true,
      isScreenSmall: window.innerWidth < 1024,
      resizeOffset: appearance.menuOffset,
      resizeType: 'slide',
    });
  },
  /** A plugin preference lasts only while that tab is active; automatic changes never save. */
  preferCollapsedMenu(owner: number | null) {
    const { menuPreference, menuStatus } = get();
    if ((menuPreference?.owner ?? null) === owner) return;
    const restored = menuPreference && !menuPreference.userChanged ? menuPreference.restoreStatus : menuStatus;
    set(owner === null
      ? { menuStatus: restored, menuPreference: null }
      : { menuStatus: MenuStatus.hidden, menuPreference: { owner, restoreStatus: restored, userChanged: false } });
  },
  changeMenuStatus(status: MenuStatus) {
    const { menuPreference } = get();
    if (menuPreference && !menuPreference.userChanged) set({ menuPreference: { ...menuPreference, userChanged: true } });
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
    if (get().menuPreference) { set({ isScreenSmall: small }); return; }
    const { menuStatus } = get();
    if (small && menuStatus === MenuStatus.expanded) set({ isScreenSmall: small, menuStatus: MenuStatus.hidden });
    else if (!small) set({ isScreenSmall: small, menuStatus: useAppearanceStore.getState().appearance.isMenuCollapsed ? MenuStatus.hidden : MenuStatus.expanded });
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
export const SIDEBAR_RAIL_WIDTH = 56;

/** HomeLayout (home/home_layout.dart). */
export function useHomeLayout(windowWidth: number, claimedChromePanelWidth = 0) {
  const state = useHomeSettingStore();
  // Panel animations (Appearance settings): the slide duration, 0 under reduced motion.
  const panelAnimationMs = useAppearancePrefsStore((s) => s.panelAnimationDurationMs);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const menuWidth = Math.max(MINIMUM_SIDEBAR_WIDTH + state.resizeOffset, MINIMUM_SIDEBAR_WIDTH);
  const showMenu = state.menuStatus === MenuStatus.expanded;
  const menuIsDrawer = showMenu && windowWidth <= 768;
  const chromePanelAvailable = !showMenu && windowWidth >= HYPER_CHROME_PANEL_MIN_WIDTH;
  const chromePanelWidth = chromePanelAvailable ? claimedChromePanelWidth : 0;
  return {
    menuWidth,
    showMenu,
    menuIsDrawer,
    railWidth: SIDEBAR_RAIL_WIDTH,
    chromePanelAvailable,
    chromePanelWidth,
    homePageLOffset: showMenu && !menuIsDrawer ? menuWidth : SIDEBAR_RAIL_WIDTH + chromePanelWidth,
    menuSpacing: !showMenu && navigator.userAgent.includes('Mac') ? 80 : 0,
    animDuration: state.resizeType === 'drag' ? 30 : reducedMotion ? 0 : panelAnimationMs,
    showNotificationPanel: !state.isNotificationPanelCollapsed,
  };
}
