import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperChildren } from '../document/HyperDocumentModel';
import { hyperCloudAssetIsProtected, hyperPreviewCloudAsset } from '../cloud-assets/HyperCloudAssetPreview';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperBookmarkTypes, hyperReadBookmarkValue } from '../document-bookmark/HyperDocumentBookmarkValue';

/** Read only reachable image blocks. Private attachment/video URLs have separate transports. */
export function hyperDocumentProtectedImages(document: DocumentDataPB): string[] {
  const sources = new Set<string>(), visited = new Set<string>(), stack = [document.pageId];
  while (stack.length) {
    const id = stack.pop()!; if (visited.has(id)) throw Error('Document contains a cycle or repeated block'); visited.add(id);
    const block = document.blocks[id]; if (!block) throw Error(`Document contains a missing block: ${id}`);
    if (block.ty === 'hyper_canvas') continue;
    const url = block.ty === 'image' ? hyperBlockData(block).url : undefined;
    if (hyperBookmarkTypes.has(block.ty)) { const thumbnail = hyperReadBookmarkValue(block).fields.thumbnail; if (thumbnail?.media.source === 'cloud') { if (!hyperCloudAssetIsProtected(thumbnail.media.url)) throw Error('The protected bookmark thumbnail is unavailable for export. Its source was kept.'); sources.add(thumbnail.media.url); } }
    if (typeof url === 'string') {
      try { if (hyperCloudAssetIsProtected(new URL(url).href)) sources.add(url); } catch { /* Generic export validation handles invalid URLs. */ }
    }
    stack.push(...hyperChildren(document, block).toReversed());
  }
  return [...sources];
}
/** Captured before async reads, including owner switches away and back to the same actor. */
export function hyperDocumentExportScope(document: DocumentDataPB, current?: () => boolean) {
  const owner = hyperCaptureDuplicateOwner(), snapshot = JSON.stringify(document);
  return { owner, check() {
    if (owner && !owner.isCurrent() || current && !current()) throw Error('The export workspace, account or app session changed. Start the export again.');
    if (snapshot !== JSON.stringify(document)) throw Error('The exported document changed. Start the export again.');
  } };
}
export async function hyperPrepareProtectedDocumentImages(document: DocumentDataPB, size: number, check: () => void, preview: (source: string) => Promise<string> = hyperPreviewCloudAsset): Promise<{ mediaUrls: Record<string, string>; size: number }> {
  const mediaUrls: Record<string, string> = {}, resolved = new Map<string, string>();
  for (const source of hyperDocumentProtectedImages(document)) {
    const canonical = new URL(source).href, known = resolved.get(canonical);
    if (known) { mediaUrls[source] = known; continue; }
    check(); const value = await preview(canonical); check();
    if (typeof value !== 'string' || value.length > 45 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw Error('The protected image could not be embedded in this export.');
    size += value.length;
    if (size > 48 * 1024 * 1024) throw Error('The images are too large for a portable export. Export fewer images.');
    resolved.set(canonical, value); mediaUrls[source] = value;
  }
  return { mediaUrls, size };
}
