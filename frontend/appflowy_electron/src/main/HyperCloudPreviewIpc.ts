import { fromJson, toBinary } from '@bufbuild/protobuf';
import { DownloadFilePBSchema } from '../shared/protobuf/flowy-document/entities_pb';
import type { CoreProcess } from './core/process';
import type { HyperCloudPreviews } from './HyperCloudPreviews';

/** Strict JSON decoding intentionally fails closed with an older generated descriptor.
 * An acknowledgement-only DownloadFile must never become a successful private preview. */
export function createHyperCloudPreviewDownload(core: Pick<CoreProcess, 'request'>) {
  return async (url: string, localFilePath: string): Promise<void> => {
    let payload: Uint8Array;
    try { payload = toBinary(DownloadFilePBSchema, fromJson(DownloadFilePBSchema, { url, localFilePath, waitForCompletion: true }, { ignoreUnknownFields: false })); }
    catch { throw new Error('The native image download protocol is unavailable. Restart after updating the app.'); }
    const result = await core.request('DownloadFile', payload);
    // A native error payload may contain storage paths or provider credentials.
    if (result.status !== 0) throw new Error('The protected image download failed.');
  };
}

export async function hyperCloudPreviewIpc(previews: Pick<HyperCloudPreviews, 'previewUrl'>, url: unknown, owner: unknown): Promise<string> {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)
    || Object.keys(owner).some(key => key !== 'actorId' && key !== 'workspaceId')
    || !('actorId' in owner) || typeof owner.actorId !== 'string' || !owner.actorId || owner.actorId.length > 256 || owner.actorId.trim() !== owner.actorId
    || !('workspaceId' in owner) || typeof owner.workspaceId !== 'string' || !owner.workspaceId || owner.workspaceId.length > 256 || owner.workspaceId.trim() !== owner.workspaceId
    || /[\u0000-\u001f\u007f]/u.test(owner.actorId + owner.workspaceId)) throw new Error('A captured account and workspace are required for protected image previews.');
  if (typeof url !== 'string') throw new Error('A protected image address is required.');
  try { return await previews.previewUrl(url, { actorId: owner.actorId, workspaceId: owner.workspaceId }); }
  catch { throw new Error('The protected image preview could not be loaded in the original workspace.'); }
}
