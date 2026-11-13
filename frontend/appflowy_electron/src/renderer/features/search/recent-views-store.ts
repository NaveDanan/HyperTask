// CachedRecentService (workspace/application/recent/cached_recent_service.dart): the recent
// views shared by the command palette, read once and refreshed on "recent_views" notifications.
import { create } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import type { SectionViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventReadRecentViews, FolderEventUpdateRecentViews } from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { isSpace } from '../view/view-ext';
import { hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureSearchOwner } from './HyperSearchOwner';

interface RecentState {
  ownerKey: string;
  views: SectionViewPB[];
  initialized: boolean;
}

export const useRecentViewsStore = create<RecentState>(() => ({ ownerKey: '', views: [], initialized: false }));

let stopListening: (() => void) | null = null;
let initializing: Promise<SectionViewPB[]> | null = null;
let generation = 0;
let readRevision = 0;

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
  try {
    const result = await FolderEventReadRecentViews({ start: 0n, limit: 100n });
    if (!result.ok) return null;
    return result.value.items.filter((e) => e.item && !isSpace(e.item) && e.item.id !== e.item.parentViewId);
  } catch {
    return null;
  }
}

/** recentViews(): loads and starts listening on first use. */
export function recentViews(owner: HyperDocumentOwner | null = hyperGetDocumentOwner()): Promise<SectionViewPB[]> {
  const scope = hyperCaptureSearchOwner(owner);
  if (!scope) return Promise.resolve([]);
  if (useRecentViewsStore.getState().ownerKey !== scope.key) {
    resetRecentViews();
    useRecentViewsStore.setState({ ownerKey: scope.key });
  }
  const state = useRecentViewsStore.getState();
  if (state.initialized) return Promise.resolve(state.views);
  if (initializing) return initializing;
  const captured = generation;
  const current = () => captured === generation && scope.isCurrent() && useRecentViewsStore.getState().ownerKey === scope.key;
  const refresh = async () => {
    if (!current()) return [];
    const revision = ++readRevision;
    const views = uniqueById((await readRecentViews()) ?? []);
    if (!current()) return [];
    if (revision === readRevision) useRecentViewsStore.setState({ views, initialized: true });
    return useRecentViewsStore.getState().views;
  };
  stopListening = listen<FolderNotification>(NotificationSource.Folder, (_ty, result) => {
    // Notifications only invalidate: their payload has no trustworthy owner identity.
    if (result.ok && current()) void refresh();
  }, 'recent_views');
  const pending = refresh();
  initializing = pending;
  void pending.then(() => { if (initializing === pending) initializing = null; });
  return pending;
}

/** updateRecentViews: removal only sends ids that are in the cached list. */
export async function updateRecentViews(viewIds: string[], addInRecent: boolean, owner: HyperDocumentOwner | null = hyperGetDocumentOwner()) {
  const scope = hyperCaptureSearchOwner(owner);
  if (!scope) return;
  const captured = generation;
  const cached = useRecentViewsStore.getState().views;
  const duplicated = useRecentViewsStore.getState().ownerKey === scope.key
    ? viewIds.filter((id) => cached.some((v) => v.item?.id === id)) : [];
  const result = await FolderEventUpdateRecentViews({ viewIds: addInRecent ? viewIds : duplicated, addInRecent });
  if (captured === generation && scope.isCurrent()) return result;
}

/** reset(): on workspace change. */
export function resetRecentViews() {
  generation++;
  readRevision++;
  stopListening?.();
  stopListening = null;
  initializing = null;
  useRecentViewsStore.setState({ ownerKey: '', views: [], initialized: false });
}
