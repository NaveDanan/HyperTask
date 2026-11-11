import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperEditText, hyperFormatText, hyperSliceText, hyperTextLength, hyperTextTypes, type HyperDocumentChange, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperSafeUrl } from '../document/HyperDocumentExport';
import { hyperDocumentColorAttribute, hyperDocumentColorCss } from './HyperDocumentColor';

export interface HyperDocumentFormatSelection { documentId: string; id: string; parentId: string; type: string; start: number; end: number; runs: string }
export interface HyperDocumentFormatPatch { href?: string | null; font_color?: string | null; bg_color?: string | null }
const pageMention = (run: HyperTextRun) => run.attributes?.mention !== undefined;
const plainRun = (run: HyperTextRun) => typeof run.insert === 'string' && !pageMention(run) && !Object.hasOwn(run.attributes ?? {}, 'formula');
export function hyperDocumentFormatUrl(value: string): string {
  if (/[\u0000-\u0020\u007f]/.test(value)) throw new Error('Use a complete HTTP, HTTPS or mail link without spaces.');
  const url = hyperSafeUrl(value);
  if (!url) throw new Error('Use a complete HTTP, HTTPS or mail link.');
  return url;
}
function attached(doc: DocumentDataPB, id: string): boolean {
  const seen = new Set<string>();
  while (id !== doc.pageId) {
    if (seen.has(id)) return false;
    seen.add(id); const block = doc.blocks[id], parent = block && doc.blocks[block.parentId];
    if (!parent || !hyperChildren(doc, parent).includes(id)) return false;
    id = parent.id;
  }
  return true;
}
function validBoundary(text: string, index: number) {
  return !(index > 0 && index < text.length && /[\uD800-\uDBFF]/.test(text[index - 1]) && /[\uDC00-\uDFFF]/.test(text[index]));
}
/** A collapsed caret inside an existing link expands to its complete formatted range. */
export function hyperCaptureDocumentFormat(doc: DocumentDataPB, current: { id: string; selection: { start: number; end: number } } | null): HyperDocumentFormatSelection {
  const block = current && doc.blocks[current.id];
  if (!current || !block || !hyperTextTypes.has(block.ty) || !attached(doc, block.id)) throw new Error('Select text in an editable block first.');
  const runs = hyperBlockText(doc, block), length = hyperTextLength(runs);
  let { start, end } = current.selection;
  const text = runs.map(run => typeof run.insert === 'string' ? run.insert : '\uFFFC').join('');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > length || !validBoundary(text, start) || !validBoundary(text, end)) throw new Error('The text selection is no longer valid.');
  if (start === end) {
    let offset = 0;
    const spans = runs.map(run => { const from = offset; offset += typeof run.insert === 'string' ? run.insert.length : 1; return { run, start: from, end: offset }; });
    const index = spans.findIndex(span => plainRun(span.run) && typeof span.run.attributes?.href === 'string' && start >= span.start && start <= span.end);
    if (index >= 0) {
      const href = spans[index].run.attributes!.href;
      let first = index, last = index;
      while (first > 0 && plainRun(spans[first - 1].run) && spans[first - 1].run.attributes?.href === href) first--;
      while (last + 1 < spans.length && plainRun(spans[last + 1].run) && spans[last + 1].run.attributes?.href === href) last++;
      start = spans[first].start; end = spans[last].end;
    }
  }
  if (start === end) throw new Error('Select text to add a link or change its color.');
  return { documentId: doc.pageId, id: block.id, parentId: block.parentId, type: block.ty, start, end, runs: JSON.stringify(runs) };
}
export function hyperDocumentFormatValues(selection: HyperDocumentFormatSelection): HyperDocumentFormatPatch {
  const selected = hyperSliceText(JSON.parse(selection.runs) as HyperTextRun[], selection.start, selection.end);
  const common = (key: keyof HyperDocumentFormatPatch): string | null | undefined => {
    const values = (key === 'href' ? selected.filter(plainRun) : selected).map(run => key === 'href' ? typeof run.attributes?.href === 'string' ? run.attributes.href : null : hyperDocumentColorCss(run.attributes?.[key]));
    return values.length && values.every(value => value === values[0]) ? values[0] : undefined;
  };
  return { href: common('href'), font_color: common('font_color'), bg_color: common('bg_color') };
}
export function hyperApplyDocumentFormat(doc: DocumentDataPB, selection: HyperDocumentFormatSelection, patch: HyperDocumentFormatPatch, editable = true): HyperDocumentChange {
  if (!editable) throw new Error('This document is read-only.');
  const current = hyperCaptureDocumentFormat(doc, { id: selection.id, selection: { start: selection.start, end: selection.end } });
  if (doc.pageId !== selection.documentId || current.runs !== selection.runs || current.parentId !== selection.parentId || current.type !== selection.type) throw new Error('The text changed while formatting. Select it again.');
  let runs = hyperBlockText(doc, doc.blocks[selection.id]);
  for (const key of ['href', 'font_color', 'bg_color'] as const) {
    if (!(key in patch)) continue;
    const input = patch[key];
    if (input === undefined) continue;
    const value = input === null ? null : key === 'href' ? hyperDocumentFormatUrl(input) : hyperDocumentColorAttribute(input);
    if (key === 'href') {
      const selected = hyperSliceText(runs, selection.start, selection.end);
      if (!selected.some(plainRun)) throw new Error('Select ordinary text to add a hyperlink.');
      const formatted = selected.flatMap(run => plainRun(run) ? hyperFormatText([run], 0, hyperTextLength([run]), key, value) : [run]);
      runs = [...hyperSliceText(runs, 0, selection.start), ...formatted, ...hyperSliceText(runs, selection.end)];
    } else runs = hyperFormatText(runs, selection.start, selection.end, key, value);
  }
  return hyperEditText(doc, selection.id, runs);
}
