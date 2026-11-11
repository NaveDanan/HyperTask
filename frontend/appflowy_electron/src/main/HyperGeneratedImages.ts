import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';
import type { CoreInitConfig, HyperImportedAsset } from '@shared/api';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 16_777_216;
type Extension = 'png' | 'jpg' | 'gif' | 'webp';
interface Dimensions { width: number; height: number }
export interface HyperGeneratedImageAsset extends HyperImportedAsset, Dimensions {}
export interface HyperGeneratedImageInfo {
  readonly extension: Extension;
  readonly sha256: string;
  readonly name: string;
  readonly expectedApplicationRoot: string;
}
interface Dependencies {
  applicationRoot: () => string | null;
  importImage: (bytes: Buffer, info: HyperGeneratedImageInfo) => Promise<HyperImportedAsset>;
}

const invalid = () => new Error('This generated image is missing, invalid, or outside its storage directory.');
function dimensions(width: number, height: number): Dimensions {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw invalid();
  return { width, height };
}

function png(bytes: Buffer): Dimensions {
  let offset = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const compressed: Buffer[] = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw invalid();
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && kind !== 'IHDR') throw invalid();
    if (kind === 'IHDR') {
      if (offset !== 8 || length !== 13) throw invalid();
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      dimensions(width, height);
      depth = bytes[offset + 16]; color = bytes[offset + 17]; interlace = bytes[offset + 20];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] || bytes[offset + 19] || interlace > 1) throw invalid();
    } else if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    else if (kind === 'IEND') {
      if (length || end !== bytes.length) throw invalid();
      ended = true; break;
    } else if (!/^[a-zA-Z]{4}$/.test(kind) || (kind[0] === kind[0].toUpperCase() && kind !== 'PLTE')) throw invalid();
    offset = end;
  }
  if (!ended || !compressed.length) throw invalid();
  // Validate bounded scanlines before Chromium decodes the image. Adam7 uses seven passes.
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows: Array<{ count: number; length: number }> = [];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / dx)), count = Math.max(0, Math.ceil((height - y) / dy));
    if (!columns || !count) continue;
    const length = Math.ceil(columns * depth * channels[color] / 8) + 1;
    expected += count * length; rows.push({ count, length });
  }
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (decoded.length !== expected) throw invalid();
  let cursor = 0;
  for (const row of rows) for (let index = 0; index < row.count; index++) {
    if (decoded[cursor] > 4) throw invalid();
    cursor += row.length;
  }
  return { width, height };
}

function jpeg(bytes: Buffer): Dimensions {
  let offset = 2, sized = false, scanned = false, width = 0, height = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) { if (!sized || !scanned || offset !== bytes.length) throw invalid(); return { width, height }; }
    if (!marker || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) throw invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw invalid();
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || ![8, 12, 16].includes(bytes[offset + 2]) || ![1, 2, 3, 4].includes(bytes[offset + 7]) || length !== 8 + 3 * bytes[offset + 7]) throw invalid();
      width = bytes.readUInt16BE(offset + 5); height = bytes.readUInt16BE(offset + 3);
      dimensions(width, height); sized = true;
    }
    offset += length;
    if (marker === 0xda) {
      if (!sized || length < 6) throw invalid();
      const start = offset;
      while (offset < bytes.length - 1) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
      if (offset === start) throw invalid();
      scanned = true;
    }
  }
  throw invalid();
}

function gif(bytes: Buffer): Dimensions {
  if (bytes.length < 14) throw invalid();
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8); dimensions(width, height);
  let offset = 13 + ((bytes[10] & 0x80) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0), frames = 0;
  const blocks = () => {
    let total = 0;
    for (;;) {
      if (offset >= bytes.length) throw invalid();
      const length = bytes[offset++]; if (!length) return total;
      offset += length; total += length;
      if (offset > bytes.length) throw invalid();
    }
  };
  while (offset < bytes.length) {
    const kind = bytes[offset++];
    if (kind === 0x3b) { if (!frames || offset !== bytes.length) throw invalid(); return { width, height }; }
    if (kind === 0x21) { offset++; blocks(); continue; }
    if (kind !== 0x2c || offset + 10 > bytes.length) throw invalid();
    const x = bytes.readUInt16LE(offset), y = bytes.readUInt16LE(offset + 2), w = bytes.readUInt16LE(offset + 4), h = bytes.readUInt16LE(offset + 6);
    dimensions(w, h);
    if (x + w > width || y + h > height || ++frames > 128 || width * height * frames > MAX_PIXELS * 8) throw invalid();
    const packed = bytes[offset + 8]; offset += 9;
    if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
    if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset++] > 8 || !blocks()) throw invalid();
  }
  throw invalid();
}

function webp(bytes: Buffer): Dimensions {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
  let offset = 12, found = false;
  let canvas: [number, number] | undefined;
  let image: Dimensions | undefined;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length;
    if (end > bytes.length) throw invalid();
    let width = 0, height = 0;
    if (kind === 'VP8X') {
      if (offset !== 12 || length !== 10 || (bytes[start] & 0xc1) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) throw invalid();
      canvas = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1]; dimensions(...canvas);
      // Animation needs a bounded frame decoder; generated WebP is static.
      if (bytes[start] & 0x02) throw invalid();
    } else if (kind === 'VP8 ') {
      if (length < 10 || (bytes[start] & 1) || bytes.toString('hex', start + 3, start + 6) !== '9d012a') throw invalid();
      width = bytes.readUInt16LE(start + 6) & 0x3fff; height = bytes.readUInt16LE(start + 8) & 0x3fff;
    } else if (kind === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0) throw invalid();
      const bits = bytes.readUInt32LE(start + 1); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(kind)) throw invalid();
    if (width) {
      if (found || (canvas && (canvas[0] !== width || canvas[1] !== height))) throw invalid();
      image = dimensions(width, height); found = true;
    }
    offset = end + (length & 1);
  }
  if (!found || offset !== bytes.length) throw invalid();
  return image!;
}

function inspect(bytes: Buffer): Dimensions & { extension: Extension } {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ...png(bytes), extension: 'png' };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return { ...jpeg(bytes), extension: 'jpg' };
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return { ...gif(bytes), extension: 'gif' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { ...webp(bytes), extension: 'webp' };
  throw invalid();
}

/** Shared bounded raster inspection; source ownership is checked by each caller. */
export function hyperInspectRasterImage(bytes: Buffer): Dimensions & { extension: Extension } {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw invalid();
  return inspect(bytes);
}

/** Accept only Rust-generated artifacts, then copy validated bytes into managed image storage. */
export class HyperGeneratedImages {
  private queue: Promise<void> = Promise.resolve();
  private readonly inFlight = new Map<string, Promise<HyperGeneratedImageAsset>>();
  constructor(private readonly dependencies: Dependencies) {}

  importUrl(value: string): Promise<HyperGeneratedImageAsset> {
    const configured = this.dependencies.applicationRoot();
    if (typeof value !== 'string') return Promise.reject(invalid());
    const key = JSON.stringify([configured, value]);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    // History rendering can request many images at once. Keep at most one bounded
    // file buffer and PNG inflation active, and share concurrent requests for one URL.
    const operation = this.queue.then(() => {
      if (this.dependencies.applicationRoot() !== configured) throw invalid();
      return this.importCurrentUrl(value, configured);
    });
    this.queue = operation.then(() => {}, () => {});
    this.inFlight.set(key, operation);
    const clear = () => { if (this.inFlight.get(key) === operation) this.inFlight.delete(key); };
    void operation.then(clear, clear);
    return operation;
  }

  private async importCurrentUrl(value: string, configured: string | null): Promise<HyperGeneratedImageAsset> {
    if (!configured || !path.isAbsolute(configured)) throw new Error('Workspace storage is not initialized.');
    if (typeof value !== 'string' || value.length > 16_384 || /[\\\0\r\n]/.test(value) || /%(2f|5c|00)/i.test(value)) throw invalid();
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.hostname || url.port || url.username || url.password || url.search || url.hash) throw invalid();
    const source = fileURLToPath(url);
    if (pathToFileURL(source).href !== value) throw invalid();
    const root = await fs.realpath(configured), directory = path.join(root, 'ai_generated_images');
    const configuredDirectory = path.join(path.resolve(configured), 'ai_generated_images');
    if (![directory, configuredDirectory].includes(path.dirname(source))) throw invalid();
    const filename = path.basename(source), canonicalSource = path.join(directory, filename);
    const assertCurrent = async () => {
      if (this.dependencies.applicationRoot() !== configured || await fs.realpath(configured) !== root || await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw invalid();
    };
    await assertCurrent();
    if (await fs.realpath(source) !== canonicalSource || !(await fs.lstat(source)).isFile()) throw invalid();
    const file = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || !stat.size || stat.size > MAX_BYTES) throw invalid();
      const bounded = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bounded.length) {
        const read = await file.read(bounded, length, bounded.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await file.stat();
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw invalid();
      bytes = bounded.subarray(0, length);
    } finally { await file.close(); }
    let image: Dimensions & { extension: Extension };
    try { image = inspect(bytes); } catch { throw invalid(); }
    const { extension, width, height } = image;
    const suffix = path.extname(filename).toLowerCase();
    if (suffix !== `.${extension}` && !(extension === 'jpg' && suffix === '.jpeg')) throw invalid();
    await assertCurrent();
    const result = await this.dependencies.importImage(bytes, Object.freeze({ extension, sha256: createHash('sha256').update(bytes).digest('hex'), name: filename, expectedApplicationRoot: root }));
    await assertCurrent();
    return { ...result, width, height };
  }
}

type StorageConfig = Pick<CoreInitConfig, 'custom_app_path' | 'appflowy_cloud_config' | 'envs'>;
const cloudKeys = ['APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_BASE_URL', 'APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_WS_BASE_URL', 'APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_GOTRUE_URL'];
/** electron-core writes the cloud configuration, then applies these environment overrides. */
export const hyperCoreCloudBaseUrl = (config: Pick<CoreInitConfig, 'appflowy_cloud_config' | 'envs'>): string => config.envs[cloudKeys[0]] ?? config.appflowy_cloud_config.base_url;
/** Snapshot before CoreInit creates folders. Mirrors AppFlowyCoreConfig::new/make_user_data_folder. */
export async function resolveHyperCoreStorageDirectory(config: StorageConfig, exists: (directory: string) => Promise<boolean> = async directory => { try { await fs.access(directory); return true; } catch { return false; } }): Promise<string> {
  const root = config.custom_app_path;
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw new Error('Workspace storage is not initialized.');
  const values = [config.appflowy_cloud_config.base_url, config.appflowy_cloud_config.ws_base_url, config.appflowy_cloud_config.gotrue_url].map((value, index) => config.envs[cloudKeys[index]] ?? value);
  const parsed = values.map(value => {
    try {
      const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
      return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && host && !['appflowy.com', 'appflowy.io', 'appflowy.cloud'].some(domain => host === domain || host.endsWith(`.${domain}`)) ? url : null;
    } catch { return null; }
  });
  if (parsed.some(url => !url)) return root;
  const legacy = `${root}_${Buffer.from(values[0]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')}`;
  return await exists(legacy) ? legacy : `${root}_${parsed[0]!.hostname}`;
}
