import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperDocumentColorCss } from './HyperDocumentColor';

export const HYPER_MARKDOWN_TEXT_MARKER = 'data-hyper-text-source';
export const HYPER_MARKDOWN_TEXT_SOURCE_BYTES = 64 * 1024;
export const HYPER_MARKDOWN_TEXT_OUTPUT_BYTES = 8 * 1024 * 1024;
export interface HyperMarkdownTextBudget { runs: number; bytes: number }
const unsupported = () => new Error('This formatted text cannot be exported without losing its source. Copy its source before exporting.');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const reserved = (attributes: Record<string, unknown>) => ['formula', 'mention', 'footnote', 'hyper_footnote'].some(key => Object.hasOwn(attributes, key));
function safeHref(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw unsupported();
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'mailto:', 'appflowy-flutter:'].includes(url.protocol) || url.username || url.password) throw unsupported();
    return url.href.replace(/[|`\\]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { throw unsupported(); }
}
function nakedCode(run: HyperTextRun | undefined) {
  if (!run || typeof run.insert !== 'string' || !run.insert.length) return false;
  const attributes = run.attributes ?? {};
  let linked = false; try { linked = !!safeHref(attributes.href); } catch { /* An unsafe link cannot separate code fences. */ }
  return !reserved(attributes) && !!attributes.code && !attributes.bold && !attributes.italic && !attributes.strikethrough && !linked;
}
/** Ordinary representable Markdown keeps its existing output. Only confirmed
 * whitespace/line-boundary and adjoining code-fence cases need source markup. */
export function hyperMarkdownStyledTextRequired(run: HyperTextRun, previous?: HyperTextRun, next?: HyperTextRun): boolean {
  if (typeof run.insert !== 'string') return false;
  const attributes = run.attributes ?? {};
  if (reserved(attributes)) return false;
  const formatted = ['bold', 'italic', 'strikethrough', 'underline', 'code', 'href', 'font_color', 'bg_color'].some(key => !!attributes[key]);
  return formatted && (/^\s|\s$/u.test(run.insert) || /[\r\n\u2028\u2029]/u.test(run.insert))
    || nakedCode(run) && (nakedCode(previous) || nakedCode(next));
}
function bounded(value: unknown) {
  const stack = [{ value, depth: 0 }]; let nodes = 0, units = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 4096 || depth > 32) throw unsupported();
    if (typeof value === 'string') units += value.length;
    if (units > HYPER_MARKDOWN_TEXT_SOURCE_BYTES) throw unsupported();
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) continue;
    if (!Array.isArray(value) && (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw unsupported();
    if (Array.isArray(value) && value.length > 4096) throw unsupported();
    for (const key of Object.keys(value)) {
      units += key.length;
      if (units > HYPER_MARKDOWN_TEXT_SOURCE_BYTES || stack.length + nodes >= 4096) throw unsupported();
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
}
function valid(run: HyperTextRun) {
  if (typeof run.insert !== 'string' || !run.insert || run.insert.length > HYPER_MARKDOWN_TEXT_SOURCE_BYTES || run.insert.includes('\0') || !record(run.attributes) || reserved(run.attributes) || Object.keys(run).some(key => key !== 'insert' && key !== 'attributes')) throw unsupported();
  for (const char of run.insert) if (char.length === 1 && /[\uD800-\uDFFF]/u.test(char)) throw unsupported();
  safeHref(run.attributes.href);
  bounded({ version: 1, insert: run.insert, attributes: run.attributes });
}
function marker(run: HyperTextRun) {
  valid(run);
  const value = JSON.stringify({ version: 1, insert: run.insert, attributes: run.attributes });
  if (value.length > HYPER_MARKDOWN_TEXT_SOURCE_BYTES || new TextEncoder().encode(value).length > HYPER_MARKDOWN_TEXT_SOURCE_BYTES) throw unsupported();
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function hyperParseMarkdownTextMarker(source: string): HyperTextRun | null {
  try {
    if (source.length > HYPER_MARKDOWN_TEXT_SOURCE_BYTES * 3 || !/^(?:[A-Za-z0-9_.~-]|%[\dA-Fa-f]{2})+$/u.test(source)) return null;
    const decoded = decodeURIComponent(source);
    if (decoded.length > HYPER_MARKDOWN_TEXT_SOURCE_BYTES || new TextEncoder().encode(decoded).length > HYPER_MARKDOWN_TEXT_SOURCE_BYTES) return null;
    const value: unknown = JSON.parse(decoded);
    if (!record(value) || Object.keys(value).length !== 3 || value.version !== 1 || typeof value.insert !== 'string' || !record(value.attributes)) return null;
    const run = { insert: value.insert, attributes: value.attributes }; marker(run); return run;
  } catch { return null; }
}
function semanticBody(run: HyperTextRun) {
  const attributes = run.attributes!, href = safeHref(attributes.href);
  let body = escapeHtml(run.insert as string).replace(/[\s`[\]()_*~\\$|]/gu, char => `&#${char.charCodeAt(0)};`);
  if (attributes.code) body = `<code>${body}</code>`;
  if (attributes.bold) body = `<strong>${body}</strong>`;
  if (attributes.italic) body = `<em>${body}</em>`;
  if (attributes.strikethrough) body = `<s>${body}</s>`;
  if (attributes.underline) body = `<u>${body}</u>`;
  if (href) body = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${body}</a>`;
  return body;
}
function span(run: HyperTextRun) {
  const source = marker(run), foreground = hyperDocumentColorCss(run.attributes!.font_color), background = hyperDocumentColorCss(run.attributes!.bg_color);
  const style = ['white-space:pre-wrap', foreground && `color:${foreground}`, background && `background-color:${background}`].filter(Boolean).join(';');
  return `<span ${HYPER_MARKDOWN_TEXT_MARKER}="${source}" style="${style}">${semanticBody(run)}</span>`;
}
export function hyperExportMarkdownStyledText(run: HyperTextRun, budget: HyperMarkdownTextBudget = { runs: 0, bytes: 0 }): string {
  if (budget.runs >= 2048) throw new Error('This page has too many formatted source spans for one export. Split it into smaller pages.');
  const output = span(run), bytes = new TextEncoder().encode(output).length;
  if (bytes > HYPER_MARKDOWN_TEXT_OUTPUT_BYTES - budget.bytes) throw new Error('The formatted text is too large for one portable export. Split the page before exporting.');
  budget.runs++; budget.bytes += bytes; return output;
}
const opening = String.raw`(?:<(?:strong|em|s|u|code)>|<a href="[^"<>\r\n]*" rel="noopener noreferrer">)`;
const closing = String.raw`(?:<\/(?:strong|em|s|u|code|a)>)`;
export const hyperMarkdownStyledTextPattern = String.raw`<span data-hyper-text-source="[A-Za-z0-9_.~%-]+" style="[^"<>\r\n]*">${opening}{0,6}[^<\r\n]*${closing}{0,6}<\/span>`;
/** Canonical known markup only. This never parses or inserts general HTML. */
export function hyperParseMarkdownStyledSpan(source: string): HyperTextRun | null {
  const match = /^<span data-hyper-text-source="([A-Za-z0-9_.~%-]+)" style="[^"<>\r\n]*">/.exec(source);
  if (!match) return null;
  const run = hyperParseMarkdownTextMarker(match[1]);
  return run && span(run) === source ? run : null;
}
