import { create } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetViewAncestors, FolderEventSetLatestView } from '@/backend/events';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { isSpace } from '../view/view-ext';
import { PluginType, blankPlugin, pluginView, viewPlugin, type Plugin, type PluginArguments } from './plugin';

export interface Tab {
  /** Stable React key for the tab's mounted page. */
  key: number;
  plugin: Plugin;
  isPinned: boolean;
  /** Secondary (side) view, used by AI chat "open page from message". */
  secondary: Plugin;
  showSecondary: boolean;
}

export interface TabsState {
  currentIndex: number;
  tabs: Tab[];
  /** MenuSharedState.latestOpenView: drives the sidebar selection highlight. */
  latestOpenView: ViewPB | null;
}

let nextKey = 1;
const newTab = (plugin: Plugin): Tab => ({ key: nextKey++, plugin, isPinned: false, secondary: blankPlugin(), showSecondary: false });

export const useTabsStore = create<TabsState>(() => ({
  currentIndex: 0,
  tabs: [newTab(blankPlugin())],
  latestOpenView: null,
}));

const get = useTabsStore.getState;
const set = useTabsStore.setState;

/** PageNotifier.setPlugin: SetLatestView only for view plugins (not blank-type, non-empty id). */
function announceLatest(plugin: Plugin, setLatest: boolean) {
  if (setLatest && plugin.id !== '' && plugin.type !== PluginType.blank) {
    void FolderEventSetLatestView({ value: plugin.id });
  }
}

function setLatestOpenView(view?: ViewPB) {
  if (view) {
    if (get().latestOpenView?.id !== view.id) set({ latestOpenView: view });
    return;
  }
  const { tabs, currentIndex } = get();
  const current = tabs[currentIndex] && pluginView(tabs[currentIndex].plugin);
  if (current && get().latestOpenView?.id !== current.id) set({ latestOpenView: current });
}

/** closeView: the last tab never closes; the index number is kept unless it falls off the end. */
function closeView(pluginId: string) {
  const { tabs, currentIndex } = get();
  if (tabs.length <= 1) return;
  const index = tabs.findIndex((t) => t.plugin.id === pluginId);
  if (index < 0) return;
  const next = tabs.filter((_, i) => i !== index);
  const newIndex = currentIndex > next.length - 1 && currentIndex > 0 ? currentIndex - 1 : currentIndex;
  set({ tabs: next, currentIndex: newIndex });
}

function resetCurrentSecondary() {
  const { tabs, currentIndex } = get();
  set({
    tabs: tabs.map((t, i) => (i === currentIndex ? { ...t, showSecondary: false, secondary: blankPlugin() } : t)),
  });
}

// ViewExpanderRegistry: sidebar rows register here so opening a page can reveal it.
export interface ViewExpander {
  isExpanded(): boolean;
  expand(): void;
}
const expanders = new Map<string, Set<ViewExpander>>();
export function registerViewExpander(viewId: string, expander: ViewExpander): () => void {
  const set = expanders.get(viewId) ?? new Set();
  set.add(expander);
  expanders.set(viewId, set);
  return () => {
    set.delete(expander);
    if (set.size === 0) expanders.delete(viewId);
  };
}
const isViewExpanded = (viewId: string) => [...(expanders.get(viewId) ?? [])].some((e) => e.isExpanded());

/** _expandAncestors: persist every ancestor as expanded and expand the first registered one. */
async function expandAncestors(view: ViewPB, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return;
  if (isViewExpanded(view.parentViewId)) return;
  const expanded = KeyValueStorage.getJson<Record<string, boolean>>(KVKeys.expandedViews) ?? {};
  const ancestors = await FolderEventGetViewAncestors({ value: view.id });
  if (!ancestors.ok || !isCurrent()) return;
  for (const ancestor of ancestors.value.items) expanded[ancestor.id] = true;
  await KeyValueStorage.set(KVKeys.expandedViews, JSON.stringify(expanded));
  if (!isCurrent()) return;
  for (const ancestor of ancestors.value.items) {
    const candidates = [...(expanders.get(ancestor.id) ?? [])];
    const target = candidates.find((e) => !e.isExpanded());
    if (target) {
      target.expand();
      break;
    }
  }
}

let lastOpen: { pluginId: string; viewId?: string; at: number; isCurrent?: () => boolean } | null = null;

/** TabsBloc (workspace/application/tabs/tabs_bloc.dart) with its exact reducer rules. */
export const tabsActions = {
  selectTab(index: number) {
    const { currentIndex, tabs } = get();
    if (index === currentIndex || index < 0 || index >= tabs.length) return;
    set({ currentIndex: index });
    setLatestOpenView();
  },

  closeTab(pluginId: string) {
    const tab = get().tabs.find((t) => t.plugin.id === pluginId);
    if (!tab || tab.isPinned) return;
    closeView(pluginId);
    setLatestOpenView();
  },

  closeCurrentTab() {
    const { tabs, currentIndex } = get();
    const current = tabs[currentIndex];
    if (!current || current.isPinned) return;
    closeView(current.plugin.id);
  },

  closeOtherTabs(pluginId: string) {
    const { tabs, currentIndex } = get();
    const currentPinned = tabs[currentIndex]?.isPinned;
    const next = tabs.filter((t) => t.plugin.id === pluginId || t.isPinned);
    const index = next.findIndex((t) => t.plugin.id === pluginId);
    set({ tabs: next, currentIndex: currentPinned ? Math.min(currentIndex, next.length - 1) : Math.max(0, index) });
    setLatestOpenView();
  },

  togglePin(pluginId: string) {
    const { tabs, currentIndex } = get();
    const index = tabs.findIndex((t) => t.plugin.id === pluginId);
    if (index < 0) return;
    const current = tabs[currentIndex];
    const tab = { ...tabs[index], isPinned: !tabs[index].isPinned };
    const rest = tabs.filter((_, i) => i !== index);
    let target: number;
    if (tab.isPinned) {
      const lastPinned = rest.reduce((last, t, i) => (t.isPinned ? i : last), -1);
      target = lastPinned + 1;
    } else {
      const firstUnpinned = rest.findIndex((t) => !t.isPinned);
      target = firstUnpinned < 0 ? rest.length : firstUnpinned;
    }
    rest.splice(target, 0, tab);
    set({ tabs: rest, currentIndex: rest.findIndex((t) => t.key === current.key) });
  },

  /** openTab: select the tab showing this plugin, or append a new one. */
  openTab(plugin: Plugin, view?: ViewPB) {
    resetCurrentSecondary();
    const { tabs } = get();
    const existing = tabs.findIndex((t) => t.plugin.id === plugin.id);
    if (existing >= 0) {
      set({ currentIndex: existing });
    } else {
      announceLatest(plugin, true);
      set({ tabs: [...tabs, newTab(plugin)], currentIndex: tabs.length });
    }
    setLatestOpenView(view);
  },

  /** openPlugin: select an existing tab, else replace the current tab's page (even when pinned). */
  openPlugin(plugin: Plugin, view?: ViewPB, setLatest = true, isCurrent: () => boolean = () => true) {
    if (!isCurrent()) return;
    const now = Date.now();
    if (lastOpen && (!lastOpen.isCurrent || lastOpen.isCurrent()) && lastOpen.pluginId === plugin.id && lastOpen.viewId === view?.id && now - lastOpen.at < 500) return;
    lastOpen = { pluginId: plugin.id, viewId: view?.id, at: now, isCurrent };

    resetCurrentSecondary();
    const { tabs, currentIndex } = get();
    const existing = tabs.findIndex((t) => t.plugin.id === plugin.id);
    if (existing >= 0) {
      set({ currentIndex: existing });
    } else {
      announceLatest(plugin, setLatest);
      set({ tabs: tabs.map((t, i) => (i === currentIndex ? { ...t, plugin } : t)) });
    }
    if (setLatest) {
      if (view && isSpace(view)) return;
      setLatestOpenView(view);
      if (view) void expandAncestors(view, isCurrent);
    }
  },

  openSecondaryPlugin(plugin: Plugin) {
    const { tabs, currentIndex } = get();
    set({ tabs: tabs.map((t, i) => (i === currentIndex ? { ...t, secondary: plugin, showSecondary: true } : t)) });
  },

  closeSecondaryPlugin() {
    const { tabs, currentIndex } = get();
    set({ tabs: tabs.map((t, i) => (i === currentIndex ? { ...t, showSecondary: false } : t)) });
  },

  showSecondaryPlugin() {
    const { tabs, currentIndex } = get();
    set({ tabs: tabs.map((t, i) => (i === currentIndex ? { ...t, showSecondary: true } : t)) });
  },

  expandSecondaryPlugin() {
    const { tabs, currentIndex } = get();
    const current = tabs[currentIndex];
    announceLatest(current.secondary, true);
    set({
      tabs: tabs.map((t, i) =>
        i === currentIndex ? { ...t, plugin: t.secondary, secondary: blankPlugin(), showSecondary: false } : t,
      ),
    });
    setLatestOpenView();
  },

  /** switchWorkspace: keep pinned tabs and the current one; select index 0 if anything closed. */
  switchWorkspace() {
    const { tabs, currentIndex } = get();
    const next = tabs.filter((t, i) => t.isPinned || i === currentIndex);
    if (next.length !== tabs.length) set({ tabs: next, currentIndex: 0 });
  },

  /** Helpers mirroring TabsBloc.openTab(view) / openPlugin(view, arguments). */
  openViewInNewTab(view: ViewPB) {
    tabsActions.openTab(viewPlugin(view), view);
  },
  openView(view: ViewPB, args?: PluginArguments, isCurrent?: () => boolean) {
    tabsActions.openPlugin(viewPlugin(view, args), view, true, isCurrent);
  },

  /** Keeps tab titles/icons fresh when a view changes (ViewPluginNotifier.onViewUpdated). */
  updateView(view: ViewPB) {
    const { tabs, latestOpenView } = get();
    let changed = false;
    const next = tabs.map((t) => {
      if ((t.plugin.kind === 'view' || t.plugin.kind === 'databaseDocument') && t.plugin.view.id === view.id) {
        changed = true;
        return { ...t, plugin: { ...t.plugin, view } };
      }
      return t;
    });
    if (changed) set({ tabs: next });
    if (latestOpenView?.id === view.id) set({ latestOpenView: view });
  },

  /** For tests and sign-out: back to one blank tab. */
  reset() {
    lastOpen = null;
    set({ currentIndex: 0, tabs: [newTab(blankPlugin())], latestOpenView: null });
  },
};

export const useCurrentTab = () => useTabsStore((s) => s.tabs[s.currentIndex]);
