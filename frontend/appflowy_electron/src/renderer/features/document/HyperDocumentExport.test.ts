import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperEditText, hyperInsertBlock } from './HyperDocumentModel';
import { hyperDocumentHasCanvas, hyperExportDocument, hyperSafeUrl } from './HyperDocumentExport';
import { hyperInsertCanvasElement } from '../whiteboard/HyperWhiteboardModel';

function document(type = 'paragraph', data = {}, text = 'Hello') {
  const doc = create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', childrenId: 'children', data: '{}' }, p: { id: 'p', parentId: 'root', ty: type, childrenId: 'p-children', data: JSON.stringify({ ...data, delta: [{ insert: text }] }) } }, meta: { childrenMap: { children: { children: ['p'] } } } });
  return doc;
}
describe('Hyper document export', () => {
  it('exports page text and canvas together without duplicating the drawing', () => {
    const shape = hyperInsertCanvasElement(document(), 'rectangle', { x: 0, y: 0, width: 200, height: 100 });
    const note = hyperInsertCanvasElement(shape.document, 'note', { x: 220, y: 0, width: 200, height: 100 }, { text: 'Shared <script> note' });
    expect(hyperDocumentHasCanvas(note.document)).toBe(true);
    const html = hyperExportDocument(note.document, 'html', 'Page & canvas');
    expect(html).toContain('<p>Hello</p>');
    expect(html).toContain('<svg'); expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('Shared &lt;script&gt; note'); expect(html).not.toContain('<script>');
    const markdown = hyperExportDocument(note.document, 'markdown', 'Page', { canvasUrl: 'Page.canvas-123.svg' });
    expect(markdown).toContain('Hello'); expect(markdown).toContain('![Page](<Page.canvas-123.svg>)');
    expect(markdown).not.toContain('<svg');
    expect(hyperExportDocument(note.document, 'markdown')).toContain('<svg');
  });
  it('rejects unsafe companion URLs, unknown canvas elements and hidden nested data', () => {
    const inserted = hyperInsertCanvasElement(document(), 'text', { x: 0, y: 0, width: 100, height: 80 }, { text: 'Canvas' });
    expect(() => hyperExportDocument(inserted.document, 'markdown', '', { canvasUrl: 'javascript:bad.svg' })).toThrow('sibling SVG');
    const unknown = hyperInsertBlock(inserted.document, inserted.document.blocks[inserted.focus!.id].parentId, inserted.focus!.id, 'hyper_canvas_future', { version: 2 });
    expect(() => hyperExportDocument(unknown.document, 'html')).toThrow('unsupported');
    const nested = hyperInsertBlock(inserted.document, inserted.focus!.id, '', 'paragraph');
    expect(() => hyperExportDocument(nested.document, 'html')).toThrow('nested');
  });
  it('escapes user content, titles and malicious link schemes in HTML', () => {
    const doc = hyperEditText(document(), 'p', [{ insert: '<img onerror="alert(1)">', attributes: { bold: true, href: 'javascript:alert(1)' } }]).document;
    const html = hyperExportDocument(doc, 'html', '<script>bad</script>');
    expect(html).toContain('<strong>&lt;img');
    expect(html).toContain('<title>&lt;script&gt;bad&lt;/script&gt;</title>');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('javascript:');
  });
  it('exports headings, checkboxes, nested lists and inline styles', () => {
    let doc = document('heading', { level: 2 });
    const list = hyperInsertBlock(doc, 'root', 'p', 'todo_list', { checked: true });
    doc = hyperEditText(list.document, list.focus!.id, [{ insert: 'task', attributes: { bold: true } }]).document;
    const nested = hyperInsertBlock(doc, list.focus!.id, '', 'bulleted_list');
    doc = hyperEditText(nested.document, nested.focus!.id, [{ insert: 'nested' }]).document;
    expect(hyperExportDocument(doc, 'markdown', 'Title')).toBe('# Title\n\n## Hello\n\n- [x] **task**\n\n  - nested\n');
    expect(hyperExportDocument(doc, 'html')).toContain('<input type="checkbox" disabled checked> <strong>task</strong>');
  });
  it('uses a longer code fence when code contains triple backticks', () => {
    expect(hyperExportDocument(document('code', { language: 'typescript' }, '```\nconst x = 1;'), 'markdown')).toContain('````typescript\n```\nconst x = 1;\n````');
  });
  it('keeps image alternative text separate from the visible caption and file name', () => {
    const image = document('image', { url: 'https://example.org/drawing.png', name: 'drawing.png', alt: 'A <map>', caption: 'Route & stops', image_type: 2 });
    const html = hyperExportDocument(image, 'html');
    expect(html).toContain('alt="A &lt;map&gt;"');
    expect(html).toContain('<figcaption>Route &amp; stops</figcaption>');
    expect(hyperExportDocument(image, 'markdown')).toContain('![A \\<map\\>](<https://example.org/drawing.png>)\n\nRoute & stops');
  });
  it('keeps formatting and escapes raw HTML in Markdown quotes and callouts', () => {
    for (const type of ['quote', 'callout']) {
      const doc = hyperEditText(document(type), 'p', [{ insert: '<img src=x onerror=alert(1)>', attributes: { bold: true } }]).document;
      expect(hyperExportDocument(doc, 'markdown')).toBe('> **\\<img src=x onerror=alert\\(1\\)\\>**\n');
    }
  });
  it('keeps literal Markdown block markers inside paragraph text', () => {
    for (const [input, output] of [['# Literal heading', '\\# Literal heading'], ['1. Literal number', '1\\. Literal number'], ['- Literal bullet', '\\- Literal bullet'], ['+ Literal bullet', '\\+ Literal bullet'], ['~~literal~~', '\\~\\~literal\\~\\~']]) {
      expect(hyperExportDocument(document('paragraph', {}, input), 'markdown')).toBe(`${output}\n`);
    }
  });
  it('keeps page mention targets and permission-checked labels instead of dollar tokens', () => {
    const doc = hyperEditText(document(), 'p', [{ insert: '$', attributes: { mention: { type: 'page', page_id: 'linked-view' }, bold: true } }]).document;
    expect(hyperExportDocument(doc, 'markdown')).toBe('**linked\\-view**\n');
    const options = { pageMentions: { 'linked-view': { label: 'Linked <page>', url: 'https://workspace.example/app/workspace/linked-view' } } };
    const html = hyperExportDocument(doc, 'html', '', options);
    expect(html).toContain('data-hyper-page-id="linked-view"');
    expect(html).toContain('href="https://workspace.example/app/workspace/linked-view"');
    expect(html).toContain('<strong>Linked &lt;page&gt;</strong>');
    expect(hyperExportDocument(doc, 'markdown', '', { pageMentions: { 'linked-view': { label: 'Page unavailable', url: 'javascript:bad' } } })).toContain('Page unavailable** \\[page: linked\\-view\\]');
  });
  it('exports validated AppFlowy text colors and ignores executable CSS values', () => {
    const doc = hyperEditText(document(), 'p', [{ insert: 'Colored', attributes: { font_color: '0xff12ab34', bg_color: '#ff00ee80', href: 'https://example.org' } }]).document;
    expect(hyperExportDocument(doc, 'html')).toContain('<span style="color:#12ab34ff;background-color:#ff00ee80">Colored</span>');
    const invalid = hyperEditText(doc, 'p', [{ insert: 'Safe', attributes: { font_color: 'red; background:url(https://leak)', bg_color: 'var(--secret)' } }]).document;
    expect(hyperExportDocument(invalid, 'html')).not.toContain('style=');
  });
  it('groups ordered HTML siblings and nests Markdown children under the complete marker', () => {
    const first = document('numbered_list', {}, 'First');
    const child = hyperInsertBlock(first, 'p', '', 'bulleted_list');
    const nested = hyperEditText(child.document, child.focus!.id, [{ insert: 'Nested' }]);
    const next = hyperInsertBlock(nested.document, 'root', 'p', 'numbered_list');
    const doc = hyperEditText(next.document, next.focus!.id, [{ insert: 'Second' }]).document;
    const html = hyperExportDocument(doc, 'html');
    expect(html.match(/<ol>/g)).toHaveLength(1);
    expect(html).toContain('<li>First<ul><li>Nested</li></ul></li>');
    expect(html).toContain('<li>Second</li>');
    expect(hyperExportDocument(doc, 'markdown')).toBe('1. First\n\n   - Nested\n\n1. Second\n');
  });
  it('refuses incomplete exports for unsupported blocks or broken trees', () => {
    expect(() => hyperExportDocument(document('grid'), 'markdown')).toThrow('grid');
    const broken = document(); broken.meta!.childrenMap.children.children.push('missing');
    expect(() => hyperExportDocument(broken, 'html')).toThrow('missing');
    const cyclic = document(); cyclic.meta!.childrenMap['p-children'] = { $typeName: 'ChildrenPB', children: ['p'] };
    expect(() => hyperExportDocument(cyclic, 'markdown')).toThrow('cycle');
  });
  it('allows safe URLs and rejects executable, file, malformed and data URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', '//host/a', 'https://']) expect(hyperSafeUrl(url)).toBeNull();
    expect(hyperSafeUrl('https://example.org/a?x=1')).toBe('https://example.org/a?x=1');
    expect(hyperExportDocument(document('image', { url: 'javascript:bad', caption: '<unsafe>' }), 'html')).not.toContain('<img');
  });
});
