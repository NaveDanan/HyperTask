import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperCanEditDocumentText, hyperChildren, hyperEditText, hyperPlainText, hyperSliceText, hyperTextLength, hyperTextTypes, type HyperDocumentChange, type HyperTextRun } from '../document/HyperDocumentModel';
import { HyperInlineMathError, hyperInlineMathConflictingAttributes, hyperInlineMathPlaceholder, hyperInlineMathWithinAtomLimit, hyperReadInlineMath, hyperValidateInlineMathSource, type HyperInlineMathRead } from './HyperInlineMathValue';

interface HyperInlineMathSource {
  pageId: string;
  blockId: string;
  path: string;
  source: string;
  start: number;
  end: number;
}
export interface HyperInlineMathSelection { id: string; selection: { start: number; end: number } }
export interface HyperInlineMathInsertion extends HyperInlineMathSource { kind: 'insert'; formula: string; attributes: Record<string, unknown> }
export interface HyperInlineMathTarget extends HyperInlineMathSource { kind: 'existing'; read: HyperInlineMathRead; editable: boolean }
export type HyperInlineMathAnchor = HyperInlineMathInsertion | HyperInlineMathTarget;

// Core/Yrs may reorder object keys after persistence. Preserve every value but
// permit equivalent JSON key order in a fresh native read.
const snapshot = (value: unknown) => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function path(doc: DocumentDataPB, blockId: string) {
  const seen = new Set<string>(), chain: unknown[] = [];
  let id = blockId;
  while (true) {
    const block = doc.blocks[id];
    if (!block || seen.has(id) || block.ty === 'hyper_canvas') throw new HyperInlineMathError('changed');
    seen.add(id); chain.push([block.id, block.parentId, block.childrenId, block.ty, block.oneOfExternalId, block.oneOfExternalType]);
    if (id === doc.pageId) return snapshot(chain);
    const parent = doc.blocks[block.parentId];
    if (!parent || hyperChildren(doc, parent).filter(child => child === id).length !== 1) throw new HyperInlineMathError('changed');
    id = parent.id;
  }
}
function blockSource(doc: DocumentDataPB, blockId: string) {
  const block = doc.blocks[blockId];
  if (!block || !hyperTextTypes.has(block.ty)) throw new HyperInlineMathError('unsupported');
  const runs = hyperBlockText(doc, block);
  const supportedRuns = runs.every(run => { const read = hyperReadInlineMath(run); return !read || read.atomic && Object.keys(run).every(key => key === 'insert' || key === 'attributes'); });
  return { runs, source: snapshot(runs), path: path(doc, blockId), editable: block.ty !== 'code' && supportedRuns && hyperInlineMathWithinAtomLimit(runs) && hyperCanEditDocumentText(doc, block) };
}
function boundary(runs: HyperTextRun[], offset: number) {
  const text = hyperPlainText(runs);
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length || offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset])) throw new HyperInlineMathError('invalidPosition');
}
function selectedAttributes(runs: HyperTextRun[], start: number, end: number) {
  const selected = hyperSliceText(runs, start, end);
  if (!selected.length) return {};
  let signature: string | undefined;
  for (const run of selected) {
    if (typeof run.insert !== 'string' || Object.keys(run).some(key => key !== 'insert' && key !== 'attributes') || run.attributes && (typeof run.attributes !== 'object' || Array.isArray(run.attributes)) || Object.hasOwn(run.attributes ?? {}, 'formula') || hyperInlineMathConflictingAttributes(run.attributes ?? {})) throw new HyperInlineMathError('unsupported');
    const current = snapshot(run.attributes ?? {});
    if (signature !== undefined && signature !== current) throw new HyperInlineMathError('mixedAttributes');
    signature = current;
  }
  return structuredClone(selected[0].attributes ?? {});
}
function currentSource(doc: DocumentDataPB, target: HyperInlineMathAnchor) {
  if (doc.pageId !== target.pageId) throw new HyperInlineMathError('changed');
  const current = blockSource(doc, target.blockId);
  if (current.path !== target.path || current.source !== target.source) throw new HyperInlineMathError('changed');
  boundary(current.runs, target.start); boundary(current.runs, target.end);
  return current;
}
function existingRun(runs: HyperTextRun[], offset: number) {
  let at = 0;
  for (const run of runs) {
    const length = typeof run.insert === 'string' ? run.insert.length : 1;
    if (offset >= at && offset < at + length) return run;
    at += length;
  }
  throw new HyperInlineMathError('changed');
}
export function hyperCaptureInlineMathInsertion(doc: DocumentDataPB, selection: HyperInlineMathSelection): HyperInlineMathInsertion {
  const current = blockSource(doc, selection.id), { start, end } = selection.selection;
  boundary(current.runs, start); boundary(current.runs, end);
  if (end < start) throw new HyperInlineMathError('invalidPosition');
  if (!current.editable) throw new HyperInlineMathError('unsupported');
  const attributes = selectedAttributes(current.runs, start, end), formula = hyperPlainText(hyperSliceText(current.runs, start, end));
  hyperValidateInlineMathSource(formula);
  return { kind: 'insert', pageId: doc.pageId, blockId: selection.id, path: current.path, source: current.source, start, end, formula, attributes };
}
/** Offset selects exactly one atom, including one position of a merged '$$' run. */
export function hyperCaptureInlineMath(doc: DocumentDataPB, blockId: string, offset: number): HyperInlineMathTarget {
  const current = blockSource(doc, blockId); boundary(current.runs, offset);
  const read = hyperReadInlineMath(existingRun(current.runs, offset));
  if (!read) throw new HyperInlineMathError('unsupported');
  return { kind: 'existing', pageId: doc.pageId, blockId, path: current.path, source: current.source, start: offset, end: offset + 1, read: structuredClone(read), editable: current.editable && read.supported };
}
function replace(doc: DocumentDataPB, target: HyperInlineMathAnchor, runs: HyperTextRun[], inserted: HyperTextRun[]) {
  const next = [...hyperSliceText(runs, 0, target.start), ...inserted, ...hyperSliceText(runs, target.end)];
  if (!hyperInlineMathWithinAtomLimit(next)) throw new HyperInlineMathError('atomLimit');
  const changed = hyperEditText(doc, target.blockId, next);
  return { ...changed, focus: { id: target.blockId, offset: target.start + hyperTextLength(inserted) } };
}
export function hyperSaveInlineMath(doc: DocumentDataPB, target: HyperInlineMathAnchor, formula: string): HyperDocumentChange {
  const current = currentSource(doc, target);
  if (!current.editable) throw new HyperInlineMathError('unsupported');
  hyperValidateInlineMathSource(formula);
  let attributes: Record<string, unknown>;
  if (target.kind === 'existing') {
    const run = existingRun(current.runs, target.start), read = hyperReadInlineMath(run);
    if (!target.editable || !read?.supported) throw new HyperInlineMathError('unsupported');
    if (read.formula === formula) return { document: doc, actions: [], focus: { id: target.blockId, offset: target.start + 1 } };
    attributes = { ...run.attributes, formula };
  } else attributes = { ...selectedAttributes(current.runs, target.start, target.end), formula };
  return replace(doc, target, current.runs, [{ insert: hyperInlineMathPlaceholder, attributes }]);
}
export function hyperUnwrapInlineMath(doc: DocumentDataPB, target: HyperInlineMathTarget): HyperDocumentChange {
  const current = currentSource(doc, target), run = existingRun(current.runs, target.start), read = hyperReadInlineMath(run);
  if (!current.editable || !target.editable || !read?.supported || read.formula === null) throw new HyperInlineMathError('unsupported');
  const attributes = { ...run.attributes }; delete attributes.formula;
  return replace(doc, target, current.runs, read.formula.length ? [{ insert: read.formula, ...(Object.keys(attributes).length ? { attributes } : {}) }] : []);
}
