import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDatabaseRowDuplicateService, type HyperDatabaseRowDuplicateBackend } from '../src/renderer/features/database/HyperDatabaseRowDuplicateService';
import { hyperRowDuplicateDocument } from '../src/renderer/features/database/HyperDatabaseRowDuplicateModel';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateBackend';
const sourceId = '329ff418-5bfa-439d-9863-202918c90550', documentId = '433e63a9-9f01-4235-b502-29f46f3e60ce';
function fixture() {
  let version = 0, actor = '7', realm = 'realm-A', writable = true, pending = false, localPending = false, lostAck = false;
  const current = () => { const revision = version, id = actor, context = realm; return { workspaceId: 'workspace', actorId: id, contextKey: context, isCurrent: () => revision === version }; };
  let source = create(RowMetaPBSchema, { id: sourceId, oneOfDocumentId: { case: 'documentId', value: documentId }, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } });
  let database = { id: 'database', rows: [{ id: sourceId }] }; const copies = new Map<string, ReturnType<typeof create<typeof RowMetaPBSchema>>>();
  const backend: HyperDatabaseRowDuplicateBackend = {
    owner: current, capture: () => current(), writable: vi.fn(async () => { if (!writable) throw Error('Locked database'); return create(ViewPBSchema, { id: 'view', layout: ViewLayoutPB.Grid }); }),
    database: vi.fn(async () => database), row: vi.fn(async () => source), flush: vi.fn(async () => {}), pending: () => pending,
    duplicate: vi.fn(async request => { let copy = copies.get(request.operationId); if (!copy) { if (!database.rows.some(row => row.id === request.rowId)) throw Error('Missing source'); copy = create(RowMetaPBSchema, { id: crypto.randomUUID(), oneOfDocumentId: { case: 'documentId', value: crypto.randomUUID() } }); copies.set(request.operationId, copy); } if (lostAck) throw Error('Lost acknowledgement'); return copy; }),
  };
  const service = new HyperDatabaseRowDuplicateService(backend), options = () => ({ owner: current(), databaseId: 'database', viewId: 'view', rowId: sourceId, editable: () => true, hasPending: () => localPending });
  return { backend, service, copies, options, current, pending: (value: boolean) => { pending = value; }, localPending: (value: boolean) => { localPending = value; }, lock: () => { writable = false; }, lost: (value = true) => { lostAck = value; }, row: (value: typeof source) => { source = value; }, source: () => source, database: (value: typeof database) => { database = value; }, replaceOwner: () => { actor = '8'; version++; }, realmAba: () => { realm = 'realm-B'; version++; realm = 'realm-A'; version++; } };
}
describe('Hyper retained row-copy operations', () => {
  it('stops when a real workspace-open transition begins and remains stopped after a same-ID return', async () => {
    const original = useWorkspaceStore.getState();
    try {
      useWorkspaceStore.setState({ currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), userProfile: create(UserProfilePBSchema, { id: 7n }), actionResult: null });
      const f = fixture(); f.backend.owner = hyperGetDocumentOwner; f.backend.capture = hyperCaptureDuplicateOwner;
      f.backend.database = vi.fn(async () => { useWorkspaceStore.setState({ actionResult: { actionType: 'open', isLoading: true, result: null } }); useWorkspaceStore.setState({ actionResult: null }); return { id: 'database', rows: [{ id: sourceId }] }; });
      await expect(f.service.start({ ...f.options(), owner: hyperGetDocumentOwner()! })).rejects.toThrow('session changed'); expect(f.backend.duplicate).not.toHaveBeenCalled();
    } finally { useWorkspaceStore.setState({ currentWorkspace: original.currentWorkspace, userProfile: original.userProfile, actionResult: original.actionResult }); }
  });
  it('flushes the bound row document before the first copy and retains exact optional native arguments', async () => {
    const f = fixture(), result = await f.service.start({ ...f.options(), groupId: 'group' }); expect(result.id).not.toBe(sourceId); expect(f.backend.flush).toHaveBeenCalledExactlyOnceWith(documentId, expect.anything());
    const request = vi.mocked(f.backend.duplicate!).mock.calls[0][0]; expect(request).toMatchObject({ viewId: 'view', rowId: sourceId, groupId: 'group' }); expect(request.operationId).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/u); expect(f.service.store.getState().plans).toHaveLength(0);
  });
  it('coalesces simultaneous panes into one pending operation and one native copy', async () => {
    const f = fixture(); let release!: () => void; f.backend.flush = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const a = f.service.start(f.options()), b = f.service.start(f.options()); await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(f.service.store.getState().plans).toHaveLength(1); release(); expect((await a).id).toBe((await b).id); expect(f.backend.duplicate).toHaveBeenCalledOnce();
  });
  it('retries the exact completed operation after source deletion, preserves copied edits and does not flush/read missing source', async () => {
    const f = fixture(); f.lost(); await expect(f.service.start(f.options())).rejects.toThrow('acknowledgement'); const plan = f.service.store.getState().plans[0], copied = f.copies.get(plan.request.operationId)!; copied.oneOfDocumentId = { case: 'documentId', value: 'edited-copy-document' }; f.database({ id: 'database', rows: [] }); f.backend.row = vi.fn(async () => { throw Error('Deleted source'); }); f.lost(false);
    const result = await f.service.retry(plan.key, f.options()); expect(result).toBe(copied); expect(result.oneOfDocumentId.value).toBe('edited-copy-document'); expect(f.copies.size).toBe(1); expect(f.backend.row).not.toHaveBeenCalled(); expect(f.backend.flush).toHaveBeenCalledOnce(); expect(vi.mocked(f.backend.duplicate!).mock.calls.map(call => call[0].operationId)).toEqual([plan.request.operationId, plan.request.operationId]);
  });
  it('requires explicit retry for an uncertain acknowledgement and allocates a new UUID only after confirmation', async () => {
    const f = fixture(); f.lost(); await expect(f.service.start(f.options())).rejects.toThrow(); const plan = f.service.store.getState().plans[0]; await expect(f.service.start(f.options())).rejects.toThrow('pending copy'); expect(f.backend.duplicate).toHaveBeenCalledOnce(); f.lost(false); await f.service.retry(plan.key, f.options()); await f.service.start(f.options()); const calls = vi.mocked(f.backend.duplicate!).mock.calls; expect(calls[2][0].operationId).not.toBe(plan.request.operationId); expect(f.copies.size).toBe(2);
  });
  it('dismisses only the notice and keeps the same operation available after dialog close', async () => {
    const f = fixture(); f.lost(); await expect(f.service.start(f.options())).rejects.toThrow(); const plan = f.service.store.getState().plans[0]; f.service.dismiss(plan.key, f.current()); expect(f.service.find(f.current(), 'view', sourceId)?.dismissed).toBe(true); expect(f.service.details(plan.key, f.current())).toContain(plan.request.operationId); await expect(f.service.start(f.options())).rejects.toThrow('pending copy'); expect(f.copies.size).toBe(1);
  });
  it('blocks global cell drafts and local form edits and still flushes the first copy when retried before dispatch', async () => {
    for (const kind of ['global', 'local']) { const f = fixture(); if (kind === 'global') f.pending(true); else f.localPending(true); await expect(f.service.start(f.options())).rejects.toThrow('pending cell'); expect(f.backend.duplicate).not.toHaveBeenCalled(); const plan = f.service.store.getState().plans[0]; f.pending(false); f.localPending(false); await f.service.retry(plan.key, f.options()); expect(f.backend.flush).toHaveBeenCalledOnce(); expect(f.backend.duplicate).toHaveBeenCalledOnce(); }
  });
  it('blocks stale row-body binding, changed database and lost write permission before native copy', async () => {
    for (const kind of ['binding', 'database', 'permission']) { const f = fixture(); if (kind === 'database') f.database({ id: 'replacement', rows: [{ id: sourceId }] }); else f.backend.flush = vi.fn(async () => { if (kind === 'binding') f.row({ ...f.source(), oneOfDocumentId: { case: 'documentId', value: 'replacement-body' } }); else f.lock(); }); await expect(f.service.start(f.options())).rejects.toThrow(); expect(f.backend.duplicate).not.toHaveBeenCalled(); }
  });
  it('masks late owner errors and retains only original scoped request IDs', async () => {
    const f = fixture(); f.backend.duplicate = vi.fn(async () => { f.replaceOwner(); throw Error('foreign private row label'); }); await expect(f.service.start(f.options())).rejects.toThrow('workspace, account'); const plan = f.service.store.getState().plans[0]; expect(plan.error).not.toContain('foreign private'); expect(plan.owner.actorId).toBe('7'); expect(() => f.service.details(plan.key, f.current())).toThrow('changed'); await expect(f.service.retry(plan.key, f.options())).rejects.toThrow('changed');
  });
  it('rejects same-ID realm ABA after dispatch without losing the original operation', async () => {
    const f = fixture(); f.backend.duplicate = vi.fn(async () => { f.realmAba(); return create(RowMetaPBSchema, { id: crypto.randomUUID() }); }); await expect(f.service.start(f.options())).rejects.toThrow('session changed'); expect(f.service.store.getState().plans[0].status).toBe('uncertain'); expect(f.service.store.getState().plans[0].request.operationId).toBe(vi.mocked(f.backend.duplicate).mock.calls[0][0].operationId);
  });
  it('does not make a copied row from an invalid acknowledgement or an unavailable native callback', async () => {
    const f = fixture(); f.backend.duplicate = vi.fn(async () => create(RowMetaPBSchema, { id: sourceId })); await expect(f.service.start(f.options())).rejects.toThrow('acknowledgement'); expect(f.service.store.getState().plans[0].status).toBe('uncertain'); const empty = fixture(); empty.backend.duplicate = undefined; await expect(empty.service.start(empty.options())).rejects.toThrow('unavailable'); expect(empty.service.store.getState().plans).toHaveLength(0);
  });
  it('uses compatible derived document IDs and omits explicitly empty row bodies', () => {
    const row = create(RowMetaPBSchema, { id: sourceId }); expect(hyperRowDuplicateDocument(row)).toMatch(/^[\da-f-]{36}$/u); expect(hyperRowDuplicateDocument({ ...row, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: true } })).toBeNull();
  });
});
