import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewLayoutPB, ViewPBSchema, ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';

vi.mock('@/backend/events', async () => (await import('../test/mocks')).eventsMock());
vi.mock('@/backend/notifications', async () => (await import('../test/mocks')).notificationsMock());
vi.mock('@/startup/kv', async () => (await import('../test/mocks')).kvMock());

const events = await import('@/backend/events');
const { flush, kvStore, resetKv } = await import('../test/mocks');
const { getFolderIsExpanded, getViewIsExpanded, setExpanded } = await import('./expand-storage');
const { createSpaceStore, lastOpenedSpace, nextSpace, spaceDeleteDisabledReason, spacesFromSections, updatedSpaceExtra } =
  await import('./space-store');
const { SpacePermission } = await import('@/features/view/view-ext');

const space = (id: string, extra: Record<string, unknown> = {}, childViews: ViewPB[] = []): ViewPB =>
  create(ViewPBSchema, {
    id,
    name: id,
    parentViewId: 'ws',
    childViews,
    oneOfExtra: { case: 'extra', value: JSON.stringify({ is_space: true, ...extra }) },
  });
const page = (id: string, parentViewId = 'ws'): ViewPB => create(ViewPBSchema, { id, name: id, parentViewId });
const user = create(UserProfilePBSchema, { id: 1n, email: 'me@example.com' });
const ok = <T,>(value: T) => ({ ok: true as const, value });

describe('expandedViews (KV)', () => {
  beforeEach(resetKv);

  it('stores expanded ids as true and removes collapsed ones', async () => {
    await setExpanded('a', true);
    await setExpanded('b', true);
    await setExpanded('a', false);
    expect(JSON.parse(kvStore.expandedViews)).toEqual({ b: true });
  });

  it('rows default to collapsed, folders and spaces to expanded (BUG-COMPAT)', async () => {
    expect(getViewIsExpanded('row')).toBe(false);
    expect(getFolderIsExpanded('favorite')).toBe(true);
    await setExpanded('favorite', false);
    // A collapsed folder is "missing", which reads back as expanded.
    expect(getFolderIsExpanded('favorite')).toBe(true);
    await setExpanded('row', true);
    expect(getViewIsExpanded('row')).toBe(true);
  });
});

describe('space ordering', () => {
  it('lists public spaces then private ones, de-duplicated, skipping non-spaces', () => {
    const a = space('a');
    const b = space('b');
    const c = space('c');
    expect(spacesFromSections([a, page('p'), b, a], [c, b]).map((s) => s.id)).toEqual(['a', 'b', 'c', 'b']);
  });

  it('opens the last opened space, falling back to the first', () => {
    const spaces = [space('a'), space('b')];
    expect(lastOpenedSpace(spaces, 'b')?.id).toBe('b');
    expect(lastOpenedSpace(spaces, 'gone')?.id).toBe('a');
    expect(lastOpenedSpace(spaces, null)?.id).toBe('a');
    expect(lastOpenedSpace([], 'a')).toBeNull();
  });

  it('switches to the next space with wrap-around', () => {
    const spaces = [space('a'), space('b'), space('c')];
    expect(nextSpace(spaces, spaces[1])?.id).toBe('c');
    expect(nextSpace(spaces, spaces[2])?.id).toBe('a');
    expect(nextSpace(spaces, null)).toBeNull();
  });
});

describe('space extra updates', () => {
  it('merges icon, color and permission', () => {
    const s = space('a', { space_icon: 'x/y', space_icon_color: '0xFF000000', space_permission: 1 });
    const extra = JSON.parse(updatedSpaceExtra(s, { icon: 'g/i', permission: SpacePermission.publicToAll }));
    expect(extra).toEqual({ is_space: true, space_icon: 'g/i', space_icon_color: '0xFF000000', space_permission: 0 });
  });

  it('drops the icon when nothing icon-related changed (Manage dialog quirk)', () => {
    const s = space('a', { space_icon: 'x/y', space_icon_color: '0xFF000000', space_permission: 0 });
    expect(JSON.parse(updatedSpaceExtra(s, {}))).toEqual({ is_space: true, space_permission: 0 });
  });

  it('disables delete for the last space and for spaces created by others', () => {
    expect(spaceDeleteDisabledReason({ spaceCount: 1, isOwner: true, currentSpaceCreatedBy: 1n, userId: 1n })).toBe('last');
    expect(spaceDeleteDisabledReason({ spaceCount: 2, isOwner: false, currentSpaceCreatedBy: 2n, userId: 1n })).toBe('notCreator');
    expect(spaceDeleteDisabledReason({ spaceCount: 2, isOwner: false, currentSpaceCreatedBy: 1n, userId: 1n })).toBeNull();
    expect(spaceDeleteDisabledReason({ spaceCount: 2, isOwner: true, currentSpaceCreatedBy: null, userId: 1n })).toBeNull();
  });
});

describe('SpaceBloc', () => {
  beforeEach(() => {
    resetKv();
    vi.mocked(events.FolderEventReadWorkspaceViews).mockResolvedValue(ok({ items: [space('a'), page('root')] }) as never);
    vi.mocked(events.FolderEventReadPrivateViews).mockResolvedValue(ok({ items: [space('b')] }) as never);
    vi.mocked(events.FolderEventCreateView).mockClear();
    vi.mocked(events.FolderEventGetView).mockResolvedValue(ok(space('c')) as never);
  });

  it('initial: restores the last opened space and its expand state', async () => {
    kvStore.lastOpenedSpaceId = 'b';
    kvStore.expandedViews = JSON.stringify({});
    const bloc = createSpaceStore();
    await bloc.actions.initial(user, 'ws', false);
    const state = bloc.store.getState();
    expect(state.spaces.map((s) => s.id)).toEqual(['a', 'b']);
    expect(state.currentSpace?.id).toBe('b');
    expect(state.isExpanded).toBe(true);
    expect(state.isInitialized).toBe(true);
    bloc.actions.dispose();
  });

  it('open: remembers the space and asks to open its first page (or the blank page)', async () => {
    const bloc = createSpaceStore();
    await bloc.actions.initial(user, 'ws', false);
    vi.mocked(events.FolderEventGetView).mockResolvedValueOnce(ok(space('b', {}, [page('p1', 'b'), page('p2', 'b')])) as never);
    await bloc.actions.open(space('b'));
    expect(kvStore.lastOpenedSpaceId).toBe('b');
    expect(bloc.store.getState().currentSpace?.childViews.map((v) => v.id)).toEqual(['p1', 'p2']);
    expect(bloc.store.getState().lastCreatedPage?.id).toBe('p1');

    vi.mocked(events.FolderEventGetView).mockResolvedValueOnce(ok(space('a')) as never);
    await bloc.actions.open(space('a'));
    expect(bloc.store.getState().lastCreatedPage?.id).toBe('');
    bloc.actions.dispose();
  });

  it('expand persists the space key', async () => {
    const bloc = createSpaceStore();
    await bloc.actions.expand(space('a'), false);
    expect(bloc.store.getState().isExpanded).toBe(false);
    expect(JSON.parse(kvStore.expandedViews)).toEqual({});
    await bloc.actions.expand(space('a'), true);
    expect(JSON.parse(kvStore.expandedViews)).toEqual({ a: true });
  });

  it('createPage: a page at the top of the current space, set as current', async () => {
    const bloc = createSpaceStore();
    await bloc.actions.initial(user, 'ws', false);
    vi.mocked(events.FolderEventCreateView).mockResolvedValueOnce(ok(page('new', 'a')) as never);
    await bloc.actions.createPage({ name: '', layout: ViewLayoutPB.Document, index: 0, openAfterCreate: true });
    expect(events.FolderEventCreateView).toHaveBeenCalledWith(
      expect.objectContaining({ parentViewId: 'a', name: '', layout: ViewLayoutPB.Document, setAsCurrent: true, oneOfIndex: { case: 'index', value: 0 } }),
    );
    expect(bloc.store.getState().lastCreatedPage?.id).toBe('new');
    bloc.actions.dispose();
  });

  it('create: a space root view with its extra in the permission section', async () => {
    const bloc = createSpaceStore();
    await bloc.actions.initial(user, 'ws', false);
    vi.mocked(events.FolderEventCreateView).mockResolvedValueOnce(ok(space('c')) as never);
    await bloc.actions.create({
      name: 'General',
      icon: 'interface_essential/home-3',
      iconColor: '0xFFA34AFD',
      permission: SpacePermission.private,
      createNewPageByDefault: false,
      openAfterCreate: true,
    });
    const payload = vi.mocked(events.FolderEventCreateView).mock.calls[0][0] as unknown as {
      parentViewId: string;
      oneOfSection: { value: ViewSectionPB };
      oneOfExtra: { value: string };
      setAsCurrent: boolean;
    };
    expect(payload.parentViewId).toBe('ws');
    expect(payload.oneOfSection.value).toBe(ViewSectionPB.Private);
    expect(payload.setAsCurrent).toBe(true);
    expect(JSON.parse(payload.oneOfExtra.value)).toMatchObject({
      is_space: true,
      space_icon: 'interface_essential/home-3',
      space_icon_color: '0xFFA34AFD',
      space_permission: 1,
    });
    expect(bloc.store.getState().currentSpace?.id).toBe('c');
    await flush();
    bloc.actions.dispose();
  });

  it('reset ignores the same workspace and drops results after dispose', async () => {
    const bloc = createSpaceStore();
    await bloc.actions.initial(user, 'ws', false);
    vi.mocked(events.FolderEventReadWorkspaceViews).mockClear();
    await bloc.actions.reset(user, 'ws', true);
    expect(events.FolderEventReadWorkspaceViews).not.toHaveBeenCalled();
    const pending = bloc.actions.didReceiveSpaceUpdate();
    bloc.actions.dispose();
    await pending;
    expect(bloc.store.getState().isInitialized).toBe(false);
  });
});
