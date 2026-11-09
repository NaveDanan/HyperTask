// The per-plugin blocs a view plugin creates in Plugin.init() and shares between its header
// (leftBarItem / rightBarItem) and its body: PageAccessLevelBloc and the ViewPluginNotifier
// (plugins/util.dart).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { DeletedViewPB, ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { tabsActions } from '../tabs/tabs-store';
import { createPageAccessLevelStore, type PageAccessLevelState, type PageAccessLevelStore } from './page-access-level-store';
import { listenView } from './view-listener';

export interface ViewPluginNotifierState {
  /** The latest view (onViewUpdated replaces it). */
  view: ViewPB;
  /** isDeleted: set by DidMoveViewToTrash. */
  isDeleted: DeletedViewPB | null;
}

export interface ViewScope {
  view: ViewPB;
  accessLevel: PageAccessLevelStore;
  notifier: StoreApi<ViewPluginNotifierState>;
  /** Starts the listeners (Plugin.init); returns dispose. */
  start(): () => void;
}

/** Plugin.init() for a view plugin. `updateTabs` keeps tab titles in sync (main pane only). */
export function createViewScope(view: ViewPB, updateTabs: boolean): ViewScope {
  const accessLevel = createPageAccessLevelStore(view);
  const notifier = createStore<ViewPluginNotifierState>(() => ({ view, isDeleted: null }));
  return {
    view,
    accessLevel,
    notifier,
    start() {
      const stopAccess = accessLevel.start();
      const stopView = listenView(view.id, {
        onViewUpdated: (updated) => {
          notifier.setState({ view: updated });
          if (updateTabs) tabsActions.updateView(updated);
        },
        onViewMoveToTrash: (deleted) => notifier.setState({ isDeleted: deleted }),
      });
      return () => {
        stopView();
        stopAccess();
      };
    },
  };
}

const ViewScopeContext = createContext<ViewScope | null>(null);

/** Creates the scope for `view` and runs it while mounted (key the caller by view id). */
export function ViewScopeProvider({ view, updateTabs, children }: { view: ViewPB; updateTabs: boolean; children: ReactNode }) {
  const [scope] = useState(() => createViewScope(view, updateTabs));
  useEffect(() => scope.start(), [scope]);
  return <ViewScopeContext.Provider value={scope}>{children}</ViewScopeContext.Provider>;
}

/** Provides a scope created elsewhere (the header and the body of one tab share it). */
export function ProvideViewScope({ scope, children }: { scope: ViewScope | null; children: ReactNode }) {
  return <ViewScopeContext.Provider value={scope}>{children}</ViewScopeContext.Provider>;
}

export const useViewScope = () => useContext(ViewScopeContext);

const fallbackAccess = createStore<PageAccessLevelState | null>(() => null);

/** BlocBuilder<PageAccessLevelBloc>: the state, or null outside a view plugin. */
export function usePageAccessLevel(): PageAccessLevelState | null {
  const scope = useViewScope();
  return useStore((scope?.accessLevel ?? fallbackAccess) as StoreApi<PageAccessLevelState | null>);
}

const fallbackNotifier = createStore<ViewPluginNotifierState | null>(() => null);

export function useViewPluginNotifier(): ViewPluginNotifierState | null {
  const scope = useViewScope();
  return useStore((scope?.notifier ?? fallbackNotifier) as StoreApi<ViewPluginNotifierState | null>);
}
