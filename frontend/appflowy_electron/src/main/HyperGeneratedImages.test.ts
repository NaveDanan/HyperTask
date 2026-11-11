import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperAssets } from './HyperAssets';
import { HyperGeneratedImages, hyperCoreCloudBaseUrl, resolveHyperCoreStorageDirectory, type HyperGeneratedImageInfo } from './HyperGeneratedImages';

// Small original 2x3 fixtures, encoded from a solid RGB image with Pillow.
const fixtures = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=',
  jpg: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK7DkP/9k=',
  gif: 'R0lGODdhAgADAIEAAEZabgAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7',
  webp: 'UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAMAAUAmJQBOgCgAAP7wxAuR2EN2HLri5shvAAA=',
};
const directories: string[] = [];
async function fixture(extension: keyof typeof fixtures = 'png', name = `generated.${extension}`) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-generated-')); directories.push(root);
  const directory = path.join(root, 'ai_generated_images'); await fs.mkdir(directory);
  const source = path.join(directory, name), bytes = Buffer.from(fixtures[extension], 'base64');
  await fs.writeFile(source, bytes);
  const assets = new HyperAssets(() => root);
  const importImage = vi.fn(assets.importGeneratedImage.bind(assets));
  const generated = new HyperGeneratedImages({ applicationRoot: () => root, importImage });
  return { root, directory, source, bytes, assets, importImage, generated, url: pathToFileURL(source).href };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('Hyper generated-image bridge', () => {
  it('uses the exact native cloud environment override and retains explicit empty values', () => {
    const appflowy_cloud_config = { base_url: 'https://configured.example', ws_base_url: '', gotrue_url: '' };
    expect(hyperCoreCloudBaseUrl({ appflowy_cloud_config, envs: { BASE_URL: 'https://unrelated.example' } })).toBe('https://configured.example');
    expect(hyperCoreCloudBaseUrl({ appflowy_cloud_config, envs: { APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_BASE_URL: 'https://effective.example' } })).toBe('https://effective.example');
    expect(hyperCoreCloudBaseUrl({ appflowy_cloud_config, envs: { APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_BASE_URL: '' } })).toBe('');
  });
  it.each(['png', 'jpg', 'gif', 'webp'] as const)('imports valid %s bytes through managed storage with bounded dimensions', async extension => {
    const f = await fixture(extension);
    const imported = await f.generated.importUrl(f.url);
    expect(imported).toMatchObject({ width: 2, height: 3, size: f.bytes.length });
    expect(path.dirname(imported.path)).toBe(path.join(f.root, 'images'));
    expect(await fs.readFile(await f.assets.resolve(imported.previewUrl))).toEqual(f.bytes);
    const [copied, info] = f.importImage.mock.calls[0];
    expect(copied).toEqual(f.bytes);
    expect(info).toEqual({ extension, sha256: createHash('sha256').update(f.bytes).digest('hex'), name: path.basename(f.source), expectedApplicationRoot: f.root });
    expect(Object.isFrozen(info)).toBe(true);
  });
  it('deduplicates repeated and concurrent imports after restart without replacing user assets', async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([f.generated.importUrl(f.url), f.generated.importUrl(f.url)]);
    expect(first.path).toBe(second.path);
    const restarted = new HyperGeneratedImages({ applicationRoot: () => f.root, importImage: f.assets.importGeneratedImage.bind(f.assets) });
    expect((await restarted.importUrl(f.url)).path).toBe(first.path);
    expect(await fs.readdir(path.join(f.root, 'images'))).toEqual([path.basename(first.path)]);
    await fs.unlink(f.source);
    expect(await f.assets.resolve(first.previewUrl)).toBe(first.path);
  });
  it('accepts encoded spaces and Unicode and canonicalizes a configured root alias', async () => {
    const f = await fixture('png', 'résumé image.png');
    expect((await f.generated.importUrl(f.url)).name).toBe('résumé image.png');
    if (process.platform === 'win32') return;
    const alias = `${f.root}-alias`; directories.push(alias); await fs.symlink(f.root, alias);
    const bridge = new HyperGeneratedImages({ applicationRoot: () => alias, importImage: f.assets.importGeneratedImage.bind(f.assets) });
    expect((await bridge.importUrl(pathToFileURL(path.join(alias, 'ai_generated_images', path.basename(f.source))).href)).width).toBe(2);
  });
  it('rejects foreign files, nested files and normalized traversal even when the target is valid', async () => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside.png'); await fs.writeFile(outside, f.bytes);
    const nested = path.join(f.directory, 'nested'); await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'image.png'), f.bytes);
    const urls = [pathToFileURL(outside).href, pathToFileURL(path.join(nested, 'image.png')).href, f.url.replace('/generated.png', '/nested/../generated.png'), f.url.replace('/generated.png', '/%2e/generated.png'), f.url.replace('/generated.png', '/nested/%2E%2E/generated.png')];
    for (const url of urls) await expect(f.generated.importUrl(url), url).rejects.toThrow();
    expect(f.importImage).not.toHaveBeenCalled();
  });
  it('rejects malformed URLs, hosts, credentials, queries, fragments and encoded separators', async () => {
    const f = await fixture();
    for (const url of ['not a URL', f.source, ` ${f.url}`, `${f.url}\n`, f.url.replace('file:///', 'file://localhost/'), f.url.replace('file:///', 'file://foreign/'), f.url.replace('file:///', 'file://user:secret@/'), f.url.replace('file:', 'https:'), `${f.url}?x=1`, `${f.url}?`, `${f.url}#fragment`, `${f.url}#`, f.url.replace('generated.png', '%2Fgenerated.png'), f.url.replace('generated.png', '%5cgenerated.png'), f.url.replace('generated.png', '%00.png'), f.url.replace('generated.png', '..%2fgenerated.png'), f.url.replace('generated.png', 'generated%ZZ.png')]) {
      await expect(f.generated.importUrl(url), url).rejects.toThrow();
    }
    expect(f.importImage).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === 'win32')('rejects symlinks, hard links and redirected artifact directories', async () => {
    const f = await fixture();
    const link = path.join(f.directory, 'link.png'); await fs.symlink(f.source, link);
    await expect(f.generated.importUrl(pathToFileURL(link).href)).rejects.toThrow();
    await fs.unlink(link); await fs.link(f.source, link);
    await expect(f.generated.importUrl(pathToFileURL(link).href)).rejects.toThrow();
    await fs.unlink(link);
    const moved = path.join(f.root, 'moved'); await fs.rename(f.directory, moved); await fs.symlink(moved, f.directory);
    await expect(f.generated.importUrl(f.url)).rejects.toThrow();
    expect(f.importImage).not.toHaveBeenCalled();
  });
  it('requires initialized roots and rejects regular directories and oversized files before copying', async () => {
    const f = await fixture();
    for (const root of [null, 'relative']) {
      await expect(new HyperGeneratedImages({ applicationRoot: () => root, importImage: f.importImage }).importUrl(f.url)).rejects.toThrow('not initialized');
    }
    const directory = path.join(f.directory, 'directory.png'); await fs.mkdir(directory);
    await expect(f.generated.importUrl(pathToFileURL(directory).href)).rejects.toThrow();
    await fs.truncate(f.source, 32 * 1024 * 1024 + 1);
    await expect(f.generated.importUrl(f.url)).rejects.toThrow();
    expect(f.importImage).not.toHaveBeenCalled();
  });
  it('rejects unsupported content, mismatched extensions, truncated files and corrupted PNG data', async () => {
    const f = await fixture();
    const invalidFiles = [Buffer.alloc(0), Buffer.from('<svg><script>alert(1)</script></svg>'), f.bytes.subarray(0, 33), Buffer.from(f.bytes)];
    invalidFiles[3][45] ^= 1;
    for (const bytes of invalidFiles) { await fs.writeFile(f.source, bytes); await expect(f.generated.importUrl(f.url)).rejects.toThrow(); }
    await fs.writeFile(f.source, f.bytes);
    const other = path.join(f.directory, 'wrong.jpg'); await fs.writeFile(other, f.bytes);
    await expect(f.generated.importUrl(pathToFileURL(other).href)).rejects.toThrow();
    expect(f.importImage).not.toHaveBeenCalled();
  });
  it.each(['png', 'jpg', 'gif', 'webp'] as const)('rejects truncated %s before a managed copy', async extension => {
    const f = await fixture(extension);
    await fs.writeFile(f.source, f.bytes.subarray(0, f.bytes.length - 3));
    await expect(f.generated.importUrl(f.url)).rejects.toThrow(); expect(f.importImage).not.toHaveBeenCalled();
  });
  it('rejects excessive dimensions and a forged PNG decompression size', async () => {
    const f = await fixture();
    for (const size of [20_000, 16_000, 3]) {
      const changed = Buffer.from(f.bytes); changed.writeUInt32BE(size, 16);
      changed.writeUInt32BE(crc32(changed.subarray(12, 29)), 29);
      await fs.writeFile(f.source, changed);
      await expect(f.generated.importUrl(f.url)).rejects.toThrow();
    }
    expect(f.importImage).not.toHaveBeenCalled();
  });
  it('fails closed when the active root changes before or during the managed copy', async () => {
    const f = await fixture(), other = await fixture();
    let selected = f.root;
    const copy = vi.fn(async () => { selected = other.root; return { path: '', name: '', size: 0, previewUrl: '' }; });
    const bridge = new HyperGeneratedImages({ applicationRoot: () => selected, importImage: copy });
    await expect(bridge.importUrl(f.url)).rejects.toThrow();
    selected = other.root;
    await expect(bridge.importUrl(f.url)).rejects.toThrow();
    expect(copy).toHaveBeenCalledTimes(1);
    selected = f.root;
    const changing = new HyperGeneratedImages({ applicationRoot: () => { const result = selected; selected = other.root; return result; }, importImage: copy });
    await expect(changing.importUrl(f.url)).rejects.toThrow();
    expect(copy).toHaveBeenCalledTimes(1);
  });
  it('shares concurrent requests and waits for one image copy before reading another', async () => {
    const f = await fixture();
    const other = path.join(f.directory, 'second.png'); await fs.writeFile(other, f.bytes);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const copying = new Promise<void>(resolve => { started = resolve; });
    const copy = vi.fn(async (bytes: Buffer, info: HyperGeneratedImageInfo) => { started(); await gate; return f.assets.importGeneratedImage(bytes, info); });
    const bridge = new HyperGeneratedImages({ applicationRoot: () => f.root, importImage: copy });
    const first = bridge.importUrl(f.url), repeated = bridge.importUrl(f.url);
    expect(first).toBe(repeated);
    const second = bridge.importUrl(pathToFileURL(other).href);
    await copying; await new Promise(resolve => setImmediate(resolve));
    expect(copy).toHaveBeenCalledTimes(1);
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one.path).toBe(two.path); expect(copy).toHaveBeenCalledTimes(2);
    await bridge.importUrl(f.url); expect(copy).toHaveBeenCalledTimes(3);
  });
  it('rejects queued work captured before a root change without sending its bytes to managed storage', async () => {
    const f = await fixture(), other = await fixture();
    const second = path.join(f.directory, 'second.png'); await fs.writeFile(second, f.bytes);
    let selected = f.root, release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const copying = new Promise<void>(resolve => { started = resolve; });
    const copy = vi.fn(async () => { started(); await gate; return { path: '', name: '', size: 0, previewUrl: '' }; });
    const bridge = new HyperGeneratedImages({ applicationRoot: () => selected, importImage: copy });
    const first = bridge.importUrl(f.url), queued = bridge.importUrl(pathToFileURL(second).href);
    const completion = Promise.allSettled([first, queued]);
    await copying; selected = other.root; release();
    expect((await completion).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(copy).toHaveBeenCalledTimes(1);
  });
});

describe('Hyper Rust storage directory selection', () => {
  const root = path.join(os.tmpdir(), 'hyper-storage');
  const config = { custom_app_path: root, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} };
  const server = { ...config, appflowy_cloud_config: { base_url: 'https://my.example:123/base', ws_base_url: 'wss://my.example/ws', gotrue_url: 'https://my.example/auth' } };
  it('uses the exact custom root for local and rejected vendor configuration', async () => {
    expect(await resolveHyperCoreStorageDirectory(config)).toBe(root);
    for (const base_url of ['https://appflowy.io', 'https://my.appflowy.cloud.', 'https://name:secret@my.example', 'file:///tmp/server']) expect(await resolveHyperCoreStorageDirectory({ ...server, appflowy_cloud_config: { ...server.appflowy_cloud_config, base_url } })).toBe(root);
  });
  it('uses server host isolation and preserves the existing padded base64 legacy path', async () => {
    expect(await resolveHyperCoreStorageDirectory(server, async () => false)).toBe(`${root}_my.example`);
    const legacy = `${root}_${Buffer.from(server.appflowy_cloud_config.base_url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')}`;
    const exists = vi.fn(async () => true);
    expect(await resolveHyperCoreStorageDirectory(server, exists)).toBe(legacy);
    expect(exists).toHaveBeenCalledWith(legacy);
  });
  it('matches the core env override order and rejects invalid custom roots', async () => {
    const envs = { APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_BASE_URL: 'https://overridden.example', APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_WS_BASE_URL: 'ws://overridden.example', APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_GOTRUE_URL: 'https://overridden.example' };
    expect(await resolveHyperCoreStorageDirectory({ ...config, envs }, async () => false)).toBe(`${root}_overridden.example`);
    await expect(resolveHyperCoreStorageDirectory({ ...config, custom_app_path: 'relative' })).rejects.toThrow('not initialized');
  });
});
