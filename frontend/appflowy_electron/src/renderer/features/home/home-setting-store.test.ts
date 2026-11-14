import { beforeEach, describe, expect, it, vi } from 'vitest';
const prefs = vi.hoisted(() => ({ appearance: { isMenuCollapsed: false, menuOffset: 32 } }));
vi.mock('@/theme/appearance-store', () => ({
  useAppearanceStore: { getState: () => prefs },
  appearanceActions: {
    saveIsMenuCollapsed: vi.fn((collapsed: boolean) => { prefs.appearance.isMenuCollapsed = collapsed; }),
    saveMenuOffset: vi.fn(),
  },
}));
vi.stubGlobal('window', { innerWidth: 1280 });
const { homeSettingActions: actions, useHomeSettingStore: store, MenuStatus, SIDEBAR_RAIL_WIDTH } = await import('./home-setting-store');
describe('sidebar collapse preference', () => {
  beforeEach(() => { prefs.appearance.isMenuCollapsed = false; actions.initialize(); });
  it('toggles and restores the persisted state on mount', () => {
    actions.collapseMenu();
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    expect(prefs.appearance.isMenuCollapsed).toBe(true);
    actions.initialize();
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    actions.collapseMenu();
    expect(prefs.appearance.isMenuCollapsed).toBe(false);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(SIDEBAR_RAIL_WIDTH).toBe(56);
  });
  it('keeps an explicitly collapsed sidebar collapsed across resize', () => {
    actions.collapseMenu(); actions.checkScreenSize(700); actions.checkScreenSize(1280);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
  });
  it('temporarily hides an expanded sidebar on small screens without saving', () => {
    actions.checkScreenSize(700);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    expect(prefs.appearance.isMenuCollapsed).toBe(false);
    actions.checkScreenSize(1280);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
  });
});
