import { describe, expect, it, vi } from 'vitest';
import { fromBinary } from '@bufbuild/protobuf';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ImportTypePB } from '@shared/protobuf/flowy-folder/import_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperTemplateImporter, HyperTemplateMissingMediaError } from './import-service';
import { HyperTemplateRepository } from './repository';
import { HyperTemplateUnavailableError } from './models';
import { remoteAssetUrlsIn, rowDocumentIdForRow } from './converter';
import { entryNamed, failure, fakeBackend, fileRepository, fileSource, manifest } from './test-support';
import type { HyperTemplateMediaWriter } from './media-writer';

function setup(repository = fileRepository()) {
  const events = fakeBackend(), writer = vi.fn<HyperTemplateMediaWriter>(async asset => `/user/${asset.isImage ? 'images' : 'files'}/${asset.path.split('/').pop()}`);
  return { events, writer, importer: new HyperTemplateImporter(repository, events, writer) };
}
describe('document imports', () => {
  it('builds DocumentDataPB bytes with the same Markdown import type', async () => {
    const { importer } = setup(), item = await importer.buildDocumentImportItem(entryNamed('Weekly-To-Do-List'));
    expect(item.name).toBe('Weekly To-Do List'); expect(item.viewLayout).toBe(ViewLayoutPB.Document); expect(item.importType).toBe(ImportTypePB.Markdown);
    const document = fromBinary(DocumentDataPBSchema, item.oneOfData.value!);
    expect(document.blocks).toHaveProperty(document.pageId);
  });
  it('writes each asset once, reads only bundled data and removes all remote URLs', async () => {
    const source = fileSource(), { importer, writer } = setup(new HyperTemplateRepository(source)), entry = entryNamed('Business-Overview-One-Pager');
    const item = await importer.buildDocumentImportItem(entry), document = fromBinary(DocumentDataPBSchema, item.oneOfData.value!);
    expect(writer).toHaveBeenCalledTimes(entry.mediaUrls.length); expect(new Set(writer.mock.calls.map(([asset]) => asset.path)).size).toBe(entry.mediaUrls.length);
    expect(source.readPayload).toHaveBeenCalledExactlyOnceWith(entry.payloadPath);
    expect(source.readMedia.mock.calls.every(([path]) => path.startsWith('media/'))).toBe(true);
    expect(remoteAssetUrlsIn(Object.values(document.blocks).map(b => JSON.parse(b.data))).size).toBe(0);
    expect(Object.values(document.blocks).some(b => JSON.parse(b.data).image_type === 0)).toBe(true);
  });
  it('rejects unavailable entries before reading or writing data', async () => {
    const { importer, events, writer } = setup();
    await expect(importer.buildDocumentImportItem(manifest.templates.find(t => !t.isAvailable)!)).rejects.toBeInstanceOf(HyperTemplateUnavailableError);
    expect(writer).not.toHaveBeenCalled(); expect(events.importPages).not.toHaveBeenCalled();
  });
  it('refuses missing media before sending backend data', async () => {
    const source = fileSource(); source.readManifest.mockResolvedValue(JSON.stringify({ ...JSON.parse(await source.readManifest()), media: [] }));
    const { importer, events } = setup(new HyperTemplateRepository(source));
    await expect(importer.buildDocumentImportItem(entryNamed('Business-Overview-One-Pager'))).rejects.toBeInstanceOf(HyperTemplateMissingMediaError);
    expect(events.importPages).not.toHaveBeenCalled();
  });
  it('refuses remote assets left in the converted document', async () => {
    const entry = { ...entryNamed('Business-Overview-One-Pager'), mediaUrls: [] }, { importer, events } = setup();
    await expect(importer.importTemplate(entry, 'w')).rejects.toThrow('still references remote'); expect(events.importPages).not.toHaveBeenCalled();
  });
  it('sends one item under the requested parent and returns the created view', async () => {
    const { importer, events } = setup(), result = await importer.importTemplate(entryNamed('Weekly-To-Do-List'), 'workspace-1');
    expect(events.importPages).toHaveBeenCalledTimes(1); expect(events.importPages.mock.calls[0][0]).toBe('workspace-1');
    expect(events.importPages.mock.calls[0][1]).toHaveLength(1); expect(result).toMatchObject({ ok: true, value: { id: 'document-view' } });
    expect(events.createDatabase).not.toHaveBeenCalled();
  });
  it('surfaces the backend failure', async () => {
    const { importer, events } = setup(); events.importPages.mockResolvedValue(failure('boom'));
    expect(await importer.importTemplate(entryNamed('Weekly-To-Do-List'), 'w')).toEqual(failure('boom'));
  });
});
describe('database imports', () => {
  it('builds and creates typed data through the folder API', async () => {
    const { importer, events } = setup(), entry = entryNamed('Bug-Tracker-13a84186'), built = await importer.buildDatabaseImport(entry);
    expect(built.fidelity).toMatchObject({ fieldCount: 7, rowCount: 8 }); expect(built.rowDocuments).toEqual([]);
    const result = await importer.importTemplate(entry, 'workspace-1'); expect(result.ok).toBe(true);
    expect(events.createDatabase.mock.calls[0][0]).toMatchObject({ parentViewId: 'workspace-1', name: 'Bug Tracker', layoutType: built.layout });
    expect(events.createDatabase.mock.calls[0][0].initialDataBytes!.length).toBeGreaterThan(0); expect(events.importPages).not.toHaveBeenCalled();
  });
  it('creates each row page and then flags its row under the database view', async () => {
    const { importer, events } = setup();
    expect((await importer.importTemplate(entryNamed('Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'), 'w')).ok).toBe(true);
    expect(events.createDocument).toHaveBeenCalledTimes(2); expect(events.markRowHasDocument).toHaveBeenCalledTimes(2);
    events.markRowHasDocument.mock.calls.forEach(([viewId, rowId], index) => {
      expect(viewId).toBe('database-view'); expect(events.createDocument.mock.calls[index][0]).toBe(rowDocumentIdForRow(rowId));
      expect(events.createDocument.mock.invocationCallOrder[index]).toBeLessThan(events.markRowHasDocument.mock.invocationCallOrder[index]);
    });
  });
  it('returns database creation failure without creating row pages', async () => {
    const { importer, events } = setup(); events.createDatabase.mockResolvedValue(failure('no space'));
    expect(await importer.importTemplate(entryNamed('Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'), 'w')).toEqual(failure('no space')); expect(events.createDocument).not.toHaveBeenCalled();
  });
  it('stops on a row-page failure and does not flag the row', async () => {
    const { importer, events } = setup(); events.createDocument.mockResolvedValue(failure('busy'));
    expect(await importer.importTemplate(entryNamed('Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'), 'w')).toEqual(failure('busy'));
    expect(events.createDocument).toHaveBeenCalledTimes(1); expect(events.markRowHasDocument).not.toHaveBeenCalled();
  });
  it('allows a failed page indicator as Dart does', async () => {
    const { importer, events } = setup(); events.markRowHasDocument.mockResolvedValue(failure('flag failed'));
    expect((await importer.importTemplate(entryNamed('Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'), 'w')).ok).toBe(true);
  });
  it('rejects unavailable databases before any backend call', async () => {
    const { importer, events } = setup();
    await expect(importer.importTemplate(manifest.templates.find(t => !t.isAvailable)!, 'w')).rejects.toBeInstanceOf(HyperTemplateUnavailableError);
    expect(events.createDatabase).not.toHaveBeenCalled();
  });
});