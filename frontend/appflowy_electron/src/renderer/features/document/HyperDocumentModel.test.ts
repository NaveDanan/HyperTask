import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { BlockActionTypePB, BlockPBSchema, DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import {
  hyperBlockData, hyperBlockText, hyperChildren, hyperDeleteBlock, hyperDocumentPlainText, hyperEditText, hyperFormatText,
  hyperInsertBlock, hyperMergeWithPrevious, hyperMoveBlock, hyperPlainText, hyperSliceText, hyperSplitBlock, hyperTextDiff, hyperUpdateBlock,
  HyperDocumentTextCompatibilityError, type HyperTextRun,
} from './HyperDocumentModel';

export function hyperTestDocument(): DocumentDataPB {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', data: '{}', childrenId: 'root-children' },
    p: { id: 'p', ty: 'paragraph', data: '{"custom":"preserved"}', parentId: 'root', childrenId: 'p-children', oneOfExternalId: { case: 'externalId', value: 'text' }, oneOfExternalType: { case: 'externalType', value: 'text' } },
  }, meta: { childrenMap: { 'root-children': { children: ['p'] }, 'p-children': { children: [] } }, textMap: { text: JSON.stringify([{ insert: 'Hello 🌍', attributes: { bold: true } }]) } } });
}
describe('Hyper document operations', () => {
  it('builds AI page context in tree order without detached or canvas data', () => {
    const first = hyperInsertBlock(hyperTestDocument(), 'root', '', 'paragraph');
    let doc = hyperEditText(first.document, first.focus!.id, [{ insert: 'First' }]).document;
    const canvas = hyperInsertBlock(doc, 'root', 'p', 'hyper_canvas', { version: 1 });
    doc = canvas.document;
    const hidden = hyperInsertBlock(doc, canvas.focus!.id, '', 'paragraph');
    doc = hyperEditText(hidden.document, hidden.focus!.id, [{ insert: 'Canvas geometry text' }]).document;
    doc.blocks.detached = create(BlockPBSchema, { id: 'detached', ty: 'paragraph', data: '{"delta":[{"insert":"Detached"}]}' });
    expect(hyperDocumentPlainText(doc)).toBe('First\nHello 🌍');
  });
  it('inserts after a sibling with external text and survives protobuf serialization', () => {
    const original = hyperTestDocument(), change = hyperInsertBlock(original, 'root', 'p', 'todo_list', { checked: false });
    const decoded = fromBinary(DocumentDataPBSchema, toBinary(DocumentDataPBSchema, change.document));
    expect(hyperChildren(original, original.blocks.root)).toEqual(['p']);
    expect(hyperChildren(decoded, decoded.blocks.root)).toEqual(['p', change.focus!.id]);
    expect(hyperBlockText(decoded, decoded.blocks[change.focus!.id])).toEqual([]);
    expect(change.actions.map(a => a.action)).toEqual([BlockActionTypePB.InsertText, BlockActionTypePB.Insert]);
    expect(() => hyperInsertBlock(original, 'root', 'missing')).toThrow('sibling');
  });
  it('uses incremental UTF-16 deltas without splitting surrogate pairs', () => {
    expect(hyperTextDiff([{ insert: 'A🌍B' }], [{ insert: 'A🌎B' }])).toEqual([{ retain: 1 }, { delete: 2 }, { insert: '🌎' }]);
    expect(hyperTextDiff([{ insert: '🌍hello' }], [{ insert: '🌍hi' }])).toEqual([{ retain: 3 }, { delete: 4 }, { insert: 'i' }]);
    expect(hyperTextDiff([{ insert: 'same' }], [{ insert: 'same' }])).toEqual([]);
  });
  it('preserves unknown inline objects in pure helpers without claiming core insert support', () => {
    const runs = [{ insert: 'hello', attributes: { bold: true, custom: 'kept' } }, { insert: { mention: 'page-id' } }];
    const formatted = hyperFormatText(runs, 1, 4, 'italic', true);
    expect(hyperPlainText(formatted)).toBe('hello\uFFFC');
    expect(formatted[1]).toEqual({ insert: 'ell', attributes: { bold: true, custom: 'kept', italic: true } });
    expect(formatted.at(-1)!.insert).toEqual({ mention: 'page-id' });
    expect(hyperSliceText(formatted, 1, 4)).toEqual([formatted[1]]);
  });
  it('splits text with selection removal and preserves the remaining block metadata', () => {
    const original = hyperTestDocument(), split = hyperSplitBlock(original, 'p', 2, 6);
    expect(hyperPlainText(hyperBlockText(split.document, split.document.blocks.p))).toBe('He');
    expect(hyperPlainText(hyperBlockText(split.document, split.document.blocks[split.focus!.id]))).toBe('🌍');
    expect(hyperBlockData(split.document.blocks.p).custom).toBe('preserved');
    expect(hyperPlainText(hyperBlockText(original, original.blocks.p))).toBe('Hello 🌍');
  });
  it('upgrades legacy inline deltas on edit and preserves unrelated data', () => {
    const doc = hyperTestDocument();
    doc.blocks.p = create(BlockPBSchema, { ...doc.blocks.p, oneOfExternalId: { case: undefined }, data: '{"delta":[{"insert":"old"}],"custom":123}' });
    const change = hyperEditText(doc, 'p', [{ insert: 'new' }]);
    expect(hyperBlockData(change.document.blocks.p)).toEqual({ custom: 123 });
    expect(change.actions.map(a => a.action)).toEqual([BlockActionTypePB.InsertText, BlockActionTypePB.Update]);
    expect(hyperBlockText(change.document, change.document.blocks.p)).toEqual([{ insert: 'new' }]);
  });
  it('deletes a subtree in child-first order without deleting neighboring blocks', () => {
    const first = hyperInsertBlock(hyperTestDocument(), 'p', '', 'paragraph');
    const nested = hyperInsertBlock(first.document, first.focus!.id, '', 'paragraph');
    const deleted = hyperDeleteBlock(nested.document, 'p');
    expect(deleted.actions.map(a => a.payload!.oneOfBlock.case === 'block' && a.payload!.oneOfBlock.value.id)).toEqual([nested.focus!.id, first.focus!.id, 'p']);
    expect(Object.keys(deleted.document.blocks)).toEqual(['root']);
    expect(() => hyperDeleteBlock(nested.document, 'root')).toThrow('root');
  });
  it('changes block type and checked state without replacing child ids or text', () => {
    const original = hyperTestDocument(), next = hyperUpdateBlock(original, 'p', { checked: true }, 'todo_list');
    expect(next.document.blocks.p.childrenId).toBe('p-children');
    expect(hyperBlockText(next.document, next.document.blocks.p)).toEqual(hyperBlockText(original, original.blocks.p));
    expect(hyperBlockData(next.document.blocks.p)).toEqual({ custom: 'preserved', checked: true });
    expect(next.actions.map(a => a.action)).toEqual([BlockActionTypePB.Delete, BlockActionTypePB.InsertText, BlockActionTypePB.Insert]);
  });
  it('moves a block to a sibling or nested location and rejects cycles', () => {
    const second = hyperInsertBlock(hyperTestDocument(), 'root', 'p', 'paragraph');
    const moved = hyperMoveBlock(second.document, second.focus!.id, 'p', '');
    expect(hyperChildren(moved.document, moved.document.blocks.root)).toEqual(['p']);
    expect(hyperChildren(moved.document, moved.document.blocks.p)).toEqual([second.focus!.id]);
    expect(() => hyperMoveBlock(moved.document, 'p', second.focus!.id, '')).toThrow('subtree');
  });
  it('merges text and moves child blocks before deleting their old parent', () => {
    const second = hyperInsertBlock(hyperTestDocument(), 'root', 'p', 'paragraph');
    const text = hyperEditText(second.document, second.focus!.id, [{ insert: ' tail', attributes: { italic: true } }]);
    const child = hyperInsertBlock(text.document, second.focus!.id, '', 'paragraph');
    const merged = hyperMergeWithPrevious(child.document, second.focus!.id);
    expect(hyperPlainText(hyperBlockText(merged.document, merged.document.blocks.p))).toBe('Hello 🌍 tail');
    expect(merged.document.blocks[second.focus!.id]).toBeUndefined();
    expect(hyperChildren(merged.document, merged.document.blocks.p)).toEqual([child.focus!.id]);
    expect(merged.document.blocks[child.focus!.id].parentId).toBe('p');
    expect(merged.focus).toEqual({ id: 'p', offset: 8 });
  });
  it('rejects every non-string serialized insert without mutating the source document', () => {
    for (const insert of [{ mention: 'unsupported' }, null, 3, true, ['unsupported'], undefined]) {
      const original = hyperTestDocument(), before = JSON.stringify(original);
      expect(() => hyperEditText(original, 'p', [{ insert } as unknown as HyperTextRun])).toThrow(HyperDocumentTextCompatibilityError);
      expect(JSON.stringify(original)).toBe(before);
    }
  });
  it('allows supported string mentions with arbitrary preserved attributes', () => {
    const original = hyperTestDocument(), mention = { insert: '$', attributes: { mention: { type: 'page', page_id: 'page' }, custom: { keep: true } } };
    const edited = hyperEditText(original, 'p', [{ insert: 'Page ' }, mention]);
    const delta = edited.actions[0].payload!.oneOfDelta;
    expect(delta.case).toBe('delta');
    if (delta.case !== 'delta') throw new Error('Missing text delta.');
    expect(JSON.parse(delta.value).filter((item: { insert?: unknown }) => 'insert' in item).every((item: { insert: unknown }) => typeof item.insert === 'string')).toBe(true);
    expect(hyperBlockText(edited.document, edited.document.blocks.p)).toEqual([{ insert: 'Page ' }, mention]);
  });
  it('allows safe incremental edits beside unchanged external objects without serializing them', () => {
    const original = hyperTestDocument(), object = { insert: { custom: 'legacy-embed' }, attributes: { unknown: true } };
    original.meta!.textMap.text = JSON.stringify([object, { insert: 'Old text' }]);
    const edited = hyperEditText(original, 'p', [object, { insert: 'New text' }]);
    expect(edited.actions).toHaveLength(1); expect(edited.actions[0].action).toBe(BlockActionTypePB.ApplyTextDelta);
    const delta = edited.actions[0].payload!.oneOfDelta;
    if (delta.case !== 'delta') throw new Error('Missing text delta.');
    expect(JSON.parse(delta.value)).toEqual([{ retain: 1 }, { delete: 3 }, { insert: 'New' }]);
    expect(hyperBlockText(edited.document, edited.document.blocks.p)[0]).toEqual(object);
    const same = hyperEditText(original, 'p', hyperBlockText(original, original.blocks.p));
    expect(same.actions).toEqual([]);
  });
  it('rejects object formatting or reinsertion while keeping the pure formatted runs intact', () => {
    const original = hyperTestDocument(), runs: HyperTextRun[] = [{ insert: 'A' }, { insert: { custom: 'legacy-embed' } }, { insert: 'B' }];
    original.meta!.textMap.text = JSON.stringify(runs);
    const before = JSON.stringify(original), formatted = hyperFormatText(runs, 1, 2, 'bold', true);
    expect(formatted[1]).toEqual({ insert: { custom: 'legacy-embed' }, attributes: { bold: true } });
    expect(() => hyperEditText(original, 'p', formatted)).toThrow('original content is preserved');
    expect(() => hyperEditText(original, 'p', [{ insert: 'B' }, runs[1], { insert: 'A' }])).toThrow(HyperDocumentTextCompatibilityError);
    expect(JSON.stringify(original)).toBe(before);
  });
  it('blocks full-text promotion of legacy inline objects even when an external diff could retain them', () => {
    const original = hyperTestDocument(), runs: HyperTextRun[] = [{ insert: { custom: 'legacy-embed' } }, { insert: 'Old text' }];
    original.blocks.p.oneOfExternalId = { case: undefined };
    original.blocks.p.oneOfExternalType = { case: undefined };
    original.blocks.p.data = JSON.stringify({ custom: 'keep', delta: runs });
    const before = JSON.stringify(original);
    expect(() => hyperEditText(original, 'p', [runs[0], { insert: 'New text' }])).toThrow(HyperDocumentTextCompatibilityError);
    expect(JSON.stringify(original)).toBe(before);
    expect(hyperEditText(original, 'p', runs).actions).toEqual([]);
  });
  it('blocks splits and merges that transfer objects to another text while permitting objects retained in place', () => {
    const original = hyperTestDocument(), object = { insert: { custom: 'legacy-embed' } };
    original.meta!.textMap.text = JSON.stringify([{ insert: 'A' }, object, { insert: 'BC' }]);
    const before = JSON.stringify(original);
    expect(() => hyperSplitBlock(original, 'p', 1)).toThrow(HyperDocumentTextCompatibilityError);
    expect(JSON.stringify(original)).toBe(before);
    const safe = hyperSplitBlock(original, 'p', 2);
    expect(hyperBlockText(safe.document, safe.document.blocks.p)).toEqual([{ insert: 'A' }, object]);
    expect(hyperBlockText(safe.document, safe.document.blocks[safe.focus!.id])).toEqual([{ insert: 'BC' }]);
    const next = hyperInsertBlock(hyperTestDocument(), 'root', 'p');
    const block = next.document.blocks[next.focus!.id];
    if (block.oneOfExternalId.case !== 'externalId') throw new Error('Missing fixture text ID.');
    next.document.meta!.textMap[block.oneOfExternalId.value] = JSON.stringify([object]);
    const mergeBefore = JSON.stringify(next.document);
    expect(() => hyperMergeWithPrevious(next.document, next.focus!.id)).toThrow(HyperDocumentTextCompatibilityError);
    expect(JSON.stringify(next.document)).toBe(mergeBefore);
  });
  it('preflights the complete converted subtree before building text restoration actions', () => {
    const inserted = hyperInsertBlock(hyperTestDocument(), 'p', ''), doc = inserted.document;
    const child = doc.blocks[inserted.focus!.id];
    if (child.oneOfExternalId.case !== 'externalId') throw new Error('Missing fixture text ID.');
    doc.meta!.textMap[child.oneOfExternalId.value] = JSON.stringify([{ insert: { custom: 'legacy-child' } }]);
    const before = JSON.stringify(doc);
    expect(() => hyperUpdateBlock(doc, 'p', { level: 2 }, 'heading')).toThrow(HyperDocumentTextCompatibilityError);
    expect(JSON.stringify(doc)).toBe(before);
    const updated = hyperUpdateBlock(doc, 'p', { custom: 'safe metadata' });
    expect(updated.actions.map(action => action.action)).toEqual([BlockActionTypePB.Update]);
    expect(updated.document.meta).toEqual(doc.meta);
    const moved = hyperMoveBlock(doc, child.id, 'root', 'p');
    expect(moved.actions.map(action => action.action)).toEqual([BlockActionTypePB.Move]);
    expect(moved.document.meta!.textMap).toEqual(doc.meta!.textMap);
  });
  it('blocks legacy inline object type conversion without rewriting or replacing the object', () => {
    const original = hyperTestDocument();
    original.blocks.p.oneOfExternalId = { case: undefined };
    original.blocks.p.data = JSON.stringify({ delta: [{ insert: { custom: 'legacy-embed' } }], unknown: { keep: true } });
    const before = JSON.stringify(original);
    expect(() => hyperUpdateBlock(original, 'p', {}, 'heading')).toThrow(HyperDocumentTextCompatibilityError);
    expect(() => hyperUpdateBlock(original, 'p', { delta: [{ insert: 'Replacement' }] }, 'heading')).toThrow(HyperDocumentTextCompatibilityError);
    expect(JSON.stringify(original)).toBe(before);
  });
});
