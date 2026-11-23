import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { FolderNotification } from '@shared/protobuf/hyper-folder/notification_pb';
import { FolderEventGetAllViews } from '@/backend/events/hyper-folder';
import { listen, NotificationSource } from '@/backend/notifications';
import { nameOrDefault, viewExtra } from '@/features/view/view-ext';

export type HyperProjectLayoutFilter = 'all' | 'document' | 'grid' | 'board' | 'calendar' | 'gantt';

export interface HyperProjectsFilterCriteria {
  query: string;
  layout: HyperProjectLayoutFilter;
  matchingPathIds?: ReadonlySet<string>;
}

export interface HyperProjectsFilterState extends HyperProjectsFilterCriteria {
  isOpen: boolean;
}

const initialState = (): HyperProjectsFilterState => ({
  isOpen: false,
  query: '',
  layout: 'all',
});

export const useHyperProjectsFilterStore = create<HyperProjectsFilterState>(initialState);

export function isHyperProjectsFilterActive(criteria?: HyperProjectsFilterCriteria | null): boolean {
  if (!criteria) return false;
  return criteria.query.trim() !== '' || criteria.layout !== 'all';
}

export function viewMatchesHyperProjectLayout(view: ViewPB, layout: HyperProjectLayoutFilter): boolean {
  if (layout === 'all') return true;
  const isGantt = viewExtra(view)?.hyper_layout === 'gantt';
  switch (layout) {
    case 'gantt':
      return isGantt;
    case 'grid':
      return view.layout === ViewLayoutPB.Grid && !isGantt;
    case 'board':
      return view.layout === ViewLayoutPB.Board;
    case 'calendar':
      return view.layout === ViewLayoutPB.Calendar;
    case 'document':
      return view.layout === ViewLayoutPB.Document;
  }
}

export function viewSelfMatchesHyperProjectFilter(view: ViewPB, criteria: HyperProjectsFilterCriteria): boolean {
  const q = criteria.query.trim().toLowerCase();
  if (q !== '' && !nameOrDefault(view).toLowerCase().includes(q)) return false;
  return viewMatchesHyperProjectLayout(view, criteria.layout);
}

export function viewMatchesHyperProjectFilter(view: ViewPB, criteria: HyperProjectsFilterCriteria): boolean {
  if (!isHyperProjectsFilterActive(criteria)) return true;
  if (criteria.matchingPathIds?.has(view.id) || viewSelfMatchesHyperProjectFilter(view, criteria)) return true;
  return view.childViews.some((child) => viewMatchesHyperProjectFilter(child, criteria));
}

export function filterHyperProjectViews(views: ViewPB[], criteria?: HyperProjectsFilterCriteria | null): ViewPB[] {
  if (!criteria || !isHyperProjectsFilterActive(criteria)) return views;
  return views.filter((view) => viewMatchesHyperProjectFilter(view, criteria));
}

/** GetAllViews returns accessible views as flat rows. Keep every ancestor of a matching row. */
export function hyperMatchingProjectPaths(views: readonly ViewPB[], criteria: HyperProjectsFilterCriteria): Set<string> {
  const parents = new Map(views.map((view) => [view.id, view.parentViewId]));
  const ids = new Set<string>();
  for (const view of views) {
    if (!viewSelfMatchesHyperProjectFilter(view, criteria)) continue;
    for (let id: string | undefined = view.id; id && !ids.has(id); id = parents.get(id)) ids.add(id);
  }
  return ids;
}

const projectUpdates = new Set([
  FolderNotification.DidUpdateWorkspaceViews,
  FolderNotification.DidUpdateSectionViews,
  FolderNotification.DidUpdateView,
  FolderNotification.DidUpdateChildViews,
  FolderNotification.DidDeleteView,
  FolderNotification.DidRestoreView,
  FolderNotification.DidMoveViewToTrash,
  FolderNotification.DidUpdateSharedViews,
]);

export function useHyperProjectsFilter(workspaceId: string) {
  const query = useHyperProjectsFilterStore((state) => state.query);
  const layout = useHyperProjectsFilterStore((state) => state.layout);
  const enabled = isHyperProjectsFilterActive({ query, layout });
  const [index, setIndex] = useState<{ workspaceId: string; views: ViewPB[] | null } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setIndex(null);
      return;
    }
    let disposed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const current = ++generation;
      const result = await FolderEventGetAllViews().catch(() => null);
      if (disposed || current !== generation) return;
      setIndex({ workspaceId, views: result?.ok ? result.value.items : null });
    };
    const stop = listen<FolderNotification>(NotificationSource.Folder, (type, result) => {
      if (!result.ok || !projectUpdates.has(type)) return;
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    });
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      stop();
    };
  }, [enabled, workspaceId]);

  const current = index?.workspaceId === workspaceId ? index : null;
  const criteria = useMemo(() => {
    if (!enabled) return undefined;
    return { query, layout, matchingPathIds: current?.views ? hyperMatchingProjectPaths(current.views, { query, layout }) : undefined };
  }, [current, enabled, query, layout]);
  return { criteria, loading: enabled && !current, failed: enabled && current?.views === null };
}

export const hyperProjectsFilterActions = {
  toggleOpen() {
    useHyperProjectsFilterStore.setState((state) =>
      state.isOpen ? initialState() : { ...state, isOpen: true },
    );
  },
  open() {
    useHyperProjectsFilterStore.setState((state) => ({ ...state, isOpen: true }));
  },
  close() {
    useHyperProjectsFilterStore.setState(initialState());
  },
  setQuery(query: string) {
    useHyperProjectsFilterStore.setState((state) => ({ ...state, isOpen: true, query }));
  },
  setLayout(layout: HyperProjectLayoutFilter) {
    useHyperProjectsFilterStore.setState((state) => ({ ...state, isOpen: true, layout }));
  },
  clearFilter() {
    useHyperProjectsFilterStore.setState((state) => ({ ...state, query: '', layout: 'all' }));
  },
  reset() {
    useHyperProjectsFilterStore.setState(initialState());
  },
};
