import { clone, create, toBinary } from '@bufbuild/protobuf';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ImportItemPayloadPBSchema, ImportTypePB } from '@shared/protobuf/flowy-folder/import_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetView, FolderEventImportData, FolderEventReadCurrentWorkspace } from '@/backend/events/flowy-folder';
import { UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { unwrap } from '@/backend/dispatch';
import { viewIsLocked } from '../view-header/page-access-level-store';
import type { HyperHtmlImportResult } from './HyperDocumentHtmlParser';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperBlockData } from '../document/HyperDocumentModel';
import { hyperImportBookmarkThumbnail } from '../document-bookmark/HyperBookmarkThumbnailImport';
import { HyperBookmarkThumbnailPreparedError } from '../document-bookmark/HyperBookmarkThumbnailService';
import type { HyperBookmarkThumbnail } from '../document-bookmark/HyperBookmarkThumbnailValue';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperReadBookmarkValue } from '../document-bookmark/HyperDocumentBookmarkValue';

export interface HyperHtmlImportIdentity { workspaceId: string; userId: string }
export interface HyperHtmlImportBackend {
  identity(): Promise<HyperHtmlImportIdentity>;
  view(id: string): Promise<ViewPB>;
  importPage(parentId: string, page: HyperHtmlImportResult): Promise<ViewPB>;
  thumbnail?: typeof hyperImportBookmarkThumbnail;
  authorize?(parentId: string, owner: HyperDocumentOwner, check: <T>(operation: () => Promise<T>) => Promise<T>): Promise<void>;
}
const backend: HyperHtmlImportBackend = {
  thumbnail: hyperImportBookmarkThumbnail,
  authorize: (parentId, owner, check) => hyperDocumentDuplicateBackend.writable(parentId, owner, check),
  identity: async () => ({ workspaceId: unwrap(await FolderEventReadCurrentWorkspace()).id, userId: String(unwrap(await UserEventGetUserProfile()).id) }),
  view: async value => unwrap(await FolderEventGetView({ value })),
  importPage: async (parentViewId, page) => {
    // Markdown is the existing protobuf-document transport, independent of the source
    // format. The core decodes these bytes as DocumentDataPB, not Markdown text.
    const result = unwrap(await FolderEventImportData({ parentViewId, items: [create(ImportItemPayloadPBSchema, { name: page.title, viewLayout: ViewLayoutPB.Document, importType: ImportTypePB.Markdown, oneOfData: { case: 'data', value: toBinary(DocumentDataPBSchema, page.document) } })] }));
    if (result.items.length !== 1) throw new Error('The core did not return the imported page. Check the sidebar before importing this file again.');
    return result.items[0];
  },
};
export class HyperHtmlImportWriteError extends Error {
  constructor(cause: unknown) {
    super((cause as { msg?: string; message?: string })?.msg ?? (cause as Error)?.message ?? String(cause), { cause });
  }
}

export class HyperDocumentHtmlImporter {
  private readonly prepared = new WeakMap<HyperHtmlImportResult, HyperHtmlImportResult>();
  private readonly unresolved = new WeakMap<HyperHtmlImportResult, Error>();
  private readonly thumbnailScopes = new WeakMap<HyperHtmlImportResult, { owner: HyperDocumentOwner; source: string }>();
  constructor(private readonly api: HyperHtmlImportBackend = backend) {}
  identity() { return this.api.identity(); }
  private async assertIdentity(expected: HyperHtmlImportIdentity) {
    const current = await this.api.identity();
    if (current.workspaceId !== expected.workspaceId || current.userId !== expected.userId) throw new Error('The workspace or signed-in user changed. Choose the HTML files again.');
  }
  async importPage(parentId: string, page: HyperHtmlImportResult, identity: HyperHtmlImportIdentity, writable = () => true): Promise<ViewPB> {
    const owner = page.bookmarkThumbnails?.length ? hyperCaptureDuplicateOwner() : null;
    const requireOwner = () => { if (!writable()) throw Error('This destination is read-only.'); if (page.bookmarkThumbnails?.length && (!owner?.isCurrent() || owner.actorId !== identity.userId || owner.workspaceId !== identity.workspaceId)) throw Error('The thumbnail import owner or destination changed.'); };
    requireOwner();
    if (page.bookmarkThumbnails?.length && owner) {
      const previous = this.thumbnailScopes.get(page), source = JSON.stringify([page.document, page.bookmarkThumbnails]);
      if (previous && (!previous.owner.isCurrent() || previous.source !== source)) throw Error('The retained thumbnail import owner or source changed. Choose the original HTML again.');
      if (!previous) this.thumbnailScopes.set(page, { owner, source });
    }
    const retained = this.unresolved.get(page); if (retained) throw retained;
    if (!writable()) throw new Error('This destination is read-only.');
    if (!page.title.trim() || !page.document.blocks[page.document.pageId] || page.document.blocks[page.document.pageId].ty !== 'page') throw new Error('The HTML page has no valid document to import.');
    await this.assertIdentity(identity); requireOwner();
    const parent = await this.api.view(parentId);
    if (parent.id !== parentId || viewIsLocked(parent)) throw new Error('The import destination is unavailable or locked.');
    await this.assertIdentity(identity); requireOwner();
    if (!writable()) throw new Error('This destination is read-only.');
    let prepared = this.prepared.get(page) ?? page;
    const check = async <T,>(operation: () => Promise<T>) => { requireOwner(); await this.assertIdentity(identity); requireOwner(); const destination = await this.api.view(parentId); requireOwner(); if (destination.id !== parentId || viewIsLocked(destination)) throw Error('The import destination is unavailable or locked.'); const value = await operation(); requireOwner(); await this.assertIdentity(identity); requireOwner(); return value; };
    if (page.bookmarkThumbnails?.length && prepared === page) {
      if (!this.api.thumbnail || !owner) throw Error('This application cannot import bookmark thumbnail snapshots. The source HTML was kept.');
      prepared = { ...page, document: clone(DocumentDataPBSchema, page.document) };
      const completed: Record<string, HyperBookmarkThumbnail> = {};
      try {
        await this.api.authorize?.(parentId, owner, check);
        for (const image of page.bookmarkThumbnails) { const block = prepared.document.blocks[image.blockId]; if (!block) throw Error('The imported thumbnail card changed.'); hyperReadBookmarkValue(block); const thumbnail = await this.api.thumbnail(image.dataUrl, page.document.pageId, owner, check); completed[image.blockId] = thumbnail; const data = hyperBlockData(block); block.data = JSON.stringify({ ...data, hyper_bookmark: { ...(data.hyper_bookmark as object), version: 1, thumbnail } }); }
        await this.api.authorize?.(parentId, owner, check); await check(async () => {});
        this.prepared.set(page, prepared);
      } catch (error) {
        const retained = new HyperHtmlThumbnailImportError({ documentId: page.document.pageId, completed, ...(error instanceof HyperBookmarkThumbnailPreparedError ? { retainedAsset: error.asset, prepared: error.prepared } : {}) }, error); this.unresolved.set(page, retained); throw retained;
      }
    }
    requireOwner();
    if (page.bookmarkThumbnails?.length && owner) { await this.api.authorize?.(parentId, owner, check); await check(async () => {}); }
    try { return await this.api.importPage(parentId, { ...prepared, title: page.title }); }
    catch (error) { throw new HyperHtmlImportWriteError(error); }
  }
}
export class HyperHtmlThumbnailImportError extends Error {
  readonly details: string;
  constructor(retained: unknown, cause: unknown) { super(`The bookmark thumbnail import was not confirmed. Its saved files were kept; this import will not replay automatically. ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); this.details = JSON.stringify({ version: 1, retained }, null, 2); }
}
