import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperAssets } from './HyperAssets';

const directories: string[] = [];
async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-assets-'));
  directories.push(temporary);
  const root = path.join(temporary, 'workspace');
  await fs.mkdir(root);
  return { temporary, root, assets: new HyperAssets(() => root) };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('Hyper managed attachments', () => {
  it('freezes import storage before the source stat resolves', async () => {
    const { temporary, root } = await fixture();
    const other = path.join(temporary, 'other'); await fs.mkdir(other);
    const source = path.join(temporary, 'private.txt'); await fs.writeFile(source, 'original private bytes');
    let active = root;
    const assets = new HyperAssets(() => active), originalStat = fs.stat.bind(fs);
    vi.spyOn(fs, 'stat').mockImplementation(async (...args) => { const result = await originalStat(...args); if (args[0] === source) active = other; return result; });
    await expect(assets.importFile(source)).rejects.toThrow('workspace or account changed');
    expect(await fs.readdir(other)).toEqual([]); expect(await fs.readdir(root)).toEqual([]);
    expect(await fs.readFile(source, 'utf8')).toBe('original private bytes');
  });
  it('rejects same-storage owner ABA after copying and removes its private staging file', async () => {
    const { temporary, root } = await fixture();
    const source = path.join(temporary, 'private.txt'); await fs.writeFile(source, 'keep source');
    let revision = 0;
    const assets = new HyperAssets(() => root, () => revision), copy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementationOnce(async (...args) => { await copy(...args); revision += 2; });
    await expect(assets.importFile(source)).rejects.toThrow('workspace or account changed');
    expect(await fs.readdir(path.join(root, 'files'))).toEqual([]);
    expect(await fs.readFile(source, 'utf8')).toBe('keep source');
  });
  it('deduplicates validated generated image bytes concurrently and across restarts without replacing files', async () => {
    const { root, assets } = await fixture();
    const bytes = Buffer.from('validated image bytes');
    const info = { extension: 'png' as const, sha256: createHash('sha256').update(bytes).digest('hex'), name: 'Generated image.png', expectedApplicationRoot: await fs.realpath(root) };
    const [first, repeated] = await Promise.all([assets.importGeneratedImage(bytes, info), assets.importGeneratedImage(bytes, info)]);
    expect(first).toEqual(repeated);
    expect(await new HyperAssets(() => root).importGeneratedImage(bytes, info)).toEqual(first);
    expect(await fs.readdir(path.join(root, 'images'))).toEqual([path.basename(first.path)]);
    expect(await fs.readFile(first.path)).toEqual(bytes);
    await fs.writeFile(first.path, 'existing changed image');
    await expect(assets.importGeneratedImage(bytes, info)).rejects.toThrow('different content');
    expect(await fs.readFile(first.path, 'utf8')).toBe('existing changed image');
    await expect(assets.importGeneratedImage(Buffer.from('different'), info)).rejects.toThrow('Invalid');
  });
  it('rejects generated-image symlink targets and storage changes during publication', async () => {
    const { temporary, root } = await fixture();
    const other = path.join(temporary, 'other'); await fs.mkdir(other);
    let active = root;
    const assets = new HyperAssets(() => active), bytes = Buffer.from('validated bytes');
    const info = { extension: 'jpg' as const, sha256: createHash('sha256').update(bytes).digest('hex'), name: 'Generated image.jpg', expectedApplicationRoot: await fs.realpath(root) };
    const originalLink = fs.link.bind(fs);
    vi.spyOn(fs, 'link').mockImplementationOnce(async (...args) => { await originalLink(...args); active = other; });
    await expect(assets.importGeneratedImage(bytes, info)).rejects.toThrow('storage changed');
    expect(await fs.readdir(other)).toEqual([]);
    expect((await fs.readdir(path.join(root, 'images'))).some(name => name.endsWith('.partial'))).toBe(false);
    active = root;
    // Already published immutable data is retained, even when its original caller lost scope.
    const saved = await assets.importGeneratedImage(bytes, info);
    if (process.platform !== 'win32') {
      await fs.unlink(saved.path);
      const source = path.join(temporary, 'source'); await fs.writeFile(source, bytes); await fs.symlink(source, saved.path);
      await expect(assets.importGeneratedImage(bytes, info)).rejects.toThrow('regular file');
      expect(await fs.readFile(source)).toEqual(bytes);
    }
  });
  it('copies binary attachments into compatible storage and survives source deletion and restart', async () => {
    const { temporary, root, assets } = await fixture();
    const source = path.join(temporary, 'résumé 🌍.pdf'), bytes = Buffer.from([0, 1, 128, 255]);
    await fs.writeFile(source, bytes);
    const imported = await assets.importFile(source);
    expect(path.dirname(imported.path)).toBe(path.join(root, 'files'));
    expect(imported.name).toBe('résumé 🌍.pdf'); expect(imported.size).toBe(4);
    expect(imported.path).toMatch(/\.pdf$/);
    await fs.unlink(source);
    const restarted = new HyperAssets(() => root);
    expect(await restarted.previewUrl(imported.path)).toBe(imported.previewUrl);
    expect(await fs.readFile(await restarted.resolve(imported.previewUrl))).toEqual(bytes);
    if (process.platform !== 'win32') expect((await fs.stat(imported.path)).mode & 0o777).toBe(0o600);
  });
  it('imports images separately and never replaces same-named attachments', async () => {
    const { temporary, root, assets } = await fixture();
    const source = path.join(temporary, 'image.png'); await fs.writeFile(source, 'first');
    const first = await assets.importFile(source, 'image'); await fs.writeFile(source, 'second');
    const second = await assets.importFile(source, 'image');
    expect(path.dirname(first.path)).toBe(path.join(root, 'images'));
    expect(first.path).not.toBe(second.path);
    expect(await fs.readFile(first.path, 'utf8')).toBe('first');
    expect(await fs.readFile(second.path, 'utf8')).toBe('second');
    expect((await fs.readdir(path.join(root, 'images'))).some(name => name.endsWith('.partial'))).toBe(false);
  });
  it('exports managed binary content without replacing existing files or reading outside storage', async () => {
    const { temporary, assets } = await fixture();
    const source = path.join(temporary, 'source.pdf'); await fs.writeFile(source, Buffer.from([0, 255, 128]));
    const imported = await assets.importFile(source);
    const exported = path.join(temporary, 'exported.pdf');
    await assets.exportFile(imported.path, exported);
    expect(await fs.readFile(exported)).toEqual(Buffer.from([0, 255, 128]));
    await expect(assets.exportFile(imported.path, exported)).rejects.toThrow();
    expect(await fs.readFile(exported)).toEqual(Buffer.from([0, 255, 128]));
    await expect(assets.exportFile(source, path.join(temporary, 'bad.pdf'))).rejects.toThrow();
    expect(await assets.inlineUrl(imported.previewUrl)).toBe('data:application/octet-stream;base64,AP+A');
  });
  it('uses safe image data URLs and bounds clipboard reads', async () => {
    const { temporary, assets } = await fixture();
    const source = path.join(temporary, 'source.PNG'); await fs.writeFile(source, Buffer.from([1, 2, 3]));
    const imported = await assets.importFile(source, 'image');
    expect(await assets.inlineUrl(imported.path)).toBe('data:image/png;base64,AQID');
    await fs.truncate(imported.path, 16 * 1024 * 1024 + 1);
    await expect(assets.inlineUrl(imported.path)).rejects.toThrow('too large');
  });
  it('replaces finished export text atomically and removes a temporary file on failure', async () => {
    const { temporary, assets } = await fixture();
    const target = path.join(temporary, 'page.md'); await fs.writeFile(target, 'old');
    await assets.writeExportText(target, 'New 🌍 export');
    expect(await fs.readFile(target, 'utf8')).toBe('New 🌍 export');
    const directory = path.join(temporary, 'directory'); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'keep'), 'original');
    await expect(assets.writeExportText(directory, 'cannot replace a directory')).rejects.toThrow();
    expect(await fs.readFile(path.join(directory, 'keep'), 'utf8')).toBe('original');
    expect((await fs.readdir(temporary)).some(name => name.endsWith('.partial'))).toBe(false);
  });
  it('can replace a valid long export basename', async () => {
    const { temporary, assets } = await fixture();
    const target = path.join(temporary, `${'x'.repeat(220)}.md`);
    await fs.writeFile(target, 'old');
    await assets.writeExportText(target, 'new');
    expect(await fs.readFile(target, 'utf8')).toBe('new');
  });
  it('requires initialized storage and a regular local source', async () => {
    const { temporary, root, assets } = await fixture();
    await expect(new HyperAssets(() => null).importFile(path.join(root, 'missing'))).rejects.toThrow();
    const source = path.join(temporary, 'file'); await fs.writeFile(source, 'data');
    await expect(new HyperAssets(() => null).importFile(source)).rejects.toThrow('not initialized');
    await expect(assets.importFile(root)).rejects.toThrow('regular file');
    await expect(assets.importFile('relative.txt')).rejects.toThrow('local file');
    await expect(assets.importFile(source, 'other' as 'file')).rejects.toThrow('kind');
    await expect(assets.previewUrl(source)).rejects.toThrow('outside attachment');
  });
  it('rejects protocol traversal, foreign origins, queries and encoded path separators', async () => {
    const { temporary, assets } = await fixture();
    const source = path.join(temporary, 'file'); await fs.writeFile(source, 'private data');
    const file = await assets.importFile(source);
    for (const url of ['file:///etc/passwd', 'appflowy-file://foreign/files/item', 'appflowy-file://local/files/%2e%2e%2fprivate', 'appflowy-file://local/files/%5cprivate', 'appflowy-file://local/files/%00', 'appflowy-file://local/files/a/b', `${file.previewUrl}?query=1`, `${file.previewUrl}#hash`, 'appflowy-file://user@local/files/item']) {
      await expect(assets.resolve(url), url).rejects.toThrow();
    }
  });
  it.skipIf(process.platform === 'win32')('rejects symlink escapes in imported and existing storage', async () => {
    const { temporary, root, assets } = await fixture();
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, 'files'));
    const source = path.join(temporary, 'secret'); await fs.writeFile(source, 'secret');
    await expect(assets.importFile(source)).rejects.toThrow('regular storage');
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.unlink(path.join(root, 'files')); await fs.mkdir(path.join(root, 'files'));
    await fs.symlink(source, path.join(root, 'files', 'secret'));
    await expect(assets.resolve('appflowy-file://local/files/secret')).rejects.toThrow('outside storage');
  });
  it.skipIf(process.platform === 'win32')('keeps existing files readable through a configured data-directory alias', async () => {
    const { temporary, root, assets } = await fixture();
    const source = path.join(temporary, 'file.png'); await fs.writeFile(source, 'image');
    const imported = await assets.importFile(source, 'image');
    const alias = path.join(temporary, 'data-alias'); await fs.symlink(root, alias);
    const existing = path.join(alias, 'images', path.basename(imported.path));
    expect(await new HyperAssets(() => alias).previewUrl(existing)).toBe(imported.previewUrl);
  });
  it('preserves existing assets and changes roots only when the active workspace storage changes', async () => {
    const { temporary, root, assets } = await fixture();
    await fs.mkdir(path.join(root, 'images')); const old = path.join(root, 'images', 'old name.png');
    await fs.writeFile(old, 'existing');
    expect(await assets.previewUrl(old)).toBe('appflowy-file://local/images/old%20name.png');
    const other = path.join(temporary, 'other'); await fs.mkdir(other);
    let selected = root; const changing = new HyperAssets(() => selected);
    const imported = await changing.importFile(old); selected = other;
    await expect(changing.previewUrl(imported.path)).rejects.toThrow();
    expect(await fs.readFile(old, 'utf8')).toBe('existing');
    selected = root; expect(await changing.resolve(imported.previewUrl)).toBe(imported.path);
  });
});
