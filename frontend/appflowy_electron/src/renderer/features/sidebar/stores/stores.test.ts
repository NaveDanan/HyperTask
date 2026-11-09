import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import {
  SectionViewPBSchema,
  SectionViewsPBSchema,
  ViewLayoutPB,
  ViewPBSchema,
  ViewSectionPB,
  type SectionViewPB,
  type ViewPB,
} from '@shared/protobuf/flowy-folder/view_pb';
import { ReminderPBSchema, type ReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { FavoriteView } from './favorite-store';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';

vi.mock('@/backend/events', async () => (await import('../test/mocks')).eventsMock());
vi.mock('@/backend/notifications', async () => (await import('../test/mocks')).notificationsMock());
vi.mock('@/startup/kv', async () => (await import('../test/mocks')).kvMock());

const events = await import('@/backend/events');
const { notify, resetKv } = await import('../test/mocks');
const favorites = await import('./favorite-store');
const reminders = await import('./reminder-store');
const sections = await import('./sections-store');
const workspace = await import('./workspace-store');
const notificationUtils = await import('../notifications/notification-utils');
const { markdownToEditorJson, parseInline } = await import('../import/markdown');

const ok = <T,>(value: T) => ({ ok: true as const, value });
const view = (id: string, extra?: Record<string, unknown>): ViewPB =>
  create(ViewPBSchema, { id, name: id, ...(extra ? { oneOfExtra: { case: 'extra', value: JSON.stringify(extra) } } : null) });
const fav = (id: string, timestamp: number, extra?: Record<string, unknown>): SectionViewPB =>
  create(SectionViewPBSchema, { item: view(id, extra), timestamp: BigInt(timestamp) });

describe('FavoriteBloc', () => {
  beforeEach(() => {
    resetKv();
    vi.mocked(events.FolderEventUpdateView).mockClear();
    vi.mocked(events.FolderEventToggleFavorite).mockClear();
  });

  it('reads favorites without spaces and splits pinned views', async () => {
    vi.mocked(events.FolderEventReadFavorites).mockResolvedValue(
      ok({ items: [fav('a', 1, { is_pinned: true }), fav('space', 1, { is_space: true }), fav('b', 1)] }) as never,
    );
    await favorites.favoriteActions.fetchFavorites();
    const state = favorites.useFavoriteStore.getState();
    expect(state.views.map((v) => v.item.id)).toEqual(['a', 'b']);
    expect(state.pinnedViews.map((v) => v.item.id)).toEqual(['a']);
    expect(state.unpinnedViews.map((v) => v.item.id)).toEqual(['b']);
  });

  it('toggle auto-pins while fewer than 3 views are pinned and unpins on unfavorite', async () => {
    vi.mocked(events.FolderEventReadFavorites).mockResolvedValue(ok({ items: [fav('a', 1, { is_pinned: true })] }) as never);
    await favorites.favoriteActions.fetchFavorites();
    await favorites.favoriteActions.toggle(view('new', { font: 'x' }));
    expect(events.FolderEventUpdateView).toHaveBeenCalledWith({
      viewId: 'new',
      oneOfExtra: { case: 'extra', value: JSON.stringify({ font: 'x', is_pinned: true }) },
    });
    expect(events.FolderEventToggleFavorite).toHaveBeenCalledWith({ items: ['new'] });
    await favorites.favoriteActions.toggle(view('a', { is_pinned: true }));
    expect(events.FolderEventUpdateView).toHaveBeenLastCalledWith({
      viewId: 'a',
      oneOfExtra: { case: 'extra', value: JSON.stringify({ is_pinned: false }) },
    });
  });

  it('reorders with the ReorderableListView index fix and re-favorites every pinned view', async () => {
    expect(favorites.reorderPinned(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
    expect(favorites.reorderPinned(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(favorites.reorderNewIndex(0, 2)).toBe(3);
    expect(favorites.reorderNewIndex(2, 0)).toBe(0);
    vi.mocked(events.FolderEventReadFavorites).mockResolvedValue(
      ok({ items: [fav('a', 1, { is_pinned: true }), fav('b', 1, { is_pinned: true })] }) as never,
    );
    await favorites.favoriteActions.fetchFavorites();
    vi.mocked(events.FolderEventToggleFavorite).mockClear();
    await favorites.favoriteActions.reorder(0, 2);
    expect(vi.mocked(events.FolderEventToggleFavorite).mock.calls.map((c) => (c[0] as { items: string[] }).items[0])).toEqual([
      'b',
      'b',
      'a',
      'a',
    ]);
  });

  it('groups the favorite menu by days since favorited', () => {
    const now = new Date(2026, 10, 9, 12);
    const s = now.getTime() / 1000;
    const groups = favorites.groupFavorites(
      [fav('today', s - 3600), fav('week', s - 3 * 86400), fav('old', s - 30 * 86400)] as FavoriteView[],
      now,
    );
    expect(groups.today.map((v) => v.id)).toEqual(['today']);
    expect(groups.thisWeek.map((v) => v.id)).toEqual(['week']);
    expect(groups.others.map((v) => v.id)).toEqual(['old']);
    expect(favorites.filterFavoriteViews([view('Alpha'), view('beta')], 'AL').map((v) => v.id)).toEqual(['Alpha']);
  });
});

const reminder = (id: string, scheduledAtS: number, extra: { isRead?: boolean; meta?: Record<string, string> } = {}): ReminderPB =>
  create(ReminderPBSchema, { id, objectId: 'doc', scheduledAt: BigInt(scheduledAtS), ...extra });

describe('ReminderBloc', () => {
  it('orders past reminders before upcoming ones, each by time', () => {
    const now = 1_000_000_000_000;
    const list = reminders.normalizeReminders(
      [reminder('future2', now / 1000 + 200), reminder('past2', now / 1000 - 10), reminder('past1', now / 1000 - 100), reminder('future1', now / 1000 + 100)],
      now,
    );
    expect(list.map((r) => r.id)).toEqual(['past1', 'past2', 'future1', 'future2']);
  });

  it('merges updates with the Dart quirks', () => {
    const base = reminder('r', 100, { meta: { block_id: 'b' } });
    const read = reminders.mergeReminderUpdate({ id: 'r', isRead: true }, base);
    expect(read.isRead).toBe(true);
    // A null isArchived differs from false and is written as "null".
    expect(read.meta.is_archived).toBe('null');
    expect(read.meta.block_id).toBe('b');
    const archived = reminders.mergeReminderUpdate({ id: 'r', isArchived: true, isRead: true }, base);
    expect(reminders.reminderIsArchived(archived)).toBe(true);
    const moved = reminders.mergeReminderUpdate({ id: 'r', scheduledAt: 5_000 }, base, 10_000);
    expect(moved.scheduledAt).toBe(5n);
    expect(moved.isAck).toBe(true);
  });

  it('filters the notification tabs newest first', () => {
    const list = [
      reminder('a', 1),
      reminder('b', 2, { isRead: true }),
      reminder('c', 3, { meta: { is_archived: 'true' }, isRead: true }),
    ];
    expect(notificationUtils.filterReminders(list, 'inbox').map((r) => r.id)).toEqual(['b', 'a']);
    expect(notificationUtils.filterReminders(list, 'unread').map((r) => r.id)).toEqual(['a']);
    expect(notificationUtils.filterReminders(list, 'archive').map((r) => r.id)).toEqual(['c']);
  });

  it('formats reminder times like NotificationReminderBloc', () => {
    const now = new Date(2026, 10, 9, 15, 0);
    const fmt = (d: Date) => notificationUtils.formatReminderTimestamp(d.getTime(), UserDateFormatPB.Friendly, UserTimeFormatPB.TwelveHour, now);
    expect(fmt(new Date(2026, 10, 9, 14, 59, 30))).toBe('just now');
    expect(fmt(new Date(2026, 10, 9, 14, 30))).toBe('30 minutes ago');
    expect(fmt(new Date(2026, 10, 9, 9, 5))).toBe('9:05 AM');
    expect(fmt(new Date(2026, 10, 1, 9, 5))).toBe('Nov 01, 2026');
    expect(notificationUtils.formatUserDate(new Date(2026, 0, 2), UserDateFormatPB.ISO)).toBe('2026-01-02');
    expect(notificationUtils.formatUserTime(new Date(2026, 0, 2, 13, 4), UserTimeFormatPB.TwentyFourHour)).toBe('13:04');
  });
});

describe('SidebarSectionsBloc', () => {
  const user = create(UserProfilePBSchema, { id: 1n });

  it('loads both sections, follows DidUpdateSectionViews and remembers spaces', async () => {
    vi.mocked(events.FolderEventReadWorkspaceViews).mockResolvedValue(ok({ items: [view('pub')] }) as never);
    vi.mocked(events.FolderEventReadPrivateViews).mockResolvedValue(ok({ items: [view('priv')] }) as never);
    await sections.sectionsActions.initial(user, 'ws');
    let state = sections.useSectionsStore.getState();
    expect(state.section.publicViews.map((v) => v.id)).toEqual(['pub']);
    expect(state.containsSpace).toBe(false);
    expect(sections.sectionsActions.getViewSection(view('priv'))).toBe(ViewSectionPB.Private);
    expect(sections.sectionsActions.getViewSection(view('nested'))).toBeNull();

    notify(
      'Workspace',
      'ws',
      FolderNotification.DidUpdateSectionViews,
      toBinary(SectionViewsPBSchema, create(SectionViewsPBSchema, { section: ViewSectionPB.Public, views: [view('s', { is_space: true })] })),
    );
    state = sections.useSectionsStore.getState();
    expect(state.section.publicViews.map((v) => v.id)).toEqual(['s']);
    expect(state.containsSpace).toBe(true);
    notify(
      'Workspace',
      'ws',
      FolderNotification.DidUpdateSectionViews,
      toBinary(SectionViewsPBSchema, create(SectionViewsPBSchema, { section: ViewSectionPB.Public, views: [] })),
    );
    // containsSpace never flips back.
    expect(sections.useSectionsStore.getState().containsSpace).toBe(true);
    sections.sectionsActions.dispose();
  });

  it('creates root views at the top of a section', async () => {
    vi.mocked(events.FolderEventCreateView).mockResolvedValueOnce(ok(view('created')) as never);
    await sections.sectionsActions.initial(user, 'ws');
    await sections.sectionsActions.createRootViewInSection('', ViewSectionPB.Private, 0);
    expect(events.FolderEventCreateView).toHaveBeenLastCalledWith({
      parentViewId: 'ws',
      name: '',
      layout: ViewLayoutPB.Document,
      oneOfSection: { case: 'section', value: ViewSectionPB.Private },
      oneOfIndex: { case: 'index', value: 0 },
    });
    expect(sections.useSectionsStore.getState().lastCreatedRootView?.id).toBe('created');
    sections.sectionsActions.dispose();
  });
});

describe('UserWorkspaceBloc helpers', () => {
  it('sorts workspaces by creation time and defaults an unset role to Owner', () => {
    const w = (id: string, t: number) => create(UserWorkspacePBSchema, { workspaceId: id, createdAtTimestamp: BigInt(t) });
    expect(workspace.sortWorkspaces([w('b', 2), w('a', 1)]).map((x) => x.workspaceId)).toEqual(['a', 'b']);
    expect(workspace.workspaceRole(w('a', 1))).toBe(AFRolePB.Owner);
    expect(workspace.workspaceRole(create(UserWorkspacePBSchema, { oneOfRole: { case: 'role', value: AFRolePB.Guest } }))).toBe(AFRolePB.Guest);
    expect(workspace.workspaceRole(null)).toBeUndefined();
  });

  it('picks the workspace icon colors from the UTF-16 sum', () => {
    // "A" = 65 → 65 % 8 = 1.
    expect(workspace.workspaceIconColors('A')).toEqual(['#2E8B57', '#E0FFF0']);
    expect(workspace.workspaceIconColors('')).toEqual(['#8A2BE2', '#F0E6FF']);
  });

  it('opens the resolved workspace on initialize when the folder points elsewhere', async () => {
    vi.mocked(events.FolderEventReadCurrentWorkspace).mockResolvedValue(ok({ id: 'gone', name: 'x', createTime: 0n, views: [] }) as never);
    vi.mocked(events.UserEventGetAllWorkspace).mockResolvedValue(
      ok({ items: [create(UserWorkspacePBSchema, { workspaceId: 'w2', createdAtTimestamp: 2n }), create(UserWorkspacePBSchema, { workspaceId: 'w1', createdAtTimestamp: 1n })] }) as never,
    );
    vi.mocked(events.UserEventGetCloudConfig).mockResolvedValue(ok({ serverUrl: 'https://self.hosted' }) as never);
    vi.mocked(events.UserEventOpenWorkspace).mockClear();
    await workspace.workspaceActions.initialize(create(UserProfilePBSchema, { id: 1n, userAuthType: 1 }));
    const state = workspace.useWorkspaceStore.getState();
    expect(state.workspaces.map((x) => x.workspaceId)).toEqual(['w1', 'w2']);
    // Not found → the first fetched workspace (w2, before sorting) is opened.
    expect(state.currentWorkspace?.workspaceId).toBe('w2');
    expect(events.UserEventOpenWorkspace).toHaveBeenCalledWith({ workspaceId: 'w2', workspaceType: 0 });
    expect(state.isCollabWorkspaceOn).toBe(true);
    workspace.workspaceActions.dispose();
  });
});

describe('markdown import', () => {
  it('converts blocks and inline styles to editor JSON', () => {
    const doc = markdownToEditorJson('# Title\n\nHello **bold** and *it*\n\n- [x] done\n- item\n  - nested\n1. one\n> quote\n---\n```js\ncode\n```');
    expect(doc.children.map((b) => b.type)).toEqual(['heading', 'paragraph', 'todo_list', 'bulleted_list', 'numbered_list', 'quote', 'divider', 'code']);
    expect(doc.children[0].data).toEqual({ level: 1, delta: [{ insert: 'Title' }] });
    expect(doc.children[2].data.checked).toBe(true);
    expect(doc.children[3].children.map((b) => b.type)).toEqual(['bulleted_list']);
    expect(doc.children[7].data).toEqual({ delta: [{ insert: 'code' }], language: 'js' });
    expect(parseInline('a **b** [c](https://x) `d`')).toEqual([
      { insert: 'a ' },
      { insert: 'b', attributes: { bold: true } },
      { insert: ' ' },
      { insert: 'c', attributes: { href: 'https://x' } },
      { insert: ' ' },
      { insert: 'd', attributes: { code: true } },
    ]);
  });
});
