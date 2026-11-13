import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperExportDocument, hyperDocumentPageMentions } from '../src/renderer/features/document/HyperDocumentExport';
import { markdownToEditorJson, type EditorBlock } from '../src/renderer/features/sidebar/import/markdown';
import { hyperReadDocumentFootnote } from '../src/renderer/features/document-footnote/HyperDocumentFootnoteValue';
import { hyperParseFootnoteHtmlMarker } from '../src/renderer/features/document-footnote/HyperDocumentFootnoteExport';
import type { HyperTextRun } from '../src/renderer/features/document/HyperDocumentModel';
const runs = (block: EditorBlock) => block.data.delta as HyperTextRun[] ?? [];
const values = (blocks: EditorBlock[]): HyperTextRun[] => blocks.flatMap(block => [...runs(block).filter(run => hyperReadDocumentFootnote(run)), ...values(block.children)]);
function document(atoms: HyperTextRun[], formula = '') { return create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', data: '{}', childrenId: 'children' }, p: { id: 'p', ty: 'paragraph', data: JSON.stringify({ delta: atoms }), parentId: 'page', childrenId: 'pchildren' }, ...(formula ? { math: { id: 'math', ty: 'math_equation', data: JSON.stringify({ formula }), parentId: 'page', childrenId: 'mchildren' } } : {}) }, meta: { childrenMap: { children: { children: ['p', ...(formula ? ['math'] : [])] } } } }); }
const note = (label = '1', text = 'Note\nSecond line'): HyperTextRun => ({ insert: ' ', attributes: { hyper_footnote: { version: 1, id: `id-${label}`, label, text }, bold: true, future: { retain: true } } });
const citation: HyperTextRun = { insert: ' ', attributes: { footnote: { label: 'source', reference: { type: 'url', url: 'https://example.invalid/a%20b?q=x&n=2', favicon: 'https://example.invalid/icon%20x.png', title: 'A "source"', description: 'Stored metadata' } } } };
describe('Footnote Markdown and portable HTML state', () => {
  it('imports standard notes once per definition and preserves repeated, merged, UTF-16-adjacent references', () => {
    const imported = markdownToEditorJson('🌍[^1][^1] and **[^word]**\n\n[^1]: First line\n    Second line\n\n[^word]: A text note');
    const atoms = values(imported.children); expect(atoms).toHaveLength(2); expect(atoms[0].insert).toBe('  '); expect(atoms[0].attributes?.hyper_footnote).toMatchObject({ version: 1, label: '1', text: 'First line\nSecond line' }); expect(atoms[1].attributes?.bold).toBe(true); expect(imported.children).toHaveLength(1);
  });
  it('shares identical repeated definitions and leaves conflicting duplicates visible', () => {
    const imported = markdownToEditorJson('[^same] and [^same]\n\n[^same]: Same source\n\n[^same]: Same source');
    const atoms = values(imported.children); expect(atoms).toHaveLength(2); expect(atoms[0].attributes).toEqual(atoms[1].attributes); expect(imported.children).toHaveLength(1);
  });
  it('round-trips AFFiNE JSON references with single URL decoding and preserves unknown schemas read-only', () => {
    const doc = document([citation]), markdown = hyperExportDocument(doc, 'markdown'), imported = values(markdownToEditorJson(markdown).children)[0]; expect(imported).toEqual(citation);
    const absolute = markdownToEditorJson('[^u]\n\n[^u]: {"type":"url","url":"https://example.invalid/a%20b"}'); expect((values(absolute.children)[0].attributes?.footnote as { reference: { url: string } }).reference.url).toBe('https://example.invalid/a%20b');
    const future = markdownToEditorJson('[^u]\n\n[^u]: {"type":"future","secret":{"kept":true}}'), atom = values(future.children)[0]; expect(atom.attributes?.footnote).toEqual({ label: 'u', reference: { type: 'future', secret: { kept: true } } }); expect(hyperReadDocumentFootnote(atom)?.editable).toBe(false);
  });
  it('round-trips escaped JSON-looking plain notes and Markdown punctuation without reinterpreting them as citations', () => {
    const text = '{"type":"url","url":"literal"}\n[^other]: literal **bold** `code` \\ path';
    const imported = values(markdownToEditorJson(hyperExportDocument(document([note('a]b', text)]), 'markdown')).children)[0]; expect(hyperReadDocumentFootnote(imported)?.value).toMatchObject({ kind: 'note', data: { label: 'a]b', text } });
  });
  it('keeps missing/unused/conflicting definitions and escaped references readable', () => {
    for (const markdown of ['[^missing]', '[^unused]: Keep me', '[^a]\n\n[^a]: One\n\n[^a]: Two', String.raw`\[^a]\n\n[^a]: Not used`]) {
      const imported = markdownToEditorJson(markdown); expect(values(imported.children)).toEqual([]); expect(imported.children.map(block => runs(block).map(run => run.insert).join('')).join(' ')).toContain(markdown.startsWith('\\') ? '[^a]' : markdown.slice(0, 4));
    }
  });
  it('never scans definitions/references inside fenced code or display math, including incomplete bodies', () => {
    const formula = '[^source]: {"type":"url","url":"https://example.invalid"}\n\\text{[^source]}\n  x_1  ', markdown = 'Before[^outside]\n\n$$\n' + formula + '\n$$\n\n```md\n[^source]: literal\n[^outside]\n```\n\n[^outside]: Real note';
    const imported = markdownToEditorJson(markdown); expect(imported.children.map(block => block.type)).toEqual(['paragraph', 'math_equation', 'code']); expect(imported.children[1].data.formula).toBe(formula); expect(values(imported.children)).toHaveLength(1); expect(runs(imported.children[2])[0].insert).toBe('[^source]: literal\n[^outside]');
    const exported = hyperExportDocument(document([note()], formula), 'markdown'); expect(markdownToEditorJson(exported).children.find(block => block.type === 'math_equation')?.data.formula).toBe(formula);
    for (const input of ['```\n[^a]: body', '$$\n[^a]: body']) expect(values(markdownToEditorJson(input).children)).toHaveLength(0);
    expect(values(markdownToEditorJson('`[^a]`\n\n[^a]: Kept unused').children)).toHaveLength(0);
  });
  it('uses exact versioned HTML string-atom metadata, safe readable links and canonical endnotes', () => {
    const doc = document([note(), citation, { insert: '  ', attributes: note().attributes }]), html = hyperExportDocument(doc, 'html');
    const markers = [...html.matchAll(/data-hyper-footnote="([^"]+)"/g)].map(match => match[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
    expect(markers.map(hyperParseFootnoteHtmlMarker)).toEqual([note(), citation, note(), note()]); expect(html).toContain('role="doc-endnotes"'); expect(html).toContain('id="hyper-footnote-ref-1-3"'); expect(html).toContain('href="https://example.invalid/a%20b?q=x&amp;n=2"');
    const unsafe = document([{ insert: ' ', attributes: { footnote: { label: 'u', reference: { type: 'url', url: 'javascript:alert(1)', title: '<script>' } } } }]); expect(hyperExportDocument(unsafe, 'html')).not.toContain('href="javascript:'); expect(hyperExportDocument(unsafe, 'html')).toContain('&lt;script&gt;');
    expect(hyperParseFootnoteHtmlMarker('{"version":2,"insert":" ","attributes":{}}')).toBeNull(); expect(hyperParseFootnoteHtmlMarker('{"version":1,"insert":{},"attributes":{}}')).toBeNull();
  });
  it('resolves page citation export labels and refuses opaque/conflicting export without mutation', () => {
    const page = { insert: ' ', attributes: { footnote: { label: 'p', reference: { type: 'doc', docId: 'target' } } } }, doc = document([page]); expect(hyperDocumentPageMentions(doc)).toEqual(['target']); expect(hyperExportDocument(doc, 'html', '', { pageMentions: { target: { label: 'Target page', url: 'https://example.invalid/page' } } })).toContain('>Target page</a>');
    for (const atoms of [[{ ...note(), attributes: { hyper_footnote: { version: 2, id: 'future', label: '1', text: 'kept' } } }], [note(), note('1', 'conflict')]]) { const source = document(atoms), raw = JSON.stringify(source); expect(() => hyperExportDocument(source, 'markdown')).toThrow(/footnote/i); expect(JSON.stringify(source)).toBe(raw); }
  });
});
