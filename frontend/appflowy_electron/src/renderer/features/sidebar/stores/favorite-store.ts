import { create } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import type { SectionViewPB, ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventReadFavorites } from '@/backend/events';
import type { FlowyResult } from '@/backend/dispatch';
import { NotificationSource, listen } from '@/backend/notifications';
import { ViewBackendService } from '@/features/view/view-service';
import { ViewExtKeys, isPinnedView, isSpace, mergeViewExtra } from '@/features/view/view-ext';

/** A favorite with its item present (SectionViewPB.item is a message field). */
export type FavoriteView = SectionViewPB & { item: ViewPB };

export interface FavoriteState {
  views: FavoriteView[];
  pinnedViews: FavoriteView[];
  unpinnedViews: FavoriteView[];
  isLoading: boolean;
}

/** FavoriteBloc (workspace/application/favorite/favorite_bloc.dart), provided at home level. */
export const useFavoriteStore = create<FavoriteState>(() => ({ views: [], pinnedViews: [], unpinnedViews: [], isLoading: true }));
const get = useFavoriteStore.getState;
const set = useFavoriteStore.setState;

/** FavoriteService.readFavorites: ReadFavorites minus spaces, in backend order. */
export async function readFavorites(): Promise<FlowyResult<FavoriteView[]>> {
  const result = await FolderEventReadFavorites();
  if (!result.ok) return result;
  return { ok: true, value: result.value.items.filter((e): e is FavoriteView => !!e.item && !isSpace(e.item)) };
}

/** pinOrUnpinFavorite: merge {"is_pinned": bool} into the view's extra. */
async function pinOrUnpin(view: ViewPB, isPinned: boolean) {
  try {
    await ViewBackendService.updateView({ viewId: view.id, extra: mergeViewExtra(view, { [ViewExtKeys.isPinned]: isPinned }) });
  } catch {
    // invalid extra JSON: Failed to pin favorite
  }
}

/** Flutter's ReorderableListView index fix, then the optimistic reorder of the pinned list. */
export function reorderPinned<T>(pinned: T[], oldIndex: number, newIndex: number): T[] {
  const next = [...pinned];
  const target = oldIndex < newIndex ? newIndex - 1 : newIndex;
  const [moved] = next.splice(oldIndex, 1);
  next.splice(target, 0, moved);
  return next;
}

let isReordering = false;
let stopListener: (() => void) | null = null;

export const favoriteActions = {
  /** FavoriteEvent.initial: FavoriteListener + fetchFavorites. */
  initial() {
    stopListener?.();
    stopListener = listen<FolderNotification>(
      NotificationSource.Folder,
      (ty, result) => {
        if (ty !== FolderNotification.DidFavoriteView && ty !== FolderNotification.DidUnfavoriteView) return;
        if (!isReordering && result.ok) void favoriteActions.fetchFavorites();
      },
      'favorite',
    );
    void favoriteActions.fetchFavorites();
    return () => {
      stopListener?.();
      stopListener = null;
      set({ views: [], pinnedViews: [], unpinnedViews: [], isLoading: true });
    };
  },

  async fetchFavorites() {
    const result = await readFavorites();
    if (!result.ok) {
      set({ isLoading: false, views: [] });
      return;
    }
    const views = result.value;
    set({
      isLoading: false,
      views,
      pinnedViews: views.filter((v) => isPinnedView(v.item)),
      unpinnedViews: views.filter((v) => !isPinnedView(v.item)),
    });
  },

  /** toggle: unpin when unfavoriting; auto-pin while fewer than 3 views are pinned. */
  async toggle(view: ViewPB) {
    const isFavorited = get().views.some((v) => v.item.id === view.id);
    if (isFavorited) await pinOrUnpin(view, false);
    else if (get().pinnedViews.length < 3) await pinOrUnpin(view, true);
    await ViewBackendService.favorite(view.id);
  },

  async pin(view: ViewPB) {
    await pinOrUnpin(view, true);
    await favoriteActions.fetchFavorites();
  },

  async unpin(view: ViewPB) {
    await pinOrUnpin(view, false);
    await favoriteActions.fetchFavorites();
  },

  /** reorder: unfavorite + refavorite every pinned view in the new order (bumps the timestamps). */
  async reorder(oldIndex: number, newIndex: number) {
    isReordering = true;
    const pinnedViews = reorderPinned(get().pinnedViews, oldIndex, newIndex);
    set({ pinnedViews });
    for (const view of pinnedViews) {
      await ViewBackendService.favorite(view.item.id);
      await ViewBackendService.favorite(view.item.id);
    }
    await favoriteActions.fetchFavorites();
    isReordering = false;
  },
};

export type FavoriteGroups = { today: ViewPB[]; thisWeek: ViewPB[]; others: ViewPB[] };

/** FavoriteMenuBloc._getViews: bucket by whole days since the favorite timestamp (seconds). */
export function groupFavorites(items: FavoriteView[], now = new Date()): FavoriteGroups & { views: ViewPB[] } {
  const groups: FavoriteGroups & { views: ViewPB[] } = { views: [], today: [], thisWeek: [], others: [] };
  for (const item of items) {
    groups.views.push(item.item);
    const days = Math.trunc((now.getTime() - Number(item.timestamp) * 1000) / 86_400_000);
    if (days === 0) groups.today.push(item.item);
    else if (days < 7) groups.thisWeek.push(item.item);
    else groups.others.push(item.item);
  }
  return groups;
}

/** FavoriteMenuBloc._filter: case-insensitive name contains. */
export const filterFavoriteViews = (views: ViewPB[], query: string) =>
  views.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()));

/** Flutter's ReorderableListView newIndex for an item dropped at `target` (its final index). */
export const reorderNewIndex = (oldIndex: number, target: number) => (target > oldIndex ? target + 1 : target);
