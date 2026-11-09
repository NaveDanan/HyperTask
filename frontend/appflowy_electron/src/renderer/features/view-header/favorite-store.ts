// The part of FavoriteBloc (workspace/application/favorite/favorite_bloc.dart) the page header
// needs: the favorite list (star state) and the toggle event. Started lazily, follows the
// "favorite" notifications for the rest of the session.
import { useEffect } from 'react';
import { create } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import type { SectionViewPB, ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventReadFavorites, FolderEventToggleFavorite, FolderEventUpdateView } from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { ViewExtKeys, extraString, isPinnedView, isSpace } from '../view/view-ext';

interface FavoriteState {
  views: SectionViewPB[];
  pinnedViews: SectionViewPB[];
}

export const useFavoriteStore = create<FavoriteState>(() => ({ views: [], pinnedViews: [] }));

let started = false;

async function fetchFavorites() {
  const result = await FolderEventReadFavorites();
  if (!result.ok) {
    useFavoriteStore.setState({ views: [], pinnedViews: [] });
    return;
  }
  // FavoriteService.readFavorites drops spaces.
  const views = result.value.items.filter((v) => !(v.item && isSpace(v.item)));
  useFavoriteStore.setState({ views, pinnedViews: views.filter((v) => v.item && isPinnedView(v.item)) });
}

function start() {
  if (started) return;
  started = true;
  listen<FolderNotification>(
    NotificationSource.Folder,
    (ty, result) => {
      if ((ty === FolderNotification.DidFavoriteView || ty === FolderNotification.DidUnfavoriteView) && result.ok) {
        void fetchFavorites();
      }
    },
    'favorite',
  );
  void fetchFavorites();
}

/** FavoriteService.pinOrUnpinFavorite: merges is_pinned into the view's extra JSON. */
async function pinOrUnpinFavorite(view: ViewPB, isPinned: boolean) {
  let current: Record<string, unknown> = {};
  try {
    const raw = extraString(view);
    current = raw ? JSON.parse(raw) : {};
  } catch {
    return;
  }
  await FolderEventUpdateView({
    viewId: view.id,
    oneOfExtra: { case: 'extra', value: JSON.stringify({ ...current, [ViewExtKeys.isPinned]: isPinned }) },
  });
}

/** FavoriteEvent.toggle(view). */
export async function toggleFavorite(view: ViewPB) {
  start();
  const { views, pinnedViews } = useFavoriteStore.getState();
  const isFavorited = views.some((v) => v.item?.id === view.id);
  if (isFavorited) {
    await pinOrUnpinFavorite(view, false);
  } else if (pinnedViews.length < 3) {
    // Pin the view while there are fewer than 3 pinned favorites.
    await pinOrUnpinFavorite(view, true);
  }
  await FolderEventToggleFavorite({ items: [view.id] });
}

export function useIsFavorite(viewId: string): boolean {
  useEffect(start, []);
  return useFavoriteStore((s) => s.views.some((v) => v.item?.id === viewId));
}
