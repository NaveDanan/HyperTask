import { create, toBinary } from '@bufbuild/protobuf';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ImportItemPayloadPBSchema, ImportTypePB, type ImportItemPayloadPB } from '@shared/protobuf/flowy-folder/import_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DocumentEventConvertDataToDocument, FolderEventGetView, FolderEventImportData, FolderEventReadCurrentWorkspace, UserEventGetUserProfile } from '@/backend/events';
import { unwrap } from '@/backend/dispatch';
import { viewIsLocked } from '../view-header/page-access-level-store';
import { markdownToEditorJson } from '../sidebar/import/markdown';

export type HyperDocumentFileImportType = 'markdownOrText' | 'csv';
export interface HyperDocumentImportDestination { parentId: string; workspaceId: string; userId: string }
export interface HyperDocumentFileImportFailure { path: string; message: string; uncertain: boolean }
export interface HyperDocumentFileImportReport { imported: ViewPB[]; failures: HyperDocumentFileImportFailure[]; cancelled: boolean }
export interface HyperDocumentFileImportBackend {
  identity(): Promise<{ workspaceId: string; userId: string }>;
  view(id: string): Promise<ViewPB>;
  readText(path: string): Promise<string | null>;
  convert(markdown: string): Promise<Uint8Array>;
  importItem(parentId: string, item: ImportItemPayloadPB): Promise<ViewPB[]>;
}
const backend: HyperDocumentFileImportBackend = {
  identity: async () => ({ workspaceId: unwrap(await FolderEventReadCurrentWorkspace()).id, userId: String(unwrap(await UserEventGetUserProfile()).id) }),
  view: async value => unwrap(await FolderEventGetView({ value })),
  readText: path => window.appflowy.fs.readText(path),
  convert: async markdown => toBinary(DocumentDataPBSchema, unwrap(await DocumentEventConvertDataToDocument({ convertType: 0, data: new TextEncoder().encode(JSON.stringify(markdownToEditorJson(markdown))) }))),
  importItem: async (parentViewId, item) => unwrap(await FolderEventImportData({ parentViewId, items: [item] })).items,
};
const errorText = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
export const hyperImportFilename = (value: string) => value.split(value.startsWith('/') ? '/' : /[\\/]/).at(-1) || value;
const nameWithoutExtension = (value: string) => { const name = hyperImportFilename(value), dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(0, dot) : name; };
class HyperDocumentImportCancelled extends Error {}

export class HyperDocumentFileImporter {
  constructor(private readonly api: HyperDocumentFileImportBackend = backend) {}
  private check(signal?: AbortSignal, writable = () => true) {
    if (signal?.aborted) throw new HyperDocumentImportCancelled('Import cancelled.');
    if (!writable()) throw new Error('This import destination is read-only.');
  }
  private async identity(expected: HyperDocumentImportDestination, signal?: AbortSignal, writable?: () => boolean) {
    this.check(signal, writable);
    const current = await this.api.identity(); this.check(signal, writable);
    if (current.workspaceId !== expected.workspaceId || current.userId !== expected.userId) throw new Error('The workspace or signed-in user changed. Choose the files again.');
  }
  private async destination(expected: HyperDocumentImportDestination, signal?: AbortSignal, writable?: () => boolean) {
    await this.identity(expected, signal, writable);
    const parent = await this.api.view(expected.parentId); this.check(signal, writable);
    if (parent.id !== expected.parentId || viewIsLocked(parent)) throw new Error('The import destination is unavailable or locked.');
    await this.identity(expected, signal, writable);
  }
  /** Capture this before opening the file picker, so a later account switch cannot retarget it. */
  async capture(parentId: string, signal?: AbortSignal, writable?: () => boolean): Promise<HyperDocumentImportDestination> {
    this.check(signal, writable);
    const identity = await this.api.identity(), destination = { parentId, ...identity };
    await this.destination(destination, signal, writable);
    return destination;
  }
  async importFiles(destination: HyperDocumentImportDestination, type: HyperDocumentFileImportType, paths: string[], signal?: AbortSignal, writable?: () => boolean): Promise<HyperDocumentFileImportReport> {
    const report: HyperDocumentFileImportReport = { imported: [], failures: [], cancelled: false };
    for (const path of [...new Set(paths)]) {
      let writing = false;
      try {
        await this.destination(destination, signal, writable);
        const text = await this.api.readText(path); this.check(signal, writable);
        if (text === null) throw new Error('This file could not be read.');
        const bytes = type === 'markdownOrText' ? await this.api.convert(text) : new TextEncoder().encode(text);
        await this.destination(destination, signal, writable);
        const item = create(ImportItemPayloadPBSchema, { name: nameWithoutExtension(path), oneOfData: { case: 'data', value: bytes }, viewLayout: type === 'csv' ? ViewLayoutPB.Grid : ViewLayoutPB.Document, importType: type === 'csv' ? ImportTypePB.CSV : ImportTypePB.Markdown });
        writing = true;
        const imported = await this.api.importItem(destination.parentId, item);
        report.imported.push(...imported);
        if (imported.length !== 1) throw new Error('The core did not confirm exactly one imported page.');
        if (signal?.aborted) { report.cancelled = true; break; }
      } catch (error) {
        if (error instanceof HyperDocumentImportCancelled) { report.cancelled = true; break; }
        report.failures.push({ path, message: errorText(error), uncertain: writing });
        // A native import may have created a page before returning an error. Never retry
        // that item automatically or continue mutating after an authorization failure.
        if (writing) break;
        try { await this.destination(destination, signal, writable); }
        catch (scopeError) {
          if (scopeError instanceof HyperDocumentImportCancelled) report.cancelled = true;
          break;
        }
      }
    }
    return report;
  }
}

export const hyperDocumentFileImportStrings = {
  failed: 'Import needs attention', imported: '{count} pages imported.',
  uncertain: 'A page may have been created before the error. Check the sidebar before importing these files again.',
  remaining: 'Pages already imported are kept. Choose only the files that still need importing.', close: 'Close', importing: 'Importing…',
};
