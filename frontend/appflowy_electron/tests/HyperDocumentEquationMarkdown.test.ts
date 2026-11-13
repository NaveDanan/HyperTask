import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { markdownToEditorJson, type EditorBlock } from '../src/renderer/features/sidebar/import/markdown';

const plain = (block: EditorBlock) => (block.data.delta as Array<{ insert: string }> ?? []).map(run => run.insert).join('');
function document(formula: string, nested = false) {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' },
    equation: { id: 'equation', ty: 'math_equation', data: JSON.stringify({ formula }), parentId: nested ? 'list' : 'root', childrenId: 'equation-children' },
    ...(nested ? { list: { id: 'list', ty: 'numbered_list', data: JSON.stringify({ delta: [{ insert: 'Formula' }] }), parentId: 'root', childrenId: 'list-children' } } : {}),
  }, meta: { childrenMap: { children: { children: [nested ? 'list' : 'equation'] }, ...(nested ? { 'list-children': { children: ['equation'] } } : {}) } } });
}

describe('Hyper equation Markdown import and export', () => {
  it('keeps multiline TeX source exact before Markdown escaping or inline parsing', () => {
    const formula = String.raw`\begin{aligned}
  x_1 &= \frac{a}{b} \\
\text{literal **stars**, \$ and backticks \texttt{\`}} &= \alpha
\end{aligned} % original comment  `;
    const source = `Before\n\n$$\n${formula}\n$$\n\nAfter`;
    const imported = markdownToEditorJson(source);
    expect(imported.children.map(block => block.type)).toEqual(['paragraph', 'math_equation', 'paragraph']);
    expect(imported.children[1]).toEqual({ type: 'math_equation', data: { formula }, children: [] });
    expect(imported.children.filter(block => block.type === 'paragraph').map(plain)).toEqual(['Before', 'After']);
  });
  it('accepts a standalone single-line equation and preserves its inner spaces', () => {
    const imported = markdownToEditorJson(String.raw`$$  x_1 + \frac{a}{b}  $$`);
    expect(imported.children).toEqual([{ type: 'math_equation', data: { formula: String.raw`  x_1 + \frac{a}{b}  ` }, children: [] }]);
    expect(markdownToEditorJson('$$\n$$').children[0].data.formula).toBe('');
  });
  it('keeps delimiters in fenced code, escaped dollars, inline text and incomplete blocks as text', () => {
    const code = markdownToEditorJson('```tex\n$$\nx_1\n$$\n```');
    expect(code.children[0].type).toBe('code'); expect(plain(code.children[0])).toBe('$$\nx_1\n$$');
    for (const source of [String.raw`\$\$x\$\$`, 'Text $$x$$ stays inline', '$$\nunclosed', '$$x$$ and $$y$$', '$$$x$$$']) {
      expect(markdownToEditorJson(source).children.every(block => block.type !== 'math_equation')).toBe(true);
    }
  });
  it('round-trips raw source, empty equations and unsupported TeX without interpreting them', () => {
    for (const formula of ['', String.raw`x_1+\frac{a}{b}`, '\n  x_1  \n\n', String.raw`\unknown_command{**literal**}`]) {
      const exported = hyperExportDocument(document(formula), 'markdown');
      expect(exported).toBe(`$$\n${formula}\n$$\n`);
      expect(markdownToEditorJson(exported).children[0].data.formula).toBe(formula);
    }
  });
  it('removes only the Markdown list indentation from a nested equation', () => {
    const formula = '  x_1  \n\n    y_2';
    const imported = markdownToEditorJson(hyperExportDocument(document(formula, true), 'markdown'));
    expect(imported.children).toHaveLength(1); expect(imported.children[0].type).toBe('numbered_list');
    expect(imported.children[0].children).toEqual([{ type: 'math_equation', data: { formula }, children: [] }]);
  });
});
