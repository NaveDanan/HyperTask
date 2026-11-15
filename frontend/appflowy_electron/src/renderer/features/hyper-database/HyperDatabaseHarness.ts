import { unwrap } from '@/backend/dispatch';
import { FolderEventGetCurrentWorkspaceSetting } from '@/backend/events/flowy-folder';
import { ViewBackendService } from '@/features/view/view-service';
import { tabsActions } from '@/features/tabs/tabs-store';
import { useAppStore } from '@/startup/app-store';
import { useAppearanceStore } from '@/theme/appearance-store';
import { ThemeModePB } from '@shared/protobuf/flowy-user/user_setting_pb';
import { seedHyperDatabaseSamples, type HyperSampleDatabase } from './HyperDatabaseSeed';

declare global {
  interface Window { hyperViews?: ReturnType<typeof installHyperDatabaseHarness> }
}
/** Loaded only when the development web-harness shim marks the browser. */
export function installHyperDatabaseHarness() {
  const ready = async () => {
    if (useAppStore.getState().route.name === 'home') return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error('Harness startup timed out')); }, 60000);
      const stop = useAppStore.subscribe(state => {
        if (state.route.name === 'home') { clearTimeout(timer); stop(); resolve(); }
        if (state.route.name === 'fatal' || state.route.name === 'workspaceError') { clearTimeout(timer); stop(); reject(new Error(JSON.stringify(state.route))); }
      });
    });
  };
  const api = {
    ready,
    seed: async (count = 12): Promise<HyperSampleDatabase[]> => { await ready(); const workspace = unwrap(await FolderEventGetCurrentWorkspaceSetting()); return seedHyperDatabaseSamples(workspace.workspaceId, undefined, count); },
    open: async (viewId: string) => { await ready(); const view = unwrap(await ViewBackendService.getView(viewId)); tabsActions.openView(view); },
    theme: (theme: 'light' | 'dark') => useAppearanceStore.setState(state => ({ appearance: { ...state.appearance, themeMode: theme === 'dark' ? ThemeModePB.Dark : ThemeModePB.Light } })),
  };
  window.hyperViews = api; return api;
}
