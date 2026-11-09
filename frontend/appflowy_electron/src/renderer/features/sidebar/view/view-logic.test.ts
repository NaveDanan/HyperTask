import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { ChildViewUpdatePBSchema, ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';

vi.mock('@/backend/events', async () => (await import('../test/mocks')).eventsMock());
vi.mock('@/backend/notifications', async () => (await import('../test/mocks')).notificationsMock());
vi.mock('@/startup/kv', async () => (await import('../test/mocks')).kvMock());

const events = await import('@/backend/events');
const { flush, kvStore, notify, resetKv } = await import('../test/mocks');
const { computeHoverPosition, computeMoveTarget, shouldAcceptDrop } = await import('./dnd');
const { buildViewMoreActionTypes } = await import('./view-actions');
const { applyChildViewsUpdate, createViewBloc } = await import('../stores/view-bloc');

const view = (id: string, opts: Partial<Pick<ViewPB, 'layout' | 'parentViewId' | 'isFavorite'>> & { children?: ViewPB[] } = {}): ViewPB =>
  create(ViewPBSchema, {
    id,
    name: id,
    parentViewId: opts.parentViewId ?? 'parent',
    layout: opts.layout ?? ViewLayoutPB.Document,
    isFavorite: opts.isFavorite ?? false,
    childViews: opts.children ?? [],
  });
const ok = <T,>(value: T) => ({ ok: true as const, value });

describe('drag and drop', () => {
  it('computes the hover position from the ghost top edge', () => {
    // A 32px node: threshold = 6.4.
    expect(computeHoverPosition(-3, 32, false)).toBe('center');
    expect(computeHoverPosition(-6, 32, true)).toBe('top');
    expect(computeHoverPosition(-6, 32, false)).toBe('center');
    expect(computeHoverPosition(6, 32, false)).toBe('center');
    expect(computeHoverPosition(7, 32, false)).toBe('bottom');
  });

  it('rejects dropping into databases, onto itself or into its own subtree', () => {
    const child = view('child');
    const dragged = view('dragged', { children: [child] });
    expect(shouldAcceptDrop(dragged, view('grid', { layout: ViewLayoutPB.Grid }), 'center')).toBe(false);
    expect(shouldAcceptDrop(dragged, view('grid', { layout: ViewLayoutPB.Grid }), 'bottom')).toBe(true);
    expect(shouldAcceptDrop(dragged, dragged, 'bottom')).toBe(false);
    expect(shouldAcceptDrop(dragged, child, 'center')).toBe(false);
    expect(shouldAcceptDrop(dragged, view('other'), 'center')).toBe(true);
  });

  it('maps the position to MoveNestedView arguments', () => {
    const target = view('target', { parentViewId: 'p', children: [view('c1'), view('c2')] });
    expect(computeMoveTarget('top', target)).toEqual({ newParentId: 'p', prevId: null });
    expect(computeMoveTarget('bottom', target)).toEqual({ newParentId: 'p', prevId: 'target' });
    expect(computeMoveTarget('center', target)).toEqual({ newParentId: 'target', prevId: 'c2' });
    expect(computeMoveTarget('center', view('empty'))).toEqual({ newParentId: 'empty', prevId: null });
    expect(computeMoveTarget('center', view('chat', { layout: ViewLayoutPB.Chat }))).toBeNull();
    expect(computeMoveTarget('none', target)).toBeNull();
  });
});

describe('more actions', () => {
  it('orders tree row actions like Flutter', () => {
    expect(buildViewMoreActionTypes(view('a'), 'public', false)).toEqual([
      'favorite',
      'divider',
      'rename',
      'changeIcon',
      'duplicate',
      'moveTo',
      'delete',
      'divider',
      'openInNewTab',
    ]);
    expect(buildViewMoreActionTypes(view('a', { isFavorite: true, children: [view('c')] }), 'private', true)).toEqual([
      'unFavorite',
      'divider',
      'rename',
      'changeIcon',
      'duplicate',
      'moveTo',
      'delete',
      'divider',
      'collapseAllPages',
      'divider',
      'openInNewTab',
    ]);
    expect(buildViewMoreActionTypes(view('a', { layout: ViewLayoutPB.Chat, children: [view('c')] }), 'public', true)).toEqual([
      'favorite',
      'divider',
      'rename',
      'moveTo',
      'delete',
      'divider',
      'openInNewTab',
    ]);
    expect(buildViewMoreActionTypes(view('a'), 'favorite', false)).toEqual(['unFavorite', 'divider', 'rename', 'openInNewTab']);
  });
});

describe('ViewBloc', () => {
  beforeEach(() => {
    resetKv();
    vi.mocked(events.FolderEventGetView).mockReset();
    vi.mocked(events.FolderEventMoveNestedView).mockClear();
  });

  it('applies child view updates', async () => {
    const current = view('p', { children: [view('a'), view('b')] });
    const getView = vi.fn(async () => view('p', { children: [view('b'), view('a')] }));
    const deleted = await applyChildViewsUpdate(current, create(ChildViewUpdatePBSchema, { parentViewId: 'p', deleteChildViews: ['a'] }), getView);
    expect(deleted?.childViews.map((v) => v.id)).toEqual(['b']);
    const created = await applyChildViewsUpdate(current, create(ChildViewUpdatePBSchema, { parentViewId: 'p', createChildViews: [view('c')] }), getView);
    expect(created?.childViews.map((v) => v.id)).toEqual(['b', 'a']);
    // Same order → no change; a different order → the refetched parent.
    const sameOrder = await applyChildViewsUpdate(
      current,
      create(ChildViewUpdatePBSchema, { parentViewId: 'p', updateChildViews: [view('b'), view('a')] }),
      getView,
    );
    expect(sameOrder).toBeNull();
    const reordered = await applyChildViewsUpdate(
      current,
      create(ChildViewUpdatePBSchema, { parentViewId: 'p', updateChildViews: [view('a')] }),
      getView,
    );
    expect(reordered?.childViews.map((v) => v.id)).toEqual(['b', 'a']);
  });

  it('restores and persists the expand state, loading children on expand', async () => {
    kvStore.expandedViews = JSON.stringify({ v: true });
    vi.mocked(events.FolderEventGetView).mockResolvedValue(ok(view('v', { children: [view('c1')] })) as never);
    const bloc = createViewBloc(view('v'));
    bloc.initial();
    await flush();
    expect(bloc.store.getState().isExpanded).toBe(true);
    expect(bloc.store.getState().view.childViews.map((v) => v.id)).toEqual(['c1']);
    await bloc.setIsExpanded(false);
    expect(JSON.parse(kvStore.expandedViews)).toEqual({});
    await bloc.setIsExpanded(true);
    expect(JSON.parse(kvStore.expandedViews)).toEqual({ v: true });
    bloc.dispose();
  });

  it('collapse all forgets the direct children and collapses the row', async () => {
    kvStore.expandedViews = JSON.stringify({ v: true, c1: true, c2: true, other: true });
    vi.mocked(events.FolderEventGetView).mockResolvedValue(ok(view('v')) as never);
    const bloc = createViewBloc(view('v', { children: [view('c1'), view('c2')] }));
    bloc.initial();
    await bloc.collapseAllPages();
    expect(JSON.parse(kvStore.expandedViews)).toEqual({ other: true });
    expect(bloc.store.getState().isExpanded).toBe(false);
    bloc.dispose();
  });

  it('follows DidUpdateChildViews for its own id', async () => {
    vi.mocked(events.FolderEventGetView).mockResolvedValue(ok(view('v', { children: [view('a'), view('b')] })) as never);
    const bloc = createViewBloc(view('v'));
    bloc.initial();
    await flush();
    notify(
      'Workspace',
      'v',
      FolderNotification.DidUpdateChildViews,
      toBinary(ChildViewUpdatePBSchema, create(ChildViewUpdatePBSchema, { parentViewId: 'v', deleteChildViews: ['a'] })),
    );
    await flush();
    expect(bloc.store.getState().view.childViews.map((v) => v.id)).toEqual(['b']);
    bloc.dispose();
  });

  it('moves with MoveNestedView (prev id, sections)', async () => {
    const bloc = createViewBloc(view('target'));
    await bloc.move(view('dragged'), 'newParent', 'prev', null, 1);
    expect(events.FolderEventMoveNestedView).toHaveBeenCalledWith({
      viewId: 'dragged',
      newParentId: 'newParent',
      oneOfPrevViewId: { case: 'prevViewId', value: 'prev' },
      oneOfToSection: { case: 'toSection', value: 1 },
    });
    await bloc.move(view('dragged'), 'newParent', null, null, null);
    expect(events.FolderEventMoveNestedView).toHaveBeenLastCalledWith({ viewId: 'dragged', newParentId: 'newParent' });
  });
});
