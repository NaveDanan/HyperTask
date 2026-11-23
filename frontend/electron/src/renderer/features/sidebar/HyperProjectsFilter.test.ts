import { create } from '@bufbuild/protobuf';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filterHyperProjectViews,
  hyperProjectsFilterActions,
  isHyperProjectsFilterActive,
  useHyperProjectsFilterStore,
  viewMatchesHyperProjectFilter,
  viewMatchesHyperProjectLayout,
  viewSelfMatchesHyperProjectFilter,
} from './stores/HyperProjectsFilter';

function makeView(
  id: string,
  name: string,
  layout: ViewLayoutPB = ViewLayoutPB.Document,
  options: { gantt?: boolean; childViews?: ViewPB[] } = {},
): ViewPB {
  return create(ViewPBSchema, {
    id,
    name,
    layout,
    ...(options.gantt ? { oneOfExtra: { case: 'extra' as const, value: JSON.stringify({ hyper_layout: 'gantt' }) } } : {}),
    childViews: options.childViews ?? [],
  });
}

describe('HyperProjectsFilter pure helpers', () => {
  it('treats empty whitespace query with layout=all as inactive and returns the original list', () => {
    const views = [makeView('p1', 'Alpha'), makeView('p2', 'Beta')];
    expect(isHyperProjectsFilterActive(undefined)).toBe(false);
    expect(isHyperProjectsFilterActive({ query: '   ', layout: 'all' })).toBe(false);
    expect(filterHyperProjectViews(views, { query: '  ', layout: 'all' })).toBe(views);
  });

  it('matches project names case-insensitively and falls back to Untitled for empty names', () => {
    const alpha = makeView('p1', 'Roadmap Alpha');
    const unnamed = makeView('p2', '');
    expect(viewSelfMatchesHyperProjectFilter(alpha, { query: '  ALPHA ', layout: 'all' })).toBe(true);
    expect(viewSelfMatchesHyperProjectFilter(alpha, { query: 'beta', layout: 'all' })).toBe(false);
    expect(viewSelfMatchesHyperProjectFilter(unnamed, { query: 'untit', layout: 'all' })).toBe(true);
  });

  it('distinguishes Gantt from plain Grid views in layout matching', () => {
    const doc = makeView('d', 'Spec', ViewLayoutPB.Document);
    const grid = makeView('g', 'Tasks', ViewLayoutPB.Grid);
    const gantt = makeView('gt', 'Timeline', ViewLayoutPB.Grid, { gantt: true });
    const board = makeView('b', 'Sprint', ViewLayoutPB.Board);
    const cal = makeView('c', 'Release', ViewLayoutPB.Calendar);

    expect(viewMatchesHyperProjectLayout(doc, 'document')).toBe(true);
    expect(viewMatchesHyperProjectLayout(grid, 'grid')).toBe(true);
    expect(viewMatchesHyperProjectLayout(gantt, 'grid')).toBe(false);
    expect(viewMatchesHyperProjectLayout(gantt, 'gantt')).toBe(true);
    expect(viewMatchesHyperProjectLayout(grid, 'gantt')).toBe(false);
    expect(viewMatchesHyperProjectLayout(board, 'board')).toBe(true);
    expect(viewMatchesHyperProjectLayout(cal, 'calendar')).toBe(true);
  });

  it('keeps parent projects when a nested descendant matches and drops non-matching subtrees', () => {
    const matchingLeaf = makeView('leaf', 'Launch Gantt', ViewLayoutPB.Grid, { gantt: true });
    const mid = makeView('mid', 'Q4', ViewLayoutPB.Document, { childViews: [matchingLeaf] });
    const rootWithMatch = makeView('root-1', 'Engineering', ViewLayoutPB.Document, { childViews: [mid] });
    const unrelatedRoot = makeView('root-2', 'Finance', ViewLayoutPB.Document, {
      childViews: [makeView('leaf-2', 'Budget', ViewLayoutPB.Grid)],
    });

    const criteria = { query: 'launch', layout: 'gantt' as const };
    expect(viewSelfMatchesHyperProjectFilter(rootWithMatch, criteria)).toBe(false);
    expect(viewMatchesHyperProjectFilter(rootWithMatch, criteria)).toBe(true);
    expect(viewMatchesHyperProjectFilter(unrelatedRoot, criteria)).toBe(false);
    expect(filterHyperProjectViews([rootWithMatch, unrelatedRoot], criteria).map((v) => v.id)).toEqual(['root-1']);
  });
});

describe('useHyperProjectsFilterStore actions', () => {
  beforeEach(() => {
    hyperProjectsFilterActions.reset();
  });

  it('opens, updates query/layout, clears while staying open, and resets on close/toggle', () => {
    expect(useHyperProjectsFilterStore.getState()).toEqual({ isOpen: false, query: '', layout: 'all' });

    hyperProjectsFilterActions.toggleOpen();
    expect(useHyperProjectsFilterStore.getState().isOpen).toBe(true);

    hyperProjectsFilterActions.setQuery('sprint');
    hyperProjectsFilterActions.setLayout('board');
    expect(useHyperProjectsFilterStore.getState()).toEqual({ isOpen: true, query: 'sprint', layout: 'board' });

    hyperProjectsFilterActions.clearFilter();
    expect(useHyperProjectsFilterStore.getState()).toEqual({ isOpen: true, query: '', layout: 'all' });

    hyperProjectsFilterActions.setQuery('roadmap');
    hyperProjectsFilterActions.toggleOpen();
    expect(useHyperProjectsFilterStore.getState()).toEqual({ isOpen: false, query: '', layout: 'all' });
  });
});
