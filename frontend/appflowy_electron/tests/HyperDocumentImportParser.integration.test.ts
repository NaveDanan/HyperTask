import { fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperDocumentPlainText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperHtmlElectronAvailable, hyperParseHtmlFixtures, type HyperHtmlFixtureResult } from './HyperDocumentImportHarness';

function unpack(page: HyperHtmlFixtureResult) { if (!page.ok) throw new Error(page.error); return { result: page, document: fromBinary(DocumentDataPBSchema, Uint8Array.from(page.bytes)) }; }
(hyperHtmlElectronAvailable ? describe : describe.skip)('Hyper inert HTML parser in Electron', () => {
  it('imports common HTML and Notion text, marks, lists, tasks, code, tables and title', async () => {
    const report = await hyperParseHtmlFixtures([{ source: `<!doctype html><html><head><title>Fallback title</title></head><body><article class="page"><header><h1 class="page-title">Notion page 🌍</h1></header><div class="page-body">
      <p>Hello <strong>bold <em>and italic</em></strong> <u>underlined</u> <del>removed</del> <code>inline()</code> <a href="https://example.test/page">safe link</a><br>next line</p>
      <h2>Section</h2><ul><li>One<ul><li>Nested</li></ul></li></ul><ol><li>Numbered</li></ol>
      <ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span>Complete task</span></li><li><input type="checkbox">Pending task</li></ul>
      <blockquote><p>Quoted <b>text</b></p><p>Second quote line</p></blockquote><pre><code class="language-typescript">const value = '&lt;safe&gt;';\n  next();</code></pre><hr>
      <table><caption>Example table</caption><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td><strong>Alpha</strong></td><td>42</td></tr></tbody></table>
      </div></article></body></html>` }]);
    expect(report.executed).toBe(0); expect(report.requests).toBe(0);
    const { result, document } = unpack(report.pages[0]);
    expect(result.title).toBe('Notion page 🌍'); expect(result.issues).toEqual([]);
    const blocks = Object.values(document.blocks), allText = hyperDocumentPlainText(document);
    expect(allText).not.toContain('Fallback title'); expect(allText).not.toContain('Notion page 🌍');
    expect(allText).toContain('Hello bold and italic underlined removed inline() safe link\nnext line');
    const paragraph = blocks.find(block => hyperBlockText(document, block).some(run => run.insert === 'and italic'))!;
    const runs = hyperBlockText(document, paragraph);
    expect(runs.find(run => run.insert === 'and italic')?.attributes).toMatchObject({ bold: true, italic: true });
    expect(runs.find(run => run.insert === 'underlined')?.attributes?.underline).toBe(true);
    expect(runs.find(run => run.insert === 'removed')?.attributes?.strikethrough).toBe(true);
    expect(runs.find(run => run.insert === 'inline()')?.attributes?.code).toBe(true);
    expect(runs.find(run => run.insert === 'safe link')?.attributes?.href).toBe('https://example.test/page');
    expect(blocks.find(block => block.ty === 'heading') && hyperBlockData(blocks.find(block => block.ty === 'heading')!).level).toBe(2);
    const bullet = blocks.find(block => block.ty === 'bulleted_list' && hyperBlockText(document, block)[0]?.insert === 'One')!;
    expect(document.blocks[hyperChildren(document, bullet)[0]].ty).toBe('bulleted_list');
    expect(blocks.filter(block => block.ty === 'todo_list').map(block => hyperBlockData(block).checked)).toEqual([true, false]);
    const code = blocks.find(block => block.ty === 'code')!;
    expect(hyperBlockData(code).language).toBe('typescript'); expect(hyperBlockText(document, code)).toEqual([{ insert: "const value = '<safe>';\n  next();" }]);
    const table = blocks.find(block => block.ty === 'simple_table')!;
    expect(hyperBlockData(table).enable_header_row).toBe(true); expect(hyperChildren(document, table)).toHaveLength(2);
    expect(blocks.filter(block => block.ty === 'simple_table_cell')).toHaveLength(4);
  });
  it('never executes or fetches source content and reports assets, unsafe links and unsupported structures', async () => {
    const report = await hyperParseHtmlFixtures([{ source: `<title>Unsafe source</title><script>window.importExecuted++</script><script src="__FIXTURE_ORIGIN__/script.js"></script><link rel="stylesheet" href="__FIXTURE_ORIGIN__/style.css"><style>@import url('__FIXTURE_ORIGIN__/import.css');</style><base href="__FIXTURE_ORIGIN__/">
      <p onclick="window.importExecuted++">Readable <img src="__FIXTURE_ORIGIN__/image.png" onerror="window.importExecuted++" alt="Picture"><a href="javascript:window.importExecuted++">Bad link</a><a href="../Page.html">Relative page</a><a href="file:///private/secret">Local path</a></p>
      <iframe src="__FIXTURE_ORIGIN__/frame"></iframe><video poster="__FIXTURE_ORIGIN__/poster"><source src="__FIXTURE_ORIGIN__/movie"></video><object data="__FIXTURE_ORIGIN__/object"></object><svg><image href="__FIXTURE_ORIGIN__/svg-image"/><text>Diagram text</text></svg><p><img src="/etc/passwd" alt="Local image"></p>
      <table><tr><td colspan="2">Merged</td></tr><tr><td>A</td><td>B</td></tr></table><p>Final text</p>` }]);
    expect(report.executed).toBe(0); expect(report.requests).toBe(0);
    const { result, document } = unpack(report.pages[0]);
    const kinds = result.issues.map(issue => issue.kind);
    for (const kind of ['active-content', 'asset', 'unsafe-link', 'relative-link', 'table-layout', 'unsupported']) expect(kinds).toContain(kind);
    const blocks = Object.values(document.blocks), text = hyperDocumentPlainText(document);
    expect(text).toContain('Readable'); expect(text).toContain('Diagram text'); expect(text).toContain('Merged'); expect(text).toContain('Final text');
    expect(text).not.toContain('window.importExecuted'); expect(blocks.some(block => block.ty === 'image')).toBe(false);
    expect(blocks.flatMap(block => hyperBlockText(document, block)).some(run => run.attributes?.href)).toBe(false);
    expect(text).toContain('/etc/passwd');
  });
  it('recovers malformed HTML text, pads short rows and rejects excessive nesting before import', async () => {
    const report = await hyperParseHtmlFixtures([{ source: '<h1>Recovered<p>Paragraph <b>bold<p>Next<table><tr><td>A<td>B<tr><td>C</table>', fallback: 'Fallback page' }, { source: '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>' }, { source: '<div>'.repeat(150) + 'Deep' + '</div>'.repeat(150) }, { source: '<p>Binary\0data</p>' }]);
    const { document, result } = unpack(report.pages[0]);
    expect(hyperDocumentPlainText(document)).toContain('Paragraph'); expect(hyperDocumentPlainText(document)).toContain('Next');
    expect(result.issues.some(issue => issue.kind === 'formatting')).toBe(true);
    expect(unpack(report.pages[1]).result.issues.some(issue => issue.kind === 'table-layout')).toBe(true);
    expect(report.pages[2]).toMatchObject({ ok: false });
    if (!report.pages[2].ok) expect(report.pages[2].error).toContain('complex');
    expect(report.pages[3]).toMatchObject({ ok: false });
    if (!report.pages[3].ok) expect(report.pages[3].error).toContain('binary');
    expect(report.executed).toBe(0); expect(report.requests).toBe(0);
  });
});
