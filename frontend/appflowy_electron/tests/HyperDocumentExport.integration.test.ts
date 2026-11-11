import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { create } from '@bufbuild/protobuf';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperAssets } from '../src/main/HyperAssets';
import { hyperInsertCanvasElement } from '@/features/whiteboard/HyperWhiteboardModel';
import { hyperDocumentLocalAssets, hyperExportDocument } from '@/features/document/HyperDocumentExport';
import { hyperCopyDocumentExport, hyperSaveDocumentExport } from '@/features/document/HyperDocumentExportBundle';
import { hyperEditText, hyperInsertBlock } from '@/features/document/HyperDocumentModel';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-document-export-')); temporary.push(dir);
  const data = path.join(dir, 'data'); await fs.mkdir(data);
  const assets = new HyperAssets(() => data);
  const imagePath = path.join(dir, 'drawing.svg');
  await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const image = await assets.importFile(imagePath, 'image');
  const document = create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', data: '{}', childrenId: 'root-children' },
    a: { id: 'a', ty: 'image', parentId: 'root', data: JSON.stringify({ url: image.path, image_type: 0, caption: 'A <drawing>' }) },
    b: { id: 'b', ty: 'file', parentId: 'root', data: JSON.stringify({ url: image.path, url_type: 0, name: 'Shared drawing.svg' }) },
    detached: { id: 'detached', ty: 'image', data: JSON.stringify({ url: '/not/read.png' }) },
  }, meta: { childrenMap: { 'root-children': { children: ['a', 'b'] } } } });
  return { dir, document, image, io: { assets, writeText: (target: string, value: string) => assets.writeExportText(target, value) } };
}
describe('Hyper document export with attachments', () => {
  it('packages shared attachments once beside HTML and preserves their content independently', async () => {
    const { dir, document, image, io } = await fixture();
    expect(hyperDocumentLocalAssets(document)).toEqual([image.path]);
    const target = path.join(dir, "my page's export.html");
    await hyperSaveDocumentExport(document, 'html', '<Page>', target, {}, io);
    const html = await fs.readFile(target, 'utf8'), filename = html.match(/<img src="([^"]+)"/)![1];
    expect(html).toContain(`href="${filename}" download="Shared drawing.svg"`);
    expect(html).toContain('alt="A &lt;drawing&gt;"'); expect(html).not.toContain(image.path);
    expect(filename).toMatch(/^HyperTask\.asset-[\da-f-]+\.svg$/);
    await fs.unlink(image.path);
    expect(await fs.readFile(path.join(dir, decodeURIComponent(filename)), 'utf8')).toContain('<svg');
    expect((await fs.readdir(dir)).filter(name => name.includes('.asset-'))).toHaveLength(1);
  });
  it('exports Markdown companions and canvas together, with portable sibling paths', async () => {
    const { dir, document, io } = await fixture();
    const drawing = hyperInsertCanvasElement(document, 'rectangle', { x: 10, y: 20, width: 50, height: 40 });
    const target = path.join(dir, 'page.md');
    await hyperSaveDocumentExport(drawing.document, 'markdown', 'Page', target, {}, io);
    const markdown = await fs.readFile(target, 'utf8');
    expect(markdown).toContain('.asset-'); expect(markdown).toContain('.canvas-'); expect(markdown).not.toContain('<svg');
    const references = [...markdown.matchAll(/\]\(<([^>]+)>\)/g)].map(match => match[1]);
    for (const filename of references) expect(await fs.readFile(path.join(dir, decodeURIComponent(filename)), 'utf8')).toContain('<svg');
  });
  it('embeds managed canvas images into HTML, Markdown companions and clipboard without local paths', async () => {
    const { dir, document, io } = await fixture();
    const source = path.join(dir, 'generated.png');
    await fs.writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
    const image = await io.assets.importFile(source, 'image');
    let canvas = hyperInsertCanvasElement(document, 'image', { x: 10, y: 20, width: 50, height: 40 }, { imagePath: image.path, alt: 'Canvas image 🌍' }).document;
    canvas = hyperInsertCanvasElement(canvas, 'image', { x: 80, y: 20, width: 50, height: 40 }, { imagePath: image.path, alt: 'Same image' }).document;
    const inlineUrl = vi.spyOn(io.assets, 'inlineUrl');
    const htmlTarget = path.join(dir, 'canvas.html');
    await hyperSaveDocumentExport(canvas, 'html', 'Page', htmlTarget, {}, io);
    const html = await fs.readFile(htmlTarget, 'utf8');
    expect(html).toContain('<image '); expect(html).toContain('href="data:image/png;base64,');
    expect(html).toContain('Canvas image 🌍'); expect(html).not.toContain(image.path);
    expect(inlineUrl).toHaveBeenCalledTimes(1);
    const markdownTarget = path.join(dir, 'canvas.md');
    await hyperSaveDocumentExport(canvas, 'markdown', 'Page', markdownTarget, {}, io);
    const markdown = await fs.readFile(markdownTarget, 'utf8'), companion = markdown.match(/\]\(<(HyperTask\.canvas-[^>]+)>\)/)![1];
    const svg = await fs.readFile(path.join(dir, companion), 'utf8');
    expect(svg).toContain('href="data:image/png;base64,'); expect(svg).not.toContain(image.path);
    const copied = await hyperCopyDocumentExport(canvas, 'Page', {}, io);
    expect(copied).toContain('<image '); expect(copied).toContain('href="data:image/png;base64,'); expect(copied).not.toContain(image.path);
    await fs.unlink(source); await fs.unlink(image.path);
    expect(await fs.readFile(path.join(dir, companion), 'utf8')).toBe(svg);
    await fs.writeFile(htmlTarget, 'Previous export');
    await expect(hyperSaveDocumentExport(canvas, 'html', 'Page', htmlTarget, {}, io)).rejects.toThrow('could not be embedded');
    expect(await fs.readFile(htmlTarget, 'utf8')).toBe('Previous export');
  });
  it('keeps companion names bounded for a valid long output basename', async () => {
    const { dir, document, io } = await fixture();
    const drawing = hyperInsertCanvasElement(document, 'rectangle', { x: 10, y: 20, width: 50, height: 40 });
    const target = path.join(dir, `${'x'.repeat(220)}.md`);
    await hyperSaveDocumentExport(drawing.document, 'markdown', 'Page', target, {}, io);
    const markdown = await fs.readFile(target, 'utf8');
    expect(markdown).toContain('HyperTask.asset-'); expect(markdown).toContain('HyperTask.canvas-');
    for (const name of await fs.readdir(dir)) expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
  });
  it.skipIf(process.platform === 'win32')('keeps a literal POSIX backslash in the output basename out of companion paths', async () => {
    const { dir, document, io } = await fixture();
    const target = path.join(dir, 'a\\b.html');
    await hyperSaveDocumentExport(document, 'html', 'Page', target, {}, io);
    const html = await fs.readFile(target, 'utf8'), filename = html.match(/<img src="([^"]+)"/)![1];
    expect(await fs.readFile(path.join(dir, decodeURIComponent(filename)), 'utf8')).toContain('<svg');
  });
  it('inlines shared local bytes for clipboard without exposing machine paths', async () => {
    const { document, image, io } = await fixture();
    const inlineUrl = vi.spyOn(io.assets, 'inlineUrl');
    const markdown = await hyperCopyDocumentExport(document, 'Page', {}, io);
    expect(inlineUrl).toHaveBeenCalledTimes(1); expect(markdown).toContain('data:image/svg+xml;base64,');
    expect(markdown).not.toContain(image.path);
    expect(() => hyperExportDocument(document, 'html')).toThrow('must be included');
    for (const url of ['../outside.svg', 'https://outside/image.svg', 'javascript:bad', 'data:text/html;base64,PHNjcmlwdD4=', '%2Fetc%2Fpasswd']) {
      expect(() => hyperExportDocument(document, 'html', '', { mediaUrls: { [image.path]: url } })).toThrow();
    }
  });
  it('resolves page titles once and preserves inaccessible targets without an external link', async () => {
    const { dir, document, io } = await fixture();
    const inserted = hyperInsertBlock(document, 'root', 'b', 'paragraph');
    const doc = hyperEditText(inserted.document, inserted.focus!.id, [
      { insert: '$', attributes: { mention: { type: 'page', page_id: 'readable' } } },
      { insert: '$', attributes: { mention: { type: 'page', page_id: 'readable' } } },
      { insert: '$', attributes: { mention: { type: 'page', page_id: 'forbidden' } } },
    ]).document;
    const page = vi.fn(async (id: string) => { if (id === 'forbidden') throw new Error('A private title must never appear'); return { label: 'Visible page', url: 'https://selfhost.example/app/workspace/readable' }; });
    const target = path.join(dir, 'page.html');
    await hyperSaveDocumentExport(doc, 'html', 'Page', target, {}, { ...io, page });
    const html = await fs.readFile(target, 'utf8');
    expect(page).toHaveBeenCalledTimes(2);
    expect(html).toContain('Visible page'); expect(html).toContain('https://selfhost.example/app/workspace/readable');
    expect(html).toContain('data-hyper-page-id="forbidden">forbidden');
    expect(html).not.toContain('private title'); expect(html).not.toContain('>$<');
  });
  it('validates unsupported blocks before copying and keeps an old export if an attachment fails', async () => {
    const { dir, document, image, io } = await fixture();
    const target = path.join(dir, 'page.md'); await fs.writeFile(target, 'previous export');
    const exportFile = vi.spyOn(io.assets, 'exportFile');
    document.blocks.b.ty = 'future-block';
    await expect(hyperSaveDocumentExport(document, 'markdown', '', target, {}, io)).rejects.toThrow('future-block');
    expect(exportFile).not.toHaveBeenCalled();
    document.blocks.b.ty = 'file'; await fs.unlink(image.path);
    await expect(hyperSaveDocumentExport(document, 'markdown', '', target, {}, io)).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('previous export');
  });
});
