import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperCloudPreviews, type HyperCloudPreviewContext } from './HyperCloudPreviews';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=', 'base64');
const roots: string[] = [];
async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-cloud-previews-test-')); roots.push(temporary);
  const root = path.join(temporary, 'workspace'), staging = path.join(temporary, 'staging'); await fs.mkdir(root); await fs.mkdir(staging);
  let context: HyperCloudPreviewContext = { root, server: 'https://private.example/prefix', workspaceId: 'workspace-A', actorId: '1', revision: 0 };
  const download = vi.fn(async (_url: string, target: string) => { await fs.writeFile(target, png); });
  const previews = new HyperCloudPreviews({ context: async () => context, download, temporaryDirectory: staging });
  return { temporary, root, staging, download, previews, url: `${context.server}/api/file_storage/${context.workspaceId}/v1/blob/page/image`, context: () => context, change: (next: Partial<HyperCloudPreviewContext>) => { context = { ...context, ...next }; } };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('Hyper protected cloud previews', () => {
  it('waits for complete raster bytes, deduplicates requests and keeps private bytes out of managed storage', async () => {
    const f = await fixture();
    const result = await Promise.all([f.previews.previewUrl(f.url), f.previews.previewUrl(f.url)]);
    expect(result).toEqual([`data:image/png;base64,${png.toString('base64')}`, `data:image/png;base64,${png.toString('base64')}`]);
    expect(await f.previews.previewUrl(f.url)).toBe(result[0]); expect(f.download).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(f.staging)).toEqual([]); expect(await fs.readdir(f.root)).toEqual([]);
    expect(result[0]).not.toContain(f.temporary); expect(result[0]).not.toContain('appflowy-file:');
  });
  it('rejects foreign servers, workspaces, routes and credential-bearing URLs without a download', async () => {
    const f = await fixture();
    for (const url of [f.url.replace('private.example', 'foreign.example'), f.url.replace('workspace-A', 'workspace-B'), `${f.context().server}/api/user/profile`, f.url.replace('https://', 'https://user:secret@'), `${f.url}#fragment`, ` ${f.url}`, 'file:///private/file.png']) {
      await expect(f.previews.previewUrl(url)).rejects.toThrow();
    }
    expect(f.download).not.toHaveBeenCalled(); expect(await fs.readdir(f.staging)).toEqual([]);
  });
  it('rejects a stale renderer owner before requesting any private image bytes', async () => {
    const f = await fixture();
    await expect(f.previews.previewUrl(f.url, { actorId: 'old-actor', workspaceId: f.context().workspaceId })).rejects.toThrow('workspace or account changed');
    expect(f.download).not.toHaveBeenCalled(); expect(await fs.readdir(f.staging)).toEqual([]);
  });
  it('never treats an acknowledgement or invalid image as a completed preview and permits a fresh retry', async () => {
    const f = await fixture();
    f.download.mockImplementationOnce(async () => {});
    await expect(f.previews.previewUrl(f.url)).rejects.toThrow('complete regular file');
    f.download.mockImplementationOnce(async (_url, target) => { await fs.writeFile(target, '<svg><script>private</script></svg>'); });
    await expect(f.previews.previewUrl(f.url)).rejects.toThrow('unsupported raster');
    expect(await f.previews.previewUrl(f.url)).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(f.download).toHaveBeenCalledTimes(3); expect(await fs.readdir(f.staging)).toEqual([]);
  });
  it('lets a new owner load while an old request is held and never publishes its late result', async () => {
    const f = await fixture();
    let release!: () => void, began!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { began = resolve; });
    f.download.mockImplementationOnce(async (_url, target) => { began(); await gate; await fs.writeFile(target, png); });
    const old = f.previews.previewUrl(f.url); const rejected = expect(old).rejects.toThrow('workspace or account changed'); await started;
    f.change({ actorId: '2', revision: 1 }); f.previews.invalidate();
    expect(await f.previews.previewUrl(f.url)).toContain('data:image/png;base64,');
    release(); await rejected;
    expect(f.download).toHaveBeenCalledTimes(2); expect(await fs.readdir(f.staging)).toEqual([]);
  });
  it('rejects same-ID owner ABA and discards cached content across invalidation', async () => {
    const f = await fixture(); await f.previews.previewUrl(f.url);
    f.change({ revision: 2 }); f.previews.invalidate();
    await f.previews.previewUrl(f.url); expect(f.download).toHaveBeenCalledTimes(2);
    f.download.mockImplementationOnce(async (_url, target) => { await fs.writeFile(target, png); f.change({ revision: 4 }); });
    await expect(f.previews.previewUrl(`${f.url}-other`)).rejects.toThrow('workspace or account changed');
    expect(await fs.readdir(f.staging)).toEqual([]);
  });
  it('bounds image reads and removes failed staging without modifying source files', async () => {
    const f = await fixture();
    f.download.mockImplementationOnce(async (_url, target) => { await fs.writeFile(target, ''); await fs.truncate(target, 32 * 1024 * 1024 + 1); });
    await expect(f.previews.previewUrl(f.url)).rejects.toThrow('size limit');
    expect(await fs.readdir(f.staging)).toEqual([]);
    if (process.platform === 'win32') return;
    const original = path.join(f.root, 'private-source.png'); await fs.writeFile(original, png);
    f.download.mockImplementationOnce(async (_url, target) => { await fs.symlink(original, target); });
    await expect(f.previews.previewUrl(f.url)).rejects.toThrow('complete regular file');
    expect(await fs.readFile(original)).toEqual(png); expect(await fs.readdir(f.staging)).toEqual([]);
  });
});
