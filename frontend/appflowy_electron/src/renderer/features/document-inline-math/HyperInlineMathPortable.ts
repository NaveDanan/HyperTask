import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperReadInlineMath } from './HyperInlineMathValue';

export const HYPER_INLINE_MATH_MARKER = 'data-hyper-inline-math-source';
export const HYPER_INLINE_MATH_MARKER_BYTES = 64 * 1024;
const failure = () => new Error('This inline equation cannot be exported without losing its source. Copy its source before exporting.');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function boundedJson(value: unknown) {
  const stack = [{ value, depth: 0 }]; let count = 0, units = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 4096 || depth > 32) throw failure();
    if (Array.isArray(value) && value.length > 4096) throw failure();
    if (typeof value === 'string') units += value.length;
    if (units > HYPER_INLINE_MATH_MARKER_BYTES) throw failure();
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) continue;
    if (Array.isArray(value) || record(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      for (const key of Object.keys(value)) { units += key.length; if (units > HYPER_INLINE_MATH_MARKER_BYTES) throw failure(); }
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
    } else throw failure();
  }
}
export function hyperInlineMathPortableMarker(run: HyperTextRun) {
  const read = hyperReadInlineMath(run);
  if (!read?.supported || read.formula === null || read.formula.includes('\0') || Array.from(read.formula).some(char => char.length === 1 && /[\uD800-\uDFFF]/u.test(char))) throw failure();
  const data = { version: 1, insert: '$', attributes: run.attributes };
  boundedJson(data);
  const source = JSON.stringify(data);
  if (source.length > HYPER_INLINE_MATH_MARKER_BYTES || new TextEncoder().encode(source).length > HYPER_INLINE_MATH_MARKER_BYTES) throw failure();
  // A strict ASCII component avoids both HTML and Markdown punctuation in metadata.
  return encodeURIComponent(source).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function hyperParseInlineMathMarker(marker: string): HyperTextRun | null {
  try {
    if (marker.length > HYPER_INLINE_MATH_MARKER_BYTES * 3 || !/^(?:[A-Za-z0-9_.~-]|%[\dA-Fa-f]{2})+$/u.test(marker)) return null;
    const source = decodeURIComponent(marker);
    if (new TextEncoder().encode(source).length > HYPER_INLINE_MATH_MARKER_BYTES) return null;
    const data: unknown = JSON.parse(source); boundedJson(data);
    if (!record(data) || Object.keys(data).length !== 3 || data.version !== 1 || data.insert !== '$' || !record(data.attributes)) return null;
    const run = { insert: '$', attributes: data.attributes };
    return hyperInlineMathPortableMarker(run) ? run : null;
  } catch { return null; }
}
/** Keep Markdown spans on one physical line. Entities display the exact source
 * without letting its backticks, links or footnote-looking text become syntax. */
export function hyperInlineMathReadableSource(formula: string) {
  return escapeHtml(formula).replace(/[\r\n\t\u2028\u2029`[\]()_*~\\$|]/gu, char => `&#${char.charCodeAt(0)};`);
}
export const hyperInlineMathMarkdownPattern = '<span data-hyper-inline-math-source="(?:[A-Za-z0-9_.~%-])+">[^<\\r\\n]*<\\/span>';
export function hyperParseInlineMathMarkdown(span: string): HyperTextRun | null {
  const match = /^<span data-hyper-inline-math-source="([A-Za-z0-9_.~%-]+)">([^<\r\n]*)<\/span>$/u.exec(span);
  if (!match) return null;
  const run = hyperParseInlineMathMarker(match[1]), read = run && hyperReadInlineMath(run);
  return read && read.formula !== null && match[2] === hyperInlineMathReadableSource(read.formula) ? run : null;
}
