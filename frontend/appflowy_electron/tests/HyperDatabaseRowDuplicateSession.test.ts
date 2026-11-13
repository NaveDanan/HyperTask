import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { HyperDocumentSessionPool, type HyperDocumentBackend, type HyperDocumentHistoryParticipant } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { HyperDatabaseRowDuplicateService } from '../src/renderer/features/database/HyperDatabaseRowDuplicateService';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  const base = create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } }), initial = hyperInsertBlock(base, 'root', '', 'paragraph');
  const owner = { workspaceId: 'workspace', actorId: '7', contextKey: 'row-copy-session', isCurrent: () => true };
  const backend: HyperDocumentBackend = { open: async () => initial.document, read: async () => initial.document, apply: vi.fn(async () => {}), history: vi.fn(async () => {}), close: async () => {}, listen: () => () => {} };
  const pool = new HyperDocumentSessionPool(backend), lease = await pool.acquire('body', owner); await lease.session.flush();
  const duplicate = vi.fn(async () => create(RowMetaPBSchema, { id: crypto.randomUUID() }));
  const service = new HyperDatabaseRowDuplicateService({ owner: () => owner, capture: () => owner, writable: async () => create(ViewPBSchema, { id: 'view', layout: ViewLayoutPB.Grid }), database: async () => ({ id: 'database', rows: [{ id: 'row' }] }), row: async () => create(RowMetaPBSchema, { id: 'row', oneOfDocumentId: { case: 'documentId', value: 'body' } }), flush: (id, scope) => pool.flush(id, scope, true), pending: () => false, duplicate });
  const options = { owner, viewId: 'view', databaseId: 'database', rowId: 'row', editable: () => true };
  return { backend, pool, lease, owner, service, duplicate, options, block: initial.focus!.id };
}
describe('Hyper row-copy source document readiness', () => {
  it('blocks pending date/reminder recovery even after document actions have flushed, then permits explicit retry', async () => {
    const f = await fixture(); let blocked = true;
    const participant: HyperDocumentHistoryParticipant = { blocked: () => blocked, retain: () => blocked, prepare: async () => true, complete: async () => {} };
    f.lease.session.attachHistoryParticipant(participant); await f.pool.flush('body', f.owner);
    await expect(f.service.start(f.options)).rejects.toThrow('reminder recovery'); expect(f.duplicate).not.toHaveBeenCalled(); const plan = f.service.store.getState().plans[0];
    blocked = false; await f.service.retry(plan.key, f.options); expect(f.duplicate).toHaveBeenCalledOnce(); f.lease.release(); await f.lease.session.dispose();
  });
  it('rejects copy while successful native Undo is still reconciling its companion sidecars', async () => {
    const f = await fixture(), complete = gate(); let started = false;
    f.lease.session.attachHistoryParticipant({ blocked: () => false, retain: () => false, prepare: async () => true, complete: async () => { started = true; await complete.promise; } });
    const undo = f.lease.session.history(false); await vi.waitFor(() => expect(started).toBe(true)); await f.pool.flush('body', f.owner);
    await expect(f.service.start(f.options)).rejects.toThrow('document history'); expect(f.duplicate).not.toHaveBeenCalled(); complete.resolve(); await undo;
    await f.service.retry(f.service.store.getState().plans[0].key, f.options); expect(f.backend.history).toHaveBeenCalledOnce(); expect(f.duplicate).toHaveBeenCalledOnce(); f.lease.release(); await f.lease.session.dispose();
  });
  it('rechecks reminder readiness after a pending document write finishes', async () => {
    const f = await fixture(), write = gate(); let blocked = false;
    vi.mocked(f.backend.apply).mockImplementationOnce(() => write.promise);
    f.lease.session.attachHistoryParticipant({ blocked: () => blocked, retain: () => blocked, prepare: async () => true, complete: async () => {} });
    let flushing = false; f.service.backend.flush = (id, scope) => { flushing = true; return f.pool.flush(id, scope, true); }; f.lease.session.change(doc => hyperEditText(doc, f.block, [{ insert: 'Pending body text' }])); const copy = f.service.start(f.options), rejected = expect(copy).rejects.toThrow('reminder recovery');
    await vi.waitFor(() => expect(flushing).toBe(true)); expect(f.backend.apply).toHaveBeenCalledOnce(); blocked = true; write.resolve(); await rejected; expect(f.duplicate).not.toHaveBeenCalled();
    blocked = false; await f.service.retry(f.service.store.getState().plans[0].key, f.options); expect(f.duplicate).toHaveBeenCalledOnce(); f.lease.release(); await f.lease.session.dispose();
  });
});
