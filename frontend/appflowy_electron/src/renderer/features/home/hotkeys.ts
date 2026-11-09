import { useEffect } from 'react';
import { ThemeModePB } from '@shared/protobuf/flowy-user/user_setting_pb';
import { KeyValueStorage } from '@/startup/kv';
import { appearanceActions, effectiveBrightness, useAppearanceStore } from '@/theme/appearance-store';
import { tabsActions, useTabsStore } from '../tabs/tabs-store';
import { homeSettingActions, useHomeSettingStore } from './home-setting-store';
import { createNewPage, openSettings, renameSelectedView, switchToNextSpace, toggleCommandPalette } from './notifiers';

const isMac = navigator.userAgent.includes('Mac');

function scale(next: number) {
  const value = Math.round(Math.min(2, Math.max(0.5, next)) * 100) / 100;
  window.appflowy.app.setZoomFactor(value);
  void KeyValueStorage.set('scaleFactor', String(value));
}

/** HomeHotKeys (workspace/presentation/home/hotkeys.dart): in-app shortcuts, capture phase. */
export function useHomeHotKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key;
      let handled = true;

      if (key === 'F2' && !mod) {
        renameSelectedView.emit();
      } else if (!mod) {
        handled = false;
      } else if (key === '\\' || key === '.') {
        if (!useHomeSettingStore.getState().isNotificationPanelCollapsed) homeSettingActions.collapseNotificationPanel();
        else homeSettingActions.collapseMenu();
      } else if (event.shiftKey && key.toLowerCase() === 'l') {
        const dark = effectiveBrightness(useAppearanceStore.getState()) === 'dark';
        void appearanceActions.setThemeMode(dark ? ThemeModePB.Light : ThemeModePB.Dark);
      } else if (key.toLowerCase() === 'w' && !event.shiftKey) {
        tabsActions.closeCurrentTab();
      } else if (key === 'PageUp') {
        tabsActions.selectTab(useTabsStore.getState().currentIndex - 1);
      } else if (key === 'PageDown') {
        tabsActions.selectTab(useTabsStore.getState().currentIndex + 1);
      } else if (key === '=' || key === '+' || event.code === 'NumpadAdd') {
        void window.appflowy.prefs.getAll().then((p) => scale(Number(p.scaleFactor ?? 1) + 0.1));
      } else if (key === '-' || event.code === 'NumpadSubtract') {
        void window.appflowy.prefs.getAll().then((p) => scale(Number(p.scaleFactor ?? 1) - 0.1));
      } else if (key === '0' || event.code === 'Numpad0') {
        scale(1);
      } else if (key.toLowerCase() === 'o' && !event.shiftKey) {
        switchToNextSpace.emit();
      } else if (key.toLowerCase() === 'n' && !event.shiftKey) {
        createNewPage.emit();
      } else if (key === ',') {
        openSettings.emit();
      } else if (key.toLowerCase() === 'p' && !event.shiftKey) {
        toggleCommandPalette.emit();
      } else {
        handled = false;
      }

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
