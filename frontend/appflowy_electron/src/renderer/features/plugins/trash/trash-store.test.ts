import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { RepeatedTrashPBSchema, TrashPBSchema } from '@shared/protobuf/flowy-folder/trash_pb';

type Handler = (ty: number, result: { ok: true; value: Uint8Array }) => void;
const handlers: Array<{ objectId?: string; handler: Handler }> = [];

vi.mock('@/backend/notifications', () => ({
  NotificationSource: { Folder: 'Workspace' },
  listen: (_source: string, handler: Handler, objectId?: string) => {
    const entry = { objectId, handler };
    handlers.push(entry);
    return () => handlers.splice(handlers.indexOf(entry), 1);
  },
}));

const trash = (id: string) => create(TrashPBSchema, { id, name: id });

vi.mock('@/backend/events', () => ({
  FolderEventListTrashItems: vi.fn(async () => ({ ok: true, value: { items: [trash('a'), trash('b')] } })),
  FolderEventRestoreTrashItem: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventPermanentlyDeleteTrashItem: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventRecoverAllTrashItems: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventPermanentlyDeleteAllTrashItem: vi.fn(async () => ({ ok: false, error: { code: 1, msg: 'x' } })),
}));

const { createTrashStore } = await import('./trash-store');
const events = await import('@/backend/events');

const emitTrash = (ids: string[]) => {
  const bytes = toBinary(RepeatedTrashPBSchema, create(RepeatedTrashPBSchema, { items: ids.map(trash) }));
  handlers.filter((h) => h.objectId === 'trash').forEach((h) => h.handler(FolderNotification.DidUpdateTrash, { ok: true, value: bytes }));
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// TrashBloc (docs/parity/02-home-shell.md §2C.12).
describe('trash store', () => {
  beforeEach(() => {
    handlers.length = 0;
    vi.clearAllMocks();
  });

  it('lists the trash on start and follows DidUpdateTrash on "trash"', async () => {
    const store = createTrashStore();
    const stop = store.start();
    await flush();
    expect(store.getState().objects.map((t) => t.id)).toEqual(['a', 'b']);
    emitTrash(['c']);
    expect(store.getState().objects.map((t) => t.id)).toEqual(['c']);
    stop();
    expect(handlers).toHaveLength(0);
    emitTrash(['d']);
    expect(store.getState().objects.map((t) => t.id)).toEqual(['c']);
  });

  it('sends the restore and delete events with their payloads', async () => {
    const store = createTrashStore();
    const stop = store.start();
    await store.putback('a');
    expect(events.FolderEventRestoreTrashItem).toHaveBeenCalledWith({ id: 'a' });
    await store.delete(trash('b'));
    expect(events.FolderEventPermanentlyDeleteTrashItem).toHaveBeenCalledWith({ items: [{ id: 'b' }] });
    await store.restoreAll();
    expect(events.FolderEventRecoverAllTrashItems).toHaveBeenCalledTimes(1);
    expect(store.getState().error).toBeNull();
    await store.deleteAll();
    expect(events.FolderEventPermanentlyDeleteAllTrashItem).toHaveBeenCalledTimes(1);
    // Failures are stored, not shown.
    expect(store.getState().error).toEqual({ code: 1, msg: 'x' });
    stop();
  });
});
