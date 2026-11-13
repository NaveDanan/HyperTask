import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { MediaCellDataPBSchema, type MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { UploadFileParamsPBSchema, UploadedFilePBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HyperDatabaseDraftController, type HyperDatabaseDraftLease } from './HyperDatabaseDraft';
import { hyperExecuteDatabaseDraft } from './HyperDatabaseDraftBackend';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';

function fixture(type = WorkspaceTypePB.LocalW) {
  const imports: string[] = [], uploads: string[] = [], commits: MediaFilePB[][] = [];
  let failCopy = true, failCommit = false, writable = true, files: MediaFilePB[] = [];
  const field = create(FieldPBSchema, { id: 'field', fieldType: FieldType.Media });
  const owner = { contextKey: 'realm', workspaceId: 'workspace', actorId: 'actor', isCurrent: () => true };
  const controller = new HyperDatabaseDraftController(owner, 'database', 'row', field);
  const cell = () => create(CellPBSchema, { data: toBinary(MediaCellDataPBSchema, create(MediaCellDataPBSchema, { files })) });
  vi.stubGlobal('window', { appflowy: { assets: { importFile: async (source: string) => {
    imports.push(source); if (source === '/second.png' && failCopy) { failCopy = false; throw Error('Temporary copy failure'); }
    return { path: '/managed' + source, name: source.slice(1), size: 10 };
  } }, core: { request: async (_event: string, payload: Uint8Array) => {
    const request = fromBinary(UploadFileParamsPBSchema, payload); uploads.push(request.localFilePath);
    return { status: 0, payload: toBinary(UploadedFilePBSchema, create(UploadedFilePBSchema, { url: 'https://selfhost.example/' + request.localFilePath.slice(1) })) };
  } } } });
  const repository = { cell: async () => cell(), attachMediaFiles: async (_view: string, _row: string, _field: string, attached: MediaFilePB[]) => {
    commits.push(structuredClone(attached)); if (failCommit) { failCommit = false; throw Error('Temporary write failure'); } files = structuredClone(attached);
  } } as unknown as HyperDatabaseRepository;
  const lease: HyperDatabaseDraftLease = { repository, viewId: 'view', current: () => writable, saved: () => {}, read: async () => ({ field, cell: cell() }), execute: (mutation, prepared, check, sent) => hyperExecuteDatabaseDraft(repository, mutation, prepared, check, sent) };
  controller.attach(lease);
  const mutation = { method: 'uploadMedia' as const, args: ['view', 'row', 'field', ['/first.pdf', '/second.png'], 'workspace', type] };
  return { controller, lease, imports, uploads, commits, mutation, load: () => controller.load(repository, 'view', field), allowCopies: () => { failCopy = false; }, failCommit: () => { failCommit = true; }, revoke: () => { writable = false; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('retained media preparation', () => {
  it('retries a failed preparation without copying successful files twice, including after editor detachment', async () => {
    const f = fixture(); await f.load(); expect(await f.controller.runMutation(f.lease, f.mutation)).toBe(false);
    expect(f.imports).toEqual(['/first.pdf', '/second.png']); expect(f.commits).toHaveLength(0);
    expect(await f.controller.retry(f.lease)).toBe(true);
    expect(f.imports).toEqual(['/first.pdf', '/second.png', '/second.png']); expect(f.commits[0]).toHaveLength(2);
    expect(f.commits[0].map(file => file.url)).toEqual(['/managed/first.pdf', '/managed/second.png']);
  });
  it('retries failed cell writes with the same prepared file IDs and no new imports', async () => {
    const f = fixture(); await f.load(); f.allowCopies(); f.failCommit(); expect(await f.controller.runMutation(f.lease, f.mutation)).toBe(false);
    expect(await f.controller.retry(f.lease)).toBe(true); expect(f.imports).toHaveLength(2);
    expect(f.commits[1].map(file => file.id)).toEqual(f.commits[0].map(file => file.id));
  });
  it('keeps cloud upload results across a rejected cell write', async () => {
    const f = fixture(WorkspaceTypePB.ServerW); await f.load(); f.failCommit(); expect(await f.controller.runMutation(f.lease, f.mutation)).toBe(false);
    expect(await f.controller.retry(f.lease)).toBe(true); expect(f.uploads).toEqual(['/first.pdf', '/second.png']); expect(f.imports).toHaveLength(0);
    expect(f.commits[1].map(file => file.url)).toEqual(['https://selfhost.example/first.pdf', 'https://selfhost.example/second.png']);
  });
  it('checks context after a prepared file finishes and before the cell write', async () => {
    const f = fixture(); await f.load(); f.allowCopies();
    const original = window.appflowy.assets.importFile;
    window.appflowy.assets.importFile = async source => { const result = await original(source); f.revoke(); return result; };
    expect(await f.controller.runMutation(f.lease, f.mutation)).toBe(false); expect(f.commits).toHaveLength(0); expect(f.imports).toHaveLength(1);
    expect(f.controller.getSnapshot().issue).toBe('unavailable'); expect(f.controller.copyText()).toContain('/first.pdf');
  });
  it('checks observed source bytes again after each file preparation', async () => {
    const f = fixture(); await f.load(); f.allowCopies(); let changed = false;
    const original = f.lease.read;
    f.lease.read = async target => { const source = await original(target); return changed ? { ...source, cell: create(CellPBSchema, { data: new Uint8Array([1]) }) } : source; };
    const importer = window.appflowy.assets.importFile; window.appflowy.assets.importFile = async source => { const result = await importer(source); changed = true; return result; };
    expect(await f.controller.runMutation(f.lease, f.mutation)).toBe(false); expect(f.commits).toHaveLength(0); expect(f.imports).toHaveLength(1);
    expect(f.controller.getSnapshot().issue).toBe('changed'); expect(await f.controller.retry(f.lease)).toBe(false);
  });
});
