import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperChildren, hyperDeleteBlock, hyperEditText, hyperInsertBlock, hyperUpdateBlock, type HyperDocumentChange } from '../document/HyperDocumentModel';
import { hyperDocumentSlashMatches, type HyperDocumentSlashTarget } from '../document-slash/HyperDocumentSlashModel';
import { hyperRenderEquationMathML } from './HyperDocumentEquationMathML';

export type HyperEquationTarget = { pageId: string; path: string; blockId: string; formula: string };
export interface HyperEquationInsertion { pageId: string; path: string; parentId: string; previousId: string; slash?: HyperDocumentSlashTarget }
function path(doc: DocumentDataPB, id: string): string {
  const seen = new Set<string>(), chain: unknown[] = [];
  while (true) {
    const block = doc.blocks[id]; if (!block || seen.has(id)) throw new Error('The equation position changed or its document is invalid.'); seen.add(id);
    chain.push([block.id, block.parentId, block.childrenId, block.ty, block.oneOfExternalId, block.oneOfExternalType]);
    if (id === doc.pageId) break;
    const parent = doc.blocks[block.parentId]; if (!parent || !hyperChildren(doc, parent).includes(id)) throw new Error('The equation is no longer attached to this page.'); id = parent.id;
  }
  return JSON.stringify(chain);
}
/** Upstream AppFlowy math_equation is a formula string in a leaf block, without external text. */
export function hyperReadDocumentEquation(doc: DocumentDataPB, id: string): string {
  const block = doc.blocks[id];
  if (!block || block.ty !== 'math_equation' || hyperChildren(doc, block).length || block.oneOfExternalId.case === 'externalId' && block.oneOfExternalId.value || block.oneOfExternalType.case === 'externalType' && block.oneOfExternalType.value) throw new Error('This equation has an unsupported format. Its source was kept.');
  const formula = hyperBlockData(block).formula;
  if (typeof formula !== 'string') throw new Error('This equation has an unsupported formula format. Its data was kept.');
  return formula;
}
export function hyperCaptureDocumentEquation(doc: DocumentDataPB, blockId: string): HyperEquationTarget {
  return { pageId: doc.pageId, path: path(doc, blockId), blockId, formula: hyperReadDocumentEquation(doc, blockId) };
}
export function hyperCaptureEquationInsertion(doc: DocumentDataPB, previousId = '', slash?: HyperDocumentSlashTarget): HyperEquationInsertion {
  const previous = previousId ? doc.blocks[previousId] : undefined;
  if (previousId && !previous) throw new Error('The equation insertion position changed.');
  const parentId = previous?.parentId ?? doc.pageId;
  return { pageId: doc.pageId, path: path(doc, previousId || parentId), parentId, previousId, ...(slash ? { slash } : {}) };
}
export function hyperSaveDocumentEquation(doc: DocumentDataPB, target: HyperEquationTarget | HyperEquationInsertion, formula: string): HyperDocumentChange {
  hyperRenderEquationMathML(formula);
  if (doc.pageId !== target.pageId) throw new Error('The equation document changed.');
  if ('blockId' in target) {
    if (path(doc, target.blockId) !== target.path || hyperReadDocumentEquation(doc, target.blockId) !== target.formula) throw new Error('The equation changed while its editor was open. Reopen it before saving.');
    return { ...hyperUpdateBlock(doc, target.blockId, { formula }), focus: { id: target.blockId, offset: 0 } };
  }
  if (path(doc, target.previousId || target.parentId) !== target.path || target.previousId && doc.blocks[target.previousId].parentId !== target.parentId) throw new Error('The equation insertion position changed.');
  if (target.slash && !hyperDocumentSlashMatches(doc, target.slash)) throw new Error('The slash command changed. Type / again.');
  const inserted = hyperInsertBlock(doc, target.parentId, target.previousId, 'math_equation', { formula });
  if (!target.slash) return inserted;
  const original = doc.blocks[target.slash.blockId];
  const cleanup = hyperChildren(doc, original).length ? hyperEditText(inserted.document, original.id, []) : hyperDeleteBlock(inserted.document, original.id);
  return { document: cleanup.document, actions: [...inserted.actions, ...cleanup.actions], focus: inserted.focus };
}
