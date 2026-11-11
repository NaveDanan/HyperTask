import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import type { HyperDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
const state = vi.hoisted(() => ({ realm: 'one', preflight: vi.fn(), duplicate: vi.fn() }));
vi.mock('@/backend/events', async () => (await import('../src/renderer/features/sidebar/test/mocks')).eventsMock());
vi.mock('@/backend/notifications', async () => (await import('../src/renderer/features/sidebar/test/mocks')).notificationsMock());
vi.mock('@/startup/kv', async () => (await import('../src/renderer/features/sidebar/test/mocks')).kvMock());
vi.mock('@/features/document/HyperDocumentOwner', () => {
  const capture = () => { const realm = state.realm; return { workspaceId: 'workspace', actorId: 'actor', contextKey: realm, isCurrent: () => state.realm === realm }; };
  return { hyperGetDocumentOwner: capture, hyperDocumentOwnerKey: (owner: HyperDocumentOwner | null) => owner ? JSON.stringify([owner.workspaceId, owner.actorId, owner.contextKey]) : '' };
});
vi.mock('@/features/document-duplicate/HyperDocumentDuplicateBackend', async () => {
  const { hyperGetDocumentOwner } = await import('@/features/document/HyperDocumentOwner');
  return { hyperCaptureDuplicateOwner: hyperGetDocumentOwner, hyperDocumentDuplicates: { preflight: state.preflight }, hyperDuplicateView: state.duplicate };
});
const events = await import('@/backend/events');
const { resetKv } = await import('../src/renderer/features/sidebar/test/mocks');
const { createSpaceStore } = await import('../src/renderer/features/sidebar/stores/space-store');
const child = (id: string) => create(ViewPBSchema, { id, parentViewId: 'source', name: id, layout: ViewLayoutPB.Document });
const source = create(ViewPBSchema, { id: 'source', name: 'Source', parentViewId: 'workspace', childViews: [child('first'), child('second')], oneOfExtra: { case: 'extra', value: '{"is_space":true,"space_permission":0}' } });
const created = create(ViewPBSchema, { id: 'created-space', name: 'Source (copy)', parentViewId: 'workspace', oneOfExtra: { case: 'extra', value: '{"is_space":true,"space_permission":0}' } });
async function fixture() { const store = createSpaceStore(); await store.actions.initial(create(UserProfilePBSchema, { id: 1n }), 'workspace', false); return store; }
beforeEach(() => {
  resetKv(); state.realm = 'one'; state.preflight.mockReset().mockResolvedValue(undefined); state.duplicate.mockReset().mockResolvedValue({ ok: true, value: created });
  vi.mocked(events.FolderEventReadWorkspaceViews).mockResolvedValue({ ok: true, value: { items: [source] } } as never); vi.mocked(events.FolderEventReadPrivateViews).mockResolvedValue({ ok: true, value: { items: [] } } as never);
  vi.mocked(events.FolderEventGetView).mockReset().mockResolvedValue({ ok: true, value: source }); vi.mocked(events.FolderEventCreateView).mockReset().mockResolvedValue({ ok: true, value: created });
});
describe('Hyper space duplicate wrapper', () => {
  it('preflights the whole subtree before creating a container and never opens intermediate copies', async () => {
    const store = await fixture(); await store.actions.duplicate(source);
    expect(state.preflight).toHaveBeenCalledWith('source', expect.objectContaining({ workspaceId: 'workspace', contextKey: 'one' }));
    expect(state.preflight.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(events.FolderEventCreateView).mock.invocationCallOrder[0]);
    expect(events.FolderEventCreateView).toHaveBeenCalledWith(expect.objectContaining({ setAsCurrent: false })); expect(state.duplicate).toHaveBeenCalledTimes(2);
    expect(state.duplicate).toHaveBeenCalledWith(expect.objectContaining({ owner: expect.objectContaining({ contextKey: 'one' }), parentViewId: 'created-space', openAfterDuplicate: false })); expect(store.store.getState().isDuplicatingSpace).toBe(false); store.actions.dispose();
  });
  it('does not create a space when a descendant cannot be copied safely', async () => {
    const store = await fixture(); state.preflight.mockRejectedValueOnce(new Error('Unsafe embedded text')); await store.actions.duplicate(source);
    expect(events.FolderEventCreateView).not.toHaveBeenCalled(); expect(state.duplicate).not.toHaveBeenCalled(); expect(store.store.getState().isDuplicatingSpace).toBe(false); store.actions.dispose();
  });
  it('stops the space loop after one uncertain child result without replaying it', async () => {
    const store = await fixture(); state.duplicate.mockResolvedValueOnce({ ok: false, error: { msg: 'Uncertain child copy' } }); await store.actions.duplicate(source);
    expect(events.FolderEventCreateView).toHaveBeenCalledTimes(1); expect(state.duplicate).toHaveBeenCalledTimes(1); expect(store.store.getState().currentSpace?.id).toBe('source'); expect(store.store.getState().isDuplicatingSpace).toBe(false); store.actions.dispose();
  });
  it('does not write or navigate children when the owner changes while creating the container', async () => {
    const store = await fixture(); let release!: () => void;
    vi.mocked(events.FolderEventCreateView).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { ok: true, value: created }; });
    const result = store.actions.duplicate(source); while (!release) await new Promise(resolve => setTimeout(resolve, 1)); state.realm = 'two'; release(); await result;
    expect(state.duplicate).not.toHaveBeenCalled(); expect(store.store.getState().currentSpace?.id).toBe('source'); expect(store.store.getState().isDuplicatingSpace).toBe(false); store.actions.dispose();
  });
  it('does not publish stale final space navigation after a same-ID realm switch', async () => {
    const store = await fixture(); let release!: () => void;
    vi.mocked(events.FolderEventGetView).mockImplementation(async payload => {
      if (payload.value === 'source') return { ok: true, value: source };
      await new Promise<void>(resolve => { release = resolve; }); return { ok: true, value: { ...created, childViews: [child('copied-child')] } };
    });
    const result = store.actions.duplicate(source); while (!release) await new Promise(resolve => setTimeout(resolve, 1)); state.realm = 'two'; release(); await result; await new Promise(resolve => setTimeout(resolve, 5));
    expect(store.store.getState().currentSpace?.id).toBe('source'); expect(store.store.getState().lastCreatedPage).toBe(null); store.actions.dispose();
  });
});
