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
const { appearanceActions } = await import('@/theme/appearance-store');
const { localToolPlugin, blankPlugin, trashPlugin } = await import('../tabs/plugin');
const { homeSettingActions: actions, useHomeSettingStore: store, MenuStatus, SIDEBAR_RAIL_WIDTH } = await import('./home-setting-store');
describe('sidebar collapse preference', () => {
  beforeEach(() => { vi.clearAllMocks(); prefs.appearance.isMenuCollapsed = false; actions.initialize(); });
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


describe('active plugin menu preference', () => {
  beforeEach(() => { vi.clearAllMocks(); prefs.appearance.isMenuCollapsed = false; actions.initialize(); });
  it('collapses on entry and restores on exit without saving either automatic change', () => {
    actions.preferCollapsedMenu(1);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    expect(prefs.appearance.isMenuCollapsed).toBe(false);
    actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(store.getState().menuPreference).toBeNull();
    expect(appearanceActions.saveIsMenuCollapsed).not.toHaveBeenCalled();
  });
  it('preserves a previously collapsed preference, including startup entry', () => {
    prefs.appearance.isMenuCollapsed = true; actions.initialize(); actions.preferCollapsedMenu(1);
    actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    expect(appearanceActions.saveIsMenuCollapsed).not.toHaveBeenCalled();
  });
  it('does not re-collapse an active tab after the user expands it', () => {
    actions.preferCollapsedMenu(1); actions.collapseMenu(); actions.preferCollapsedMenu(1);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(appearanceActions.saveIsMenuCollapsed).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('keeps a user expansion when the sidebar was collapsed before entry', () => {
    prefs.appearance.isMenuCollapsed = true; actions.initialize(); actions.preferCollapsedMenu(1);
    actions.changeMenuStatus(MenuStatus.expanded); actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(prefs.appearance.isMenuCollapsed).toBe(false);
    expect(appearanceActions.saveIsMenuCollapsed).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('keeps the user choice after they expand and collapse again', () => {
    actions.preferCollapsedMenu(1); actions.collapseMenu(); actions.collapseMenu();
    actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    expect(prefs.appearance.isMenuCollapsed).toBe(true);
    expect(appearanceActions.saveIsMenuCollapsed).toHaveBeenCalledTimes(2);
  });
  it('starts a new temporary preference on re-entry and restores on tab close', () => {
    actions.preferCollapsedMenu(1); actions.collapseMenu(); actions.preferCollapsedMenu(null);
    actions.preferCollapsedMenu(2);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(appearanceActions.saveIsMenuCollapsed).toHaveBeenCalledTimes(1);
  });
  it('hands off between preferred tabs without losing the original expanded state', () => {
    actions.preferCollapsedMenu(1); actions.preferCollapsedMenu(2); actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(appearanceActions.saveIsMenuCollapsed).not.toHaveBeenCalled();
  });
  it('keeps temporary collapse and user overrides stable across responsive breakpoints', () => {
    actions.preferCollapsedMenu(1); actions.checkScreenSize(700); actions.checkScreenSize(1280);
    expect(store.getState().menuStatus).toBe(MenuStatus.hidden);
    actions.collapseMenu(); actions.checkScreenSize(700); actions.checkScreenSize(1280);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    actions.preferCollapsedMenu(null);
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(appearanceActions.saveIsMenuCollapsed).toHaveBeenCalledTimes(1);
  });
  it('allows initialization to clear a previous session preference', () => {
    actions.preferCollapsedMenu(1); actions.initialize();
    expect(store.getState().menuStatus).toBe(MenuStatus.expanded);
    expect(store.getState().menuPreference).toBeNull();
  });
  it('marks only the bots plugin as preferring collapse and keeps its identity', () => {
    expect(localToolPlugin('bots')).toMatchObject({ id: 'local-tool:bots', prefersCollapsedMenu: true });
    for (const plugin of [localToolPlugin('home'), localToolPlugin('jira'), localToolPlugin('nod'), localToolPlugin('templates'), blankPlugin(), trashPlugin()]) expect(plugin.prefersCollapsedMenu).toBeFalsy();
  });
});
