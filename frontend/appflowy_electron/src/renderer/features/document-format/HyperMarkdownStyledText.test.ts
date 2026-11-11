import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperExportDocument } from '../document/HyperDocumentExport';
import { hyperCopyDocumentExport, hyperSaveDocumentExport } from '../document/HyperDocumentExportBundle';
import { markdownToEditorJson, parseInline } from '../sidebar/import/markdown';
import { HYPER_MARKDOWN_TEXT_MARKER, hyperExportMarkdownStyledText, hyperParseMarkdownStyledSpan, hyperParseMarkdownTextMarker } from './HyperMarkdownStyledText';

const document = (runs: HyperTextRun[]) => create(DocumentDataPBSchema, { pageId: 'page', blocks: {
  page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' },
  text: { id: 'text', ty: 'paragraph', parentId: 'page', childrenId: 'text-children', data: JSON.stringify({ delta: runs, unknown: 'kept' }) },
}, meta: { childrenMap: { children: { children: ['text'] } } } });
const units = (runs: HyperTextRun[]) => runs.flatMap(run => Array.from(run.insert as string, insert => ({ insert, attributes: run.attributes ?? {} })));
const roundtrip = (runs: HyperTextRun[]) => markdownToEditorJson(hyperExportDocument(document(runs), 'markdown')).children[0].data.delta as HyperTextRun[];

describe('Hyper styled whitespace Markdown fidelity', () => {
  it('retains original leading italic whitespace instead of literal delimiter characters', () => {
    const source = [{ insert: '🌍 ' }, { insert: ' literal $$', attributes: { italic: true } }];
    expect(units(roundtrip(source))).toEqual(units(source));
  });
  it('preserves whitespace-only code and adjacent code spans with different opaque attributes', () => {
    for (const source of [[{ insert: '   ', attributes: { code: true } }], [{ insert: 'a', attributes: { code: true, opaque: 1 } }, { insert: 'b', attributes: { code: true, opaque: 2 } }]]) expect(units(roundtrip(source))).toEqual(units(source));
  });
  it('preserves exact boundary whitespace, newlines and known or opaque marks', () => {
    const marks = [{ bold: true }, { italic: true }, { strikethrough: true }, { code: true }, { underline: true }, { bold: true, italic: true, strikethrough: true, code: true, href: 'https://example.invalid/a(b)' }, { font_color: '0xff12ab34', bg_color: '#fff' }];
    for (const attributes of marks) for (const insert of [' leading', 'trailing ', ' \t ', '\r\n', 'middle\nline', '\u00a0nonbreaking\u00a0', '\u2028line\u2029']) {
      const run = { insert, attributes: { ...attributes, opaque: { preserve: ['🌍', 7] } } }, markdown = hyperExportDocument(document([run]), 'markdown');
      expect(markdown).toContain(HYPER_MARKDOWN_TEXT_MARKER); expect(markdown.trimEnd().split('\n')).toHaveLength(1);
      expect(units(roundtrip([run]))).toEqual(units([run]));
    }
  });
  it('keeps ordinary representable output unchanged across marks, code and safe links', () => {
    for (const [attributes, expected] of [
      [{ bold: true }, '**ordinary**\n'], [{ italic: true }, '*ordinary*\n'], [{ strikethrough: true }, '~~ordinary~~\n'],
      [{ bold: true, italic: true }, '***ordinary***\n'], [{ code: true }, '` ordinary `\n'], [{ href: 'https://example.invalid' }, '[ordinary](<https://example.invalid>)\n'],
    ] as Array<[Record<string, unknown>, string]>) expect(hyperExportDocument(document([{ insert: 'ordinary', attributes }]), 'markdown')).toBe(expected);
    expect(hyperExportDocument(document([{ insert: ' plain boundary ' }]), 'markdown')).not.toContain(HYPER_MARKDOWN_TEXT_MARKER);
  });
  it('retains every adjacent mark pair without introducing ambiguous code fences', () => {
    const marks: Record<string, unknown>[] = [{}, { bold: true }, { italic: true }, { strikethrough: true }, { bold: true, italic: true }, { italic: true, strikethrough: true }, { bold: true, strikethrough: true }, { bold: true, italic: true, strikethrough: true }, { code: true }, { code: true, italic: true }, { code: true, bold: true }, { href: 'https://example.invalid' }, { italic: true, href: 'https://example.invalid' }, { code: true, href: 'https://example.invalid' }];
    for (const a of marks) for (const b of marks) {
      const source = [{ insert: 'a', ...(Object.keys(a).length ? { attributes: a } : {}) }, { insert: 'b', ...(Object.keys(b).length ? { attributes: b } : {}) }];
      expect(units(roundtrip(source))).toEqual(units(source));
    }
  });
  it('keeps punctuation, emoji, HTML-looking text, leading/trailing code and link attributes exact', () => {
    const run = { insert: ' 🌍 <script>alert(1)</script> `code` | [^note] $$ \\path\n ', attributes: { bold: true, code: true, italic: true, href: 'https://example.invalid/a|b?q=1&next=2', underline: true, opaque: { keep: '<img src=remote>' } } };
    const source = hyperExportMarkdownStyledText(run);
    expect(source).toContain('<code>'); expect(source).toContain('<em>'); expect(source).toContain('<a href="https://example.invalid/a%7Cb?q=1&amp;next=2"');
    expect(source).not.toContain('<script>'); expect(source).not.toContain('<img'); expect(source).not.toContain('\n');
    expect(hyperParseMarkdownStyledSpan(source)).toEqual(run); expect(units(roundtrip([run]))).toEqual(units([run]));
  });
  it('does not decode source spans inside code, links, escaped markup or display-math bodies', () => {
    const run = { insert: ' leading ', attributes: { italic: true } }, span = hyperExportMarkdownStyledText(run);
    expect(parseInline('`' + span + '`')).toEqual([{ insert: span, attributes: { code: true } }]);
    expect(parseInline('[' + span + '](https://example.invalid)')).toEqual([{ insert: span, attributes: { href: 'https://example.invalid' } }]);
    expect(parseInline('\\' + span)).toEqual([{ insert: span }]);
    const code = markdownToEditorJson('```html\n' + span + '\n```').children[0]; expect(code.type).toBe('code'); expect(code.data.delta).toEqual([{ insert: span }]);
    const math = markdownToEditorJson('$$\n' + span + '\n$$').children[0]; expect(math.type).toBe('math_equation'); expect(math.data.formula).toBe(span);
    const blockCode = document([{ insert: ' leading ', attributes: { italic: true } }]); blockCode.blocks.text.ty = 'code'; expect(hyperExportDocument(blockCode, 'markdown')).not.toContain(HYPER_MARKDOWN_TEXT_MARKER);
  });
  it('refuses future, mismatched or active envelopes while preserving their Markdown literally', () => {
    const span = hyperExportMarkdownStyledText({ insert: ' leading', attributes: { italic: true } });
    for (const value of [
      { version: 2, insert: ' leading', attributes: { italic: true } },
      { version: 1, insert: ' leading', attributes: [] },
      { version: 1, insert: ' leading', attributes: { italic: true, formula: 'x' } },
      { version: 1, insert: ' leading', attributes: { mention: { type: 'page', page_id: 'private' } } },
      { version: 1, insert: ' leading', attributes: { href: 'javascript:alert(1)' } },
      { version: 1, insert: ' leading', attributes: { italic: true }, extra: true },
    ]) {
      const marker = encodeURIComponent(JSON.stringify(value)), malformed = span.replace(/data-hyper-text-source="[^"]*"/, `data-hyper-text-source="${marker}"`);
      expect(hyperParseMarkdownTextMarker(marker)).toBeNull(); expect(hyperParseMarkdownStyledSpan(malformed)).toBeNull(); expect(parseInline(malformed)).toEqual([{ insert: malformed }]);
    }
    const mismatch = span.replace('leading</em>', 'different</em>'); expect(hyperParseMarkdownStyledSpan(mismatch)).toBeNull(); expect(parseInline(mismatch)).toEqual([{ insert: mismatch }]);
  });
  it('bounds source bytes, nesting, nodes and cumulative export output without writing a partial file', async () => {
    const deep: Record<string, unknown> = {}; let current = deep; for (let index = 0; index < 34; index++) { const child = {}; current.next = child; current = child; }
    for (const opaque of ['x'.repeat(65_536), deep, Array(5000).fill('x')]) expect(() => hyperExportMarkdownStyledText({ insert: ' leading', attributes: { italic: true, opaque } })).toThrow('without losing');
    const io = { assets: { inlineUrl: vi.fn(), exportFile: vi.fn() }, page: vi.fn(), writeText: vi.fn() };
    const invalid = document([{ insert: ' leading', attributes: { italic: true, href: 'javascript:bad' } }]);
    await expect(hyperSaveDocumentExport(invalid, 'markdown', '', '/disposable/previous.md', {}, io)).rejects.toThrow('without losing'); expect(io.writeText).not.toHaveBeenCalled(); expect(io.page).not.toHaveBeenCalled();
    const many = document(Array.from({ length: 2049 }, () => ({ insert: ' ', attributes: { italic: true } }))); expect(() => hyperExportDocument(many, 'markdown')).toThrow('too many');
    const large = document(Array.from({ length: 300 }, () => ({ insert: ' ', attributes: { italic: true, opaque: 'x'.repeat(32_000) } }))); expect(() => hyperExportDocument(large, 'markdown')).toThrow('too large');
    const source = document([{ insert: ' leading', attributes: { italic: true, opaque: { keep: true } } }]);
    const copied = await hyperCopyDocumentExport(source, '', {}, io); expect(units(markdownToEditorJson(copied).children[0].data.delta as HyperTextRun[])).toEqual(units([{ insert: ' leading', attributes: { italic: true, opaque: { keep: true } } }]));
    expect(io.assets.inlineUrl).not.toHaveBeenCalled(); expect(io.assets.exportFile).not.toHaveBeenCalled();
  });
});
