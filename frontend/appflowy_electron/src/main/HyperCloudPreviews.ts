import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hyperInspectRasterImage } from './HyperGeneratedImages';

export interface HyperCloudPreviewContext {
  root: string;
  server: string;
  actorId: string;
  workspaceId: string;
  revision: number;
}
export interface HyperCloudPreviewBackend {
  context(): Promise<HyperCloudPreviewContext>;
  /** Must await native DownloadFile with waitForCompletion=true. */
  download(url: string, target: string): Promise<void>;
  temporaryDirectory?: string;
}
const limit = 32 * 1024 * 1024;
const cacheLimit = 64 * 1024 * 1024;
const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
const changed = () => new Error('The image workspace or account changed.');
const key = (context: HyperCloudPreviewContext) => JSON.stringify([context.root, context.server, context.actorId, context.workspaceId, context.revision]);

function cloudUrl(value: string, context: HyperCloudPreviewContext): string {
  if (typeof value !== 'string' || value.length > 8192 || value.trim() !== value || /[\r\n\0]/u.test(value)) throw new Error('Invalid protected image URL.');
  const url = new URL(value), server = new URL(context.server);
  const prefix = `${server.pathname.replace(/\/$/u, '')}/api/file_storage/${encodeURIComponent(context.workspaceId)}/`;
  const resource = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
    || server.username || server.password || url.origin !== server.origin || !/^(?:v1\/)?blob\/.+/u.test(resource)) {
    throw new Error('This image does not belong to the active server and workspace.');
  }
  return url.href;
}

/** Authenticated image bytes stay out of the public managed-asset protocol.
 * Only validated raster data URLs leave this scoped, disposable download path. */
export class HyperCloudPreviews {
  private revision = 0;
  private bytes = 0;
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly queues = new Map<string, Promise<void>>();
  constructor(private readonly backend: HyperCloudPreviewBackend) {}

  invalidate(): void {
    this.revision++;
    this.cache.clear(); this.bytes = 0;
    this.inFlight.clear(); this.queues.clear();
  }

  private async context(): Promise<HyperCloudPreviewContext> {
    const value = { ...await this.backend.context() };
    if (!path.isAbsolute(value.root) || !value.actorId || !value.workspaceId || !Number.isSafeInteger(value.revision)) throw changed();
    value.root = await fs.realpath(value.root);
    return Object.freeze(value);
  }

  private async check(context: HyperCloudPreviewContext, revision: number): Promise<void> {
    if (revision !== this.revision) throw changed();
    const current = await this.context();
    if (revision !== this.revision || key(context) !== key(current)) throw changed();
  }

  async previewUrl(source: string, expectedOwner?: Pick<HyperCloudPreviewContext, 'actorId' | 'workspaceId'>): Promise<string> {
    const revision = this.revision, context = await this.context();
    if (revision !== this.revision) throw changed();
    if (expectedOwner && (expectedOwner.actorId !== context.actorId || expectedOwner.workspaceId !== context.workspaceId)) throw changed();
    const url = cloudUrl(source, context), ownerKey = `${revision}:${key(context)}`, cacheKey = `${ownerKey}:${url}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      await this.check(context, revision);
      this.cache.delete(cacheKey); this.cache.set(cacheKey, cached);
      return cached;
    }
    const active = this.inFlight.get(cacheKey);
    if (active) return active;
    if (this.inFlight.size >= 128) throw new Error('Too many protected images are loading. Try again shortly.');
    const preceding = this.queues.get(ownerKey) ?? Promise.resolve();
    const request = preceding.then(() => this.load(url, context, revision)).then(value => {
      if (revision !== this.revision) throw changed();
      this.cache.set(cacheKey, value); this.bytes += value.length;
      while (this.bytes > cacheLimit || this.cache.size > 128) {
        const oldest = this.cache.keys().next().value!;
        this.bytes -= this.cache.get(oldest)!.length; this.cache.delete(oldest);
      }
      return value;
    });
    this.inFlight.set(cacheKey, request);
    const tail = request.then(() => {}, () => {});
    this.queues.set(ownerKey, tail);
    const release = () => {
      if (this.inFlight.get(cacheKey) === request) this.inFlight.delete(cacheKey);
    };
    void request.then(release, release);
    void tail.then(() => {
      if (this.queues.get(ownerKey) === tail) this.queues.delete(ownerKey);
    });
    return request;
  }

  private async load(url: string, context: HyperCloudPreviewContext, revision: number): Promise<string> {
    await this.check(context, revision);
    const temporary = await fs.mkdtemp(path.join(this.backend.temporaryDirectory ?? os.tmpdir(), 'hyper-cloud-preview-'));
    try {
      await fs.chmod(temporary, 0o700);
      await this.check(context, revision);
      const target = path.join(temporary, 'download');
      await this.backend.download(url, target);
      await this.check(context, revision);
      const file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
        .catch(() => { throw new Error('The image download did not produce a complete regular file.'); });
      let bytes: Buffer;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || !stat.size || stat.size > limit) throw new Error('The image exceeds the preview size limit or is not a regular file.');
        const buffer = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const result = await file.read(buffer, length, buffer.length - length, length);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        if (length !== stat.size) throw new Error('The downloaded image changed before it could be read.');
        bytes = buffer.subarray(0, length);
      } finally { await file.close(); }
      let type: keyof typeof mime;
      try { type = hyperInspectRasterImage(bytes).extension; }
      catch { throw new Error('The downloaded image is incomplete or uses an unsupported raster format.'); }
      await this.check(context, revision);
      return `data:${mime[type]};base64,${bytes.toString('base64')}`;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
}
