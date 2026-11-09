import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';

vi.mock('@/backend/events', () => ({
  FolderEventSetLatestView: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventGetViewAncestors: vi.fn(async () => ({ ok: true, value: { items: [] } })),
}));
vi.mock('@/startup/kv', () => ({
  KVKeys: { expandedViews: 'expandedViews' },
  KeyValueStorage: { getJson: () => null, set: async () => {} },
}));

const { tabsActions, useTabsStore } = await import('./tabs-store');
const { viewPlugin } = await import('./plugin');
const events = await import('@/backend/events');

const view = (id: string): ViewPB => create(ViewPBSchema, { id, name: id, parentViewId: 'root' });
const ids = () => useTabsStore.getState().tabs.map((t) => t.plugin.id);
const current = () => useTabsStore.getState().currentIndex;

// Rules from docs/parity/02-home-shell.md §3.2.2.
describe('tabs store', () => {
  beforeEach(() => {
    tabsActions.reset();
    vi.mocked(events.FolderEventSetLatestView).mockClear();
  });

  it('openPlugin replaces the current tab and announces the latest view', () => {
    tabsActions.openView(view('a'));
    expect(ids()).toEqual(['a']);
    expect(events.FolderEventSetLatestView).toHaveBeenCalledWith({ value: 'a' });
    tabsActions.openView(view('b'));
    expect(ids()).toEqual(['b']);
  });

  it('openTab appends a tab or selects the existing one', () => {
    tabsActions.openView(view('a'));
    tabsActions.openViewInNewTab(view('b'));
    expect(ids()).toEqual(['a', 'b']);
    expect(current()).toBe(1);
    tabsActions.openViewInNewTab(view('a'));
    expect(ids()).toEqual(['a', 'b']);
    expect(current()).toBe(0);
  });

  it('never closes the last tab', () => {
    tabsActions.openView(view('a'));
    tabsActions.closeCurrentTab();
    expect(ids()).toEqual(['a']);
  });

  it('keeps the index number when a tab left of the selection closes', () => {
    tabsActions.openView(view('a'));
    tabsActions.openViewInNewTab(view('b'));
    tabsActions.openViewInNewTab(view('c'));
    tabsActions.selectTab(1);
    tabsActions.closeTab('a');
    expect(ids()).toEqual(['b', 'c']);
    expect(current()).toBe(1);
  });

  it('pinned tabs ignore close and move into the pinned group', () => {
    tabsActions.openView(view('a'));
    tabsActions.openViewInNewTab(view('b'));
    tabsActions.togglePin('b');
    expect(ids()).toEqual(['b', 'a']);
    expect(current()).toBe(0);
    tabsActions.closeTab('b');
    expect(ids()).toEqual(['b', 'a']);
    tabsActions.closeOtherTabs('a');
    expect(ids()).toEqual(['b', 'a']);
  });

  it('dedups the same openPlugin within 500 ms', () => {
    tabsActions.openView(view('a'));
    tabsActions.openViewInNewTab(view('b'));
    tabsActions.openPlugin(viewPlugin(view('c')), view('c'));
    tabsActions.selectTab(0);
    tabsActions.openPlugin(viewPlugin(view('c')), view('c'));
    expect(current()).toBe(0);
  });

  it('switchWorkspace keeps pinned and current tabs', () => {
    tabsActions.openView(view('a'));
    tabsActions.openViewInNewTab(view('b'));
    tabsActions.openViewInNewTab(view('c'));
    tabsActions.togglePin('a');
    tabsActions.switchWorkspace();
    expect(ids()).toEqual(['a', 'c']);
    expect(current()).toBe(0);
  });
});
