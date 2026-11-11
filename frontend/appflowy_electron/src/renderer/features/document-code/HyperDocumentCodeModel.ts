import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperCanEditDocumentText, hyperChildren, hyperEditText, hyperSliceText, hyperUpdateBlock, type HyperDocumentChange, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperCodeLanguageSnapshot, hyperValidateCodeLanguage, type HyperCodeLanguage } from './HyperDocumentCodeValue';
export interface HyperCodeTarget { pageId: string; blockId: string; path: string; runs: string; signature: string; language: ReturnType<typeof hyperCodeLanguageSnapshot> }
export interface HyperCodeSelection { start: number; end: number }
function path(doc: DocumentDataPB, id: string) {
  const result: unknown[] = [], seen = new Set<string>();
  while (true) {
    const block = doc.blocks[id]; if (!block || seen.has(id)) throw Error('The code block position is invalid.'); seen.add(id);
    result.push([block.id, block.parentId, block.childrenId, block.ty, block.oneOfExternalId, block.oneOfExternalType]);
    if (id === doc.pageId) break;
    const parent = doc.blocks[block.parentId]; if (!parent || hyperChildren(doc, parent).filter(child => child === id).length !== 1) throw Error('The code block is no longer attached to this page.'); id = parent.id;
  }
  return JSON.stringify(result);
}
export function hyperCodeSource(doc: DocumentDataPB, id: string): string {
  const block = doc.blocks[id]; if (!block || block.ty !== 'code') throw Error('This code block changed.');
  const runs = hyperBlockText(doc, block); if (runs.some(run => typeof run.insert !== 'string')) throw Error('This code block contains embedded data. Its source was kept.');
  return runs.map(run => run.insert as string).join('');
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value; }
function signature(runs: HyperTextRun[]) {
  const normalized: HyperTextRun[] = [];
  for (const run of runs) {
    const attributes = stable(run.attributes ?? {}) as Record<string, unknown>, previous = normalized.at(-1);
    if (typeof run.insert === 'string' && run.insert === '') continue;
    if (previous && typeof previous.insert === 'string' && typeof run.insert === 'string' && JSON.stringify(previous.attributes) === JSON.stringify(attributes)) previous.insert += run.insert;
    else normalized.push({ insert: run.insert, attributes });
  }
  return JSON.stringify(stable(normalized));
}
export function hyperCaptureDocumentCode(doc: DocumentDataPB, blockId: string): HyperCodeTarget {
  const block = doc.blocks[blockId]; if (!block || block.ty !== 'code') throw Error('This code block changed.');
  return { pageId: doc.pageId, blockId, path: path(doc, blockId), runs: JSON.stringify(hyperBlockText(doc, block)), signature: signature(hyperBlockText(doc, block)), language: hyperCodeLanguageSnapshot(block) };
}
export function hyperRequireCodeTarget(doc: DocumentDataPB, target: HyperCodeTarget) {
  const fresh = hyperCaptureDocumentCode(doc, target.blockId);
  if (fresh.pageId !== target.pageId || fresh.path !== target.path || fresh.signature !== target.signature || JSON.stringify(fresh.language) !== JSON.stringify(target.language)) throw Error('The code block changed. Reopen its language picker or select the text again.');
}
export function hyperSaveCodeLanguage(doc: DocumentDataPB, target: HyperCodeTarget, language: HyperCodeLanguage): HyperDocumentChange {
  hyperRequireCodeTarget(doc, target); hyperValidateCodeLanguage(language);
  return hyperUpdateBlock(doc, target.blockId, { language });
}
function boundary(text: string, value: number) { return Number.isInteger(value) && value >= 0 && value <= text.length && !(value > 0 && value < text.length && /[\uD800-\uDBFF]/u.test(text[value - 1]) && /[\uDC00-\uDFFF]/u.test(text[value])); }
/** One local text transaction, with the same scoped session and live permissions as ordinary typing. */
export function hyperIndentDocumentCode(doc: DocumentDataPB, target: HyperCodeTarget, selection: HyperCodeSelection, outdent: boolean): HyperDocumentChange & { selection: HyperCodeSelection } {
  hyperRequireCodeTarget(doc, target);
  const source = hyperCodeSource(doc, target.blockId), block = doc.blocks[target.blockId], runs = hyperBlockText(doc, block);
  if (!hyperCanEditDocumentText(doc, block) || !boundary(source, selection.start) || !boundary(source, selection.end) || selection.end < selection.start) throw Error('The code selection is no longer valid.');
  const edits: Array<{ start: number; removed: number; inserted: string }> = [];
  if (!outdent && selection.start === selection.end) edits.push({ start: selection.start, removed: 0, inserted: '  ' });
  else {
    const first = selection.start === 0 ? 0 : source.lastIndexOf('\n', selection.start - 1) + 1;
    const last = selection.end > selection.start && source[selection.end - 1] === '\n' ? selection.end - 1 : selection.end;
    let line = first;
    while (line <= last) {
      const removed = outdent ? source[line] === '\t' ? 1 : Math.min(2, /^ */u.exec(source.slice(line))![0].length) : 0;
      if (!outdent || removed) edits.push({ start: line, removed, inserted: outdent ? '' : '  ' });
      const next = source.indexOf('\n', line); if (next < 0) break; line = next + 1;
    }
  }
  let updated: HyperTextRun[] = runs;
  for (const edit of edits.toReversed()) updated = [...hyperSliceText(updated, 0, edit.start), ...(edit.inserted ? [{ insert: edit.inserted }] : []), ...hyperSliceText(updated, edit.start + edit.removed)];
  const offset = (value: number) => value + edits.reduce((sum, edit) => sum + (value >= edit.start ? edit.inserted.length - Math.min(edit.removed, value - edit.start) : 0), 0);
  return { ...(edits.length ? hyperEditText(doc, target.blockId, updated) : { document: doc, actions: [] }), selection: { start: offset(selection.start), end: offset(selection.end) } };
}
