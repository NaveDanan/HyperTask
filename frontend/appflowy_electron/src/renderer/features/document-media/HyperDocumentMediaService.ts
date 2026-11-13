import { hyperCloudAssetIsProtected, hyperPreviewCloudAsset } from '../cloud-assets/HyperCloudAssetPreview';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import type { HyperImportedAsset } from '@shared/api';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FolderEventGetView, FolderEventReadCurrentWorkspace } from '@/backend/events/flowy-folder';
import { UserEventGetAllWorkspace, UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { DocumentEventDownloadFile, DocumentEventUploadFile } from '@/backend/events/flowy-document';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { viewIsLocked } from '../view-header/page-access-level-store';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperDocumentMediaUrl, type HyperDocumentMediaKind, type HyperDocumentMediaReference } from './HyperDocumentMediaModel';

export interface HyperDocumentMediaIdentity { workspaceId: string; userId: string; local: boolean }
export interface HyperDocumentMediaRowScope { viewId: string; rowId: string }
export interface HyperPreparedDocumentMedia { media: HyperDocumentMediaReference; identity: HyperDocumentMediaIdentity }
export interface HyperDocumentMediaBackend {
  identity(): Promise<HyperDocumentMediaIdentity>;
  view(id: string): Promise<ViewPB>;
  row(viewId: string, rowId: string): Promise<RowMetaPB>;
  importFile(path: string, kind: HyperDocumentMediaKind): Promise<HyperImportedAsset>;
  upload(workspaceId: string, documentId: string, path: string): Promise<string>;
  preview(path: string): Promise<string>;
  previewRemote?(url: string): Promise<string>;
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  saveFile(name: string): Promise<string | null>;
  download(url: string, path: string): Promise<void>;
}
const backend: HyperDocumentMediaBackend = {
  identity: async () => {
    const workspaceId = unwrap(await FolderEventReadCurrentWorkspace()).id;
    const user = unwrap(await UserEventGetUserProfile());
    const workspace = unwrap(await UserEventGetAllWorkspace()).items.find(item => item.workspaceId === workspaceId);
    if (!workspace || unwrap(await FolderEventReadCurrentWorkspace()).id !== workspaceId) throw new Error('The active workspace changed. Reopen media insertion.');
    return { workspaceId, userId: String(user.id), local: workspace.workspaceType === WorkspaceTypePB.LocalW };
  },
  view: async value => unwrap(await FolderEventGetView({ value })),
  row: async (viewId, rowId) => unwrap(await DatabaseEventGetRowMeta({ viewId, rowId })),
  importFile: (path, kind) => window.appflowy.assets.importFile(path, kind),
  upload: async (workspaceId, documentId, localFilePath) => unwrap(await DocumentEventUploadFile({ workspaceId, documentId, localFilePath })).url,
  preview: path => window.appflowy.assets.previewUrl(path),
  previewRemote: hyperPreviewCloudAsset,
  openPath: path => window.appflowy.shell.openPath(path),
  openExternal: url => window.appflowy.shell.openExternal(url),
  saveFile: defaultPath => window.appflowy.dialog.saveFile({ defaultPath }),
  download: async (url, localFilePath) => { unwrap(await DocumentEventDownloadFile({ url, localFilePath, waitForCompletion: true })); },
};
export interface HyperDocumentMediaWriteOptions {
  documentId: string;
  identity: HyperDocumentMediaIdentity;
  writable(): boolean;
  signal?: AbortSignal;
  rowScope?: HyperDocumentMediaRowScope;
}
export class HyperDocumentMediaPreparedError extends Error {
  constructor(readonly prepared: HyperPreparedDocumentMedia) {
    super('The file was saved, but the insertion context changed. The saved file has been kept.');
  }
}
export class HyperDocumentMediaService {
  constructor(private readonly api: HyperDocumentMediaBackend = backend) {}
  private check(signal?: AbortSignal) { if (signal?.aborted) throw new Error('The media request was cancelled.'); }
  async assertIdentity(expected: HyperDocumentMediaIdentity, signal?: AbortSignal) {
    this.check(signal);
    const actual = await this.api.identity(); this.check(signal);
    if (actual.workspaceId !== expected.workspaceId || actual.userId !== expected.userId || actual.local !== expected.local) throw new Error('The workspace or signed-in user changed. Reopen media insertion.');
  }
  private async document(documentId: string, identity: HyperDocumentMediaIdentity, writable?: () => boolean, signal?: AbortSignal, rowScope?: HyperDocumentMediaRowScope) {
    await this.assertIdentity(identity, signal);
    if (writable && !writable()) throw new Error('This document is read-only.');
    const view = await this.api.view(rowScope?.viewId ?? documentId);
    if (rowScope) {
      if (!rowScope.viewId || !rowScope.rowId || view.id !== rowScope.viewId || ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout) || (writable && viewIsLocked(view))) throw new Error('The row database is unavailable or locked.');
      const row = await this.api.row(rowScope.viewId, rowScope.rowId);
      const rowDocumentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowScope.rowId || rowDocumentId !== documentId || (row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value)) throw new Error('The row document is unavailable or has changed.');
      const latest = await this.api.view(rowScope.viewId);
      if (latest.id !== rowScope.viewId || ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(latest.layout) || (writable && viewIsLocked(latest))) throw new Error('The row database is unavailable or locked.');
    } else if (view.id !== documentId || view.layout !== ViewLayoutPB.Document || (writable && viewIsLocked(view))) throw new Error('This document is unavailable or locked.');
    await this.assertIdentity(identity, signal);
    if (writable && !writable()) throw new Error('This document is read-only.');
  }
  async start(documentId: string, writable: () => boolean, signal?: AbortSignal, rowScope?: HyperDocumentMediaRowScope) {
    this.check(signal); const identity = await this.api.identity();
    await this.document(documentId, identity, writable, signal, rowScope); return identity;
  }
  async prepareLocal(sourcePath: string, kind: HyperDocumentMediaKind, values: { name: string; caption: string; alt: string }, options: HyperDocumentMediaWriteOptions): Promise<HyperPreparedDocumentMedia> {
    await this.document(options.documentId, options.identity, options.writable, options.signal, options.rowScope);
    const local = options.identity.local;
    const imported = local ? await this.api.importFile(sourcePath, kind) : null;
    const location = imported?.path ?? hyperDocumentMediaUrl(await this.api.upload(options.identity.workspaceId, options.documentId, sourcePath));
    const media: HyperDocumentMediaReference = { id: crypto.randomUUID(), kind, source: local ? 'local' : 'cloud', url: location, name: values.name.trim() || imported?.name || sourcePath.split(/[\\/]/).at(-1) || kind, caption: values.caption, alt: values.alt, uploadedAt: Date.now() };
    const prepared = { media, identity: options.identity };
    try { await this.document(options.documentId, options.identity, options.writable, options.signal, options.rowScope); }
    catch { throw new HyperDocumentMediaPreparedError(prepared); }
    return prepared;
  }
  async prepareNetwork(url: string, kind: HyperDocumentMediaKind, values: { name: string; caption: string; alt: string }, options: HyperDocumentMediaWriteOptions): Promise<HyperPreparedDocumentMedia> {
    const location = hyperDocumentMediaUrl(url);
    await this.document(options.documentId, options.identity, options.writable, options.signal, options.rowScope);
    return { identity: options.identity, media: { id: crypto.randomUUID(), kind, source: 'network', url: location, name: values.name.trim() || new URL(location).pathname.split('/').at(-1) || kind, caption: values.caption, alt: values.alt, uploadedAt: Date.now() } };
  }
  async preview(media: HyperDocumentMediaReference) {
    return media.source === 'local' ? this.api.preview(media.url) : (this.api.previewRemote ?? hyperPreviewCloudAsset)(hyperDocumentMediaUrl(media.url));
  }
  async open(media: HyperDocumentMediaReference, documentId: string, signal?: AbortSignal, expected?: HyperDocumentMediaIdentity, rowScope?: HyperDocumentMediaRowScope) {
    const owner = hyperCaptureDuplicateOwner(), check = () => { this.check(signal); if (owner && !owner.isCurrent()) throw new Error('The media workspace, account or app session changed.'); };
    check(); const identity = expected ?? await this.api.identity();
    await this.document(documentId, identity, undefined, signal, rowScope); check();
    if (media.source === 'local') {
      const error = await this.api.openPath(media.url); if (error) throw new Error(error);
    } else if (media.source === 'network' && !hyperCloudAssetIsProtected(media.url)) await this.api.openExternal(hyperDocumentMediaUrl(media.url));
    else await this.download(media, documentId, signal, identity, rowScope);
  }
  async download(media: HyperDocumentMediaReference, documentId: string, signal?: AbortSignal, expected?: HyperDocumentMediaIdentity, rowScope?: HyperDocumentMediaRowScope) {
    if (media.source === 'local') return this.open(media, documentId, signal, expected, rowScope);
    const owner = hyperCaptureDuplicateOwner(), check = () => { this.check(signal); if (owner && !owner.isCurrent()) throw new Error('The media workspace, account or app session changed.'); };
    check(); const identity = expected ?? await this.api.identity();
    await this.document(documentId, identity, undefined, signal, rowScope); check();
    const target = await this.api.saveFile(media.name.split(/[\\/]/).at(-1)?.replaceAll('\0', '') || media.kind);
    if (!target) return;
    await this.document(documentId, identity, undefined, signal, rowScope); check();
    await this.api.download(hyperDocumentMediaUrl(media.url), target);
  }
}
