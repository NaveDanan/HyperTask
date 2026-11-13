import { fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, type HyperTextRun } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperEscapeHtml } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperExportMarkdownStyledText } from '../src/renderer/features/document-format/HyperMarkdownStyledText';
import { hyperHtmlElectronAvailable, hyperParseHtmlFixtures, type HyperHtmlFixtureResult } from './HyperDocumentImportHarness';

function unpack(result: HyperHtmlFixtureResult) {
  if (!result.ok) throw Error(result.error);
  const doc = fromBinary(DocumentDataPBSchema, Uint8Array.from(result.bytes));
  return hyperChildren(doc, doc.blocks[doc.pageId]).map(id => hyperBlockText(doc, doc.blocks[id]));
}
const units = (runs: HyperTextRun[]) => runs.flatMap(run => Array.from(run.insert as string, insert => ({ insert, attributes: run.attributes ?? {} })));

(hyperHtmlElectronAvailable ? describe : describe.skip)('Hyper styled whitespace inert HTML source', () => {
  it('preserves leading/trailing, all-white and multiline styled source without trimming or merging it into surrounding markup', async () => {
    const source: HyperTextRun[] = [
      { insert: ' \t\r\n ', attributes: { code: true, opaque: { exact: 'source' } } },
      { insert: ' 🌍\nline ', attributes: { italic: true, bold: true, href: 'https://example.invalid/a(b)', opaque: { keep: true } } },
    ];
    const report = await hyperParseHtmlFixtures([{ source: source.map(run => '<p>' + hyperExportMarkdownStyledText(run) + '</p>').join('') }, { source: '<p><em>' + hyperExportMarkdownStyledText({ insert: ' trailing ', attributes: { italic: true } }) + 'normal </em></p>' }]);
    expect(unpack(report.pages[0]).map(units)).toEqual(source.map(run => units([run])));
    expect(unpack(report.pages[1])[0]).toEqual([{ insert: ' trailing ', attributes: { italic: true } }, { insert: 'normal', attributes: { italic: true } }]);
    expect(report.requests).toBe(0); expect(report.executed).toBe(0);
  });
  it('never executes or fetches marker child HTML, event handlers or CSS addresses', async () => {
    const run = { insert: ' leading ', attributes: { italic: true, opaque: { untouched: 'metadata' } } };
    const source = hyperExportMarkdownStyledText(run)
      .replace('<span ', '<span onclick="window.importExecuted++" ')
      .replace('white-space:pre-wrap', 'white-space:pre-wrap;background-image:url(__FIXTURE_ORIGIN__/css)')
      .replace('</span>', '<img src="__FIXTURE_ORIGIN__/image"><script src="__FIXTURE_ORIGIN__/script"></script><iframe src="__FIXTURE_ORIGIN__/frame"></iframe></span>');
    const report = await hyperParseHtmlFixtures([{ source: '<p>' + source + '</p>' }]);
    expect(unpack(report.pages[0])[0]).toEqual([run]); expect(report.requests).toBe(0); expect(report.executed).toBe(0);
    if (report.pages[0].ok) expect(report.pages[0].issues.some(issue => issue.kind === 'active-content')).toBe(true);
  });
  it('rejects future or mismatched metadata and leaves code/link contexts outside the source decoder', async () => {
    const run = { insert: ' leading ', attributes: { italic: true, opaque: 'must not be decoded inside a link' } }, span = hyperExportMarkdownStyledText(run);
    const future = span.replace(/data-hyper-text-source="[^"]*"/, `data-hyper-text-source="${encodeURIComponent(JSON.stringify({ version: 2, insert: run.insert, attributes: run.attributes }))}"`);
    const report = await hyperParseHtmlFixtures([
      { source: '<p>' + future + '</p>' }, { source: '<p>' + span.replace('leading&#32;</em>', 'different&#32;</em>') + '</p>' },
      { source: '<pre><code>' + hyperEscapeHtml(span) + '</code></pre>' },
      { source: '<p><a href="https://example.invalid">' + span + '</a><a href="javascript:window.importExecuted++">' + span + '</a></p>' },
    ]);
    expect(report.pages[0]).toMatchObject({ ok: false }); expect(report.pages[1]).toMatchObject({ ok: false });
    expect(unpack(report.pages[2])[0]).toEqual([{ insert: span }]);
    expect(unpack(report.pages[3]).flat().some(value => value.attributes?.opaque)).toBe(false);
    expect(report.requests).toBe(0); expect(report.executed).toBe(0);
  });
});
