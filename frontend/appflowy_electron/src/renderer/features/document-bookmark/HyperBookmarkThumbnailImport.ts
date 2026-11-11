import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { DocumentEventUploadFile } from '@/backend/events/flowy-document';
import { UserEventGetAllWorkspace } from '@/backend/events/flowy-user';
import { unwrap } from '@/backend/dispatch';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCloudAssetIsProtected } from '../cloud-assets/HyperCloudAssetPreview';
import { HyperBookmarkThumbnailPreparedError } from './HyperBookmarkThumbnailService';
import type { HyperBookmarkThumbnail } from './HyperBookmarkThumbnailValue';
/** Only embedded, already-reviewed bytes are staged. No source URL or sibling path is ever fetched. */
export async function hyperImportBookmarkThumbnail(dataUrl: string, documentId: string, owner: HyperDocumentOwner, check: <T>(operation: () => Promise<T>) => Promise<T>): Promise<HyperBookmarkThumbnail> {
  const asset = await check(() => window.appflowy.bookmarks.importThumbnail(dataUrl, { actorId: owner.actorId, workspaceId: owner.workspaceId }));
  try {
    const workspaces = unwrap(await check(() => UserEventGetAllWorkspace())).items, workspace = workspaces.find(item => item.workspaceId === owner.workspaceId);
    if (!workspace) throw Error('The import workspace is unavailable.');
    const local = workspace.workspaceType === WorkspaceTypePB.LocalW;
    // UploadFile's document ID namespaces the workspace blob; the fresh import UUID is not a native document mutation.
    const url = local ? asset.path : unwrap(await check(() => DocumentEventUploadFile({ workspaceId: owner.workspaceId, documentId, localFilePath: asset.path }))).url;
    if (!local && !hyperCloudAssetIsProtected(url)) throw Error('The uploaded thumbnail is not a protected workspace asset.');
    return { version: 1, width: asset.width, height: asset.height, media: { id: crypto.randomUUID(), kind: 'image', source: local ? 'local' : 'cloud', url, name: asset.name, alt: '', caption: '' } };
  } catch (error) { throw new HyperBookmarkThumbnailPreparedError(asset, error); }
}
