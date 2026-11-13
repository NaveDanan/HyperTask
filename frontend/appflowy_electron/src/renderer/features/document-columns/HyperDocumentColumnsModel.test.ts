import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { BlockActionTypePB, DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperEditText, hyperInsertBlock, hyperUpdateBlock } from '../document/HyperDocumentModel';
import { hyperExportDocument } from '../document/HyperDocumentExport';
import { hyperCaptureDocumentColumns, hyperCaptureDocumentColumnsInsertion, hyperDocumentColumnsInsertionMatches, hyperInsertDocumentColumns, hyperReadDocumentColumns, hyperResizeDocumentColumns } from './HyperDocumentColumnsModel';

const empty = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
function fixture(count: 2 | 3 | 4 = 2) {
  const changed = hyperInsertDocumentColumns(empty(), 'root', '', count), doc = changed.document;
  const id = hyperChildren(doc, doc.blocks.root)[0], layout = hyperReadDocumentColumns(doc, id);
  return { changed, doc, id, layout };
}

describe('Hyper compatible document columns', () => {
  it.each([2, 3, 4] as const)('creates %s compatible column subtrees and focuses the first paragraph', count => {
    const original = empty(), changed = hyperInsertDocumentColumns(original, 'root', '', count), doc = changed.document;
    const id = hyperChildren(doc, doc.blocks.root)[0], layout = hyperReadDocumentColumns(doc, id);
    expect(original.meta!.childrenMap.children.children).toEqual([]);
    expect(doc.blocks[id].ty).toBe('simple_columns'); expect(layout.supported).toBe(true);
    expect(layout.columns).toHaveLength(count);
    for (const column of layout.columns) {
      expect(doc.blocks[column.id].ty).toBe('simple_column'); expect(doc.blocks[column.id].parentId).toBe(id);
      expect(column.ratio).toBeCloseTo(1 / count);
      const child = hyperChildren(doc, doc.blocks[column.id]);
      expect(child).toHaveLength(1); expect(doc.blocks[child[0]].ty).toBe('paragraph');
      expect(doc.blocks[child[0]].oneOfExternalId.case).toBe('externalId');
    }
    expect(changed.focus?.id).toBe(hyperChildren(doc, doc.blocks[layout.columns[0].id])[0]);
    expect(changed.actions.filter(action => action.action === BlockActionTypePB.InsertText)).toHaveLength(count);
  });
  it('validates roots, insertion parents and captured anchors before producing changes', () => {
    const paragraph = hyperInsertBlock(empty(), 'root', ''), doc = paragraph.document, paragraphId = paragraph.focus!.id;
    const target = hyperCaptureDocumentColumnsInsertion(doc, 'root', paragraphId);
    expect(hyperDocumentColumnsInsertionMatches(doc, target)).toBe(true);
    const text = hyperEditText(doc, paragraphId, [{ insert: 'Concurrent text' }]).document;
    expect(hyperDocumentColumnsInsertionMatches(text, target)).toBe(true);
    const inserted = hyperInsertBlock(text, 'root', paragraphId);
    expect(hyperDocumentColumnsInsertionMatches(inserted.document, target)).toBe(false);
    expect(() => hyperInsertDocumentColumns(doc, 'root', 'missing', 2)).toThrow('position changed');
    expect(() => hyperInsertDocumentColumns(doc, 'missing', '', 2)).toThrow();
    expect(() => hyperInsertDocumentColumns(doc, 'root', '', 5 as 2)).toThrow('two, three or four');
    expect(() => hyperInsertDocumentColumns(doc, 'root', '', 2, false)).toThrow('read-only');
    const code = hyperUpdateBlock(doc, paragraphId, {}, 'code');
    expect(() => hyperInsertDocumentColumns(code.document, paragraphId, '', 2)).toThrow('cannot be inserted');
    const broken = empty(); broken.blocks.root.parentId = 'root';
    expect(() => hyperInsertDocumentColumns(broken, 'root', '', 2)).toThrow('root');
  });
  it('can insert inside a valid column without moving or overwriting existing content', () => {
    const f = fixture(), column = f.layout.columns[0];
    const originalChild = hyperChildren(f.doc, f.doc.blocks[column.id])[0];
    const changed = hyperInsertDocumentColumns(f.doc, column.id, originalChild, 2);
    expect(changed.document.blocks[originalChild]).toEqual(f.doc.blocks[originalChild]);
    expect(hyperChildren(changed.document, changed.document.blocks[column.id])).toHaveLength(2);
    expect(() => hyperInsertDocumentColumns(f.doc, f.id, '', 2)).toThrow('cannot be inserted');
  });
  it('resizes an adjacent pair while preserving IDs, deprecated widths, unknown attributes and external rich text', () => {
    const f = fixture(3), [left, right, other] = f.layout.columns;
    let doc = hyperUpdateBlock(f.doc, left.id, { width: 225, custom: { keep: true } }).document;
    doc = hyperUpdateBlock(doc, f.id, { futureMetadata: { keep: true } }).document;
    const textId = hyperChildren(doc, doc.blocks[left.id])[0];
    doc = hyperEditText(doc, textId, [{ insert: 'Styled ', attributes: { bold: true, custom: 'keep' } }, { insert: '$', attributes: { mention: { type: 'page', page_id: 'page' } } }]).document;
    const before = doc, target = hyperCaptureDocumentColumns(doc, f.id);
    const changed = hyperResizeDocumentColumns(doc, target, 0, 0.4);
    expect(changed.actions.map(action => action.action)).toEqual([BlockActionTypePB.Update, BlockActionTypePB.Update]);
    expect(hyperBlockData(changed.document.blocks[left.id])).toMatchObject({ ratio: 0.4, width: 225, custom: { keep: true } });
    expect(hyperReadDocumentColumns(changed.document, f.id).columns[1].ratio).toBeCloseTo(2 / 3 - 0.4);
    expect(changed.document.blocks[other.id]).toEqual(before.blocks[other.id]);
    expect(changed.document.blocks[textId]).toEqual(before.blocks[textId]);
    expect(hyperBlockText(changed.document, changed.document.blocks[textId])).toEqual(hyperBlockText(before, before.blocks[textId]));
    expect(changed.document.blocks[f.id]).toEqual(before.blocks[f.id]);
    expect(hyperBlockData(before.blocks[right.id]).ratio).toBeCloseTo(1 / 3);
  });
  it('leaves missing ratios unchanged on read and writes only the resized pair', () => {
    const f = fixture(3);
    for (const column of f.layout.columns) f.doc.blocks[column.id].data = JSON.stringify({ width: 200, unknown: true });
    const original = JSON.stringify(f.doc), layout = hyperReadDocumentColumns(f.doc, f.id);
    expect(layout.supported).toBe(true); expect(layout.columns.map(column => column.ratio)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(JSON.stringify(f.doc)).toBe(original);
    const changed = hyperResizeDocumentColumns(f.doc, hyperCaptureDocumentColumns(f.doc, f.id), 0, 0.4);
    expect(hyperBlockData(changed.document.blocks[layout.columns[2].id])).toEqual({ width: 200, unknown: true });
    expect(hyperReadDocumentColumns(changed.document, f.id).supported).toBe(true);
  });
  it('accepts floating point thirds but preserves non-unit-sum legacy ratios as read-only', () => {
    const f = fixture(3);
    for (const column of f.layout.columns) f.doc.blocks[column.id].data = JSON.stringify({ ratio: 0.3333334, unknown: 'keep' });
    expect(hyperReadDocumentColumns(f.doc, f.id).supported).toBe(true);
    const g = fixture();
    for (const column of g.layout.columns) g.doc.blocks[column.id].data = JSON.stringify({ ratio: 0.6, width: 240 });
    const before = JSON.stringify(g.doc), layout = hyperReadDocumentColumns(g.doc, g.id);
    expect(layout.supported).toBe(false); expect(layout.columns.map(column => column.ratio)).toEqual([0.6, 0.6]);
    expect(layout.error).toContain('preserved'); expect(JSON.stringify(g.doc)).toBe(before);
    expect(() => hyperCaptureDocumentColumns(g.doc, g.id)).toThrow('preserved');
  });
  it('rejects invalid boundaries, sizes, stale topology and read-only changes without altering documents', () => {
    const f = fixture(), target = hyperCaptureDocumentColumns(f.doc, f.id), before = JSON.stringify(f.doc);
    for (const ratio of [NaN, Infinity, 0.09, 0.91, -1, 2]) expect(() => hyperResizeDocumentColumns(f.doc, target, 0, ratio)).toThrow();
    for (const index of [-1, 0.5, 1, 8]) expect(() => hyperResizeDocumentColumns(f.doc, target, index, 0.6)).toThrow('boundary');
    expect(() => hyperResizeDocumentColumns(f.doc, target, 0, 0.6, false)).toThrow('read-only');
    const changed = hyperResizeDocumentColumns(f.doc, target, 0, 0.55);
    expect(() => hyperResizeDocumentColumns(changed.document, target, 0, 0.6)).toThrow('layout changed');
    expect(hyperResizeDocumentColumns(f.doc, target, 0, 0.5).actions).toEqual([]);
    expect(JSON.stringify(f.doc)).toBe(before);
    const reordered = fixture();
    reordered.doc.meta!.childrenMap[reordered.doc.blocks[reordered.id].childrenId].children.reverse();
    expect(() => hyperResizeDocumentColumns(reordered.doc, target, 0, 0.6)).toThrow();
  });
  it('allows independent text and unknown-attribute updates during a captured width edit', () => {
    const f = fixture(), target = hyperCaptureDocumentColumns(f.doc, f.id), column = f.layout.columns[0];
    const childId = hyperChildren(f.doc, f.doc.blocks[column.id])[0];
    let doc = hyperEditText(f.doc, childId, [{ insert: 'Concurrent user text' }]).document;
    doc = hyperUpdateBlock(doc, column.id, { custom: { current: true } }).document;
    const changed = hyperResizeDocumentColumns(doc, target, 0, 0.6);
    expect(hyperBlockText(changed.document, changed.document.blocks[childId])).toEqual([{ insert: 'Concurrent user text' }]);
    expect(hyperBlockData(changed.document.blocks[column.id]).custom).toEqual({ current: true });
  });
  it('sends no text actions when resizing a preserved legacy object-run snapshot', () => {
    const f = fixture(), paragraph = f.doc.blocks[f.changed.focus!.id];
    if (paragraph.oneOfExternalId.case !== 'externalId') throw new Error('Fixture text ID is missing.');
    const textId = paragraph.oneOfExternalId.value, raw = JSON.stringify([{ insert: 'Keep existing ', attributes: { bold: true } }, { insert: { mention: 'legacy-page' } }]);
    // This is a read-only legacy snapshot, not an edit supported by Rust's String-only TextDelta.
    f.doc.meta!.textMap[textId] = raw;
    const changed = hyperResizeDocumentColumns(f.doc, hyperCaptureDocumentColumns(f.doc, f.id), 0, 0.6);
    expect(changed.actions.every(action => action.action === BlockActionTypePB.Update)).toBe(true);
    expect(changed.document.meta!.textMap[textId]).toBe(raw);
    expect(changed.document.blocks[paragraph.id]).toEqual(paragraph);
  });
  it('preserves malformed and future layouts instead of migrating them', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.doc.blocks[f.id].data = '{"version":2}'; },
      (f: ReturnType<typeof fixture>) => { f.doc.blocks[f.layout.columns[0].id].data = '{"ratio":"50%"}'; },
      (f: ReturnType<typeof fixture>) => { f.doc.blocks[f.layout.columns[0].id].ty = 'future_column'; },
      (f: ReturnType<typeof fixture>) => { f.doc.blocks[f.layout.columns[0].id].parentId = 'wrong'; },
      (f: ReturnType<typeof fixture>) => { f.doc.meta!.childrenMap[f.doc.blocks[f.id].childrenId].children.push(f.layout.columns[0].id); },
    ]) {
      const f = fixture(); mutate(f); const before = JSON.stringify(f.doc);
      expect(hyperReadDocumentColumns(f.doc, f.id).supported).toBe(false);
      expect(() => hyperCaptureDocumentColumns(f.doc, f.id)).toThrow('preserved');
      expect(JSON.stringify(f.doc)).toBe(before);
    }
  });
  it('exports self-contained proportional HTML and ordered Markdown without changing stored columns', () => {
    const f = fixture();
    let doc = hyperEditText(f.doc, f.changed.focus!.id, [{ insert: 'Left <script> & first' }]).document;
    const second = hyperChildren(doc, doc.blocks[f.layout.columns[1].id])[0];
    doc = hyperEditText(doc, second, [{ insert: 'Right 🌍' }]).document;
    doc = hyperResizeDocumentColumns(doc, hyperCaptureDocumentColumns(doc, f.id), 0, 0.6).document;
    const before = JSON.stringify(doc), html = hyperExportDocument(doc, 'html'), markdown = hyperExportDocument(doc, 'markdown');
    expect(html).toContain('data-hyper-columns="true"'); expect(html).toContain('display:flex');
    expect(html).toContain('flex:0.6 1 0%'); expect(html).toContain('flex:0.4 1 0%');
    expect(html).toContain('Left &lt;script&gt; &amp; first'); expect(html).toContain('Right 🌍'); expect(html).not.toContain('<script>');
    expect(markdown.indexOf('Left')).toBeLessThan(markdown.indexOf('Right')); expect(markdown).not.toContain('data-hyper-columns');
    expect(JSON.stringify(doc)).toBe(before);
  });
});
