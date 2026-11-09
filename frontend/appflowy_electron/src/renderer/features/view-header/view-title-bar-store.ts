// ViewTitleBarBloc (workspace/application/view_title/view_title_bar_bloc.dart).
import { createStore, type StoreApi } from 'zustand';
import type { TrashPB } from '@shared/protobuf/flowy-folder/trash_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetViewAncestors, FolderEventListTrashItems } from '@/backend/events';
import { listenTrash, listenView } from './view-listener';

export interface ViewTitleBarState {
  ancestors: ViewPB[];
  isDeleted: boolean;
}

export interface ViewTitleBarStore extends StoreApi<ViewTitleBarState> {
  /** Starts the listeners and the first reload; returns the stop function. */
  start(): () => void;
  reload(): Promise<void>;
  trashUpdated(trash: TrashPB[]): void;
}

export function createViewTitleBarStore(viewId: string): ViewTitleBarStore {
  const store = createStore<ViewTitleBarState>(() => ({ ancestors: [], isDeleted: false }));
  let active = false;
  let generation = 0;

  const reload = async () => {
    const run = ++generation;
    const ancestors = await FolderEventGetViewAncestors({ value: viewId });
    const trash = await FolderEventListTrashItems();
    // Bloc events are handled in order; a newer reload wins.
    if (!active || run !== generation) return;
    store.setState({
      ancestors: ancestors.ok ? ancestors.value.items : [],
      isDeleted: trash.ok ? trash.value.items.some((t) => t.id === viewId) : false,
    });
  };

  // trashUpdated only ever sets isDeleted; a reload resets it.
  const trashUpdated = (trash: TrashPB[]) => {
    if (active && trash.some((t) => t.id === viewId)) store.setState({ isDeleted: true });
  };

  return Object.assign(store, {
    start() {
      active = true;
      const stopView = listenView(viewId, { onViewChildViewsUpdated: () => void reload() });
      const stopTrash = listenTrash(trashUpdated);
      void reload();
      return () => {
        active = false;
        stopView();
        stopTrash();
      };
    },
    reload,
    trashUpdated,
  });
}
