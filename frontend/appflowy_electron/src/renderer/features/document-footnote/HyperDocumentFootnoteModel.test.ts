import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperEditText, hyperPlainText, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperCaptureMentionSelection } from '../document/HyperDocumentMentions';
import { hyperApplyDocumentFootnoteValue, hyperBuildDocumentFootnote, hyperCaptureDocumentFootnote, hyperCaptureFootnoteInsertion, hyperDocumentFootnoteIndex, hyperRemoveDocumentFootnote, hyperSaveDocumentFootnote } from './HyperDocumentFootnoteModel';
import { hyperDocumentFootnoteDraft, hyperReadDocumentFootnote } from './HyperDocumentFootnoteValue';
const note = { version: 1 as const, id: 'note-id', label: '1', text: 'Original note' };
const atom = (attributes: Record<string, unknown> = {}): HyperTextRun => ({ insert: ' ', attributes: { hyper_footnote: { ...note }, ...attributes } });
function document(first: HyperTextRun[] = [{ insert: '🌍 selected' }], second: HyperTextRun[] = []) {
  return create(DocumentDataPBSchema, { pageId: 'page', blocks: {
    page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' },
    a: { id: 'a', parentId: 'page', childrenId: 'a-children', ty: 'paragraph', data: '{"custom":"kept"}', oneOfExternalId: { case: 'externalId', value: 'a-text' }, oneOfExternalType: { case: 'externalType', value: 'text' } },
    b: { id: 'b', parentId: 'page', childrenId: 'b-children', ty: 'paragraph', data: '{}', oneOfExternalId: { case: 'externalId', value: 'b-text' }, oneOfExternalType: { case: 'externalType', value: 'text' } },
  }, meta: { childrenMap: { children: { children: ['a', 'b'] }, 'a-children': { children: [] }, 'b-children': { children: [] } }, textMap: { 'a-text': JSON.stringify(first), 'b-text': JSON.stringify(second) } } });
}
describe('string-backed footnote definitions', () => {
  it('recognizes exact AFFiNE citations and explicit versioned notes while retaining other attributes', () => {
    const citation = { insert: ' ', attributes: { bold: true, future: { opaque: [1, 'keep'] }, footnote: { label: 'doc-7', reference: { type: 'doc', docId: 'target', description: 'Source' } } } };
    expect(hyperReadDocumentFootnote(citation)).toMatchObject({ atomic: true, supported: true, editable: true, label: 'doc-7', value: { kind: 'citation' } });
    expect(hyperReadDocumentFootnote(atom())).toMatchObject({ supported: true, value: { kind: 'note' } });
    expect(hyperReadDocumentFootnote({ insert: ' ', attributes: { footnote: { label: 'file', reference: { type: 'attachment', blobId: 'blob', fileName: 'Source.pdf' } } } })).toMatchObject({ supported: true, editable: false });
    expect(citation.attributes.future).toEqual({ opaque: [1, 'keep'] });
  });
  it.each([
    { footnote: { label: '1', reference: { type: 'future', docId: 'x' } } },
    { footnote: { label: '1', reference: { type: 'doc', docId: 42 } } },
    { footnote: { label: '1', reference: { type: 'url', url: 'https://example.invalid', future: true } } },
    { hyper_footnote: { ...note, version: 2 } },
    { hyper_footnote: { ...note, extra: { opaque: true } } },
    { hyper_footnote: note, footnote: { label: '2', reference: { type: 'doc', docId: 'x' } } },
  ])('keeps future or ambiguous schemas read-only: %j', attributes => {
    const run = { insert: ' ', attributes }, before = JSON.stringify(run), doc = document([run]), target = hyperCaptureDocumentFootnote(doc, 'a', 0);
    expect(hyperReadDocumentFootnote(run)?.editable).toBe(false); expect(target.editable).toBe(false);
    expect(() => hyperSaveDocumentFootnote(doc, target, { ...hyperDocumentFootnoteDraft(), text: 'rewrite' })).toThrow('unsupported'); expect(JSON.stringify(run)).toBe(before);
  });
  it('inserts after a selected phrase, allocates an unused label, and never inserts an object', () => {
    const doc = document(undefined, [atom()]), before = JSON.stringify(doc), selection = hyperCaptureMentionSelection(doc, { id: 'a', selection: { start: 3, end: 11 } })!, target = hyperCaptureFootnoteInsertion(doc, selection);
    const changed = hyperSaveDocumentFootnote(doc, target, { ...hyperDocumentFootnoteDraft(), text: 'Second note' }), runs = hyperBlockText(changed.document, changed.document.blocks.a);
    expect(hyperPlainText(runs)).toBe('🌍 selected '); expect(hyperReadDocumentFootnote(runs.at(-1)!)?.value?.data.label).toBe('2'); expect(runs.every(run => typeof run.insert === 'string')).toBe(true); expect(JSON.stringify(doc)).toBe(before);
  });
  it('updates every repeated reference, including merged spaces, while preserving each run’s unrelated attrs', () => {
    const doc = document([{ insert: '🌍' }, { ...atom({ bold: true, future: { untouched: 1 } }), insert: '  ' }, { insert: ' tail' }], [atom({ italic: true, other: 'kept' })]), index = hyperDocumentFootnoteIndex(doc);
    expect(index.groups.get('1')?.entries.map(entry => [entry.blockId, entry.offset])).toEqual([['a', 2], ['a', 3], ['b', 0]]);
    const target = hyperCaptureDocumentFootnote(doc, 'a', 3), changed = hyperSaveDocumentFootnote(doc, target, { ...hyperDocumentFootnoteDraft(target.read.value), text: 'Updated' });
    const a = hyperBlockText(changed.document, changed.document.blocks.a), b = hyperBlockText(changed.document, changed.document.blocks.b);
    expect(a[1]).toMatchObject({ insert: '  ', attributes: { bold: true, future: { untouched: 1 }, hyper_footnote: { ...note, text: 'Updated' } } }); expect(b[0]).toMatchObject({ attributes: { italic: true, other: 'kept', hyper_footnote: { ...note, text: 'Updated' } } });
    expect(hyperPlainText(a)).toBe('🌍   tail'); expect(changed.actions).toHaveLength(2);
    const unchanged = hyperSaveDocumentFootnote(doc, target, hyperDocumentFootnoteDraft(target.read.value)); expect(unchanged.actions).toEqual([]); expect(unchanged.document).toBe(doc);
  });
  it('removes only one complete merged atom and keeps its other references', () => {
    const doc = document([{ insert: '🌍' }, { ...atom(), insert: '  ' }], [atom()]), changed = hyperRemoveDocumentFootnote(doc, hyperCaptureDocumentFootnote(doc, 'a', 3));
    expect(hyperPlainText(hyperBlockText(changed.document, changed.document.blocks.a))).toBe('🌍 '); expect(hyperDocumentFootnoteIndex(changed.document).groups.get('1')?.entries).toHaveLength(2); expect(changed.focus).toEqual({ id: 'a', offset: 3 });
  });
  it('rejects stale source blocks, changed shared definitions and detachment without changing the document', () => {
    const doc = document([atom()], [atom()]), target = hyperCaptureDocumentFootnote(doc, 'a', 0), draft = { ...hyperDocumentFootnoteDraft(target.read.value), text: 'Save' };
    const elsewhere = hyperEditText(doc, 'b', [{ insert: 'different' }, atom()]).document; expect(() => hyperSaveDocumentFootnote(elsewhere, target, draft)).toThrow('changed');
    const detached = clone(DocumentDataPBSchema, doc); detached.blocks.a.parentId = 'b'; expect(() => hyperSaveDocumentFootnote(detached, target, draft)).toThrow('changed'); expect(hyperBlockText(doc, doc.blocks.a)).toEqual([atom()]);
  });
  it('rejects conflicting labels and conflicting note IDs instead of choosing a definition', () => {
    for (const other of [{ ...note, text: 'Different' }, { ...note, label: '2' }, { ...note, label: '2', version: 2 }]) {
      const doc = document([atom()], [{ insert: ' ', attributes: { hyper_footnote: other } }]), index = hyperDocumentFootnoteIndex(doc);
      expect(index.conflict).toBe(true); expect(() => hyperBuildDocumentFootnote(index, { ...hyperDocumentFootnoteDraft(), text: 'New' })).toThrow('conflict');
    }
  });
  it('protects legacy object snapshots and UTF-16 boundaries while leaving retained object embeds untouched', () => {
    const doc = document([{ insert: { future: 'object' } }, atom()]), target = hyperCaptureDocumentFootnote(doc, 'a', 1), changed = hyperSaveDocumentFootnote(doc, target, { ...hyperDocumentFootnoteDraft(target.read.value), text: 'Changed' });
    expect(hyperBlockText(changed.document, changed.document.blocks.a)[0].insert).toEqual({ future: 'object' });
    for (const action of changed.actions) if (action.payload?.oneOfDelta.case === 'delta') for (const run of JSON.parse(action.payload.oneOfDelta.value)) if ('insert' in run) expect(typeof run.insert).toBe('string');
    const legacy = document(); legacy.blocks.a.oneOfExternalId = { case: undefined }; legacy.blocks.a.data = JSON.stringify({ delta: [{ insert: { future: 'legacy' } }] });
    expect(() => hyperCaptureFootnoteInsertion(legacy, hyperCaptureMentionSelection(legacy, { id: 'a', selection: { start: 1, end: 1 } })!)).toThrow('changed');
    const emoji = document(); expect(() => hyperCaptureFootnoteInsertion(emoji, hyperCaptureMentionSelection(emoji, { id: 'a', selection: { start: 1, end: 1 } })!)).toThrow('invalidPosition');
  });
  it('accepts a fresh core read that reorders JSON keys while guarding every retained value', () => {
    const doc = document([{ insert: 'Text' }, atom({ opaque: { first: 1, second: 2 } })]), target = hyperCaptureDocumentFootnote(doc, 'a', 4), insertion = hyperCaptureFootnoteInsertion(doc, hyperCaptureMentionSelection(doc, { id: 'a', selection: { start: 5, end: 5 } })!);
    const reordered = clone(DocumentDataPBSchema, doc); reordered.meta!.textMap['a-text'] = JSON.stringify([{ insert: 'Text' }, { attributes: { opaque: { second: 2, first: 1 }, hyper_footnote: { text: note.text, label: note.label, id: note.id, version: 1 } }, insert: ' ' }]);
    expect(hyperSaveDocumentFootnote(reordered, target, { ...hyperDocumentFootnoteDraft(target.read.value), text: 'Updated' }).actions.length).toBeGreaterThan(0);
    expect(hyperSaveDocumentFootnote(reordered, insertion, { ...hyperDocumentFootnoteDraft(), text: 'Inserted' }).actions.length).toBeGreaterThan(0);
    const changed = clone(DocumentDataPBSchema, reordered); changed.meta!.textMap['a-text'] = reordered.meta!.textMap['a-text'].replace('\"second\":2', '\"second\":3');
    expect(() => hyperSaveDocumentFootnote(changed, target, { ...hyperDocumentFootnoteDraft(target.read.value), text: 'Updated' })).toThrow('changed');
  });
  it('allows explicit reuse and guards prepared labels against concurrent allocation', () => {
    const doc = document([{ insert: 'Text' }], [atom()]), target = hyperCaptureFootnoteInsertion(doc, hyperCaptureMentionSelection(doc, { id: 'a', selection: { start: 4, end: 4 } })!), index = hyperDocumentFootnoteIndex(doc);
    const reused = hyperSaveDocumentFootnote(doc, target, { ...hyperDocumentFootnoteDraft(), kind: 'existing', existingLabel: '1' }); expect(hyperDocumentFootnoteIndex(reused.document).groups.get('1')?.entries).toHaveLength(2);
    const value = hyperBuildDocumentFootnote(index, { ...hyperDocumentFootnoteDraft(), text: 'New' }), concurrent = hyperEditText(doc, 'b', [atom(), { insert: ' ', attributes: { hyper_footnote: { ...note, id: 'other', label: '2', text: 'Concurrent' } } }]).document;
    expect(() => hyperApplyDocumentFootnoteValue(concurrent, target, value)).toThrow('changed');
  });
});
