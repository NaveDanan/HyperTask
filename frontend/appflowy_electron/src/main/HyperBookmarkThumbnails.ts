import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { HyperGeneratedImageAsset, HyperImportedAsset } from '../shared/api';
import type { HyperGeneratedImageInfo } from './HyperGeneratedImages';
import { hyperInspectRasterImage } from './HyperGeneratedImages';
import { hyperBookmarkOwnerValue, hyperBookmarkRequestUrl, hyperBookmarkUntilAborted, type HyperBookmarkRuntime } from './HyperBookmarkMetadata';
export const HYPER_BOOKMARK_THUMBNAIL_BYTES = 8 * 1024 * 1024;
export const HYPER_BOOKMARK_THUMBNAIL_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export interface HyperBookmarkThumbnailRuntime extends HyperBookmarkRuntime {
  root(): string | null;
  normalize(bytes: Buffer): Buffer;
  importImage(bytes: Buffer, info: HyperGeneratedImageInfo): Promise<HyperImportedAsset>;
}
function requestRaster(url: URL, signal: AbortSignal): Promise<Buffer | { redirect: string }> {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const finish = (error?: Error, result?: Buffer | { redirect: string }) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); request.destroy(); if (error) reject(error); else resolve(result!); };
    const fail = (message: string) => finish(Error(message)), abort = () => fail('The thumbnail request was cancelled.');
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'GET', headers: { Accept: 'image/png, image/jpeg, image/gif, image/webp', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) { const redirect = response.headers.location; if (!redirect || redirect.length > 4096 || /[\u0000-\u001f\u007f]/u.test(redirect)) fail('The thumbnail returned an invalid redirect.'); else finish(undefined, { redirect }); return; }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { fail(`The thumbnail returned HTTP ${response.statusCode || 0}.`); return; }
      if (!/^image\/(?:png|jpeg|gif|webp)(?:\s*;|$)/iu.test(response.headers['content-type'] ?? '') || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { fail('The thumbnail must be an uncompressed PNG, JPEG, GIF or WebP image.'); return; }
      if (Number(response.headers['content-length']) > HYPER_BOOKMARK_THUMBNAIL_BYTES) { fail('The thumbnail image is too large.'); return; }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { if (settled) return; size += chunk.length; if (size > HYPER_BOOKMARK_THUMBNAIL_BYTES) { fail('The thumbnail image is too large.'); return; } chunks.push(chunk); });
      response.on('end', () => finish(undefined, Buffer.concat(chunks)));
      response.on('aborted', () => fail('The thumbnail response was interrupted.')); response.on('error', () => fail('The thumbnail response was interrupted.'));
    });
    request.on('error', () => fail('The thumbnail could not be loaded.')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); else request.end();
  });
}
export async function hyperLoadBookmarkRaster(initial: URL, signal: AbortSignal, guard: () => Promise<void>): Promise<Buffer> {
  const seen = new Set<string>(); let url = hyperBookmarkRequestUrl(initial.href);
  for (let hop = 0; hop <= 3; hop++) {
    await guard(); if (signal.aborted) throw Error('The thumbnail request was cancelled.');
    if (seen.has(url.href)) throw Error('The thumbnail redirects in a cycle.'); seen.add(url.href);
    const result = await requestRaster(url, signal); await guard(); if (Buffer.isBuffer(result)) return result;
    if (hop === 3) throw Error('The thumbnail redirects too many times.');
    try { url = hyperBookmarkRequestUrl(new URL(result.redirect, url).href); } catch { throw Error('The thumbnail redirects to an unsupported or credential-bearing address.'); }
  }
  throw Error('The thumbnail could not be loaded.');
}
/** Explicit public downloads and embedded portable imports share the same owner-bound validation/publication path. */
export class HyperBookmarkThumbnails {
  private readonly pending = new Set<AbortController>();
  constructor(private readonly runtime: HyperBookmarkThumbnailRuntime, private readonly load = hyperLoadBookmarkRaster) {}
  invalidate() { for (const controller of this.pending) controller.abort(); }
  loadUrl(raw: unknown, rawOwner: unknown) { const url = hyperBookmarkRequestUrl(raw); return this.prepare(rawOwner, (signal, guard) => this.load(url, signal, guard)); }
  importData(raw: unknown, rawOwner: unknown) {
    if (typeof raw !== 'string' || raw.length > HYPER_BOOKMARK_THUMBNAIL_BYTES * 4 / 3 + 100 || !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(raw)) return Promise.reject(Error('The portable thumbnail is not a supported embedded raster image.'));
    const encoded = raw.slice(raw.indexOf(',') + 1), bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length > HYPER_BOOKMARK_THUMBNAIL_BYTES) return Promise.reject(Error('The portable thumbnail image is invalid or too large.'));
    return this.prepare(rawOwner, async () => bytes);
  }
  private async prepare(rawOwner: unknown, read: (signal: AbortSignal, guard: () => Promise<void>) => Promise<Buffer>): Promise<HyperGeneratedImageAsset> {
    const owner = hyperBookmarkOwnerValue(rawOwner), revision = this.runtime.revision(), configured = this.runtime.root();
    if (!configured || !path.isAbsolute(configured)) throw Error('Workspace image storage is unavailable.');
    if (this.pending.size >= 2) throw Error('Wait for the other thumbnail requests to finish.');
    const controller = new AbortController(); this.pending.add(controller); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const current = () => { if (controller.signal.aborted || revision !== this.runtime.revision() || configured !== this.runtime.root()) throw Error('The thumbnail workspace, account or app session changed.'); };
    const guard = async () => { current(); const fresh = await hyperBookmarkUntilAborted(this.runtime.identity(), controller.signal); current(); if (fresh.actorId !== owner.actorId || fresh.workspaceId !== owner.workspaceId) throw Error('The thumbnail account or workspace changed.'); };
    try {
      await guard(); const root = await hyperBookmarkUntilAborted(fs.realpath(configured), controller.signal); await guard();
      const bytes = await read(controller.signal, guard); await guard();
      const original = hyperInspectRasterImage(bytes); if (original.width > 4096 || original.height > 4096 || original.width * original.height > 4_194_304) throw Error('The thumbnail exceeds 4,194,304 pixels or a 4,096 pixel side.');
      const snapshot = this.runtime.normalize(bytes), image = hyperInspectRasterImage(snapshot);
      if (image.extension !== 'png' || image.width !== original.width || image.height !== original.height || snapshot.length > HYPER_BOOKMARK_THUMBNAIL_SNAPSHOT_BYTES) throw Error('The thumbnail snapshot is invalid or exceeds 2 MiB.');
      await guard(); current(); const result = await hyperBookmarkUntilAborted(this.runtime.importImage(snapshot, { extension: 'png', sha256: createHash('sha256').update(snapshot).digest('hex'), name: 'Bookmark thumbnail.png', expectedApplicationRoot: root }), controller.signal); await guard();
      return { ...result, width: image.width, height: image.height };
    } catch (error) { if (timedOut) throw Error('The thumbnail request timed out.'); throw error; }
    finally { clearTimeout(timer); controller.abort(); this.pending.delete(controller); }
  }
}
