import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { FolderEventCreateView, FolderEventGetAllViews, FolderEventGetView, FolderEventReadCurrentWorkspace } from '@/backend/events/flowy-folder';
import { DatabaseEventGetDatabaseId, DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { unwrap } from '@/backend/dispatch';
import { viewIsLocked } from '../view-header/page-access-level-store';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperDocumentDatabaseType, hyperReferenceDocumentDatabase, type HyperDocumentDatabaseReference } from './HyperDocumentDatabaseModel';

export interface HyperDocumentDatabaseIdentity { workspaceId: string; userId: string }
export interface HyperDocumentDatabaseRowScope { viewId: string; rowId: string }
export interface HyperDocumentDatabaseBackend {
  identity(): Promise<HyperDocumentDatabaseIdentity>;
  views(): Promise<ViewPB[]>;
  view(id: string): Promise<ViewPB>;
  databaseId(viewId: string): Promise<string>;
  row(viewId: string, rowId: string): Promise<RowMetaPB>;
  create(parentId: string, layout: ViewLayoutPB, name: string, databaseId?: string): Promise<ViewPB>;
}
const backend: HyperDocumentDatabaseBackend = {
  identity: async () => ({ workspaceId: unwrap(await FolderEventReadCurrentWorkspace()).id, userId: String(unwrap(await UserEventGetUserProfile()).id) }),
  views: async () => unwrap(await FolderEventGetAllViews()).items,
  view: async value => unwrap(await FolderEventGetView({ value })),
  databaseId: async viewId => unwrap(await DatabaseEventGetDatabaseId({ value: viewId })).value,
  row: async (viewId, rowId) => unwrap(await DatabaseEventGetRowMeta({ viewId, rowId })),
  create: async (parentViewId, layout, name, databaseId) => unwrap(await FolderEventCreateView({ parentViewId, layout, name, setAsCurrent: false, ...(databaseId ? { meta: { database_id: databaseId } } : {}) })),
};
export interface HyperDocumentDatabaseCreateOptions {
  documentId: string;
  rowScope?: HyperDocumentDatabaseRowScope;
  identity: HyperDocumentDatabaseIdentity;
  name: string;
  layout: ViewLayoutPB;
  writable(): boolean;
  signal?: AbortSignal;
}
export interface HyperPreparedDocumentDatabase {
  view: ViewPB;
  reference: HyperDocumentDatabaseReference;
}
/** A created page is kept if document insertion later fails; callers can offer to open it. */
export class HyperDocumentDatabaseCreatedError extends Error {
  constructor(readonly view: ViewPB) {
    super('The database was created, but could not be inserted here. The database page has been kept. Open it or choose a position in the document again.');
  }
}
export class HyperDocumentDatabaseService {
  constructor(private readonly api: HyperDocumentDatabaseBackend = backend) {}
  private check(signal?: AbortSignal) { if (signal?.aborted) throw new Error('The inline database request was cancelled.'); }
  private write(options: HyperDocumentDatabaseCreateOptions) {
    this.check(options.signal);
    if (!options.writable()) throw new Error('This document is read-only.');
  }
  async assertIdentity(expected: HyperDocumentDatabaseIdentity, signal?: AbortSignal) {
    this.check(signal);
    const actual = await this.api.identity();
    this.check(signal);
    if (actual.workspaceId !== expected.workspaceId || actual.userId !== expected.userId) throw new Error('The workspace or signed-in user changed. Reopen inline databases.');
  }
  async candidates(signal?: AbortSignal) {
    this.check(signal);
    const identity = await this.api.identity(), views = await this.api.views();
    await this.assertIdentity(identity, signal);
    return { identity, views: views.filter(view => [ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout)) };
  }
  async resolve(reference: HyperDocumentDatabaseReference, signal?: AbortSignal): Promise<ViewPB> {
    this.check(signal);
    const identity = await this.api.identity();
    const parent = await this.api.view(reference.parentId);
    this.check(signal);
    if (!parent.childViews.some(child => child.id === reference.viewId)) throw new Error('The database is unavailable or has moved. Its saved reference has been kept.');
    const view = await this.api.view(reference.viewId);
    await this.assertIdentity(identity, signal);
    if (view.id !== reference.viewId || view.parentViewId !== reference.parentId) throw new Error('The database is unavailable or has moved. Its saved reference has been kept.');
    hyperDocumentDatabaseType(view.layout);
    return view;
  }
  async openCreated(view: ViewPB, identity: HyperDocumentDatabaseIdentity): Promise<ViewPB> {
    await this.assertIdentity(identity);
    const latest = await this.resolve(hyperReferenceDocumentDatabase(view));
    await this.assertIdentity(identity);
    return latest;
  }
  private async destination(options: HyperDocumentDatabaseCreateOptions) {
    this.write(options);
    await this.assertIdentity(options.identity, options.signal);
    let parentId = options.documentId;
    if (options.rowScope) {
      const { viewId, rowId } = options.rowScope;
      if (!viewId.trim() || !rowId.trim()) throw new Error('The owning row is unavailable.');
      const owner = await this.api.view(viewId);
      if (owner.id !== viewId || viewIsLocked(owner)) throw new Error('The owning database is unavailable or locked.');
      hyperDocumentDatabaseType(owner.layout);
      const row = await this.api.row(viewId, rowId);
      const rowDocumentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowId || rowDocumentId !== options.documentId || row.oneOfIsDocumentEmpty.case !== 'isDocumentEmpty' || row.oneOfIsDocumentEmpty.value) throw new Error('The row document changed or is no longer available. Reopen the row.');
      // Row bodies need not have folder views. Store the backing database beneath the
      // actual owning database view and keep that real parent in the inline reference.
      parentId = owner.id;
    } else {
      const document = await this.api.view(options.documentId);
      if (document.id !== options.documentId || document.layout !== ViewLayoutPB.Document || viewIsLocked(document)) throw new Error('This document is locked or cannot contain an inline database.');
    }
    await this.assertIdentity(options.identity, options.signal);
    this.write(options);
    return parentId;
  }
  private async finish(view: ViewPB, options: HyperDocumentDatabaseCreateOptions): Promise<HyperPreparedDocumentDatabase> {
    try {
      await this.destination(options);
      return { view, reference: hyperReferenceDocumentDatabase(view) };
    } catch { throw new HyperDocumentDatabaseCreatedError(view); }
  }
  async create(options: HyperDocumentDatabaseCreateOptions) {
    hyperDocumentDatabaseType(options.layout);
    if (!options.name.trim()) throw new Error('Enter a name for the database.');
    const parentId = await this.destination(options);
    const view = await this.api.create(parentId, options.layout, options.name.trim());
    return this.finish(view, options);
  }
  async link(sourceId: string, options: HyperDocumentDatabaseCreateOptions) {
    if (!options.name.trim()) throw new Error('Enter a name for the linked database view.');
    await this.destination(options);
    const source = await this.api.view(sourceId);
    if (source.id !== sourceId || viewIsLocked(source)) throw new Error('The source database is unavailable or locked.');
    hyperDocumentDatabaseType(source.layout);
    const databaseId = await this.api.databaseId(source.id);
    if (!databaseId) throw new Error('The source database could not be found.');
    await this.destination(options);
    const latest = await this.api.view(source.id);
    if (latest.id !== source.id || latest.layout !== source.layout || viewIsLocked(latest)) throw new Error('The source database changed or is locked. Choose it again.');
    await this.assertIdentity(options.identity, options.signal);
    this.write(options);
    // Upstream references are child views of the source database and share its rows.
    const view = await this.api.create(source.id, source.layout, options.name.trim(), databaseId);
    return this.finish(view, options);
  }
}
