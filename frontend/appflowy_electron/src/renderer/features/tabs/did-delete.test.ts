import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';

const view = (id: string, parentViewId = 'parent'): ViewPB => create(ViewPBSchema, { id, name: id, parentViewId });
let parentChildren: ViewPB[] | null = [];

vi.mock('@/backend/events', () => ({
  FolderEventSetLatestView: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventGetViewAncestors: vi.fn(async () => ({ ok: true, value: { items: [] } })),
  FolderEventGetView: vi.fn(async () =>
    parentChildren === null
      ? { ok: false, error: { code: 3, msg: 'not found' } }
      : { ok: true, value: create(ViewPBSchema, { id: 'parent', childViews: parentChildren }) },
  ),
}));
vi.mock('@/startup/kv', () => ({
  KVKeys: { expandedViews: 'expandedViews' },
  KeyValueStorage: { getJson: () => null, set: async () => {} },
}));

const { didDeleteStackWidget, pickDeleteTarget } = await import('./did-delete');
const { tabsActions, useTabsStore } = await import('./tabs-store');

// HomeStackDelegate.didDeleteStackWidget (docs/parity/02-home-shell.md §3.1.2).
describe('pickDeleteTarget', () => {
  const children = [view('a'), view('b'), view('c')];

  it('opens the previous sibling for a non-zero index within range', () => {
    expect(pickDeleteTarget(children, 2)?.id).toBe('b');
    expect(pickDeleteTarget(children, 1)?.id).toBe('a');
    expect(pickDeleteTarget(children, 3)?.id).toBe('c');
  });

  it('falls back to the last child without an index, for index 0 or out of range', () => {
    expect(pickDeleteTarget(children)?.id).toBe('c');
    expect(pickDeleteTarget(children, null)?.id).toBe('c');
    expect(pickDeleteTarget(children, 0)?.id).toBe('c');
    expect(pickDeleteTarget(children, 9)?.id).toBe('c');
  });

  it('returns null when the parent has no children', () => {
    expect(pickDeleteTarget([], 1)).toBeNull();
  });
});

describe('didDeleteStackWidget', () => {
  beforeEach(() => tabsActions.reset());

  it('replaces the current tab with the chosen sibling', async () => {
    parentChildren = [view('a'), view('b')];
    tabsActions.openView(view('deleted'));
    await didDeleteStackWidget(view('deleted'), 1);
    expect(useTabsStore.getState().tabs.map((t) => t.plugin.id)).toEqual(['a']);
  });

  it('opens the blank page when the parent is empty', async () => {
    parentChildren = [];
    tabsActions.openView(view('gone'));
    await didDeleteStackWidget(view('gone'));
    const plugin = useTabsStore.getState().tabs[0].plugin;
    expect(plugin.kind).toBe('blank');
  });

  it('does nothing when the parent cannot be read', async () => {
    parentChildren = null;
    tabsActions.openView(view('x'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await didDeleteStackWidget(view('x'));
    expect(useTabsStore.getState().tabs[0].plugin.id).toBe('x');
    error.mockRestore();
  });
});
