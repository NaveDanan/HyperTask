import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperEditCanvasLabel, hyperInsertCanvasElement } from './HyperWhiteboardModel';
import { hyperUpdateBlock } from '../document/HyperDocumentModel';
import { hyperExportWhiteboardSVG, hyperPrepareWhiteboardExport } from './HyperWhiteboardExport';

const empty = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=';
describe('Hyper canvas SVG export', () => {
  it('exports current shared note text with XML escaping and no executable resources', () => {
    const note = hyperInsertCanvasElement(empty(), 'note', { x: -40, y: 30, width: 220, height: 80 }, { text: 'Old' });
    const edited = hyperEditCanvasLabel(note.document, note.focus!.id, '<script>bad()</script> & "new"\u0000');
    const svg = hyperExportWhiteboardSVG(edited.document, { title: '<unsafe title>' });
    expect(svg).toContain('&lt;script&gt;bad()&lt;/script&gt; &amp; &quot;new&quot;');
    expect(svg).toContain('&lt;unsafe title&gt;');
    expect(svg).not.toContain('<script>'); expect(svg).not.toContain('\u0000'); expect(svg).not.toContain('Old');
    expect(svg).not.toMatch(/<image|foreignObject|href=|style=/);
  });
  it('includes all lines of long notes and expands export bounds without changing storage', () => {
    const text = Array.from({ length: 25 }, (_, index) => `Line ${index}`).join('\n');
    const note = hyperInsertCanvasElement(empty(), 'note', { x: 0, y: 0, width: 220, height: 80 }, { text });
    const before = JSON.stringify(note.document), svg = hyperExportWhiteboardSVG(note.document);
    expect(svg).toContain('Line 24'); expect((svg.match(/<tspan /g) ?? [])).toHaveLength(25);
    expect(Number(/<svg[^>]* height="([\d.]+)"/.exec(svg)![1])).toBeGreaterThan(500);
    expect(JSON.stringify(note.document)).toBe(before);
  });
  it('uses resolved theme colors, rejects paint URLs and exports an exact frame viewport', () => {
    const frame = hyperInsertCanvasElement(empty(), 'frame', { x: -100, y: -50, width: 1000, height: 600 });
    const svg = hyperExportWhiteboardSVG(frame.document, { frameId: frame.focus!.id, colors: { foreground: 'rgb(12, 13, 14)' }, background: '#123456' });
    expect(svg).toContain('viewBox="-100 -50 1000 600"'); expect(svg).toContain('stroke="rgb(12, 13, 14)"'); expect(svg).toContain('fill="#123456"');
    expect(() => hyperExportWhiteboardSVG(frame.document, { background: 'url(https://example.test/image)' })).toThrow('self-contained');
    expect(() => hyperExportWhiteboardSVG(frame.document, { frameId: 'missing' })).toThrow('frame');
    const outside = hyperInsertCanvasElement(frame.document, 'note', { x: 5000, y: 5000, width: 220, height: 80 }, { text: 'Outside frame private text' });
    expect(hyperExportWhiteboardSVG(outside.document, { frameId: frame.focus!.id })).not.toContain('Outside frame private text');
  });
  it('refuses unsupported data instead of silently dropping canvas elements', () => {
    const element = hyperInsertCanvasElement(empty(), 'rectangle', { x: 0, y: 0, width: 20, height: 20 });
    const unknown = hyperUpdateBlock(element.document, element.focus!.id, { version: 2 });
    expect(() => hyperExportWhiteboardSVG(unknown.document)).toThrow('unsupported');
    expect(hyperExportWhiteboardSVG(empty())).toContain('width="800" height="600"');
  });
  it('embeds only validated image bytes with escaped descriptions and no local paths', async () => {
    const source = '/workspace/images/private generated.png';
    const image = hyperInsertCanvasElement(empty(), 'image', { x: 12, y: 24, width: 80, height: 120 }, { imagePath: source, alt: 'A <private> & "descriptive" sketch' });
    expect(() => hyperExportWhiteboardSVG(image.document)).toThrow('embedded');
    const inline = vi.fn(async () => raster);
    const options = await hyperPrepareWhiteboardExport(image.document, { title: 'Generated sketch' }, inline);
    const svg = hyperExportWhiteboardSVG(image.document, options);
    expect(inline).toHaveBeenCalledExactlyOnceWith(source);
    expect(svg).toContain(`<image x="12" y="24" width="80" height="120" href="${raster}"`);
    expect(svg).toContain('A &lt;private&gt; &amp; &quot;descriptive&quot; sketch');
    expect(svg).not.toContain(source); expect(svg).not.toContain('file:'); expect(svg).not.toContain('<text');
    expect(svg).toContain('viewBox="-12 0 128 168"');
  });
  it('rejects missing, external, executable and mismatched image content', async () => {
    const image = hyperInsertCanvasElement(empty(), 'image', { x: 0, y: 0, width: 20, height: 30 }, { imagePath: '/workspace/images/private.png' });
    for (const data of ['https://example.test/private.png', 'file:///workspace/images/private.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/jpeg;base64,iVBORw0KGgo=', 'data:image/png;base64,bm90IGFuIGltYWdl', 'data:image/png;base64,%%%']) {
      expect(() => hyperExportWhiteboardSVG(image.document, { images: { [image.focus!.id]: data } })).toThrow();
      await expect(hyperPrepareWhiteboardExport(image.document, {}, async () => data)).rejects.toThrow('could not be embedded');
    }
    await expect(hyperPrepareWhiteboardExport(image.document, {}, async () => { throw new Error('missing'); })).rejects.toThrow('Restore');
    const inherited = Object.create({ [image.focus!.id]: raster }) as Record<string, string>;
    expect(() => hyperExportWhiteboardSVG(image.document, { images: inherited })).toThrow('embedded');
  });
  it('deduplicates managed reads and bounds concurrent preparation for distinct files', async () => {
    let doc = empty();
    for (let index = 0; index < 10; index++) doc = hyperInsertCanvasElement(doc, 'image', { x: index * 25, y: 0, width: 20, height: 20 }, { imagePath: `/workspace/images/image-${index % 7}.png` }).document;
    let active = 0, max = 0;
    const inline = vi.fn(async () => { active++; max = Math.max(active, max); await Promise.resolve(); active--; return raster; });
    const options = await hyperPrepareWhiteboardExport(doc, {}, inline);
    expect(inline).toHaveBeenCalledTimes(7); expect(max).toBeLessThanOrEqual(4);
    expect(Object.keys(options.images!)).toHaveLength(10);
    expect((hyperExportWhiteboardSVG(doc, options).match(/<image /g) ?? [])).toHaveLength(10);
  });
  it('embeds images only inside the selected frame and preserves pure exports without images', async () => {
    const frame = hyperInsertCanvasElement(empty(), 'frame', { x: 0, y: 0, width: 200, height: 200 });
    const outside = hyperInsertCanvasElement(frame.document, 'image', { x: 500, y: 500, width: 100, height: 100 }, { imagePath: '/workspace/images/outside.png' });
    const inline = vi.fn(async () => { throw new Error('outside frame missing'); });
    const options = await hyperPrepareWhiteboardExport(outside.document, { frameId: frame.focus!.id }, inline);
    expect(inline).not.toHaveBeenCalled(); expect(hyperExportWhiteboardSVG(outside.document, options)).not.toContain('<image');
    const plain = { title: 'Empty canvas' };
    expect(await hyperPrepareWhiteboardExport(empty(), plain, inline)).toBe(plain);
  });
  it('limits total embedded characters including repeated copies of the same image', async () => {
    let doc = empty();
    const large = `data:image/png;base64,${'iVBORw0KGgoA'.repeat(1_500_000)}`;
    for (let index = 0; index < 3; index++) doc = hyperInsertCanvasElement(doc, 'image', { x: index * 25, y: 0, width: 20, height: 20 }, { imagePath: '/workspace/images/repeated.png' }).document;
    const inline = vi.fn(async () => large);
    await expect(hyperPrepareWhiteboardExport(doc, {}, inline)).rejects.toThrow('too large');
    expect(inline).toHaveBeenCalledTimes(1);
  });
});
