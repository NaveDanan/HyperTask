import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperBlockData, hyperChildren, hyperPlainText, hyperBlockText } from '../document/HyperDocumentModel';
import { hyperCaptureDocumentDatabaseAnchor, hyperDocumentDatabaseType, hyperInsertDocumentDatabase, hyperReadDocumentDatabase } from './HyperDocumentDatabaseModel';

const document = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: {
  root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' },
  paragraph: { id: 'paragraph', parentId: 'root', ty: 'paragraph', data: JSON.stringify({ delta: [{ insert: '🌍 original', attributes: { bold: true } }] }), childrenId: 'paragraph-children' },
}, meta: { childrenMap: { children: { children: ['paragraph'] }, 'paragraph-children': { children: [] } } } });
const reference = { type: 'grid' as const, parentId: 'page', viewId: 'database', compact: false };
describe('Hyper inline database model', () => {
  it('inserts an upstream-compatible reference without replacing the active paragraph', () => {
    const doc = document(), original = JSON.stringify(doc);
    const anchor = hyperCaptureDocumentDatabaseAnchor(doc, 'paragraph');
    const change = hyperInsertDocumentDatabase(doc, anchor, reference);
    const ids = hyperChildren(change.document, change.document.blocks.root);
    expect(ids[0]).toBe('paragraph'); expect(ids).toHaveLength(2);
    const inserted = change.document.blocks[ids[1]];
    expect(inserted.ty).toBe('grid');
    expect(hyperBlockData(inserted)).toEqual({ parent_id: 'page', view_id: 'database' });
    expect(hyperReadDocumentDatabase(change.document, inserted)).toEqual(reference);
    expect(hyperPlainText(hyperBlockText(change.document, change.document.blocks.paragraph))).toBe('🌍 original');
    expect(hyperBlockText(change.document, change.document.blocks.paragraph)[0].attributes?.bold).toBe(true);
    expect(JSON.stringify(doc)).toBe(original);
  });
  it('appends without a selection and keeps compact settings and unrelated saved attributes', () => {
    const doc = document();
    const inserted = hyperInsertDocumentDatabase(doc, hyperCaptureDocumentDatabaseAnchor(doc), { ...reference, type: 'board', compact: true });
    const id = hyperChildren(inserted.document, inserted.document.blocks.root).at(-1)!;
    const block = inserted.document.blocks[id];
    block.data = JSON.stringify({ ...hyperBlockData(block), future_setting: { keep: true } });
    const saved = block.data;
    expect(hyperReadDocumentDatabase(inserted.document, block)).toEqual({ ...reference, type: 'board', compact: true });
    expect(block.data).toBe(saved);
    expect(hyperDocumentDatabaseType(ViewLayoutPB.Calendar)).toBe('calendar');
    expect(() => hyperDocumentDatabaseType(ViewLayoutPB.Document)).toThrow('supported database');
  });
  it('rejects stale, detached and cyclic insertion locations', () => {
    const doc = document(), anchor = hyperCaptureDocumentDatabaseAnchor(doc, 'paragraph');
    const stale = document(); stale.meta!.childrenMap.children.children = [];
    expect(() => hyperInsertDocumentDatabase(stale, anchor, reference)).toThrow('location changed');
    expect(() => hyperInsertDocumentDatabase(doc, { ...anchor, pageId: 'another-page' }, reference)).toThrow('location changed');
    expect(() => hyperCaptureDocumentDatabaseAnchor(stale, 'paragraph')).toThrow('location changed');
    const cyclic = document(); cyclic.blocks.paragraph.parentId = 'paragraph'; cyclic.meta!.childrenMap['paragraph-children'].children = ['paragraph'];
    expect(() => hyperCaptureDocumentDatabaseAnchor(cyclic, 'paragraph')).toThrow('cycle');
    expect(() => hyperInsertDocumentDatabase(doc, null, reference)).toThrow('location changed');
  });
  it('refuses malformed references and nested unsupported data without rewriting blocks', () => {
    const doc = document(), change = hyperInsertDocumentDatabase(doc, hyperCaptureDocumentDatabaseAnchor(doc), reference);
    const id = hyperChildren(change.document, change.document.blocks.root).at(-1)!;
    const block = change.document.blocks[id];
    for (const data of [{ parent_id: 'page' }, { parent_id: '', view_id: 'db' }, { parent_id: 'page', view_id: 'db', enable_compact_mode: 'future' }]) {
      block.data = JSON.stringify(data); const saved = block.data;
      expect(() => hyperReadDocumentDatabase(change.document, block)).toThrow(); expect(block.data).toBe(saved);
    }
    block.data = JSON.stringify({ parent_id: 'page', view_id: 'db' });
    change.document.meta!.childrenMap[block.childrenId] = { $typeName: 'ChildrenPB', children: ['paragraph'] };
    expect(() => hyperReadDocumentDatabase(change.document, block)).toThrow('invalid');
  });
});
