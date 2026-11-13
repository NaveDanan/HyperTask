import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperEditText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperAvailableDocumentBlockCommands, hyperCanControlDocumentBlock, hyperCanDropDocumentBlock, hyperCaptureDocumentBlock, hyperDocumentBlockCommand, hyperMoveDocumentBlock } from '../src/renderer/features/document-block-controls/HyperDocumentBlockControlsModel';
import { hyperBeginBlockDrag, hyperBlockDragPayload, hyperCurrentBlockDrag, hyperEndBlockDrag, hyperReadBlockDrag } from '../src/renderer/features/document-block-controls/HyperDocumentBlockDrag';

function document() {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', data: '{}', childrenId: 'root-children' },
    a: { id: 'a', ty: 'paragraph', data: JSON.stringify({ delta: [{ insert: 'Alpha 🌍', attributes: { bold: true, custom: { keep: true } } }] }), parentId: 'root', childrenId: 'a-children' },
    a1: { id: 'a1', ty: 'bulleted_list', data: JSON.stringify({ delta: [{ insert: 'Child' }] }), parentId: 'a', childrenId: 'a1-children' },
    b: { id: 'b', ty: 'heading', data: JSON.stringify({ delta: [{ insert: 'Beta' }], level: 2 }), parentId: 'root', childrenId: 'b-children' },
    c: { id: 'c', ty: 'quote', data: JSON.stringify({ delta: [{ insert: 'Gamma' }] }), parentId: 'root', childrenId: 'c-children' },
    table: { id: 'table', ty: 'simple_table', data: '{}', parentId: 'root', childrenId: 'table-children' },
    row: { id: 'row', ty: 'simple_table_row', data: '{}', parentId: 'table', childrenId: 'row-children' },
    cell: { id: 'cell', ty: 'simple_table_cell', data: '{}', parentId: 'row', childrenId: 'cell-children' },
    cellText: { id: 'cellText', ty: 'paragraph', data: JSON.stringify({ delta: [{ insert: 'Cell' }] }), parentId: 'cell', childrenId: 'cell-text-children' },
    canvas: { id: 'canvas', ty: 'hyper_canvas', data: '{"version":1}', parentId: 'root', childrenId: 'canvas-children' },
    shape: { id: 'shape', ty: 'hyper_canvas_rectangle', data: '{}', parentId: 'canvas', childrenId: 'shape-children' },
  }, meta: { childrenMap: { 'root-children': { children: ['a', 'b', 'c', 'table', 'canvas'] }, 'a-children': { children: ['a1'] }, 'table-children': { children: ['row'] }, 'row-children': { children: ['cell'] }, 'cell-children': { children: ['cellText'] }, 'canvas-children': { children: ['shape'] } } } });
}
const children = (doc: ReturnType<typeof document>, id = 'root') => hyperChildren(doc, doc.blocks[id]);
describe('Hyper document block controls', () => {
  it('moves a whole subtree while preserving rich text, descendant IDs and table structure', () => {
    const doc = document(), changed = hyperMoveDocumentBlock(doc, hyperCaptureDocumentBlock(doc, 'a'), hyperCaptureDocumentBlock(doc, 'c'), 'after');
    expect(children(changed.document)).toEqual(['b', 'c', 'a', 'table', 'canvas']); expect(children(changed.document, 'a')).toEqual(['a1']);
    expect(changed.document.blocks.a1).toEqual(doc.blocks.a1); expect(hyperBlockText(changed.document, changed.document.blocks.a)).toEqual(hyperBlockText(doc, doc.blocks.a));
    expect(children(changed.document, 'table')).toEqual(['row']); expect(children(doc)).toEqual(['a', 'b', 'c', 'table', 'canvas']); expect(changed.actions).toHaveLength(1);
  });
  it('implements accessible move up/down and indent/outdent commands', () => {
    let doc = document();
    expect(hyperAvailableDocumentBlockCommands(doc, hyperCaptureDocumentBlock(doc, 'a'))).toEqual(['down', 'delete']);
    doc = hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, 'b'), 'up').document; expect(children(doc).slice(0, 3)).toEqual(['b', 'a', 'c']);
    doc = hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, 'b'), 'down').document; expect(children(doc).slice(0, 3)).toEqual(['a', 'b', 'c']);
    doc = hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, 'b'), 'indent').document; expect(children(doc, 'a')).toEqual(['a1', 'b']); expect(doc.blocks.b.parentId).toBe('a');
    doc = hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, 'b'), 'outdent').document; expect(children(doc).slice(0, 3)).toEqual(['a', 'b', 'c']); expect(doc.blocks.b.parentId).toBe('root');
  });
  it('deletes only the captured subtree and supplies a remaining text focus target', () => {
    const doc = document(), changed = hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, 'a'), 'delete');
    expect(changed.document.blocks.a).toBeUndefined(); expect(changed.document.blocks.a1).toBeUndefined(); expect(changed.document.blocks.b).toEqual(doc.blocks.b); expect(changed.document.blocks.cellText).toEqual(doc.blocks.cellText);
    expect(changed.focus?.id).toBe('b'); expect(children(changed.document)).toEqual(['b', 'c', 'table', 'canvas']);
  });
  it('protects roots, canvas geometry, table rows/cells and their paragraph contents', () => {
    const doc = document();
    for (const id of ['root', 'canvas', 'shape', 'row', 'cell', 'cellText']) { expect(hyperCanControlDocumentBlock(doc, id)).toBe(false); expect(() => hyperCaptureDocumentBlock(doc, id)).toThrow(); }
    expect(hyperCanControlDocumentBlock(doc, 'table')).toBe(true);
    for (const id of ['table', 'b', 'row', 'cell', 'canvas']) expect(hyperCanDropDocumentBlock(doc, 'a', id, 'inside')).toBe(false);
  });
  it('rejects cycles, self drops, invalid targets and cross-document captures', () => {
    const doc = document(), a = hyperCaptureDocumentBlock(doc, 'a'), child = hyperCaptureDocumentBlock(doc, 'a1');
    expect(() => hyperMoveDocumentBlock(doc, a, child, 'inside')).toThrow('own subtree'); expect(() => hyperMoveDocumentBlock(doc, a, a, 'before')).toThrow('different target');
    const other = clone(DocumentDataPBSchema, doc); other.pageId = 'other-root'; other.blocks['other-root'] = { ...other.blocks.root, id: 'other-root' }; other.blocks.b.parentId = 'other-root';
    const target = hyperCaptureDocumentBlock(other, 'b'); expect(() => hyperMoveDocumentBlock(doc, a, target, 'after')).toThrow('changed');
    expect(hyperCanDropDocumentBlock(doc, 'a', 'missing', 'before')).toBe(false);
  });
  it('rejects stale source text, descendants, targets, sibling order, read-only operations and malformed trees', () => {
    const doc = document(), source = hyperCaptureDocumentBlock(doc, 'a'), target = hyperCaptureDocumentBlock(doc, 'b');
    for (const id of ['a', 'a1', 'b']) {
      const changed = hyperEditText(doc, id, [{ insert: 'New content' }]).document;
      expect(() => hyperMoveDocumentBlock(changed, source, target, 'after')).toThrow('changed');
    }
    const reordered = clone(DocumentDataPBSchema, doc); reordered.meta!.childrenMap['root-children'].children.reverse(); expect(() => hyperDocumentBlockCommand(reordered, source, 'delete')).toThrow('changed');
    expect(() => hyperMoveDocumentBlock(doc, source, target, 'after', false)).toThrow('read-only'); expect(() => hyperDocumentBlockCommand(doc, source, 'delete', false)).toThrow('read-only');
    const repeated = clone(DocumentDataPBSchema, doc); repeated.meta!.childrenMap['a-children'].children.push('a1'); expect(() => hyperCaptureDocumentBlock(repeated, 'a')).toThrow('repeated');
    const broken = clone(DocumentDataPBSchema, doc); delete broken.blocks.a1; expect(() => hyperCaptureDocumentBlock(broken, 'a')).toThrow('invalid child');
  });
});
describe('Hyper block transfer ownership', () => {
  it('keeps private subtree data out of DataTransfer and rejects another document, owner, forged token and replay', () => {
    const owner = {}, other = {}, doc = document(), drag = hyperBeginBlockDrag(owner, 'document', hyperCaptureDocumentBlock(doc, 'a'), { id: 'a', start: 1, end: 3 });
    const payload = hyperBlockDragPayload(drag); expect(payload).not.toContain('Alpha'); expect(payload).not.toContain('custom'); expect(payload).not.toContain('subtree');
    expect(hyperReadBlockDrag(owner, 'document', payload)).toBe(drag); expect(hyperCurrentBlockDrag(owner, 'document')).toBe(drag);
    expect(() => hyperReadBlockDrag(other, 'document', payload)).toThrow('same document and owner'); expect(() => hyperReadBlockDrag(owner, 'other-document', payload)).toThrow('same document and owner');
    expect(() => hyperReadBlockDrag(owner, 'document', JSON.stringify({ ...JSON.parse(payload), id: 'forged' }))).toThrow();
    hyperEndBlockDrag(drag); expect(() => hyperReadBlockDrag(owner, 'document', payload)).toThrow();
  });
  it('invalidates an earlier drag without letting its late cleanup remove the current transfer', () => {
    const owner = {}, doc = document(), first = hyperBeginBlockDrag(owner, 'document', hyperCaptureDocumentBlock(doc, 'a')), second = hyperBeginBlockDrag(owner, 'document', hyperCaptureDocumentBlock(doc, 'b'));
    hyperEndBlockDrag(first); expect(hyperCurrentBlockDrag(owner, 'document')).toBe(second); expect(() => hyperReadBlockDrag(owner, 'document', hyperBlockDragPayload(first))).toThrow(); hyperEndBlockDrag(second);
  });
});
