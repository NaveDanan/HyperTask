import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperDeleteBlock, hyperMoveBlock, hyperTextTypes, type HyperDocumentChange } from '../document/HyperDocumentModel';

export type HyperBlockPlacement = 'before' | 'after' | 'inside';
export type HyperBlockCommand = 'up' | 'down' | 'indent' | 'outdent' | 'delete';
export interface HyperBlockCapture { documentId: string; blockId: string; path: string; subtree: string }
// Same child-capable text blocks used by upstream's drag-to-reorder handler.
export const hyperBlockChildTypes = new Set(['paragraph', 'bulleted_list', 'numbered_list', 'quote', 'todo_list', 'toggle_list']);
const movable = new Set([...hyperTextTypes, 'divider', 'simple_table', 'simple_columns', 'image', 'file', 'link_preview', 'link_embed', 'video', 'grid', 'board', 'calendar']);
const structural = new Set(['simple_table_row', 'simple_table_cell', 'simple_column', 'simple_columns']);
function path(doc: DocumentDataPB, id: string) {
  const parents: Array<{ id: string; type: string; parent: string; children: string[] }> = [], visited = new Set<string>();
  while (id !== doc.pageId) {
    if (visited.has(id)) throw new Error('The document contains a cycle.');
    visited.add(id); const block = doc.blocks[id], parent = block && doc.blocks[block.parentId];
    if (!block || !parent) throw new Error('This block is no longer attached to the page.');
    const siblings = hyperChildren(doc, parent);
    if (siblings.indexOf(id) < 0 || siblings.indexOf(id) !== siblings.lastIndexOf(id)) throw new Error('This block is no longer uniquely attached to the page.');
    parents.push({ id: parent.id, type: parent.ty, parent: parent.parentId, children: [...hyperChildren(doc, parent)] });
    id = parent.id;
  }
  if (!doc.blocks[doc.pageId] || doc.blocks[doc.pageId].ty !== 'page') throw new Error('The document root is invalid.');
  return parents;
}
export function hyperCanControlDocumentBlock(doc: DocumentDataPB, id: string): boolean {
  const block = doc.blocks[id];
  if (!block || id === doc.pageId || !movable.has(block.ty)) return false;
  try {
    const parents = path(doc, id), parent = parents[0];
    return !!parent && (parent.id === doc.pageId || hyperBlockChildTypes.has(parent.type)) && !parents.some(parent => structural.has(parent.type) || parent.type === 'hyper_canvas' || parent.type.startsWith('hyper_canvas_'));
  } catch { return false; }
}
export function hyperCaptureDocumentBlock(doc: DocumentDataPB, blockId: string): HyperBlockCapture {
  if (!hyperCanControlDocumentBlock(doc, blockId)) throw new Error('This block cannot be moved or deleted here.');
  const visited = new Set<string>(), blocks: unknown[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) throw new Error('The block contains a cycle or repeated child.');
    visited.add(id); const block = doc.blocks[id];
    if (!block) throw new Error('The block contains missing content.');
    const children = hyperChildren(doc, block);
    blocks.push([block, children, block.oneOfExternalId.case === 'externalId' ? doc.meta?.textMap[block.oneOfExternalId.value] : null]);
    for (const childId of children) {
      if (doc.blocks[childId]?.parentId !== id) throw new Error('The block contains an invalid child.');
      visit(childId);
    }
  };
  visit(blockId);
  return { documentId: doc.pageId, blockId, path: JSON.stringify(path(doc, blockId)), subtree: JSON.stringify(blocks) };
}
function requireCapture(doc: DocumentDataPB, capture: HyperBlockCapture) {
  const current = hyperCaptureDocumentBlock(doc, capture.blockId);
  if (doc.pageId !== capture.documentId || current.path !== capture.path || current.subtree !== capture.subtree) throw new Error('The block changed. Open its controls or start dragging again.');
}
function destination(doc: DocumentDataPB, sourceId: string, targetId: string, placement: HyperBlockPlacement) {
  if (!['before', 'after', 'inside'].includes(placement)) throw new Error('Invalid block placement.');
  if (sourceId === targetId) throw new Error('Choose a different target block.');
  const target = doc.blocks[targetId];
  if (!target || !hyperCanControlDocumentBlock(doc, targetId)) throw new Error('This target cannot accept that block.');
  const parentId = placement === 'inside' ? targetId : target.parentId, parent = doc.blocks[parentId];
  if (!parent || parentId !== doc.pageId && !hyperBlockChildTypes.has(parent.ty)) throw new Error('This target cannot contain child blocks.');
  const ancestors = path(doc, parentId);
  if (parentId === sourceId || ancestors.some(parent => parent.id === sourceId)) throw new Error('A block cannot move into its own subtree.');
  const siblings = hyperChildren(doc, parent).filter(id => id !== sourceId);
  if (placement === 'inside') return { parentId, previousId: siblings.at(-1) ?? '' };
  const index = siblings.indexOf(targetId);
  if (index < 0) throw new Error('The target is no longer attached.');
  return { parentId, previousId: placement === 'before' ? siblings[index - 1] ?? '' : targetId };
}
export function hyperCanDropDocumentBlock(doc: DocumentDataPB, sourceId: string, targetId: string, placement: HyperBlockPlacement): boolean {
  try { if (!hyperCanControlDocumentBlock(doc, sourceId)) return false; destination(doc, sourceId, targetId, placement); return true; } catch { return false; }
}
export function hyperMoveDocumentBlock(doc: DocumentDataPB, source: HyperBlockCapture, target: HyperBlockCapture, placement: HyperBlockPlacement, editable = true): HyperDocumentChange {
  if (!editable) throw new Error('This document is read-only.');
  requireCapture(doc, source); requireCapture(doc, target);
  const next = destination(doc, source.blockId, target.blockId, placement);
  return hyperMoveBlock(doc, source.blockId, next.parentId, next.previousId);
}
export function hyperDocumentBlockCommand(doc: DocumentDataPB, source: HyperBlockCapture, command: HyperBlockCommand, editable = true): HyperDocumentChange {
  if (!editable) throw new Error('This document is read-only.');
  requireCapture(doc, source);
  const block = doc.blocks[source.blockId], parent = doc.blocks[block.parentId], siblings = hyperChildren(doc, parent), index = siblings.indexOf(block.id);
  if (command === 'delete') {
    const result = hyperDeleteBlock(doc, block.id);
    const candidates = [siblings[index - 1], siblings[index + 1], parent.id].filter(Boolean);
    for (const id of candidates) {
      const seen = new Set<string>(), pending = [id];
      for (let index = 0; index < pending.length; index++) {
        const next = pending[index], item = result.document.blocks[next];
        if (!item || seen.has(next)) continue;
        seen.add(next);
        if (hyperTextTypes.has(item.ty)) { result.focus = { id: next, offset: 0 }; return result; }
        pending.push(...hyperChildren(result.document, item));
      }
    }
    return result;
  }
  const targetId = command === 'up' || command === 'indent' ? siblings[index - 1] : command === 'down' ? siblings[index + 1] : parent.id;
  if (!targetId || command === 'outdent' && parent.id === doc.pageId) throw new Error('That move is unavailable here.');
  const target = hyperCaptureDocumentBlock(doc, targetId), placement = command === 'up' ? 'before' : command === 'indent' ? 'inside' : 'after';
  return hyperMoveDocumentBlock(doc, source, target, placement, editable);
}
export function hyperAvailableDocumentBlockCommands(doc: DocumentDataPB, source: HyperBlockCapture): HyperBlockCommand[] {
  try {
    requireCapture(doc, source);
    const block = doc.blocks[source.blockId], parent = doc.blocks[block.parentId], siblings = hyperChildren(doc, parent), index = siblings.indexOf(block.id);
    const result: HyperBlockCommand[] = [];
    if (siblings[index - 1] && hyperCanDropDocumentBlock(doc, block.id, siblings[index - 1], 'before')) result.push('up');
    if (siblings[index + 1] && hyperCanDropDocumentBlock(doc, block.id, siblings[index + 1], 'after')) result.push('down');
    if (siblings[index - 1] && hyperCanDropDocumentBlock(doc, block.id, siblings[index - 1], 'inside')) result.push('indent');
    if (parent.id !== doc.pageId && hyperCanDropDocumentBlock(doc, block.id, parent.id, 'after')) result.push('outdent');
    result.push('delete'); return result;
  } catch { return []; }
}
export function hyperDocumentBlockLabel(doc: DocumentDataPB, id: string): string {
  const block = doc.blocks[id];
  if (!block) return id;
  try { return hyperBlockText(doc, block).flatMap(run => typeof run.insert === 'string' ? [run.insert] : []).join('').trim().slice(0, 60) || block.ty; } catch { return block.ty; }
}
