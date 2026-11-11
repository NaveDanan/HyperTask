import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HYPER_MATH_FONT_MARKER } from '@shared/HyperMathFont';
import { hyperExportDocument } from '../document/HyperDocumentExport';
import { hyperCopyDocumentExport, hyperSaveDocumentExport } from '../document/HyperDocumentExportBundle';
import { markdownToEditorJson, parseInline } from '../sidebar/import/markdown';
import type { HyperTextRun } from '../document/HyperDocumentModel';
import { HYPER_INLINE_MATH_EXPORT_ATOMS, hyperExportInlineMath } from './HyperInlineMathExport';
import { HYPER_INLINE_MATH_MARKER, HYPER_INLINE_MATH_MARKER_BYTES, hyperInlineMathPortableMarker, hyperParseInlineMathMarker, hyperParseInlineMathMarkdown } from './HyperInlineMathPortable';

const atom = (formula = 'x_1+1', insert = '$', attributes: Record<string, unknown> = {}): HyperTextRun => ({ insert, attributes: { formula, ...attributes } });
const document = (runs: HyperTextRun[], ty = 'paragraph') => create(DocumentDataPBSchema, { pageId: 'page', blocks: {
  page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' },
  text: { id: 'text', ty, parentId: 'page', childrenId: 'text-children', data: JSON.stringify({ delta: runs, unknown: { retain: true } }) },
}, meta: { childrenMap: { children: { children: ['text'] } } } });
const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe('Hyper inline math portable source and export', () => {
  it('round-trips merged atoms, emoji, full attributes and arbitrary TeX through one-line Markdown source spans', () => {
    const formula = '  \\unknown{🌍} % exact\r\n`literal` [^note]: **source** $ \\n  ', source = atom(formula, '$$', { bold: true, opaque: { kept: ['value', 7] } });
    const runs = [{ insert: '🌍 Before ' }, source, { insert: ' after' }], doc = document(runs), before = JSON.stringify(doc);
    const markdown = hyperExportDocument(doc, 'markdown');
    expect(markdown.match(/data-hyper-inline-math-source=/g)).toHaveLength(2);
    expect(markdown.trimEnd().split('\n')).toHaveLength(1); expect(markdown).not.toContain('<math'); expect(markdown).toContain('&#13;&#10;');
    expect(markdownToEditorJson(markdown).children[0].data.delta).toEqual(runs);
    expect(hyperParseInlineMathMarkdown(hyperExportInlineMath(atom(formula), false)!)).toEqual(atom(formula)); expect(JSON.stringify(doc)).toBe(before);
  });
  it('renders inline MathML with portable metadata and exactly one bundled font sheet for HTML/PDF', () => {
    const html = hyperExportDocument(document([{ insert: '🌍 Before ' }, atom(String.raw`\frac{a}{b}`, '$$'), { insert: ' after' }]), 'html');
    expect(html.match(/class="hyper-document-inline-equation"/g)).toHaveLength(2); expect(html.match(/<math\b/g)).toHaveLength(2);
    expect(html).not.toContain('display="block"'); expect(html).toContain('.hyper-document-inline-equation math');
    expect(html.match(/data-hyper-math-font=/g)).toHaveLength(1); expect(html).toContain(HYPER_MATH_FONT_MARKER);
    expect(html).toContain('🌍 Before '); expect(html).toContain(' after');
    const marked = hyperExportInlineMath(atom('x', '$', { bold: true, italic: true, underline: true, strikethrough: true, font_color: '0xff12ab34', bg_color: '#fff' }), true)!;
    expect(marked).toContain('font-weight:700;font-style:italic;text-decoration:underline line-through;color:#12ab34ff;background-color:#ffffff');
    expect(hyperExportInlineMath(atom('x', '$', { font_color: 'url(https://example.invalid)' }), true)).not.toContain('style=');
  });
  it('does not infer equations from currency, dollars, code, links, display-math bodies or live DOM metadata', () => {
    const span = hyperExportInlineMath(atom(), false)!;
    for (const source of ['$5 and $10', '$x_1$', String.raw`\$x\$`, '`' + span + '`', '[' + span + '](https://example.invalid)', '<span data-hyper-inline-math data-hyper-atomic="\"$\"">x</span>']) expect(parseInline(source).some(run => Object.hasOwn(run.attributes ?? {}, 'formula'))).toBe(false);
    const fenced = markdownToEditorJson('```html\n' + span + '\n```'); expect(fenced.children[0].type).toBe('code'); expect(fenced.children[0].data.delta).toEqual([{ insert: span }]);
    const block = markdownToEditorJson('$$\n' + span + '\n$$'); expect(block.children[0].type).toBe('math_equation'); expect(block.children[0].data.formula).toBe(span);
  });
  it('does not convert conflicting, future or mismatched portable markers', () => {
    for (const value of [
      { version: 2, insert: '$', attributes: { formula: 'x' } },
      { version: 1, insert: '$', attributes: { formula: { future: true } } },
      { version: 1, insert: '$', attributes: { formula: 'x', mention: { type: 'page', page_id: 'private' } } },
      { version: 1, insert: '$', attributes: { formula: 'x' }, future: true },
      { version: 1, insert: {}, attributes: { formula: 'x' } },
    ]) {
      const marker = encoded(value), span = `<span ${HYPER_INLINE_MATH_MARKER}="${marker}">x</span>`;
      expect(hyperParseInlineMathMarker(marker)).toBeNull(); expect(hyperParseInlineMathMarkdown(span)).toBeNull(); expect(parseInline(span)).toEqual([{ insert: span }]);
    }
    const span = hyperExportInlineMath(atom('x'), false)!.replace('>x<', '>different<'); expect(hyperParseInlineMathMarkdown(span)).toBeNull(); expect(parseInline(span)).toEqual([{ insert: span }]);
  });
  it('bounds opaque metadata by UTF-8 size, depth and node count without dropping fields', () => {
    const nested: Record<string, unknown> = {}; let current = nested; for (let index = 0; index < 34; index++) { const child = {}; current.next = child; current = child; }
    for (const opaque of [nested, '🌍'.repeat(HYPER_INLINE_MATH_MARKER_BYTES / 4), Array(4100).fill('item')]) {
      expect(() => hyperInlineMathPortableMarker(atom('x', '$', { opaque }))).toThrow('without losing');
      expect(hyperParseInlineMathMarker(encoded({ version: 1, insert: '$', attributes: { formula: 'x', opaque } }))).toBeNull();
    }
    expect(hyperParseInlineMathMarker('%broken')).toBeNull();
  });
  it('stops unsupported export instead of dropping formula data or changing an existing file', async () => {
    const writeText = vi.fn(), exportFile = vi.fn(), inlineUrl = vi.fn(), page = vi.fn();
    for (const run of [atom('x', '$', { href: 'https://example.invalid' }), { insert: '$', attributes: { formula: { future: true } } }, atom('x'.repeat(8193)), { ...atom(), extra: 'future operation' }]) {
      const doc = document([run]), before = JSON.stringify(doc);
      for (const format of ['html', 'markdown'] as const) await expect(hyperSaveDocumentExport(doc, format, '', '/disposable/previous-export', {}, { writeText, page, assets: { exportFile, inlineUrl } })).rejects.toThrow('without losing');
      expect(JSON.stringify(doc)).toBe(before);
    }
    expect(writeText).not.toHaveBeenCalled(); expect(exportFile).not.toHaveBeenCalled(); expect(inlineUrl).not.toHaveBeenCalled(); expect(page).not.toHaveBeenCalled();
    expect(() => hyperExportDocument(document([atom()], 'code'), 'markdown')).toThrow('inside code');
  });
  it('uses the production file and clipboard adapters without metadata requests or attachment reads', async () => {
    const source = document([{ insert: 'Before ' }, atom('x+1', '$$', { opaque: { exact: 'value' } }), { insert: ' after' }]);
    const saved = new Map<string, string>(), inlineUrl = vi.fn(), exportFile = vi.fn(), page = vi.fn();
    const io = { writeText: async (target: string, value: string) => { saved.set(target, value); }, assets: { inlineUrl, exportFile }, page };
    await hyperSaveDocumentExport(source, 'html', '', '/disposable/page.html', {}, io);
    await hyperSaveDocumentExport(source, 'markdown', '', '/disposable/page.md', {}, io);
    const copied = await hyperCopyDocumentExport(source, '', {}, io);
    expect(saved.get('/disposable/page.html')).toContain('<math'); expect(copied).toBe(saved.get('/disposable/page.md'));
    expect(markdownToEditorJson(copied).children[0].data.delta).toEqual([{ insert: 'Before ' }, atom('x+1', '$$', { opaque: { exact: 'value' } }), { insert: ' after' }]);
    expect(inlineUrl).not.toHaveBeenCalled(); expect(exportFile).not.toHaveBeenCalled(); expect(page).not.toHaveBeenCalled();
  });
  it('escapes HTML-looking source and rejects active TeX commands before HTML export', () => {
    const formula = String.raw`\text{<script>network()</script>}`, html = hyperExportDocument(document([atom(formula)]), 'html');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
    for (const formula of [String.raw`\href{https://example.invalid}{link}`, String.raw`\includegraphics{https://example.invalid/image}`, String.raw`\htmlClass{active}{x}`]) {
      expect(() => hyperExportDocument(document([atom(formula)]), 'html')).toThrow();
      expect(markdownToEditorJson(hyperExportDocument(document([atom(formula)]), 'markdown')).children[0].data.delta).toEqual([atom(formula)]);
    }
  });
  it('bounds atom materialization and cumulative document output before allocating repeated markup', () => {
    expect(() => hyperExportInlineMath(atom('x', '$'.repeat(100_000)), true)).toThrow('too many');
    expect(() => hyperExportDocument(document([atom('x', '$'.repeat(1024)), atom('y', '$'.repeat(1025))]), 'markdown')).toThrow('too many');
    expect(HYPER_INLINE_MATH_EXPORT_ATOMS).toBe(2048);
    expect(() => hyperExportDocument(document([atom('x', '$'.repeat(300), { opaque: 'x'.repeat(32_000) })]), 'html')).toThrow('too large');
  });
});
