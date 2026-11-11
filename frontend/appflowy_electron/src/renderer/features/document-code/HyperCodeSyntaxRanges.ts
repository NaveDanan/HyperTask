import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperCodeSyntaxBoundary, hyperCodeSyntaxLimits, type HyperCodeSyntaxKind, type HyperCodeSyntaxRange } from './HyperCodeSyntaxTypes';
const kinds: Record<string, HyperCodeSyntaxKind> = { keyword: 'keyword', literal: 'keyword', type: 'keyword', built_in: 'keyword', string: 'string', regexp: 'string', number: 'number', comment: 'comment', doctag: 'comment', meta: 'comment', title: 'title', function: 'title', attr: 'title', attribute: 'title', 'selector-tag': 'title', 'selector-class': 'title', 'selector-id': 'title' };
/** Parse the engine's public output into inert ranges. Only text and class-only spans are accepted. */
export function hyperCodeSyntaxRanges(html: string, source: string, ownerDocument: Document): HyperCodeSyntaxRange[] {
  if (html.length > hyperCodeSyntaxLimits.html) return [];
  // HTML parsing normalizes raw CR/CRLF, even inside an inert template. An
  // entity preserves the original UTF16 units without touching editable text.
  const inert = html.replaceAll('\r', '&#13;'); if (inert.length > hyperCodeSyntaxLimits.html) return [];
  const template = ownerDocument.createElement('template'); template.innerHTML = inert;
  if (template.content.textContent !== source) return [];
  const ranges: HyperCodeSyntaxRange[] = []; let offset = 0, nodes = 0;
  const walk = (node: Node, inherited?: HyperCodeSyntaxKind, depth = 0) => {
    if (++nodes > hyperCodeSyntaxLimits.nodes || depth > 64) throw Error('Syntax decoration exceeds its DOM budget.');
    if (node.nodeType === 3) { const end = offset + (node.textContent?.length ?? 0); if (inherited && end > offset) { if (!hyperCodeSyntaxBoundary(source, offset) || !hyperCodeSyntaxBoundary(source, end)) throw Error('Invalid syntax UTF16 boundary.'); const previous = ranges.at(-1); if (previous?.end === offset && previous.kind === inherited) previous.end = end; else ranges.push({ start: offset, end, kind: inherited }); if (ranges.length > hyperCodeSyntaxLimits.ranges) throw Error('Too many syntax ranges.'); } offset = end; return; }
    if (node.nodeType !== 1) throw Error('Unsupported syntax node.');
    const element = node as Element; if (element.localName !== 'span' || [...element.attributes].some(attribute => attribute.name !== 'class')) throw Error('Unsupported syntax element.');
    const names = [...element.classList]; if (names.some(name => name.length > 128 || !/^(?:hljs-[a-zA-Z0-9_.-]+|[a-zA-Z][a-zA-Z0-9.-]*_+)$/u.test(name))) throw Error('Unsupported syntax scope.');
    let kind = inherited; for (const name of names) if (name.startsWith('hljs-') && Object.hasOwn(kinds, name.slice(5))) kind = kinds[name.slice(5)];
    for (const child of element.childNodes) walk(child, kind, depth + 1);
  };
  try { for (const child of template.content.childNodes) walk(child); return offset === source.length ? ranges : []; } catch { return []; }
}
/** Authored colors/links stay visible; token paint does not replace rich-text marks. */
export function hyperCodeSyntaxRespectMarks(ranges: HyperCodeSyntaxRange[], runs: HyperTextRun[]): HyperCodeSyntaxRange[] {
  if (ranges.length > hyperCodeSyntaxLimits.ranges || runs.length > hyperCodeSyntaxLimits.ranges) return [];
  const protectedRuns: Array<{ start: number; end: number }> = []; let offset = 0;
  for (const run of runs) { if (typeof run.insert !== 'string') return []; const end = offset + run.insert.length; if (run.attributes?.font_color || run.attributes?.bg_color || run.attributes?.href || run.attributes?.mention || run.attributes?.footnote) protectedRuns.push({ start: offset, end }); offset = end; }
  const result: HyperCodeSyntaxRange[] = []; let protectedAt = 0;
  for (const range of ranges) { let start = range.start; while (protectedAt < protectedRuns.length && protectedRuns[protectedAt].end <= start) protectedAt++; for (let at = protectedAt; at < protectedRuns.length; at++) { const protectedRun = protectedRuns[at]; if (protectedRun.start >= range.end) break; if (protectedRun.start > start) result.push({ ...range, start, end: protectedRun.start }); start = Math.max(start, protectedRun.end); if (start >= range.end) break; } if (start < range.end) result.push({ ...range, start }); if (result.length > hyperCodeSyntaxLimits.ranges) return []; }
  return result;
}
/** Only display-relevant mark presence enters the paint revision; unknown authored data stays untouched. */
export function hyperCodeSyntaxMarkSignature(runs: HyperTextRun[]): string {
  if (runs.length > hyperCodeSyntaxLimits.ranges) return '';
  return JSON.stringify(runs.map(run => [typeof run.insert === 'string' ? run.insert.length : -1, !!run.attributes?.font_color, !!run.attributes?.bg_color, !!run.attributes?.href, !!run.attributes?.mention, !!run.attributes?.footnote]));
}
