import { create, fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperChildren, hyperEditText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCodeSource } from '../src/renderer/features/document-code/HyperDocumentCodeModel';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperHtmlElectronAvailable, hyperParseHtmlFixtures } from './HyperDocumentImportHarness';
(hyperHtmlElectronAvailable ? describe : describe.skip)('Hyper inert code HTML language roundtrip', () => {
  it('preserves absent/null/empty/future tags and exact text without fetching or executing marker content', async () => {
    const languages = [{}, { language: null }, { language: '' }, { language: 'Future # language\"<&\n' }], raw = '\n  😀<x>\n```\n\tlast\n';
    const cases = languages.map(data => {
      const document = create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', data: '{}', childrenId: 'children' }, code: { id: 'code', parentId: 'page', ty: 'code', data: JSON.stringify(data), childrenId: 'codechildren' } }, meta: { childrenMap: { children: { children: ['code'] }, codechildren: { children: [] } } } });
      return { source: hyperExportDocument(hyperEditText(document, 'code', [{ insert: raw }]).document, 'html') };
    });
    cases.push({ source: '<pre data-hyper-code-language="bad"><code class="language-python">readable&lt;img src=__FIXTURE_ORIGIN__/trap&gt;</code></pre><script>window.importExecuted++</script>' });
    const result = await hyperParseHtmlFixtures(cases); expect(result.executed).toBe(0); expect(result.requests).toBe(0);
    result.pages.forEach((page, index) => {
      expect(page.ok).toBe(true); if (!page.ok) return;
      const document = fromBinary(DocumentDataPBSchema, new Uint8Array(page.bytes)), code = hyperChildren(document, document.blocks[document.pageId]).map(id => document.blocks[id]).find(block => block.ty === 'code')!;
      if (index < languages.length) { expect(hyperBlockData(code)).toEqual(languages[index]); expect(hyperCodeSource(document, code.id)).toBe(raw); }
      else { expect(hyperBlockData(code).language).toBe('python'); expect(hyperCodeSource(document, code.id)).toContain('readable<img src='); expect(page.issues.some(issue => issue.kind === 'unsupported')).toBe(true); }
    });
  });
});
