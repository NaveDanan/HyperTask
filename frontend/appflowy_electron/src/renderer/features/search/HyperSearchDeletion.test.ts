import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { PublishInfoResponsePBSchema } from '@shared/protobuf/flowy-folder/publish_pb';

let actor = 'one';
vi.mock('../document/HyperDocumentOwner', () => ({
  hyperGetDocumentOwner: () => { const actorId = actor; return { workspaceId: 'workspace', actorId, contextKey: 'realm', isCurrent: () => actorId === actor }; },
  hyperDocumentOwnerKey: (owner: { actorId: string } | null) => owner?.actorId ?? '',
}));
vi.mock('@/i18n', () => ({ tr: (key: string) => key }));
vi.mock('@/backend/notifications', () => ({ NotificationSource: { Folder: 'Workspace' }, listen: () => () => {} }));
vi.mock('@/backend/events', () => ({
  FolderEventGetView: vi.fn(), FolderEventGetPublishInfo: vi.fn(), FolderEventUnpublishViews: vi.fn(),
  FolderEventDeleteView: vi.fn(), FolderEventUpdateRecentViews: vi.fn(), FolderEventDuplicateView: vi.fn(),
}));

const events = await import('@/backend/events');
const { deleteView } = await import('../view-header/view-service');
const { hyperCaptureSearchOwner, hyperInvalidateSearchOwner } = await import('./HyperSearchOwner');
const { resetRecentViews } = await import('./recent-views-store');
const view = create(ViewPBSchema, { id: 'same-view', parentViewId: 'parent' });
const published = { ok: true as const, value: create(PublishInfoResponsePBSchema) };
const success = { ok: true as const, value: undefined };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('Hyper search recent-removal deletion ownership', () => {
  beforeEach(() => {
    actor = 'one'; resetRecentViews(); vi.clearAllMocks();
    vi.mocked(events.FolderEventGetView).mockResolvedValue({ ok: true, value: view });
    vi.mocked(events.FolderEventGetPublishInfo).mockResolvedValue(published);
    vi.mocked(events.FolderEventUnpublishViews).mockResolvedValue(success);
    vi.mocked(events.FolderEventDeleteView).mockResolvedValue(success);
    vi.mocked(events.FolderEventUpdateRecentViews).mockResolvedValue(success);
  });

  it('issues no unpublish, delete or recent write when ownership changes during published-info loading', async () => {
    const pending = deferred<typeof published>(); vi.mocked(events.FolderEventGetPublishInfo).mockReturnValueOnce(pending.promise);
    const deleting = deleteView(view);
    await vi.waitFor(() => expect(events.FolderEventGetPublishInfo).toHaveBeenCalledOnce());
    actor = 'two'; pending.resolve(published);
    expect(await deleting).toMatchObject({ ok: false, error: { msg: expect.stringContaining('workspace changed') } });
    expect(events.FolderEventUnpublishViews).not.toHaveBeenCalled();
    expect(events.FolderEventDeleteView).not.toHaveBeenCalled();
    expect(events.FolderEventUpdateRecentViews).not.toHaveBeenCalled();
  });

  it('does not continue into DeleteView after a delayed unpublish loses its owner', async () => {
    const pending = deferred<typeof success>(); vi.mocked(events.FolderEventUnpublishViews).mockReturnValueOnce(pending.promise);
    const deleting = deleteView(view);
    await vi.waitFor(() => expect(events.FolderEventUnpublishViews).toHaveBeenCalledOnce());
    actor = 'two'; pending.resolve(success);
    expect((await deleting).ok).toBe(false);
    expect(events.FolderEventDeleteView).not.toHaveBeenCalled();
    expect(events.FolderEventUpdateRecentViews).not.toHaveBeenCalled();
  });

  it('drops the recent write after a dispatched deletion changes owners', async () => {
    const pending = deferred<typeof success>(); vi.mocked(events.FolderEventDeleteView).mockReturnValueOnce(pending.promise);
    const deleting = deleteView(view);
    await vi.waitFor(() => expect(events.FolderEventDeleteView).toHaveBeenCalledOnce());
    actor = 'two'; pending.resolve(success);
    expect((await deleting).ok).toBe(false);
    expect(events.FolderEventUpdateRecentViews).not.toHaveBeenCalled();
  });

  it('cancels descendant traversal on A → B → A and never dispatches a new-owner mutation', async () => {
    const pending = deferred<{ ok: true; value: typeof view }>(); vi.mocked(events.FolderEventGetView).mockReturnValueOnce(pending.promise);
    const scope = hyperCaptureSearchOwner(); const deleting = deleteView(view, scope);
    actor = 'two'; hyperInvalidateSearchOwner(); actor = 'one'; pending.resolve({ ok: true, value: view });
    expect((await deleting).ok).toBe(false);
    expect(events.FolderEventGetPublishInfo).not.toHaveBeenCalled();
    expect(events.FolderEventDeleteView).not.toHaveBeenCalled();
  });

  it('preserves same-owner unpublish, deletion and recent-removal behavior', async () => {
    expect(await deleteView(view)).toEqual(success);
    expect(events.FolderEventUnpublishViews).toHaveBeenCalledWith({ viewIds: ['same-view'] });
    expect(events.FolderEventDeleteView).toHaveBeenCalledWith({ items: ['same-view'] });
    expect(events.FolderEventUpdateRecentViews).toHaveBeenCalledWith({ viewIds: [], addInRecent: false });
  });
});
