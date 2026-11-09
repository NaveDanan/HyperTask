import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashPBSchema } from '@shared/protobuf/flowy-folder/trash_pb';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';

vi.mock('@/backend/notifications', () => ({
  NotificationSource: { Folder: 'Workspace' },
  listen: () => () => {},
}));
let trashIds: string[] = [];
vi.mock('@/backend/events', () => ({
  FolderEventGetViewAncestors: vi.fn(async () => ({
    ok: true,
    value: { items: ['root', 'a', 'page'].map((id) => create(ViewPBSchema, { id, name: id })) },
  })),
  FolderEventListTrashItems: vi.fn(async () => ({ ok: true, value: { items: trashIds.map((id) => create(TrashPBSchema, { id })) } })),
}));

const { createViewTitleBarStore } = await import('./view-title-bar-store');
const { formatDate, formatTrashDate } = await import('./date-format');
const { generatePublishName } = await import('./share/publish-name');

// ViewTitleBarBloc (docs/parity/02-home-shell.md §3.4.2).
describe('view title bar store', () => {
  beforeEach(() => {
    trashIds = [];
  });

  it('reloads ancestors and whether the page is in the trash', async () => {
    trashIds = ['page'];
    const store = createViewTitleBarStore('page');
    const stop = store.start();
    await store.reload();
    expect(store.getState().ancestors.map((v) => v.id)).toEqual(['root', 'a', 'page']);
    expect(store.getState().isDeleted).toBe(true);
    trashIds = [];
    await store.reload();
    expect(store.getState().isDeleted).toBe(false);
    stop();
  });

  it('trash updates only ever mark the page deleted', async () => {
    const store = createViewTitleBarStore('page');
    const stop = store.start();
    await store.reload();
    store.trashUpdated([create(TrashPBSchema, { id: 'other' })]);
    expect(store.getState().isDeleted).toBe(false);
    store.trashUpdated([create(TrashPBSchema, { id: 'page' })]);
    expect(store.getState().isDeleted).toBe(true);
    store.trashUpdated([]);
    expect(store.getState().isDeleted).toBe(true);
    stop();
  });
});

describe('date formats (date_format_ext.dart)', () => {
  const date = new Date(2024, 2, 5, 14, 7);
  it('formats each UserDateFormatPB', () => {
    expect(formatDate(date, UserDateFormatPB.Locally, false)).toBe('03/05/2024');
    expect(formatDate(date, UserDateFormatPB.US, false)).toBe('2024/03/05');
    expect(formatDate(date, UserDateFormatPB.ISO, false)).toBe('2024-03-05');
    expect(formatDate(date, UserDateFormatPB.Friendly, false)).toBe('Mar 05, 2024');
    expect(formatDate(date, UserDateFormatPB.DayMonthYear, false)).toBe('05/03/2024');
  });
  it('adds the time in 24 or 12 hour format', () => {
    expect(formatDate(date, UserDateFormatPB.Friendly, true, UserTimeFormatPB.TwentyFourHour)).toBe('Mar 05, 2024 14:07');
    expect(formatDate(date, UserDateFormatPB.Friendly, true, UserTimeFormatPB.TwelveHour)).toBe('Mar 05, 2024 2:07 PM');
  });
  it('formats trash dates as MM/dd/yyyy hh:mm a', () => {
    expect(formatTrashDate(BigInt(Math.floor(date.getTime() / 1000)))).toBe('03/05/2024 02:07 PM');
  });
});

describe('generatePublishName (publish_name_generator.dart)', () => {
  it('replaces invalid characters and appends the id', () => {
    expect(generatePublishName('id1', 'My page!')).toBe('My-page--id1');
  });
  it('truncates long names so the result stays within 120 characters', () => {
    const id = 'x'.repeat(20);
    const name = generatePublishName(id, 'n'.repeat(200));
    expect(name).toBe(`${'n'.repeat(100)}-${id}`);
  });
});
