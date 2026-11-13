import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperPageMention } from '../document-links/HyperDocumentLinkService';
import { hyperCaptureMentionSelection, hyperInsertMentionAtSelection } from './HyperDocumentMentions';
import { hyperBlockText, hyperEditText, hyperPlainText } from './HyperDocumentModel';

function document() {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', childrenId: 'children' },
    p: { id: 'p', ty: 'paragraph', parentId: 'root', childrenId: 'p-children', data: JSON.stringify({ delta: [{ insert: '🌍word', attributes: { bold: true, custom: 'retained' } }] }) },
  }, meta: { childrenMap: { children: { children: ['p'] }, 'p-children': { children: [] } } } });
}

describe('Hyper document mention insertion', () => {
  it('replaces the captured UTF-16 range and retains surrounding attributes', () => {
    const original = document();
    const target = hyperCaptureMentionSelection(original, { id: 'p', selection: { start: 2, end: 4 } });
    const change = hyperInsertMentionAtSelection(original, target, hyperPageMention('target'));
    expect(hyperBlockText(change.document, change.document.blocks.p)).toEqual([
      { insert: '🌍', attributes: { bold: true, custom: 'retained' } },
      ...hyperPageMention('target'),
      { insert: 'rd', attributes: { bold: true, custom: 'retained' } },
    ]);
    expect(change.focus).toEqual({ id: 'p', offset: 3 });
    expect(hyperPlainText(hyperBlockText(original, original.blocks.p))).toBe('🌍word');
  });
  it('rejects stale text and invalid ranges without overwriting changed data', () => {
    const original = document();
    const target = hyperCaptureMentionSelection(original, { id: 'p', selection: { start: 2, end: 2 } });
    const changed = hyperEditText(original, 'p', [{ insert: 'Someone else changed this' }]).document;
    expect(() => hyperInsertMentionAtSelection(changed, target, hyperPageMention('target'))).toThrow('text changed');
    expect(hyperPlainText(hyperBlockText(changed, changed.blocks.p))).toBe('Someone else changed this');
    expect(() => hyperCaptureMentionSelection(original, { id: 'p', selection: { start: 0, end: 100 } })).toThrow('selection');
    expect(() => hyperCaptureMentionSelection(original, { id: 'missing', selection: { start: 0, end: 0 } })).toThrow('block');
  });
  it('creates an editable paragraph when no text selection exists', () => {
    const change = hyperInsertMentionAtSelection(document(), null, hyperPageMention('target'));
    expect(change.document.meta!.childrenMap.children.children).toEqual(['p', change.focus!.id]);
    expect(hyperBlockText(change.document, change.document.blocks[change.focus!.id])).toEqual(hyperPageMention('target'));
  });
});
