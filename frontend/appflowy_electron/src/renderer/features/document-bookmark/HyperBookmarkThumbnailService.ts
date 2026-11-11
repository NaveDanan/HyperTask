import type { HyperGeneratedImageAsset } from '@shared/api';
import { HyperDocumentMediaService, type HyperPreparedDocumentMedia } from '../document-media/HyperDocumentMediaService';
import { hyperCloudAssetIsProtected } from '../cloud-assets/HyperCloudAssetPreview';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import type { HyperBookmarkContext } from './HyperDocumentBookmarkStore';
import type { HyperBookmarkThumbnail } from './HyperBookmarkThumbnailValue';
/** Retain the managed snapshot whenever a cloud upload may already have happened. Never retry it automatically. */
export class HyperBookmarkThumbnailPreparedError extends Error {
  constructor(readonly asset: HyperGeneratedImageAsset, cause: unknown, readonly prepared?: HyperPreparedDocumentMedia) { super(`The thumbnail was kept, but its upload or preparation was not confirmed. Copy the card source before closing. ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
}
export async function hyperPrepareBookmarkThumbnail(asset: HyperGeneratedImageAsset, context: HyperBookmarkContext, service = new HyperDocumentMediaService()): Promise<HyperBookmarkThumbnail> {
  const owner = hyperCaptureDuplicateOwner(context.owner), writable = () => !!owner?.isCurrent() && context.editable() && context.session.belongsTo(owner) && context.session.isCurrentOwner();
  let prepared: HyperPreparedDocumentMedia | undefined;
  try {
    if (!writable()) throw Error('The thumbnail owner or page changed.');
    const identity = await service.start(context.session.id, writable, undefined, context.rowScope);
    // Existing routing stores local workspaces in managed storage and uploads self-hosted images.
    prepared = await service.prepareLocal(asset.path, 'image', { name: asset.name, caption: '', alt: '' }, { documentId: context.session.id, identity, writable, rowScope: context.rowScope });
    if (!writable()) throw Error('The thumbnail owner or page changed.');
    if (prepared.media.source === 'cloud' && !hyperCloudAssetIsProtected(prepared.media.url)) throw Error('The uploaded thumbnail is not a protected workspace asset.');
    return { version: 1, media: prepared.media, width: asset.width, height: asset.height };
  } catch (error) { throw new HyperBookmarkThumbnailPreparedError(asset, error, prepared ?? (error as { prepared?: HyperPreparedDocumentMedia })?.prepared); }
}
