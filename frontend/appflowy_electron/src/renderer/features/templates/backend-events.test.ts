import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromBinary, toBinary, create } from '@bufbuild/protobuf';
import { CreateDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { UpdateRowMetaChangesetPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { ImportPayloadPBSchema } from '@shared/protobuf/flowy-folder/import_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperTemplateImporter } from './import-service';
import { entryNamed, fileRepository } from './test-support';

afterEach(() => vi.unstubAllGlobals());
describe('generated backend event integration', () => {
  it('encodes documents through FolderEventImportData and returns the created view', async () => {
    const request = vi.fn(async (_event: string, _payload: Uint8Array) => ({ status: 0, payload: toBinary(RepeatedViewPBSchema, create(RepeatedViewPBSchema, { items: [{ id: 'imported' }] })) }));
    vi.stubGlobal('window', { appflowy: { core: { request } } });
    const result = await new HyperTemplateImporter(fileRepository()).importTemplate(entryNamed('Weekly-To-Do-List'), 'workspace');
    expect(result).toMatchObject({ ok: true, value: { id: 'imported' } }); expect(request).toHaveBeenCalledTimes(1);
    const [event, bytes] = request.mock.calls[0]; expect(event).toBe('ImportData');
    const payload = fromBinary(ImportPayloadPBSchema, bytes); expect(payload.parentViewId).toBe('workspace');
    expect(payload.items).toHaveLength(1); expect(payload.items[0].oneOfData.case).toBe('data');
  });
  it('encodes typed database creation, row documents and the optional row page flag', async () => {
    const request = vi.fn(async (event: string, _payload: Uint8Array) => ({ status: 0, payload: event === 'CreateView' ? toBinary(ViewPBSchema, create(ViewPBSchema, { id: 'database-view' })) : new Uint8Array() }));
    vi.stubGlobal('window', { appflowy: { core: { request } } });
    const result = await new HyperTemplateImporter(fileRepository()).importTemplate(entryNamed('Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'), 'workspace');
    expect(result.ok).toBe(true); expect(request.mock.calls.map(([event]) => event)).toEqual(['CreateView', 'CreateDocument', 'UpdateRowMeta', 'CreateDocument', 'UpdateRowMeta']);
    const view = fromBinary(CreateViewPayloadPBSchema, request.mock.calls[0][1]); expect(view.parentViewId).toBe('workspace');
    expect(JSON.parse(new TextDecoder().decode(view.initialData)).fields.length).toBeGreaterThan(0);
    const document = fromBinary(CreateDocumentPayloadPBSchema, request.mock.calls[1][1]); expect(document.oneOfInitialData.case).toBe('initialData');
    const flag = fromBinary(UpdateRowMetaChangesetPBSchema, request.mock.calls[2][1]); expect(flag.viewId).toBe('database-view');
    expect(flag.oneOfIsDocumentEmpty).toEqual({ case: 'isDocumentEmpty', value: false });
  });
});