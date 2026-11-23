import { create } from 'zustand';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { nameOrDefault, viewExtra } from '@/features/view/view-ext';

export type HyperProjectLayoutFilter = 'all' | 'document' | 'grid' | 'board' | 'calendar' | 'gantt';

export interface HyperProjectsFilterCriteria {
  query: string;
  layout: HyperProjectLayoutFilter;
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
  if (viewSelfMatchesHyperProjectFilter(view, criteria)) return true;
  return view.childViews.some((child) => viewMatchesHyperProjectFilter(child, criteria));
}

export function filterHyperProjectViews(views: ViewPB[], criteria?: HyperProjectsFilterCriteria | null): ViewPB[] {
  if (!criteria || !isHyperProjectsFilterActive(criteria)) return views;
  return views.filter((view) => viewMatchesHyperProjectFilter(view, criteria));
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
