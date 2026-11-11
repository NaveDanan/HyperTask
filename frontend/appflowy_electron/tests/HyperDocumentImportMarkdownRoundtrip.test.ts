import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { markdownToEditorJson, parseInline, type EditorBlock } from '../src/renderer/features/sidebar/import/markdown';

const plain = (block: EditorBlock) => (block.data.delta as Array<{ insert: string }> ?? []).map(run => run.insert).join('');
function document(blocks: Array<{ type?: string; text: string; attributes?: Record<string, unknown> }>) {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' }, ...Object.fromEntries(blocks.map((block, index) => [`p${index}`, { id: `p${index}`, parentId: 'root', ty: block.type || 'paragraph', childrenId: `c${index}`, data: JSON.stringify({ delta: [{ insert: block.text, ...(block.attributes ? { attributes: block.attributes } : {}) }] }) }])) }, meta: { childrenMap: { children: { children: blocks.map((_, index) => `p${index}`) } } } });
}
describe('Hyper exported Markdown import regressions', () => {
  it('restores escaped literal block markers and punctuation as plain paragraphs', () => {
    const literals = ['# literal heading', '- literal list', '1. literal number', '**literal stars**', '~~literal strike~~', '~~~literal fence', '[literal](link)', '<script>', 'a_b_c', 'C:\\docs\\note.txt', '! punctuation (parentheses) + minus - dot .'];
    const imported = markdownToEditorJson(hyperExportDocument(document(literals.map(text => ({ text }))), 'markdown'));
    expect(imported.children.map(block => block.type)).toEqual(literals.map(() => 'paragraph')); expect(imported.children.map(plain)).toEqual(literals);
    expect(imported.children.every(block => !(block.data.delta as Array<{ attributes?: unknown }>).some(run => run.attributes))).toBe(true);
  });
  it('keeps quote and callout text escaped while restoring exported marks', () => {
    for (const type of ['quote', 'callout']) {
      const imported = markdownToEditorJson(hyperExportDocument(document([{ type, text: '<unsafe> **literal**', attributes: { bold: true, italic: true, strikethrough: true } }]), 'markdown'));
      expect(imported.children[0].type).toBe('quote'); expect(plain(imported.children[0])).toBe('<unsafe> **literal**');
      expect((imported.children[0].data.delta as Array<{ attributes: object }>)[0].attributes).toMatchObject({ bold: true, italic: true, strikethrough: true });
    }
  });
  it('keeps blank-separated ordered children under their complete three-space marker', () => {
    const doc = document([{ type: 'numbered_list', text: '1' }, { type: 'bulleted_list', text: 'Nested bullet' }, { text: 'Nested paragraph' }]);
    doc.meta!.childrenMap.children.children = ['p0']; doc.blocks.p1.parentId = 'p0'; doc.blocks.p2.parentId = 'p0'; doc.meta!.childrenMap.c0 = { $typeName: 'ChildrenPB', children: ['p1', 'p2'] };
    const markdown = hyperExportDocument(doc, 'markdown'); expect(markdown).toContain('\n   - Nested bullet');
    const imported = markdownToEditorJson(markdown); expect(imported.children).toHaveLength(1); expect(imported.children[0].type).toBe('numbered_list');
    expect(imported.children[0].children.map(block => [block.type, plain(block)])).toEqual([['bulleted_list', 'Nested bullet'], ['paragraph', 'Nested paragraph']]);
  });
  it('restores padded variable code spans, angle destinations and longer code fences', () => {
    expect(parseInline('`` `code` ``')).toEqual([{ insert: '`code`', attributes: { code: true } }]);
    expect(parseInline('` \\*literal `')).toEqual([{ insert: '\\*literal', attributes: { code: true } }]);
    expect(parseInline('[safe](<https://example.test/a(b)>)')).toEqual([{ insert: 'safe', attributes: { href: 'https://example.test/a(b)' } }]);
    const code = '```\nconst literal = "**text**";';
    const imported = markdownToEditorJson(hyperExportDocument(document([{ type: 'code', text: code }]), 'markdown'));
    expect(imported.children).toHaveLength(1); expect(imported.children[0].type).toBe('code'); expect(plain(imported.children[0])).toBe(code);
    const sourceInfo = markdownToEditorJson('```js title="snippet"\nsource code\n```');
    expect(sourceInfo.children[0].type).toBe('code'); expect(sourceInfo.children[0].data.language).toBe('js'); expect(plain(sourceInfo.children[0])).toBe('source code');
  });
});
