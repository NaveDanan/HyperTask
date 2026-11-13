import type { BlockPB, DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperBlockData, hyperChildren, hyperInsertBlock } from '../document/HyperDocumentModel';

export type HyperDocumentDatabaseType = 'grid' | 'board' | 'calendar';
export interface HyperDocumentDatabaseReference {
  type: HyperDocumentDatabaseType;
  parentId: string;
  viewId: string;
  compact: boolean;
}
export interface HyperDocumentDatabaseAnchor {
  pageId: string;
  parentId: string;
  previousId: string;
}
export const hyperIsDocumentDatabase = (type: string): type is HyperDocumentDatabaseType => ['grid', 'board', 'calendar'].includes(type);
export function hyperDocumentDatabaseType(layout: ViewLayoutPB): HyperDocumentDatabaseType {
  if (layout === ViewLayoutPB.Grid) return 'grid';
  if (layout === ViewLayoutPB.Board) return 'board';
  if (layout === ViewLayoutPB.Calendar) return 'calendar';
  throw new Error('This page is not a supported database view.');
}
const validId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0;

/** Flutter's DatabaseBlockKeys. Reading never rewrites unknown attributes or missing views. */
export function hyperReadDocumentDatabase(document: DocumentDataPB, block: BlockPB): HyperDocumentDatabaseReference {
  if (!hyperIsDocumentDatabase(block.ty)) throw new Error('This block is not a supported inline database.');
  const data = hyperBlockData(block);
  if (!validId(data.parent_id) || !validId(data.view_id) || hyperChildren(document, block).length) throw new Error('The inline database reference is invalid. Its saved block has been kept.');
  if (data.enable_compact_mode !== undefined && typeof data.enable_compact_mode !== 'boolean') throw new Error('The inline database settings are unsupported. Its saved block has been kept.');
  return { type: block.ty, parentId: data.parent_id, viewId: data.view_id, compact: data.enable_compact_mode === true };
}

function connected(document: DocumentDataPB, id: string) {
  const seen = new Set<string>();
  while (id !== document.pageId) {
    if (seen.has(id)) throw new Error('The insertion location contains a cycle.');
    seen.add(id);
    const block = document.blocks[id], parent = block && document.blocks[block.parentId];
    if (!parent || !hyperChildren(document, parent).includes(id)) throw new Error('The insertion location changed. Choose a position in the document again.');
    id = parent.id;
  }
  if (!document.blocks[id] || !document.meta) throw new Error('The document is not ready for insertion.');
}
export function hyperCaptureDocumentDatabaseAnchor(document: DocumentDataPB, activeBlockId?: string): HyperDocumentDatabaseAnchor {
  connected(document, activeBlockId ?? document.pageId);
  const active = activeBlockId ? document.blocks[activeBlockId] : undefined;
  if (active?.id === document.pageId) throw new Error('Choose a position inside the document.');
  return {
    pageId: document.pageId,
    parentId: active?.parentId ?? document.pageId,
    previousId: active?.id ?? hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '',
  };
}
export function hyperInsertDocumentDatabase(document: DocumentDataPB, anchor: HyperDocumentDatabaseAnchor | null, reference: HyperDocumentDatabaseReference) {
  if (!anchor || anchor.pageId !== document.pageId) throw new Error('The insertion location changed. Choose a position in the document again.');
  connected(document, anchor.parentId);
  const parent = document.blocks[anchor.parentId];
  if (anchor.previousId && !hyperChildren(document, parent).includes(anchor.previousId)) throw new Error('The insertion location changed. Choose a position in the document again.');
  if (!hyperIsDocumentDatabase(reference.type) || !validId(reference.parentId) || !validId(reference.viewId)) throw new Error('The inline database reference is invalid.');
  return hyperInsertBlock(document, anchor.parentId, anchor.previousId, reference.type, {
    parent_id: reference.parentId,
    view_id: reference.viewId,
    ...(reference.compact ? { enable_compact_mode: true } : {}),
  });
}
export function hyperReferenceDocumentDatabase(view: ViewPB): HyperDocumentDatabaseReference {
  if (!validId(view.id) || !validId(view.parentViewId)) throw new Error('The database is missing its parent page.');
  return { type: hyperDocumentDatabaseType(view.layout), parentId: view.parentViewId, viewId: view.id, compact: false };
}
