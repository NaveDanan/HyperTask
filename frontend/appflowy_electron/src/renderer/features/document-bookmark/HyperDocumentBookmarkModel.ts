import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperChildren, hyperDeleteBlock, hyperEditText, hyperInsertBlock, hyperUpdateBlock, type HyperDocumentChange } from '../document/HyperDocumentModel';
import { hyperDocumentSlashMatches, type HyperDocumentSlashTarget } from '../document-slash/HyperDocumentSlashModel';
import { hyperReadBookmarkValue, hyperValidateBookmarkFields, type HyperBookmarkFields } from './HyperDocumentBookmarkValue';
export interface HyperBookmarkInsertion { pageId: string; path: string; parentId: string; previousId: string; slash?: HyperDocumentSlashTarget }
export interface HyperBookmarkTarget { pageId: string; path: string; blockId: string; source: string; fields: HyperBookmarkFields }
function path(doc: DocumentDataPB, id: string) {
  const seen = new Set<string>(), result: unknown[] = [];
  while (true) {
    const block = doc.blocks[id]; if (!block || seen.has(id)) throw Error('The link card position is invalid.'); seen.add(id);
    result.push([block.id, block.parentId, block.childrenId, block.ty, block.oneOfExternalId, block.oneOfExternalType]);
    if (id === doc.pageId) break;
    const parent = doc.blocks[block.parentId]; if (!parent || hyperChildren(doc, parent).filter(child => child === id).length !== 1) throw Error('The link card is no longer attached to this page.'); id = parent.id;
  }
  return JSON.stringify(result);
}
export function hyperReadDocumentBookmark(doc: DocumentDataPB, id: string) {
  const block = doc.blocks[id];
  if (!block || hyperChildren(doc, block).length || block.oneOfExternalId.case === 'externalId' && block.oneOfExternalId.value || block.oneOfExternalType.case === 'externalType' && block.oneOfExternalType.value) throw Error('This link card has an unsupported structure. Its source was kept.');
  return hyperReadBookmarkValue(block);
}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;
const source = (doc: DocumentDataPB, id: string) => { const read = hyperReadDocumentBookmark(doc, id); return JSON.stringify(stable([read.fields, read.data.preview_type])); };
export function hyperCaptureDocumentBookmark(doc: DocumentDataPB, blockId: string): HyperBookmarkTarget { return { pageId: doc.pageId, path: path(doc, blockId), blockId, source: source(doc, blockId), fields: hyperReadDocumentBookmark(doc, blockId).fields }; }
export function hyperCaptureBookmarkInsertion(doc: DocumentDataPB, previousId = '', slash?: HyperDocumentSlashTarget): HyperBookmarkInsertion {
  const previous = previousId ? doc.blocks[previousId] : undefined; if (previousId && !previous) throw Error('The link card insertion position changed.');
  const parentId = previous?.parentId ?? doc.pageId;
  return { pageId: doc.pageId, path: path(doc, previousId || parentId), parentId, previousId, ...(slash ? { slash } : {}) };
}
export function hyperRequireBookmarkTarget(doc: DocumentDataPB, target: HyperBookmarkTarget | HyperBookmarkInsertion) {
  if (target.pageId !== doc.pageId) throw Error('The link card document changed.');
  if ('blockId' in target) {
    if (path(doc, target.blockId) !== target.path || source(doc, target.blockId) !== target.source) throw Error('The link card changed while its editor was open. Reopen it before saving.');
  } else {
    if (path(doc, target.previousId || target.parentId) !== target.path) throw Error('The link card insertion position changed.');
    if (target.slash && !hyperDocumentSlashMatches(doc, target.slash)) throw Error('The slash command changed. Type / again.');
  }
}
export function hyperSaveDocumentBookmark(doc: DocumentDataPB, target: HyperBookmarkTarget | HyperBookmarkInsertion, input: HyperBookmarkFields): HyperDocumentChange {
  const fields = hyperValidateBookmarkFields(input); hyperRequireBookmarkTarget(doc, target);
  if ('blockId' in target) {
    const { data } = hyperReadDocumentBookmark(doc, target.blockId);
    return { ...hyperUpdateBlock(doc, target.blockId, { url: fields.url, ...(fields.mode === 'youtube' ? { preview_type: 'embed' } : {}), hyper_bookmark: { ...(data.hyper_bookmark as object ?? {}), version: 1, ...Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'url')) } }), focus: { id: target.blockId, offset: 0 } };
  }
  const { url, ...metadata } = fields, inserted = hyperInsertBlock(doc, target.parentId, target.previousId, 'link_preview', { url, ...(fields.mode === 'youtube' ? { preview_type: 'embed' } : {}), hyper_bookmark: { version: 1, ...metadata } });
  if (!target.slash) return inserted;
  const original = doc.blocks[target.slash.blockId], cleanup = hyperChildren(doc, original).length ? hyperEditText(inserted.document, original.id, []) : hyperDeleteBlock(inserted.document, original.id);
  return { document: cleanup.document, actions: [...inserted.actions, ...cleanup.actions], focus: inserted.focus };
}
