import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { RowMetaPBSchema, type RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { rowDocumentIdForRow } from '../templates/converter';
import { HyperDocumentDatabaseCreatedError, HyperDocumentDatabaseService, type HyperDocumentDatabaseBackend, type HyperDocumentDatabaseCreateOptions } from './HyperDocumentDatabaseService';

const view = (id: string, layout = ViewLayoutPB.Document, parentViewId = 'workspace') => create(ViewPBSchema, { id, layout, parentViewId, name: id });
function setup() {
  let identity = { workspaceId: 'workspace', userId: 'user' }, writable = true, count = 0;
  const views = new Map<string, ViewPB>([['document', view('document')], ['source', view('source', ViewLayoutPB.Grid)]]);
  const rows = new Map<string, RowMetaPB>();
  const api: HyperDocumentDatabaseBackend = {
    identity: vi.fn(async () => identity), views: vi.fn(async () => [...views.values()]),
    view: vi.fn(async id => { const value = views.get(id); if (!value) throw new Error('Not available'); return value; }),
    databaseId: vi.fn(async () => 'shared-database'),
    row: vi.fn(async (viewId, rowId) => { const row = rows.get(`${viewId}:${rowId}`); if (!row) throw new Error('Row unavailable'); return row; }),
    create: vi.fn(async (parentId, layout, name) => {
      const created = view(`created-${++count}`, layout, parentId); created.name = name;
      views.set(created.id, created); views.get(parentId)?.childViews.push(created);
      return created;
    }),
  };
  const options: HyperDocumentDatabaseCreateOptions = { documentId: 'document', identity, layout: ViewLayoutPB.Board, name: '  Test database  ', writable: () => writable };
  return { views, rows, api, options, service: new HyperDocumentDatabaseService(api), changeIdentity: () => { identity = { ...identity, userId: 'another-user' }; }, readOnly: () => { writable = false; } };
}
function rowSetup(explicit = true) {
  const state = setup(), rowId = '136c3a74-0c57-47dd-a152-7d2366165917', documentId = rowDocumentIdForRow(rowId);
  const row = create(RowMetaPBSchema, { id: rowId, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false }, ...(explicit ? { oneOfDocumentId: { case: 'documentId' as const, value: documentId } } : {}) });
  state.rows.set(`source:${rowId}`, row);
  return { ...state, row, options: { ...state.options, documentId, rowScope: { viewId: 'source', rowId } } };
}
describe('Hyper inline database service', () => {
  it('creates a child database and resolves the exact parent/view reference', async () => {
    const { api, service, options } = setup();
    const result = await service.create(options);
    expect(api.create).toHaveBeenCalledWith('document', ViewLayoutPB.Board, 'Test database');
    expect(result.reference).toEqual({ type: 'board', viewId: result.view.id, parentId: 'document', compact: false });
    expect((await service.resolve(result.reference)).id).toBe(result.view.id);
    expect((await service.openCreated(result.view, options.identity)).id).toBe(result.view.id);
  });
  it('creates linked views under the source database with the same database ID', async () => {
    const { api, service, options } = setup();
    const result = await service.link('source', options);
    expect(api.databaseId).toHaveBeenCalledWith('source');
    expect(api.create).toHaveBeenCalledWith('source', ViewLayoutPB.Grid, 'Test database', 'shared-database');
    expect(result.reference.parentId).toBe('source'); expect(result.reference.type).toBe('grid');
  });
  it('does not create pages when the target is read-only, locked, cancelled or the actor changed', async () => {
    const readonly = setup(); readonly.readOnly(); await expect(readonly.service.create(readonly.options)).rejects.toThrow('read-only'); expect(readonly.api.create).not.toHaveBeenCalled();
    const locked = setup(); locked.views.get('document')!.oneOfIsLocked = { case: 'isLocked', value: true }; await expect(locked.service.create(locked.options)).rejects.toThrow('locked'); expect(locked.api.create).not.toHaveBeenCalled();
    const changed = setup(); changed.changeIdentity(); await expect(changed.service.create(changed.options)).rejects.toThrow('signed-in user changed'); expect(changed.api.create).not.toHaveBeenCalled();
    const cancelled = setup(), controller = new AbortController(); controller.abort(); await expect(cancelled.service.create({ ...cancelled.options, signal: controller.signal })).rejects.toThrow('cancelled'); expect(cancelled.api.create).not.toHaveBeenCalled();
  });
  it('keeps a database created just before the document becomes read-only', async () => {
    const { api, views, service, options, readOnly } = setup();
    vi.mocked(api.create).mockImplementation(async (parentId, layout, name) => { const created = view('created-kept', layout, parentId); created.name = name; views.set(created.id, created); views.get(parentId)!.childViews.push(created); readOnly(); return created; });
    let failure: unknown;
    try { await service.create(options); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(HyperDocumentDatabaseCreatedError);
    expect((failure as HyperDocumentDatabaseCreatedError).view.id).toBe('created-kept');
    expect(views.has('created-kept')).toBe(true); expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('rejects moved, missing and unsupported references while retaining their saved identity', async () => {
    const { views, service, options } = setup(); const prepared = await service.create(options);
    views.get('document')!.childViews = [];
    await expect(service.resolve(prepared.reference)).rejects.toThrow('moved');
    expect(prepared.reference.parentId).toBe('document'); expect(views.has(prepared.view.id)).toBe(true);
    views.get('document')!.childViews = [prepared.view]; prepared.view.layout = ViewLayoutPB.Document;
    await expect(service.resolve(prepared.reference)).rejects.toThrow('supported database');
  });
  it('revalidates source lock and workspace after asynchronous ID resolution', async () => {
    const locked = setup(); vi.mocked(locked.api.databaseId).mockImplementation(async () => { locked.views.get('source')!.oneOfIsLocked = { case: 'isLocked', value: true }; return 'database'; });
    await expect(locked.service.link('source', locked.options)).rejects.toThrow('locked'); expect(locked.api.create).not.toHaveBeenCalled();
    const changed = setup(); vi.mocked(changed.api.databaseId).mockImplementation(async () => { changed.changeIdentity(); return 'database'; });
    await expect(changed.service.link('source', changed.options)).rejects.toThrow('changed'); expect(changed.api.create).not.toHaveBeenCalled();
  });
  it('filters candidates and blocks stale recovery-page opens', async () => {
    const { service, views, options, changeIdentity } = setup(); views.set('calendar', view('calendar', ViewLayoutPB.Calendar));
    expect((await service.candidates()).views.map(value => value.id)).toEqual(['source', 'calendar']);
    const result = await service.create(options); changeIdentity();
    await expect(service.openCreated(result.view, options.identity)).rejects.toThrow('changed');
  });
  it('creates row-body databases under the real owner without a folder row-document view', async () => {
    for (const explicit of [true, false]) {
      const { api, views, service, options } = rowSetup(explicit);
      const result = await service.create(options);
      expect(api.row).toHaveBeenCalledWith('source', options.rowScope.rowId);
      expect(api.create).toHaveBeenCalledWith('source', ViewLayoutPB.Board, 'Test database');
      expect(result.reference.parentId).toBe('source');
      expect((await service.resolve(result.reference)).id).toBe(result.view.id);
      expect(views.has(options.documentId)).toBe(false);
      expect(api.view).not.toHaveBeenCalledWith(options.documentId);
      const linked = await service.link('source', options);
      expect(linked.reference.parentId).toBe('source');
    }
  });
  it('rejects changed, removed, empty and locked row bodies before creating backing data', async () => {
    const changed = rowSetup(); changed.row.oneOfDocumentId = { case: 'documentId', value: 'another-document' };
    await expect(changed.service.create(changed.options)).rejects.toThrow('row document changed'); expect(changed.api.create).not.toHaveBeenCalled();
    const removed = rowSetup(); removed.rows.clear();
    await expect(removed.service.link('source', removed.options)).rejects.toThrow('Row unavailable'); expect(removed.api.create).not.toHaveBeenCalled();
    const empty = rowSetup(); empty.row.oneOfIsDocumentEmpty = { case: 'isDocumentEmpty', value: true };
    await expect(empty.service.create(empty.options)).rejects.toThrow('row document changed'); expect(empty.api.create).not.toHaveBeenCalled();
    const locked = rowSetup(); locked.views.get('source')!.oneOfIsLocked = { case: 'isLocked', value: true };
    await expect(locked.service.create(locked.options)).rejects.toThrow('locked'); expect(locked.api.create).not.toHaveBeenCalled();
    const readonly = rowSetup(); readonly.readOnly();
    await expect(readonly.service.create(readonly.options)).rejects.toThrow('read-only'); expect(readonly.api.create).not.toHaveBeenCalled();
  });
  it('keeps a newly created database if its owning row disappears before insertion', async () => {
    const { api, rows, views, service, options } = rowSetup();
    vi.mocked(api.create).mockImplementation(async (parentId, layout, name) => { const created = view('row-kept', layout, parentId); created.name = name; views.set(created.id, created); views.get(parentId)!.childViews.push(created); rows.clear(); return created; });
    await expect(service.create(options)).rejects.toBeInstanceOf(HyperDocumentDatabaseCreatedError);
    expect(views.has('row-kept')).toBe(true); expect(views.has(options.documentId)).toBe(false);
  });
});
