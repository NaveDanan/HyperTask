import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperEditText, hyperInsertBlock, hyperMoveBlock, hyperUpdateBlock } from '../document/HyperDocumentModel';
import { hyperDocumentOutline } from './HyperDocumentOutlineModel';

function fixture() {
  return create(DocumentDataPBSchema, {
    pageId: 'root',
    blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'root-children' } },
    meta: { childrenMap: { 'root-children': { children: [] } } },
  });
}

describe('Hyper document outline', () => {
  it('follows tree order, carries collapsed ancestors, and ignores detached and canvas headings', () => {
    let doc = fixture();
    const toggle = hyperInsertBlock(doc, 'root', '', 'toggle_list'); doc = toggle.document;
    const nested = hyperInsertBlock(doc, toggle.focus!.id, '', 'heading', { level: 3 }); doc = nested.document;
    doc = hyperEditText(doc, nested.focus!.id, [{ insert: ' Nested\n heading 🌍 ', attributes: { bold: true } }]).document;
    const next = hyperInsertBlock(doc, 'root', toggle.focus!.id, 'heading', { level: 1 }); doc = next.document;
    doc = hyperEditText(doc, next.focus!.id, [{ insert: 'Top heading' }]).document;
    const canvas = hyperInsertBlock(doc, 'root', next.focus!.id, 'hyper_canvas', { version: 1 }); doc = canvas.document;
    doc = hyperInsertBlock(doc, canvas.focus!.id, '', 'heading', { level: 2 }).document;
    doc.blocks.detached = { ...doc.blocks[next.focus!.id], id: 'detached', parentId: '' };
    const before = JSON.stringify(doc);
    expect(hyperDocumentOutline(doc)).toEqual({ invalid: false, headings: [
      { id: nested.focus!.id, title: 'Nested heading 🌍', level: 3, ancestorIds: ['root', toggle.focus!.id] },
      { id: next.focus!.id, title: 'Top heading', level: 1, ancestorIds: ['root'] },
    ] });
    expect(JSON.stringify(doc)).toBe(before);
    doc = hyperMoveBlock(doc, next.focus!.id, 'root', '').document;
    expect(hyperDocumentOutline(doc).headings.map(heading => heading.id)).toEqual([next.focus!.id, nested.focus!.id]);
  });

  it('updates from external rich text and preserves empty headings and levels one through six', () => {
    let doc = fixture();
    const inserted = hyperInsertBlock(doc, 'root', '', 'heading', { level: 6 }); doc = inserted.document;
    expect(hyperDocumentOutline(doc).headings[0]).toMatchObject({ title: '', level: 6 });
    doc = hyperEditText(doc, inserted.focus!.id, [{ insert: 'Revised ', attributes: { italic: true } }, { insert: 'title' }]).document;
    expect(hyperDocumentOutline(doc).headings[0].title).toBe('Revised title');
    doc = hyperUpdateBlock(doc, inserted.focus!.id, { level: -5 }).document;
    expect(hyperDocumentOutline(doc).headings[0].level).toBe(1);
    expect(hyperDocumentOutline(null)).toEqual({ headings: [], invalid: false });
    expect(hyperDocumentOutline(fixture())).toEqual({ headings: [], invalid: false });
  });

  it('reports malformed, repeated, cyclic, or mismatched trees without returning a misleading partial outline', () => {
    const inserted = hyperInsertBlock(fixture(), 'root', '', 'heading', { level: 2 });
    for (const mutate of [
      (doc: typeof inserted.document) => { delete doc.blocks[inserted.focus!.id]; },
      (doc: typeof inserted.document) => { doc.meta!.childrenMap['root-children'].children.push(inserted.focus!.id); },
      (doc: typeof inserted.document) => { doc.meta!.childrenMap[doc.blocks[inserted.focus!.id].childrenId] = { $typeName: 'ChildrenPB', children: ['root'] }; },
      (doc: typeof inserted.document) => { doc.blocks[inserted.focus!.id].parentId = 'other'; },
      (doc: typeof inserted.document) => { doc.blocks[inserted.focus!.id].data = 'broken json'; },
      (doc: typeof inserted.document) => { doc.blocks[inserted.focus!.id].id = 'other'; },
    ]) {
      const doc = structuredClone(inserted.document); mutate(doc);
      expect(hyperDocumentOutline(doc)).toEqual({ headings: [], invalid: true });
    }
  });
});
