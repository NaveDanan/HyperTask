import { create, toBinary } from '@bufbuild/protobuf';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ImportItemPayloadPBSchema, ImportTypePB, type ImportItemPayloadPB } from '@shared/protobuf/flowy-folder/import_pb';
import { ViewLayoutPB, type RepeatedViewPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabaseEventUpdateRowMeta, DocumentEventCreateDocument, FolderEventImportData } from '@/backend/events';
import type { FlowyResult } from '@/backend/dispatch';
import { ViewBackendService, type CreateViewOptions } from '../view/view-service';
import { databaseImportFromSnapshot, documentDataPbFromSnapshot, remoteAssetUrlsIn } from './converter';
import { HyperTemplateUnavailableError, type HyperTemplateEntry } from './models';
import { saveHyperTemplateMedia, type HyperTemplateMediaWriter } from './media-writer';
import type { HyperTemplateRepository } from './repository';

export interface HyperTemplateImportBackend {
  importPages(parentViewId: string, items: ImportItemPayloadPB[]): Promise<FlowyResult<RepeatedViewPB>>;
  createDatabase(options: CreateViewOptions): Promise<FlowyResult<ViewPB>>;
  createDocument(documentId: string, document: DocumentDataPB): Promise<FlowyResult<void>>;
  markRowHasDocument(databaseViewId: string, rowId: string): Promise<FlowyResult<void>>;
}
const backend: HyperTemplateImportBackend = {
  importPages: (parentViewId, items) => FolderEventImportData({ parentViewId, items }),
  createDatabase: options => ViewBackendService.createView(options),
  createDocument: (documentId, document) => DocumentEventCreateDocument({ documentId, oneOfInitialData: { case: 'initialData', value: document } }),
  markRowHasDocument: (viewId, id) => DatabaseEventUpdateRowMeta({ viewId, id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }),
};
function assertLocal(value: unknown) {
  const remote = remoteAssetUrlsIn(value);
  if (remote.size) throw new Error(`Template still references remote assets: ${[...remote].join(', ')}`);
}
function assertDocumentLocal(document: DocumentDataPB) { Object.values(document.blocks).forEach(block => assertLocal(JSON.parse(block.data))); }
export class HyperTemplateMissingMediaError extends Error {
  constructor(entry: HyperTemplateEntry, url: string) { super(`${entry.publishName} references ${url}, which is not in the bundled media`); }
}
export class HyperTemplateImporter {
  constructor(readonly repository: HyperTemplateRepository, readonly events = backend, readonly writeMedia: HyperTemplateMediaWriter = saveHyperTemplateMedia) {}
  async bundleMedia(entry: HyperTemplateEntry): Promise<Record<string, string>> {
    const manifest = await this.repository.loadManifest(), urls: Record<string, string> = {};
    for (const url of entry.mediaUrls) {
      const asset = manifest.mediaForUrl(url);
      if (!asset) throw new HyperTemplateMissingMediaError(entry, url);
      urls[url] = await this.writeMedia(asset, await this.repository.loadMedia(asset));
    }
    return urls;
  }
  async buildDocumentImportItem(entry: HyperTemplateEntry) {
    if (!entry.isAvailable || entry.kind !== 'document') throw new HyperTemplateUnavailableError(entry);
    const urls = await this.bundleMedia(entry);
    const document = documentDataPbFromSnapshot(await this.repository.loadPayload(entry), urls);
    assertDocumentLocal(document);
    return create(ImportItemPayloadPBSchema, { name: entry.name, oneOfData: { case: 'data', value: toBinary(DocumentDataPBSchema, document) }, viewLayout: ViewLayoutPB.Document, importType: ImportTypePB.Markdown });
  }
  async buildDatabaseImport(entry: HyperTemplateEntry) {
    if (!entry.isAvailable || entry.kind !== 'database') throw new HyperTemplateUnavailableError(entry);
    const urls = await this.bundleMedia(entry);
    const result = databaseImportFromSnapshot(await this.repository.loadPayload(entry), urls);
    assertLocal(JSON.parse(new TextDecoder().decode(result.initialData)));
    result.rowDocuments.forEach(row => assertDocumentLocal(row.document));
    return result;
  }
  /** Returns the created folder view as well as preserving backend failures. */
  async importTemplate(entry: HyperTemplateEntry, parentViewId: string): Promise<FlowyResult<ViewPB | null>> {
    if (entry.kind === 'document') {
      const result = await this.events.importPages(parentViewId, [await this.buildDocumentImportItem(entry)]);
      return result.ok ? { ok: true, value: result.value.items[0] ?? null } : result;
    }
    if (entry.kind !== 'database') throw new HyperTemplateUnavailableError(entry);
    const database = await this.buildDatabaseImport(entry);
    const created = await this.events.createDatabase({ parentViewId, name: entry.name, layoutType: database.layout, initialDataBytes: database.initialData });
    if (!created.ok) return created;
    for (const row of database.rowDocuments) {
      const document = await this.events.createDocument(row.documentId, row.document);
      if (!document.ok) return document;
      // As in Dart, a failed flag only hides the page indicator; it does not fail the import.
      await this.events.markRowHasDocument(created.value.id, row.rowId);
    }
    return created;
  }
}