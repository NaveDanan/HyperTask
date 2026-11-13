import type { HyperTextRun } from '../document/HyperDocumentModel';

export interface HyperMarkdownFootnoteDefinition { start: number; end: number; body: string; ranges: Array<[number, number]>; attributes: Record<string, unknown> }
export interface HyperMarkdownFootnotes { definitions: Map<string, HyperMarkdownFootnoteDefinition>; used: Set<string> }
const unescape = (value: string) => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** AFFiNE encodes these two reference fields once. Already-absolute URLs stay literal. */
function decodeReference(value: unknown): unknown {
  if (typeof value !== 'string' || /^[A-Za-z][\w+.-]*:/.test(value)) return value;
  try { return decodeURIComponent(value); } catch { return value; }
}
/** Scan only ordinary Markdown. Fences and display-equation bodies are opaque. */
export function hyperCollectMarkdownFootnotes(lines: string[]): HyperMarkdownFootnotes {
  const definitions = new Map<string, HyperMarkdownFootnoteDefinition>(), conflicts = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim(), fence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) { for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++); continue; }
    if (trimmed === '$$') { for (i++; i < lines.length && lines[i].trim() !== '$$'; i++); continue; }
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) continue;
    const match = /^ {0,3}\[\^((?:\\.|[^\]\\\r\n])+)\]:[ \t]?(.*)$/.exec(lines[i]);
    if (!match) continue;
    const start = i, label = unescape(match[1]), body = [match[2]];
    while (i + 1 < lines.length && (/^(?: {4}|\t)/.test(lines[i + 1]) || !lines[i + 1].trim() && /^(?: {4}|\t)/.test(lines[i + 2] ?? ''))) {
      i++; body.push(lines[i].replace(/^(?: {4}|\t)/, ''));
    }
    const text = body.join('\n'); let attributes: Record<string, unknown>;
    try {
      const reference: unknown = JSON.parse(text);
      if (!record(reference) || typeof reference.type !== 'string') throw Error('text');
      attributes = { footnote: { label, reference: { ...reference, ...(Object.hasOwn(reference, 'url') ? { url: decodeReference(reference.url) } : {}), ...(Object.hasOwn(reference, 'favicon') ? { favicon: decodeReference(reference.favicon) } : {}) } } };
    } catch { attributes = { hyper_footnote: { version: 1, id: crypto.randomUUID(), label, text: unescape(text) } }; }
    const prior = definitions.get(label);
    if (prior && prior.body === text) prior.ranges.push([start, i]);
    else if (prior) { conflicts.add(label); definitions.delete(label); }
    else if (!conflicts.has(label)) definitions.set(label, { start, end: i, body: text, ranges: [[start, i]], attributes });
  }
  return { definitions, used: new Set() };
}
export function hyperMarkdownFootnoteReference(label: string, context?: HyperMarkdownFootnotes): HyperTextRun | null {
  const definition = context?.definitions.get(label); if (!definition) return null;
  context!.used.add(label); return { insert: ' ', attributes: definition.attributes };
}
export function hyperMarkdownFootnoteLines(lines: string[], context: HyperMarkdownFootnotes, onlyUsed = false): string[] {
  const result = [...lines];
  for (const [label, definition] of context.definitions) if (!onlyUsed || context.used.has(label)) for (const [start, end] of definition.ranges) for (let i = start; i <= end; i++) result[i] = '';
  return result;
}
