import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperChildren, hyperInsertBlock, hyperTextTypes, hyperUpdateBlock, type HyperDocumentChange } from '../document/HyperDocumentModel';

export type HyperDocumentColumnCount = 2 | 3 | 4;
export interface HyperDocumentColumn { id: string; ratio: number }
export interface HyperDocumentColumnsLayout { id: string; columns: HyperDocumentColumn[]; supported: boolean; error: string | null }
export interface HyperDocumentColumnsCapture { pageId: string; columnsId: string; signature: string }
export interface HyperDocumentColumnsInsertion { pageId: string; parentId: string; previousId: string; signature: string }
const MIN_RATIO = 0.1;
const invalid = () => new Error('This column layout cannot be edited safely. Its stored content is preserved.');

function path(doc: DocumentDataPB, id: string): unknown[] {
  const root = doc.blocks[doc.pageId];
  if (!root || root.ty !== 'page' || !doc.meta || root.parentId) throw new Error('The document root is invalid.');
  const visited = new Set<string>(), result: unknown[] = [];
  while (id !== doc.pageId) {
    if (visited.has(id)) throw invalid();
    visited.add(id);
    const block = doc.blocks[id], parent = block && doc.blocks[block.parentId];
    if (!parent) throw invalid();
    const siblings = hyperChildren(doc, parent);
    if (siblings.indexOf(id) < 0 || siblings.indexOf(id) !== siblings.lastIndexOf(id)) throw invalid();
    result.push([id, block.ty, block.parentId, siblings]); id = parent.id;
  }
  return result;
}
function version(data: Record<string, unknown>) {
  if (data.version !== undefined && data.version !== 1) throw invalid();
}

/** Existing AppFlowy columns have no version marker. Missing ratios are display
 * defaults only; reading a document never migrates or rewrites its layout. */
export function hyperReadDocumentColumns(doc: DocumentDataPB, columnsId: string): HyperDocumentColumnsLayout {
  const block = doc.blocks[columnsId], ids = block ? hyperChildren(doc, block) : [];
  const fallback = ids.length ? 1 / ids.length : 1;
  const columns = ids.map(id => {
    try {
      const ratio = hyperBlockData(doc.blocks[id]).ratio;
      return { id, ratio: typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : fallback };
    } catch { return { id, ratio: fallback }; }
  });
  try {
    if (block?.ty !== 'simple_columns' || !ids.length || ids.length > 64 || new Set(ids).size !== ids.length) throw invalid();
    path(doc, columnsId); version(hyperBlockData(block));
    for (const id of ids) {
      const column = doc.blocks[id];
      if (column?.ty !== 'simple_column' || column.parentId !== columnsId || !doc.meta?.childrenMap[column.childrenId]) throw invalid();
      const data = hyperBlockData(column); version(data);
      if (data.ratio !== undefined && data.ratio !== null && (typeof data.ratio !== 'number' || !Number.isFinite(data.ratio) || data.ratio <= 0 || data.ratio > 1)) throw invalid();
      const children = hyperChildren(doc, column);
      if (!children.length || new Set(children).size !== children.length || children.some(child => !doc.blocks[child] || doc.blocks[child].parentId !== id)) throw invalid();
    }
    if (Math.abs(columns.reduce((total, column) => total + column.ratio, 0) - 1) > 1e-6) throw invalid();
    return { id: columnsId, columns, supported: true, error: null };
  } catch { return { id: columnsId, columns, supported: false, error: invalid().message }; }
}

function insertion(doc: DocumentDataPB, parentId: string, previousId: string): string {
  const topology = path(doc, parentId), parent = doc.blocks[parentId];
  if (!parent || parentId !== doc.pageId && !hyperTextTypes.has(parent.ty) && parent.ty !== 'simple_column' || parent?.ty === 'code') throw new Error('Columns cannot be inserted in this block.');
  if (parent.ty === 'simple_column' && !hyperReadDocumentColumns(doc, parent.parentId).supported) throw invalid();
  const children = hyperChildren(doc, parent);
  if (!doc.meta?.childrenMap[parent.childrenId] || new Set(children).size !== children.length || children.some(id => !doc.blocks[id] || doc.blocks[id].parentId !== parentId)) throw invalid();
  if (previousId && (doc.blocks[previousId]?.parentId !== parentId || !children.includes(previousId))) throw new Error('The column insertion position changed.');
  return JSON.stringify([topology, parent.id, parent.ty, parent.parentId, children, previousId]);
}
export function hyperCaptureDocumentColumnsInsertion(doc: DocumentDataPB, parentId: string, previousId: string): HyperDocumentColumnsInsertion {
  return { pageId: doc.pageId, parentId, previousId, signature: insertion(doc, parentId, previousId) };
}
export function hyperDocumentColumnsInsertionMatches(doc: DocumentDataPB, target: HyperDocumentColumnsInsertion): boolean {
  try { return doc.pageId === target.pageId && insertion(doc, target.parentId, target.previousId) === target.signature; } catch { return false; }
}
export function hyperInsertDocumentColumns(doc: DocumentDataPB, parentId: string, previousId: string, count: HyperDocumentColumnCount, editable = true): HyperDocumentChange {
  if (!editable) throw new Error('This document is read-only.');
  if (![2, 3, 4].includes(count)) throw new Error('Choose two, three or four columns.');
  insertion(doc, parentId, previousId);
  let change = hyperInsertBlock(doc, parentId, previousId, 'simple_columns');
  const columnsId = change.focus!.id;
  let previous = '', focus: HyperDocumentChange['focus'];
  for (let index = 0; index < count; index++) {
    const column = hyperInsertBlock(change.document, columnsId, previous, 'simple_column', { ratio: 1 / count });
    previous = column.focus!.id;
    const paragraph = hyperInsertBlock(column.document, previous, '', 'paragraph');
    focus ??= paragraph.focus;
    change = { document: paragraph.document, actions: [...change.actions, ...column.actions, ...paragraph.actions] };
  }
  return { ...change, focus };
}

export function hyperCaptureDocumentColumns(doc: DocumentDataPB, columnsId: string): HyperDocumentColumnsCapture {
  const layout = hyperReadDocumentColumns(doc, columnsId);
  if (!layout.supported) throw invalid();
  return { pageId: doc.pageId, columnsId, signature: JSON.stringify([path(doc, columnsId), layout.columns.map(column => [column.id, hyperBlockData(doc.blocks[column.id]).ratio ?? null])]) };
}
export function hyperResizeDocumentColumns(doc: DocumentDataPB, target: HyperDocumentColumnsCapture, leftIndex: number, nextLeftRatio: number, editable = true): HyperDocumentChange {
  if (!editable) throw new Error('This document is read-only.');
  const current = hyperCaptureDocumentColumns(doc, target.columnsId);
  if (target.pageId !== doc.pageId || current.signature !== target.signature) throw new Error('The column layout changed. Focus its width control again.');
  const layout = hyperReadDocumentColumns(doc, target.columnsId), left = layout.columns[leftIndex], right = layout.columns[leftIndex + 1];
  if (!Number.isInteger(leftIndex) || !left || !right || !Number.isFinite(nextLeftRatio)) throw new Error('Choose a valid column boundary and width.');
  const nextRight = left.ratio + right.ratio - nextLeftRatio;
  if (nextLeftRatio < MIN_RATIO - 1e-9 || nextRight < MIN_RATIO - 1e-9 || nextLeftRatio > 1 || nextRight > 1) throw new Error('Each adjacent column needs at least 10% width.');
  if (Math.abs(left.ratio - nextLeftRatio) < 1e-9) return { document: doc, actions: [] };
  const changed = hyperUpdateBlock(doc, left.id, { ratio: nextLeftRatio });
  const next = hyperUpdateBlock(changed.document, right.id, { ratio: nextRight });
  return { document: next.document, actions: [...changed.actions, ...next.actions] };
}
