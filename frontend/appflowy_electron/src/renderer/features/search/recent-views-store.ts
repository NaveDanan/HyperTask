// CachedRecentService (workspace/application/recent/cached_recent_service.dart): the recent
// views shared by the command palette, read once and refreshed on "recent_views" notifications.
import { create } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import type { SectionViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventReadRecentViews, FolderEventUpdateRecentViews } from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { isSpace } from '../view/view-ext';

interface RecentState {
  views: SectionViewPB[];
  initialized: boolean;
}

export const useRecentViewsStore = create<RecentState>(() => ({ views: [], initialized: false }));

let stopListening: (() => void) | null = null;
let initializing: Promise<SectionViewPB[]> | null = null;

/** unique((e) => e.item.id): keeps the first occurrence. */
export function uniqueById(items: SectionViewPB[]): SectionViewPB[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item.item?.id ?? '';
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** _readRecentViews: the first 100, without spaces and orphan views. */
async function readRecentViews(): Promise<SectionViewPB[] | null> {
  const result = await FolderEventReadRecentViews({ start: 0n, limit: 100n });
  if (!result.ok) return null;
  return result.value.items.filter((e) => e.item && !isSpace(e.item) && e.item.id !== e.item.parentViewId);
}

/** recentViews(): loads and starts listening on first use. */
export function recentViews(): Promise<SectionViewPB[]> {
  const state = useRecentViewsStore.getState();
  if (state.initialized) return Promise.resolve(state.views);
  initializing ??= (async () => {
    stopListening = listen<FolderNotification>(
      NotificationSource.Folder,
      // RecentViewsListener ignores the type: any notification on "recent_views" refreshes.
      (_ty, result) => {
        if (!result.ok) return;
        void readRecentViews().then((views) => useRecentViewsStore.setState({ views: uniqueById(views ?? []) }));
      },
      'recent_views',
    );
    const views = uniqueById((await readRecentViews()) ?? []);
    useRecentViewsStore.setState({ views, initialized: true });
    initializing = null;
    return views;
  })();
  return initializing;
}

/** updateRecentViews: removal only sends ids that are in the cached list. */
export function updateRecentViews(viewIds: string[], addInRecent: boolean) {
  const cached = useRecentViewsStore.getState().views;
  const duplicated = viewIds.filter((id) => cached.some((v) => v.item?.id === id));
  return FolderEventUpdateRecentViews({ viewIds: addInRecent ? viewIds : duplicated, addInRecent });
}

/** reset(): on workspace change. */
export function resetRecentViews() {
  stopListening?.();
  stopListening = null;
  initializing = null;
  useRecentViewsStore.setState({ views: [], initialized: false });
}
