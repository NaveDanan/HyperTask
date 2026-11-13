import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { BlockActionTypePB, DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperDeleteBlock } from '../document/HyperDocumentModel';
import { hyperCaptureDocumentMediaAnchor, hyperDocumentMediaUrl, hyperInsertDocumentMedia, hyperReadDocumentMedia, type HyperDocumentMediaReference } from './HyperDocumentMediaModel';

function fixture() {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' },
    text: { id: 'text', ty: 'paragraph', data: JSON.stringify({ delta: [{ insert: 'Before 🌍', attributes: { bold: true } }] }), parentId: 'root', childrenId: 'text-children' },
  }, meta: { childrenMap: { children: { children: ['text'] } } } });
}
const media = (kind: 'image' | 'file' = 'image', source: HyperDocumentMediaReference['source'] = 'local'): HyperDocumentMediaReference => ({ id: 'media-id', kind, source, url: source === 'local' ? '/storage/images/photo.png' : 'https://example.org/media', name: 'Photo 🌍', caption: 'Caption', alt: 'Alternative', uploadedAt: 123 });
describe('Hyper document media model', () => {
  it('inserts compatible source enums beside existing text and makes repeated insertion idempotent', () => {
    for (const kind of ['image', 'file'] as const) for (const source of ['local', 'cloud', 'network'] as const) {
      const original = fixture(), anchor = hyperCaptureDocumentMediaAnchor(original, 'text'), reference = media(kind, source);
      const inserted = hyperInsertDocumentMedia(original, anchor, reference);
      expect(hyperBlockText(inserted.document, inserted.document.blocks.text)).toEqual(hyperBlockText(original, original.blocks.text));
      expect(hyperChildren(inserted.document, inserted.document.blocks.root)).toEqual(['text', reference.id]);
      expect(inserted.actions).toHaveLength(1); expect(inserted.actions[0].action).toBe(BlockActionTypePB.Insert);
      expect(hyperReadDocumentMedia(inserted.document, inserted.document.blocks[reference.id])).toMatchObject({ id: reference.id, kind, source, url: reference.url, name: reference.name });
      expect(hyperInsertDocumentMedia(inserted.document, anchor, reference).actions).toEqual([]);
      const removed = hyperDeleteBlock(inserted.document, reference.id);
      expect(removed.document.blocks.text).toEqual(original.blocks.text);
      expect(removed.actions.every(action => action.action === BlockActionTypePB.Delete)).toBe(true);
    }
  });
  it('keeps malformed/future media and attached child data untouched', () => {
    for (const data of [{ url: '/file', image_type: 7 }, { url: 'javascript:alert(1)', image_type: 2 }, { url: '/file', image_type: '0' }, { url: 'https://x/file', image_type: 2, caption: { unknown: true } }]) {
      const doc = fixture(); doc.blocks.text.ty = 'image'; doc.blocks.text.data = JSON.stringify(data);
      const before = JSON.stringify(doc);
      expect(() => hyperReadDocumentMedia(doc, doc.blocks.text)).toThrow(); expect(JSON.stringify(doc)).toBe(before);
    }
    const doc = fixture(); doc.blocks.text.ty = 'image'; doc.blocks.text.data = JSON.stringify({ url: '/file', image_type: 0 });
    doc.meta!.childrenMap['text-children'] = { $typeName: 'ChildrenPB', children: ['nested'] };
    expect(() => hyperReadDocumentMedia(doc, doc.blocks.text)).toThrow('saved content');
  });
  it('reads legacy URL images, captions, alt text, alignment and dimensions without normalizing saved data', () => {
    const doc = fixture(); doc.blocks.text.ty = 'image';
    doc.blocks.text.data = JSON.stringify({ url: 'https://example.org/photo.png', caption: '<caption>', alt: '🌍', align: 'right', width: 400, height: 250, unknown: 'preserved' });
    const original = doc.blocks.text.data;
    expect(hyperReadDocumentMedia(doc, doc.blocks.text)).toMatchObject({ source: 'network', caption: '<caption>', alt: '🌍', align: 'right', width: 400, height: 250 });
    expect(doc.blocks.text.data).toBe(original);
  });
  it('rejects stale insertion anchors, reused IDs and unsafe URLs', () => {
    const doc = fixture(), anchor = hyperCaptureDocumentMediaAnchor(doc, 'text');
    delete doc.blocks.text; doc.meta!.childrenMap.children.children = [];
    expect(() => hyperInsertDocumentMedia(doc, anchor, media())).toThrow('location changed');
    expect(() => hyperInsertDocumentMedia(fixture(), { ...anchor, pageId: 'other' }, media())).toThrow('location changed');
    expect(() => hyperInsertDocumentMedia(fixture(), anchor, { ...media(), id: 'text' })).toThrow();
    for (const url of ['file:///etc/passwd', 'data:image/svg+xml,bad', 'javascript:alert(1)', 'https://key:secret@example.org/file', '//example.org/file']) expect(() => hyperDocumentMediaUrl(url)).toThrow();
    expect(hyperDocumentMediaUrl(' https://example.org/a ')).toBe('https://example.org/a');
  });
});
