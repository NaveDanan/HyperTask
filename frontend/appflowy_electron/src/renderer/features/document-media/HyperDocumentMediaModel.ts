import { clone, create } from '@bufbuild/protobuf';
import { BlockActionPBSchema, BlockActionTypePB, BlockPBSchema, ChildrenPBSchema, DocumentDataPBSchema, type BlockPB, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperChildren, type HyperDocumentChange } from '../document/HyperDocumentModel';

export type HyperDocumentMediaKind = 'image' | 'file';
export interface HyperDocumentMediaReference {
  id: string;
  kind: HyperDocumentMediaKind;
  source: 'local' | 'network' | 'cloud';
  url: string;
  name: string;
  caption: string;
  alt: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  uploadedAt?: number;
}
export interface HyperDocumentMediaAnchor { pageId: string; parentId: string; previousId: string }
export const hyperIsDocumentMedia = (type: string): type is HyperDocumentMediaKind => type === 'image' || type === 'file';
export function hyperDocumentMediaUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS URL without embedded credentials.');
  return url.href;
}
function localPath(value: string) {
  return !value.includes('\0') && (/^\//.test(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]/.test(value));
}
const optionalText = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Unsupported media text. The saved block has been kept.');
  return value;
};

/** Read upstream image_type and url_type enums without rewriting original attributes. */
export function hyperReadDocumentMedia(document: DocumentDataPB, block: BlockPB): HyperDocumentMediaReference {
  if (!hyperIsDocumentMedia(block.ty)) throw new Error('This is not an image or attachment block.');
  const data = hyperBlockData(block), url = data.url;
  if (typeof url !== 'string' || !url || hyperChildren(document, block).length) throw new Error('Unsupported media block. Its saved content has been kept.');
  const rawType = data[block.ty === 'image' ? 'image_type' : 'url_type'];
  if (rawType !== undefined && ![0, 1, 2].includes(rawType as number)) throw new Error('Unsupported media source. The saved block has been kept.');
  // Older imported URL blocks can omit the type. Infer only the absent value.
  const source = rawType === undefined ? (/^https?:/i.test(url) ? 'network' : 'local') : rawType === 0 ? 'local' : (block.ty === 'image' ? rawType === 1 : rawType === 2) ? 'cloud' : 'network';
  if (source === 'local' ? !localPath(url) : !hyperDocumentMediaUrl(url)) throw new Error('Unsupported media location. The saved block has been kept.');
  const size = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000 ? value : undefined;
  return {
    id: block.id, kind: block.ty, source, url,
    name: optionalText(data.name) || url.split(/[\\/]/).at(-1)?.split(/[?#]/)[0] || block.ty,
    caption: optionalText(data.caption), alt: optionalText(data.alt),
    ...(data.align === 'left' || data.align === 'center' || data.align === 'right' ? { align: data.align } : {}),
    ...(size(data.width) ? { width: size(data.width) } : {}), ...(size(data.height) ? { height: size(data.height) } : {}),
    ...(typeof data.uploaded_at === 'number' ? { uploadedAt: data.uploaded_at } : {}),
  };
}
export function hyperDocumentMediaAttributes(media: HyperDocumentMediaReference): Record<string, unknown> {
  return media.kind === 'image' ? {
    url: media.url, image_type: { local: 0, cloud: 1, network: 2 }[media.source],
    ...(media.name ? { name: media.name } : {}), ...(media.caption ? { caption: media.caption } : {}), ...(media.alt ? { alt: media.alt } : {}),
    align: media.align ?? 'center', ...(media.width ? { width: media.width } : {}), ...(media.height ? { height: media.height } : {}),
  } : { url: media.url, url_type: { local: 0, network: 1, cloud: 2 }[media.source], name: media.name, ...(media.uploadedAt !== undefined ? { uploaded_at: media.uploadedAt } : {}) };
}
function connected(document: DocumentDataPB, id: string) {
  const seen = new Set<string>();
  while (id !== document.pageId) {
    if (seen.has(id)) throw new Error('The insertion location contains a cycle.');
    seen.add(id);
    const block = document.blocks[id], parent = block && document.blocks[block.parentId];
    if (!parent || !hyperChildren(document, parent).includes(id)) throw new Error('The insertion location changed. Choose a position again.');
    id = parent.id;
  }
  if (!document.blocks[id] || !document.meta) throw new Error('The document is not ready.');
}
export function hyperCaptureDocumentMediaAnchor(document: DocumentDataPB, activeBlockId?: string): HyperDocumentMediaAnchor {
  connected(document, activeBlockId ?? document.pageId);
  const active = activeBlockId ? document.blocks[activeBlockId] : undefined;
  if (active?.id === document.pageId) throw new Error('Choose a position inside the document.');
  return { pageId: document.pageId, parentId: active?.parentId ?? document.pageId, previousId: active?.id ?? hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '' };
}
export function hyperInsertDocumentMedia(document: DocumentDataPB, anchor: HyperDocumentMediaAnchor | null, media: HyperDocumentMediaReference): HyperDocumentChange {
  if (!anchor || anchor.pageId !== document.pageId || !media.id) throw new Error('The insertion location changed. Choose a position again.');
  connected(document, anchor.parentId);
  const existing = document.blocks[media.id];
  if (existing) {
    connected(document, media.id);
    const saved = hyperReadDocumentMedia(document, existing);
    if (saved.kind !== media.kind || saved.source !== media.source || saved.url !== media.url) throw new Error('The media block identifier is already in use.');
    return { document, actions: [] };
  }
  const siblings = hyperChildren(document, document.blocks[anchor.parentId]);
  const index = anchor.previousId ? siblings.indexOf(anchor.previousId) + 1 : 0;
  if (anchor.previousId && !index) throw new Error('The insertion location changed. Choose a position again.');
  const updated = clone(DocumentDataPBSchema, document);
  const block = create(BlockPBSchema, { id: media.id, ty: media.kind, parentId: anchor.parentId, childrenId: crypto.randomUUID(), data: JSON.stringify(hyperDocumentMediaAttributes(media)) });
  hyperReadDocumentMedia(updated, block);
  updated.blocks[block.id] = block;
  updated.meta!.childrenMap[block.childrenId] = create(ChildrenPBSchema);
  updated.meta!.childrenMap[updated.blocks[anchor.parentId].childrenId] = create(ChildrenPBSchema, { children: [...siblings.slice(0, index), block.id, ...siblings.slice(index)] });
  return { document: updated, actions: [create(BlockActionPBSchema, { action: BlockActionTypePB.Insert, payload: { oneOfBlock: { case: 'block', value: block }, oneOfParentId: { case: 'parentId', value: anchor.parentId }, oneOfPrevId: { case: 'prevId', value: anchor.previousId } } })] };
}
