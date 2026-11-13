import type { BlockPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperReadBookmarkThumbnail, type HyperBookmarkThumbnail } from './HyperBookmarkThumbnailValue';

export interface HyperBookmarkFields { url: string; title: string; description: string; site: string; caption: string; mode: 'card' | 'youtube'; thumbnail?: HyperBookmarkThumbnail | null }
export const hyperBookmarkTypes = new Set(['link_preview', 'link_embed', 'video']);
export const hyperBookmarkLimits = { url: 4096, title: 512, description: 4000, site: 256, caption: 2000 } as const;
export function hyperBookmarkUrl(raw: string): string {
  if (typeof raw !== 'string' || raw.length > hyperBookmarkLimits.url || /[\u0000-\u001f\u007f]/u.test(raw)) throw Error('Enter a valid HTTP or HTTPS link without embedded credentials.');
  let url: URL; try { url = new URL(raw.trim()); } catch { throw Error('Enter a complete HTTP or HTTPS link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('Enter a valid HTTP or HTTPS link without embedded credentials.');
  return url.href;
}
export function hyperBookmarkYoutubeId(raw: string): string | null {
  let url: URL; try { url = new URL(hyperBookmarkUrl(raw)); } catch { return null; }
  if (url.port) return null;
  const host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be' && parts.length === 1) id = parts[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v')!;
    else if (parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
}
export function hyperValidateBookmarkFields(value: HyperBookmarkFields): HyperBookmarkFields {
  hyperBookmarkUrl(value.url);
  for (const key of Object.keys(hyperBookmarkLimits) as Array<keyof typeof hyperBookmarkLimits>) if (typeof value[key] !== 'string' || value[key].length > hyperBookmarkLimits[key]) throw Error(`The link card ${key} is too long or has an unsupported format.`);
  if (!['card', 'youtube'].includes(value.mode)) throw Error('Choose Card or YouTube.');
  if (value.mode === 'youtube' && !hyperBookmarkYoutubeId(value.url)) throw Error('YouTube mode requires a supported YouTube video link.');
  hyperReadBookmarkThumbnail(value.thumbnail);
  return { ...value, url: value.url.trim() };
}
export function hyperReadBookmarkValue(block: Pick<BlockPB, 'ty' | 'data'>): { data: Record<string, unknown>; fields: HyperBookmarkFields } {
  if (!hyperBookmarkTypes.has(block.ty)) throw Error('This block is not a link card.');
  const data: unknown = JSON.parse(block.data || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('This link card has an unsupported data format. Its source was kept.');
  const root = data as Record<string, unknown>, raw = root.hyper_bookmark;
  if (typeof root.url !== 'string' || root.preview_type !== undefined && root.preview_type !== null && (typeof root.preview_type !== 'string' || !['', 'embed'].includes(root.preview_type))) throw Error('This link card has an unsupported source format. Its data was kept.');
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as Record<string, unknown>).version !== 1)) throw Error('This link card uses an unsupported metadata version. Its data was kept.');
  const meta = (raw ?? {}) as Record<string, unknown>;
  const fields: HyperBookmarkFields = { url: root.url, title: '', description: '', site: '', caption: '', mode: 'card' };
  for (const key of ['title', 'description', 'site', 'caption'] as const) {
    if (meta[key] !== undefined && (typeof meta[key] !== 'string' || meta[key].length > hyperBookmarkLimits[key])) throw Error('This link card has unsupported metadata. Its data was kept.');
    fields[key] = typeof meta[key] === 'string' ? meta[key] : '';
  }
  if (meta.mode !== undefined && meta.mode !== 'card' && meta.mode !== 'youtube') throw Error('This link card has an unsupported display mode. Its data was kept.');
  fields.mode = meta.mode === 'youtube' ? 'youtube' : 'card';
  if (Object.hasOwn(meta, 'thumbnail')) fields.thumbnail = hyperReadBookmarkThumbnail(meta.thumbnail);
  return { data: root, fields };
}
/** Metadata remains inert and bounded; no source nodes or remote resources enter the live page. */
export function hyperParseBookmarkMetadata(html: string, sourceUrl: string, ownerDocument: Document = document): Pick<HyperBookmarkFields, 'title' | 'description' | 'site'> {
  if (html.length > 2 * 1024 * 1024 || html.includes('\0')) throw Error('The link metadata response is too large or invalid.');
  const url = new URL(hyperBookmarkUrl(sourceUrl)), template = ownerDocument.createElement('template'); template.innerHTML = html;
  if (template.content.querySelectorAll('*').length > 30_000) throw Error('The link metadata response is too complex.');
  const content = (selectors: string[], fallback = '') => selectors.map(selector => template.content.querySelector(selector)?.getAttribute('content')).find(value => value?.trim()) || fallback;
  const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim().slice(0, max);
  return {
    title: clean(content(['meta[property="og:title"]', 'meta[name="twitter:title"]'], template.content.querySelector('title')?.textContent || ''), hyperBookmarkLimits.title),
    description: clean(content(['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']), hyperBookmarkLimits.description),
    site: clean(content(['meta[property="og:site_name"]'], url.hostname), hyperBookmarkLimits.site),
  };
}
export function hyperParseBookmarkThumbnailCandidate(html: string, sourceUrl: string, ownerDocument: Document = document): string {
  if (html.length > 2 * 1024 * 1024 || html.includes('\0')) throw Error('The link metadata response is too large or invalid.');
  const template = ownerDocument.createElement('template'); template.innerHTML = html;
  if (template.content.querySelectorAll('*').length > 30_000) throw Error('The link metadata response is too complex.');
  for (const selector of ['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[property="twitter:image"]']) {
    const value = template.content.querySelector(selector)?.getAttribute('content');
    if (value) { try { return hyperBookmarkUrl(new URL(value.trim(), hyperBookmarkUrl(sourceUrl)).href); } catch { /* Unsupported candidates remain unfetched. */ } }
  }
  return '';
}
export function hyperBookmarkHtmlMarker(block: BlockPB, omitThumbnail = true): string {
  hyperReadBookmarkValue(block);
  const data = JSON.parse(block.data || '{}');
  if (omitThumbnail && data.hyper_bookmark) delete data.hyper_bookmark.thumbnail;
  const value = JSON.stringify({ version: 1, type: block.ty, data });
  if (value.length > 64 * 1024) throw Error('This link card contains too much metadata for portable HTML. Copy its source instead.');
  return value;
}
export function hyperParseBookmarkHtmlMarker(raw: string): { type: string; data: Record<string, unknown> } | null {
  try {
    if (raw.length > 64 * 1024) return null;
    const envelope = JSON.parse(raw);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.version !== 1 || Object.keys(envelope).some(key => !['version', 'type', 'data'].includes(key))) return null;
    const block = { ty: envelope.type, data: JSON.stringify(envelope.data) };
    const read = hyperReadBookmarkValue(block); hyperValidateBookmarkFields(read.fields);
    // Portable cards carry image bytes in a separate inert img, never native storage references.
    if (read.fields.thumbnail !== undefined) return null;
    return { type: envelope.type, data: read.data };
  } catch { return null; }
}
