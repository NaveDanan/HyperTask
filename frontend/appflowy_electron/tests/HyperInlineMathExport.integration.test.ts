import { create, fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperDocumentPlainText, type HyperTextRun } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperEscapeHtml, hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperExportInlineMath } from '../src/renderer/features/document-inline-math/HyperInlineMathExport';
import { HYPER_INLINE_MATH_MARKER, hyperInlineMathPortableMarker } from '../src/renderer/features/document-inline-math/HyperInlineMathPortable';
import { hyperHtmlElectronAvailable, hyperParseHtmlFixtures, type HyperHtmlFixtureResult } from './HyperDocumentImportHarness';

const atom = (formula: string, insert = '$', attributes: Record<string, unknown> = {}): HyperTextRun => ({ insert, attributes: { formula, ...attributes } });
const document = (runs: HyperTextRun[]) => create(DocumentDataPBSchema, { pageId: 'page', blocks: {
  page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' },
  text: { id: 'text', ty: 'paragraph', parentId: 'page', childrenId: 'text-children', data: JSON.stringify({ delta: runs }) },
}, meta: { childrenMap: { children: { children: ['text'] } } } });
function unpack(value: HyperHtmlFixtureResult) { if (!value.ok) throw Error(value.error); return { doc: fromBinary(DocumentDataPBSchema, Uint8Array.from(value.bytes)), result: value }; }
const atoms = (doc: ReturnType<typeof document>) => Object.values(doc.blocks).flatMap(block => hyperBlockText(doc, block)).flatMap(run => typeof run.insert === 'string' && Object.hasOwn(run.attributes ?? {}, 'formula') ? Array.from(run.insert, () => ({ insert: '$', attributes: run.attributes })) : []);

(hyperHtmlElectronAvailable ? describe : describe.skip)('Hyper inline math inert HTML import in Electron', () => {
  it('round-trips real inline MathML and Markdown source spans without changing full source attributes', async () => {
    const attributes = { bold: true, opaque: { label: '🌍 <source> "quotes"', future: [1, true] } }, formula = String.raw`\frac{a_1}{b}+1`, source = document([{ insert: '🌍 Before ' }, atom(formula, '$$', attributes), { insert: ' after' }]);
    const raw = '  \\future{🌍} % exact\r\n`code` [^label]: literal $  ', rawAtom = atom(raw, '$$', { unknown: 'kept' });
    const report = await hyperParseHtmlFixtures([{ source: hyperExportDocument(source, 'html') }, { source: '<p>' + hyperExportInlineMath(rawAtom, false) + '</p>' }]);
    expect(report.requests).toBe(0); expect(report.executed).toBe(0);
    const imported = unpack(report.pages[0]); expect(atoms(imported.doc)).toEqual([atom(formula, '$', attributes), atom(formula, '$', attributes)]); expect(hyperDocumentPlainText(imported.doc)).toBe('🌍 Before $$ after');
    expect(imported.result.issues.some(issue => issue.kind === 'unsupported')).toBe(false);
    expect(atoms(unpack(report.pages[1]).doc)).toEqual([atom(raw, '$', { unknown: 'kept' }), atom(raw, '$', { unknown: 'kept' })]);
  });
  it('ignores untrusted marker child markup, scripts, images and TeX addresses without making any request', async () => {
    const formula = String.raw`\href{https://example.invalid/private}{source}`, marker = hyperInlineMathPortableMarker(atom(formula));
    const source = `<p><span ${HYPER_INLINE_MATH_MARKER}="${marker}" onclick="window.importExecuted++"><math><semantics><mi>Untrusted visual text</mi><annotation encoding="application/x-tex">${hyperEscapeHtml(formula)}</annotation></semantics></math><img src="__FIXTURE_ORIGIN__/private-image"><script>window.importExecuted++</script><iframe src="__FIXTURE_ORIGIN__/frame"></iframe></span></p>`;
    const report = await hyperParseHtmlFixtures([{ source }]);
    expect(report.requests).toBe(0); expect(report.executed).toBe(0);
    const imported = unpack(report.pages[0]); expect(atoms(imported.doc)).toEqual([atom(formula)]); expect(hyperDocumentPlainText(imported.doc)).toBe('$'); expect(imported.result.issues.some(issue => issue.kind === 'active-content')).toBe(true);
  });
  it('stops invalid/future/conflicting metadata imports and never converts live DOM markers or code', async () => {
    const span = hyperExportInlineMath(atom('x+1'), false)!, valid = hyperInlineMathPortableMarker(atom('x'));
    const future = encodeURIComponent(JSON.stringify({ version: 2, insert: '$', attributes: { formula: 'future' } }));
    const conflict = encodeURIComponent(JSON.stringify({ version: 1, insert: '$', attributes: { formula: 'x', mention: { type: 'page', page_id: 'private' } } }));
    const report = await hyperParseHtmlFixtures([
      { source: `<p><span ${HYPER_INLINE_MATH_MARKER}="${future}">future</span></p>` },
      { source: `<p><span ${HYPER_INLINE_MATH_MARKER}="${conflict}">x</span></p>` },
      { source: `<p><span ${HYPER_INLINE_MATH_MARKER}="${valid}">changed</span></p>` },
      { source: '<pre><code>' + hyperEscapeHtml(span) + '</code></pre>' },
      { source: '<p>$5 and $10 <span data-hyper-inline-math data-hyper-atomic="&quot;$&quot;">live text</span><math><mi>x</mi></math></p>' },
      { source: `<p><span ${HYPER_INLINE_MATH_MARKER}="${valid}">${'<b>'.repeat(140)}x${'</b>'.repeat(140)}</span></p>` },
      { source: `<p><a href="https://example.invalid">${span}</a> <a href="javascript:window.importExecuted++">${span}</a></p>` },
    ]);
    for (const value of report.pages.slice(0, 3)) expect(value).toMatchObject({ ok: false });
    expect(atoms(unpack(report.pages[3]).doc)).toEqual([]); expect(hyperDocumentPlainText(unpack(report.pages[3]).doc)).toBe(span);
    expect(atoms(unpack(report.pages[4]).doc)).toEqual([]); expect(hyperDocumentPlainText(unpack(report.pages[4]).doc)).toContain('$5 and $10 live text');
    expect(report.pages[5]).toMatchObject({ ok: false }); if (!report.pages[5].ok) expect(report.pages[5].error).toContain('complex');
    expect(atoms(unpack(report.pages[6]).doc)).toEqual([]); expect(hyperDocumentPlainText(unpack(report.pages[6]).doc)).toContain('x+1');
    expect(report.requests).toBe(0); expect(report.executed).toBe(0);
  });
});
