import { beforeEach, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { eventsMock, kvMock, kvStore, notificationsMock } from '../sidebar/test/mocks';
vi.mock('@/backend/events', () => eventsMock());
vi.mock('@/backend/notifications', () => notificationsMock());
vi.mock('@/startup/kv', () => kvMock());
vi.mock('@/features/sidebar/stores/space-store', () => ({ sidebarSpace: { store: { getState: () => ({ isInitialized: true, currentSpace: { id: 'space' } }) }, actions: { workspaceId: 'workspace' } } }));
import * as events from '@/backend/events';
import { ensureHyperGeneralKanban } from './HyperGeneralKanban';
import { viewExtra } from '../view/view-ext';
const view = (id: string, marked = false, layout = ViewLayoutPB.Board) => create(ViewPBSchema, { id, name: 'Hyper-Kanban', layout, oneOfExtra: { case: 'extra', value: JSON.stringify({ ...(marked ? { hyper_general_kanban: true } : {}), other: 'kept' }) } });
let views: ViewPB[];
beforeEach(() => {
  vi.clearAllMocks(); for (const key of Object.keys(kvStore)) delete kvStore[key]; views = [];
  vi.mocked(events.FolderEventGetAllViews).mockImplementation(async () => ({ ok: true, value: { items: views } }) as never);
  vi.mocked(events.FolderEventCreateView).mockImplementation(async args => {
    expect(args).toMatchObject({ parentViewId: 'space', name: 'Hyper-Kanban', layout: ViewLayoutPB.Board, setAsCurrent: false, oneOfExtra: { case: 'extra', value: '{"hyper_general_kanban":true}' } });
    const created = view('created', true);
    views.push(created);
    return { ok: true, value: created };
  });
});
it('creates one marked board without opening it, preserving other extra', async () => {
  const [a, b] = await Promise.all([ensureHyperGeneralKanban('workspace'), ensureHyperGeneralKanban('workspace')]);
  expect(a.id).toBe(b.id); expect(events.FolderEventCreateView).toHaveBeenCalledOnce(); expect(events.FolderEventSetLatestView).not.toHaveBeenCalled();
  expect(viewExtra(a)).toMatchObject({ other: 'kept', hyper_general_kanban: true }); expect(kvStore['hyperGeneralKanbanViewId:workspace']).toBe('created');
});
it('reuses the marked board and ignores unmarked boards and other layouts', async () => {
  views = [view('plain'), view('calendar', true, ViewLayoutPB.Calendar), view('general', true)];
  expect((await ensureHyperGeneralKanban('workspace')).id).toBe('general'); expect(events.FolderEventCreateView).not.toHaveBeenCalled();
});
