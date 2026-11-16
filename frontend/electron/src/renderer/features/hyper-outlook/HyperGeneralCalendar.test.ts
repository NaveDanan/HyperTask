import { beforeEach, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { eventsMock, kvMock, kvStore, notificationsMock } from '../sidebar/test/mocks';
const state = vi.hoisted(() => ({ space: { id: 'space' } as { id: string } | null }));
vi.mock('@/backend/events', () => eventsMock());
vi.mock('@/backend/notifications', () => notificationsMock());
vi.mock('@/startup/kv', () => kvMock());
vi.mock('@/features/sidebar/stores/space-store', () => ({ sidebarSpace: { store: { getState: () => ({ isInitialized: true, currentSpace: state.space }) }, actions: { workspaceId: 'workspace' } } }));
import * as events from '@/backend/events';
import { favoriteActions, useFavoriteStore } from '../sidebar/stores/favorite-store';
import { ensureHyperGeneralCalendar } from './HyperGeneralCalendar';
import { viewExtra } from '../view/view-ext';
const view = (id: string, marked = false) => create(ViewPBSchema, { id, name: 'General calendar', layout: ViewLayoutPB.Calendar, oneOfExtra: { case: 'extra', value: JSON.stringify({ ...(marked ? { hyper_general_calendar: true } : {}), other: 'kept' }) } });
let views: ViewPB[], favorites: ViewPB[];
beforeEach(() => {
  vi.clearAllMocks(); state.space = { id: 'space' }; for (const key of Object.keys(kvStore)) delete kvStore[key]; views = []; favorites = [];
  useFavoriteStore.setState({ views: [], pinnedViews: [], unpinnedViews: [], isLoading: false });
  vi.mocked(events.FolderEventGetAllViews).mockImplementation(async () => ({ ok: true, value: { items: views } }) as never);
  vi.mocked(events.FolderEventCreateView).mockImplementation(async args => { const created = view('created'); views.push(created); expect(args).toMatchObject({ parentViewId: state.space?.id ?? 'workspace', layout: ViewLayoutPB.Calendar, setAsCurrent: false }); return { ok: true, value: created }; });
  vi.mocked(events.FolderEventUpdateView).mockImplementation(async args => { const item = views.find(view => view.id === args.viewId)!; if (args.oneOfExtra?.case === 'extra') item.oneOfExtra = args.oneOfExtra; return { ok: true, value: undefined }; });
  vi.mocked(events.FolderEventGetView).mockImplementation(async args => ({ ok: true, value: views.find(view => view.id === args.value)! }));
  vi.mocked(events.FolderEventToggleFavorite).mockImplementation(async args => { for (const id of args.items ?? []) favorites.push(views.find(view => view.id === id)!); return { ok: true, value: undefined }; });
  vi.mocked(events.FolderEventReadFavorites).mockImplementation(async () => ({ ok: true, value: { items: favorites.map(item => ({ item, timestamp: 0n })) } }) as never);
});
it('creates once without opening a page, marks it, favorites and pins it, preserving other extra', async () => {
  const [a, b] = await Promise.all([ensureHyperGeneralCalendar('workspace'), ensureHyperGeneralCalendar('workspace')]);
  expect(a.id).toBe(b.id); expect(events.FolderEventCreateView).toHaveBeenCalledOnce(); expect(events.FolderEventSetLatestView).not.toHaveBeenCalled();
  expect(viewExtra(a)).toMatchObject({ other: 'kept', hyper_general_calendar: true, is_pinned: true }); expect(kvStore['hyperGeneralCalendarViewId:workspace']).toBe('created'); expect(useFavoriteStore.getState().pinnedViews[0]?.item.id).toBe('created');
});
it('reuses the marked view despite a stale cache and ignores an unmarked cached Calendar', async () => {
  views = [view('ordinary'), view('general', true)]; kvStore['hyperGeneralCalendarViewId:workspace'] = 'ordinary';
  expect((await ensureHyperGeneralCalendar('workspace')).id).toBe('general'); expect(events.FolderEventCreateView).not.toHaveBeenCalled(); expect(kvStore['hyperGeneralCalendarViewId:workspace']).toBe('general');
});
it('creates when the cached view is gone (GetAllViews excludes trash)', async () => {
  kvStore['hyperGeneralCalendarViewId:workspace'] = 'trashed'; expect((await ensureHyperGeneralCalendar('workspace')).id).toBe('created');
});
it('uses pin rather than the three-item-limited toggle and never unfavorites a reused favorite', async () => {
  const general = view('general', true); general.isFavorite = true; views = [general]; favorites = [general];
  useFavoriteStore.setState({ pinnedViews: [1, 2, 3].map(id => ({ item: view(String(id)), timestamp: 0n })) as never });
  const pin = vi.spyOn(favoriteActions, 'pin'); await ensureHyperGeneralCalendar('workspace');
  expect(pin).toHaveBeenCalledWith(general); expect(events.FolderEventToggleFavorite).not.toHaveBeenCalled(); expect(viewExtra(general)?.is_pinned).toBe(true); pin.mockRestore();
});
it('surfaces backend errors and allows a later retry instead of caching failure', async () => {
  vi.mocked(events.FolderEventGetAllViews).mockResolvedValueOnce({ ok: false, error: { msg: 'Workspace unavailable' } } as never);
  await expect(ensureHyperGeneralCalendar('workspace')).rejects.toThrow('Workspace unavailable'); expect((await ensureHyperGeneralCalendar('workspace')).id).toBe('created');
});

it('creates at the workspace root when a fresh local workspace has no spaces', async () => {
  state.space = null; expect((await ensureHyperGeneralCalendar('workspace')).id).toBe('created');
  expect(events.FolderEventCreateView).toHaveBeenCalledWith(expect.objectContaining({ parentViewId: 'workspace', setAsCurrent: false }));
});
it('renames a default-named General calendar to Hyper-Event and keeps a custom name', async () => {
  vi.mocked(events.FolderEventUpdateView).mockImplementation(async args => { const item = views.find(view => view.id === args.viewId)!; if (args.oneOfName?.case === 'name') item.name = args.oneOfName.value; return { ok: true, value: undefined }; });
  views = [view('general', true)]; expect((await ensureHyperGeneralCalendar('workspace')).name).toBe('Hyper-Event');
  views = [Object.assign(view('custom', true), { name: 'Team events' })]; expect((await ensureHyperGeneralCalendar('workspace')).name).toBe('Team events');
});
