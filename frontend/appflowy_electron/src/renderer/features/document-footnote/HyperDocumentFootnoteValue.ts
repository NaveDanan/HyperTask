import type { HyperTextRun } from '../document/HyperDocumentModel';

export interface HyperCitationReference extends Record<string, unknown> {
  type: 'doc' | 'url' | 'attachment'; docId?: string; blobId?: string; artifactId?: string; fileName?: string; fileType?: string; url?: string; favicon?: string; title?: string; description?: string;
}
export interface HyperCitationFootnote extends Record<string, unknown> { label: string; reference: HyperCitationReference }
export interface HyperPlainFootnote extends Record<string, unknown> { version: 1; id: string; label: string; text: string }
export type HyperDocumentFootnoteValue = { kind: 'citation'; data: HyperCitationFootnote } | { kind: 'note'; data: HyperPlainFootnote };
export interface HyperDocumentFootnoteRead { value: HyperDocumentFootnoteValue | null; label: string; atomic: boolean; supported: boolean; editable: boolean; key: 'footnote' | 'hyper_footnote' | null; raw: unknown }
export interface HyperDocumentFootnoteDraft { kind: 'note' | 'doc' | 'url' | 'existing'; text: string; docId: string; url: string; title: string; description: string; existingLabel: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const referenceKeys = ['type', 'docId', 'blobId', 'artifactId', 'fileName', 'fileType', 'url', 'favicon', 'title', 'description'];
const validString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
/** Unlike upstream, an unknown payload is kept visible and is never normalized on inspection. */
export function hyperReadDocumentFootnote(run: HyperTextRun): HyperDocumentFootnoteRead | null {
  const attributes = run.attributes ?? {}, keys = (['footnote', 'hyper_footnote'] as const).filter(key => Object.hasOwn(attributes, key) && attributes[key] !== null && attributes[key] !== undefined);
  if (!keys.length) return null;
  const key = keys.length === 1 ? keys[0] : null, raw = key ? attributes[key] : attributes;
  const atomic = typeof run.insert === 'string' && /^ +$/u.test(run.insert);
  const label = record(raw) && typeof raw.label === 'string' ? raw.label : '';
  let value: HyperDocumentFootnoteValue | null = null, known = false;
  if (key === 'footnote' && record(raw) && validString(raw.label) && record(raw.reference)) {
    const reference = raw.reference;
    if (typeof reference.type === 'string' && ['doc', 'url', 'attachment'].includes(reference.type) && Object.entries(reference).every(([name, field]) => name === 'type' || !referenceKeys.includes(name) || typeof field === 'string')) {
      value = { kind: 'citation', data: raw as HyperCitationFootnote };
      known = only(raw, ['label', 'reference']) && only(reference, referenceKeys);
    }
  } else if (key === 'hyper_footnote' && record(raw) && raw.version === 1 && validString(raw.id) && validString(raw.label) && typeof raw.text === 'string') {
    value = { kind: 'note', data: raw as HyperPlainFootnote }; known = only(raw, ['version', 'id', 'label', 'text']);
  }
  const supported = atomic && known;
  return { value, label, atomic, supported, editable: supported && (value?.kind === 'note' || value?.data.reference.type !== 'attachment'), key, raw };
}
export function hyperDocumentFootnoteSignature(read: HyperDocumentFootnoteRead): string {
  if (!read.supported || !read.value) return JSON.stringify(['unsupported', read.key, read.raw]);
  if (read.value.kind === 'note') return JSON.stringify(['note', read.value.data.id, read.value.data.text]);
  const reference = read.value.data.reference;
  return JSON.stringify(['citation', ...referenceKeys.map(key => reference[key] ?? null)]);
}
export function hyperDocumentFootnoteDraft(value: HyperDocumentFootnoteValue | null = null): HyperDocumentFootnoteDraft {
  const base: HyperDocumentFootnoteDraft = { kind: 'note', text: '', docId: '', url: '', title: '', description: '', existingLabel: '' };
  if (value?.kind === 'note') return { ...base, text: value.data.text };
  if (value?.kind === 'citation') { const reference = value.data.reference; return { ...base, kind: reference.type === 'doc' ? 'doc' : 'url', docId: reference.docId ?? '', url: reference.url ?? '', title: reference.title ?? '', description: reference.description ?? '' }; }
  return base;
}
export function hyperDocumentFootnoteUrl(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? value : null; } catch { return null; }
}
export function hyperDocumentFootnoteAttribute(value: HyperDocumentFootnoteValue): Record<string, unknown> {
  const key = value.kind === 'note' ? 'hyper_footnote' : 'footnote';
  const read = hyperReadDocumentFootnote({ insert: ' ', attributes: { [key]: value.data } });
  if (!read?.supported) throw Error('unsupported');
  return { [key]: value.data };
}
/** Renderer seam: logical lengths and serialized attrs remain the original string data. */
export function hyperCreateDocumentFootnoteElements(run: HyperTextRun, fallback = 'Footnote'): HTMLElement[] {
  const read = hyperReadDocumentFootnote(run); if (!read?.atomic || typeof run.insert !== 'string') return [];
  return Array.from(run.insert, insert => {
    const atom = document.createElement('button'); atom.type = 'button'; atom.contentEditable = 'false'; atom.tabIndex = 0;
    atom.dataset.hyperAtomic = JSON.stringify(insert); atom.dataset.hyperAttributes = JSON.stringify(run.attributes ?? {}); atom.dataset.hyperFootnote = '';
    atom.className = 'inline-flex rounded-md bg-muted px-1 align-super text-xs text-primary outline-none focus-visible:ring-1 focus-visible:ring-ring';
    atom.textContent = `[${read.label || '?'}]`; atom.setAttribute('aria-label', `${fallback}${read.label ? ` ${read.label}` : ''}`); atom.setAttribute('aria-haspopup', 'dialog');
    return atom;
  });
}

/** Explicit metadata is accepted only as a string atom; no source DOM or remote content is used. */
export function hyperParseFootnoteHtmlMarker(raw: string): HyperTextRun | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    if (value.version !== 1 || value.insert !== ' ' || !value.attributes || typeof value.attributes !== 'object' || Array.isArray(value.attributes)) return null;
    const run = { insert: ' ', attributes: value.attributes as Record<string, unknown> };
    return hyperReadDocumentFootnote(run)?.atomic ? run : null;
  } catch { return null; }
}
