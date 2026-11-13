import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepeatedRecentViewPBSchema, SectionViewPBSchema, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';

let actor = 'one';
const listeners: { callback: (_type: number, result: { ok: true; value: Uint8Array }) => void; closed: boolean }[] = [];
vi.mock('../document/HyperDocumentOwner', () => ({
  hyperGetDocumentOwner: () => { const actorId = actor; return { workspaceId: 'same-workspace', actorId, contextKey: 'realm', isCurrent: () => actorId === actor }; },
  hyperDocumentOwnerKey: (owner: { actorId: string } | null) => owner?.actorId ?? '',
}));
vi.mock('@/i18n', () => ({ tr: (key: string) => key }));
vi.mock('@/backend/notifications', () => ({
  NotificationSource: { Folder: 'Workspace' },
  listen: (_source: string, callback: typeof listeners[number]['callback']) => { const listener = { callback, closed: false }; listeners.push(listener); return () => { listener.closed = true; }; },
}));
vi.mock('@/backend/events', () => ({ FolderEventReadRecentViews: vi.fn(), FolderEventUpdateRecentViews: vi.fn(async () => ({ ok: true, value: undefined })) }));

const recent = await import('./recent-views-store');
const events = await import('@/backend/events');
const { hyperGetDocumentOwner } = await import('../document/HyperDocumentOwner');
const { hyperInvalidateSearchOwner } = await import('./HyperSearchOwner');
const reply = (name: string) => ({ ok: true as const, value: create(RepeatedRecentViewPBSchema, { items: [create(SectionViewPBSchema, { item: create(ViewPBSchema, { id: 'same-view', parentViewId: 'parent', name }) })] }) });
type Reply = ReturnType<typeof reply>;
const deferred = () => { let resolve!: (value: Reply) => void; const promise = new Promise<Reply>(done => { resolve = done; }); return { promise, resolve }; };

describe('Hyper recent views ownership', () => {
  beforeEach(() => { recent.resetRecentViews(); actor = 'one'; listeners.length = 0; vi.clearAllMocks(); vi.mocked(events.FolderEventReadRecentViews).mockResolvedValue(reply('Current')); });

  it('keeps reset initialization and notifications from repopulating another actor cache', async () => {
    const previous = deferred(); vi.mocked(events.FolderEventReadRecentViews).mockReturnValueOnce(previous.promise);
    const old = recent.recentViews();
    const same = recent.recentViews(); expect(old).toBe(same);
    actor = 'two'; recent.resetRecentViews();
    expect(listeners[0].closed).toBe(true);
    await recent.recentViews();
    previous.resolve(reply('Private previous actor')); expect(await old).toEqual([]);
    expect(recent.useRecentViewsStore.getState().views[0].item?.name).toBe('Current');
    const calls = vi.mocked(events.FolderEventReadRecentViews).mock.calls.length;
    listeners[0].callback(0, { ok: true, value: new Uint8Array() });
    expect(events.FolderEventReadRecentViews).toHaveBeenCalledTimes(calls);
  });

  it('publishes the latest authoritative notification refresh and ignores old payloads', async () => {
    await recent.recentViews();
    const earlier = deferred(), latest = deferred();
    vi.mocked(events.FolderEventReadRecentViews).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    const emit = () => listeners[0].callback(0, { ok: true, value: new TextEncoder().encode('Private unrelated notification payload') });
    emit(); emit(); latest.resolve(reply('Latest authoritative result')); await latest.promise; await Promise.resolve(); await Promise.resolve();
    earlier.resolve(reply('Older result')); await earlier.promise; await Promise.resolve(); await Promise.resolve();
    expect(recent.useRecentViewsStore.getState().views[0].item?.name).toBe('Latest authoritative result');
  });

  it('invalidates A → B → A replies and rejects mutation through a stale owner', async () => {
    const previous = deferred(); vi.mocked(events.FolderEventReadRecentViews).mockReturnValueOnce(previous.promise);
    const pending = recent.recentViews(); const owner = hyperGetDocumentOwner();
    actor = 'two'; hyperInvalidateSearchOwner(); recent.resetRecentViews(); actor = 'one';
    previous.resolve(reply('Old session')); expect(await pending).toEqual([]);
    expect(recent.useRecentViewsStore.getState().views).toEqual([]);
    actor = 'two'; await recent.updateRecentViews(['same-view'], true, owner);
    expect(events.FolderEventUpdateRecentViews).not.toHaveBeenCalled();
  });
});
