import type { HyperDocumentMediaReference } from '../document-media/HyperDocumentMediaModel';
export interface HyperBookmarkThumbnail { version: 1; media: HyperDocumentMediaReference; width: number; height: number }
export interface HyperPortableBookmarkThumbnail { blockId: string; dataUrl: string; width: number; height: number }
export function hyperReadBookmarkThumbnail(value: unknown): HyperBookmarkThumbnail | null | undefined {
  if (value === undefined || value === null) return value;
  const fail = () => { throw Error('This bookmark thumbnail has an unsupported format. Its source was kept.'); };
  if (typeof value !== 'object' || Array.isArray(value)) return fail();
  const thumbnail = value as HyperBookmarkThumbnail, media = thumbnail.media;
  if (thumbnail.version !== 1 || !Number.isInteger(thumbnail.width) || !Number.isInteger(thumbnail.height) || thumbnail.width < 1 || thumbnail.height < 1 || thumbnail.width > 4096 || thumbnail.height > 4096 || thumbnail.width * thumbnail.height > 4_194_304 || !media || typeof media !== 'object' || Array.isArray(media) || media.kind !== 'image' || !['local', 'cloud'].includes(media.source) || typeof media.id !== 'string' || !media.id || typeof media.url !== 'string' || media.url.length > 16_384 || typeof media.name !== 'string' || typeof media.alt !== 'string' || typeof media.caption !== 'string') return fail();
  if (media.source === 'local') { if (/[\u0000-\u001f\u007f]/u.test(media.url) || !(/^(?:\/|[a-z]:[\\/]|\\\\[^\\])/iu.test(media.url))) return fail(); }
  else { try { const url = new URL(media.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fail(); } catch { return fail(); } }
  return thumbnail;
}
export function hyperPortableBookmarkRaster(value: string): boolean {
  return typeof value === 'string' && value.length <= 2 * 1024 * 1024 * 4 / 3 + 100 && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
}
