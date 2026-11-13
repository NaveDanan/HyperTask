import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperEditText, hyperPlainText, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperCaptureInlineMath, hyperCaptureInlineMathInsertion, hyperSaveInlineMath, hyperUnwrapInlineMath } from './HyperInlineMathModel';
import { HYPER_INLINE_MATH_SOURCE_LIMIT, HYPER_INLINE_MATH_ATOM_LIMIT, HyperInlineMathError, hyperInlineMathPlaceholder, hyperInlineMathWithinAtomLimit, hyperReadInlineMath } from './HyperInlineMathValue';

const atom = (formula = 'x+y', insert = '$', attributes: Record<string, unknown> = {}): HyperTextRun => ({ insert, attributes: { formula, ...attributes } });
function document(runs: HyperTextRun[] = [{ insert: 'Before ' }, atom(), { insert: ' after' }]) {
  return create(DocumentDataPBSchema, { pageId: 'page', blocks: {
    page: { id: 'page', ty: 'page', childrenId: 'page-children', data: '{"unknownRoot":true}' },
    a: { id: 'a', parentId: 'page', ty: 'paragraph', childrenId: 'a-children', data: '{"unknownBlock":{"keep":[1,2]}}', oneOfExternalId: { case: 'externalId', value: 'a-text' }, oneOfExternalType: { case: 'externalType', value: 'text' } },
    b: { id: 'b', parentId: 'page', ty: 'paragraph', childrenId: 'b-children', data: '{}', oneOfExternalId: { case: 'externalId', value: 'b-text' }, oneOfExternalType: { case: 'externalType', value: 'text' } },
  }, meta: { childrenMap: { 'page-children': { children: ['a', 'b'] }, 'a-children': { children: [] }, 'b-children': { children: [] } }, textMap: { 'a-text': JSON.stringify(runs), 'b-text': '[{"insert":"Unrelated"}]' } } });
}
const runs = (doc: DocumentDataPB) => hyperBlockText(doc, doc.blocks.a);
const selection = (start: number, end = start) => ({ id: 'a', selection: { start, end } });
function reason(action: () => unknown, expected: HyperInlineMathError['reason']) {
  try { action(); throw Error('Expected a guarded rejection'); }
  catch (error) { expect(error).toBeInstanceOf(HyperInlineMathError); expect((error as HyperInlineMathError).reason).toBe(expected); }
}

describe('Hyper compatible inline math value and text model', () => {
  it('uses AppFlowy’s dollar placeholder and string formula without changing opaque attributes', () => {
    const value = atom(String.raw`\frac{a}{b}`, '$$', { bold: true, future: { untouched: [1, 'source'] } }), before = JSON.stringify(value);
    expect(hyperInlineMathPlaceholder).toBe('$');
    expect(hyperReadInlineMath(value)).toEqual({ formula: String.raw`\frac{a}{b}`, raw: String.raw`\frac{a}{b}`, atomic: true, supported: true });
    expect(JSON.stringify(value)).toBe(before);
    expect(hyperReadInlineMath({ insert: '$', attributes: { bold: true } })).toBeNull();
  });

  it.each([
    { insert: 'not an atom', attributes: { formula: 'x' } },
    { insert: { formula: 'legacy object' }, attributes: { formula: 'x' } },
    { insert: '$', attributes: { formula: { version: 2, source: 'future' } } },
    { insert: '$', attributes: { formula: null } },
    { insert: '$', attributes: { formula: 42 } },
    { insert: '$', attributes: { formula: 'x', mention: { type: 'page', page_id: 'page' } } },
    { insert: '$', attributes: { formula: 'x', footnote: { label: '1' } } },
    { insert: '$', attributes: { formula: 'x', hyper_footnote: { version: 2 } } },
    { insert: '$', attributes: { formula: 'x', href: 'https://example.invalid' } },
    { insert: '$', attributes: { formula: 'x', code: true } },
    { insert: '$', attributes: { formula: 'x' }, futureOperation: { version: 2 } },
    atom('x'.repeat(HYPER_INLINE_MATH_SOURCE_LIMIT + 1)),
  ])('leaves malformed, conflicting and future formula data unchanged: %j', value => {
    const source = value as HyperTextRun, doc = document([source]), before = JSON.stringify(doc), target = hyperCaptureInlineMath(doc, 'a', 0);
    expect(hyperReadInlineMath(source)?.supported).toBe(false); expect(target.editable).toBe(false);
    reason(() => hyperSaveInlineMath(doc, target, 'replacement'), 'unsupported');
    reason(() => hyperUnwrapInlineMath(doc, target), 'unsupported');
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('replaces selected text with one atom while preserving uniform marks, neighboring text and unknown data', () => {
    const attributes = { bold: true, text_color: '#123456', opaque: { preserve: [1, 2] } };
    const doc = document([{ insert: '🌍 ' }, { insert: 'x+y', attributes }, { insert: ' tail', attributes: { italic: true } }]), before = JSON.stringify(doc);
    const target = hyperCaptureInlineMathInsertion(doc, selection(3, 6));
    expect(target.formula).toBe('x+y'); expect(target.attributes).toEqual(attributes);
    const changed = hyperSaveInlineMath(doc, target, String.raw`\alpha + 1`);
    expect(runs(changed.document)).toEqual([{ insert: '🌍 ' }, atom(String.raw`\alpha + 1`, '$', attributes), { insert: ' tail', attributes: { italic: true } }]);
    expect(changed.focus).toEqual({ id: 'a', offset: 4 }); expect(changed.actions).toHaveLength(1);
    expect(changed.document.blocks.a.data).toBe(doc.blocks.a.data); expect(changed.document.meta!.textMap['b-text']).toBe(doc.meta!.textMap['b-text']); expect(JSON.stringify(doc)).toBe(before);
  });

  it('rejects mixed selected attributes instead of discarding formatting, but accepts equivalent key order', () => {
    const mixed = document([{ insert: 'x', attributes: { bold: true } }, { insert: '+y', attributes: { italic: true } }]), before = JSON.stringify(mixed);
    reason(() => hyperCaptureInlineMathInsertion(mixed, selection(0, 3)), 'mixedAttributes'); expect(JSON.stringify(mixed)).toBe(before);
    const uniform = document([{ insert: 'x', attributes: { bold: true, opaque: { a: 1, b: 2 } } }, { insert: '+y', attributes: { opaque: { b: 2, a: 1 }, bold: true } }]);
    expect(hyperCaptureInlineMathInsertion(uniform, selection(0, 3)).formula).toBe('x+y');
  });

  it('edits only the selected atom in a merged run and uses UTF-16 caret offsets', () => {
    const doc = document([{ insert: '🌍' }, atom('x', '$$', { italic: true, unknown: { id: 'keep' } }), { insert: '!' }]), target = hyperCaptureInlineMath(doc, 'a', 3);
    const changed = hyperSaveInlineMath(doc, target, 'y');
    expect(runs(changed.document)).toEqual([{ insert: '🌍' }, atom('x', '$', { italic: true, unknown: { id: 'keep' } }), atom('y', '$', { italic: true, unknown: { id: 'keep' } }), { insert: '!' }]);
    expect(changed.focus).toEqual({ id: 'a', offset: 4 });
    const delta = JSON.parse(changed.actions[0].payload!.oneOfDelta.value as string);
    expect(delta[0]).toEqual({ retain: 3 }); expect(delta.filter((part: { insert?: unknown }) => part.insert !== undefined)).toEqual([{ insert: '$', attributes: { formula: 'y', italic: true, unknown: { id: 'keep' } } }]);
    const unchanged = hyperSaveInlineMath(doc, target, 'x'); expect(unchanged.document).toBe(doc); expect(unchanged.actions).toEqual([]);
  });

  it('unwraps one merged atom to its exact source and preserves every unrelated attribute', () => {
    const formula = String.raw`a_{🌍}+b`, doc = document([{ insert: '🌍' }, atom(formula, '$$', { underline: true, unknown: { keep: 'value' } })]);
    const changed = hyperUnwrapInlineMath(doc, hyperCaptureInlineMath(doc, 'a', 2));
    expect(runs(changed.document)).toEqual([{ insert: '🌍' }, { insert: formula, attributes: { underline: true, unknown: { keep: 'value' } } }, atom(formula, '$', { underline: true, unknown: { keep: 'value' } })]);
    expect(changed.focus).toEqual({ id: 'a', offset: 2 + formula.length });
    const empty = document([atom('')]), removed = hyperUnwrapInlineMath(empty, hyperCaptureInlineMath(empty, 'a', 0)); expect(runs(removed.document)).toEqual([]); expect(removed.focus?.offset).toBe(0);
  });

  it('inserts at a collapsed boundary without inheriting an adjacent atom’s metadata', () => {
    const doc = document([{ insert: '🌍' }, atom('original', '$', { bold: true })]);
    const changed = hyperSaveInlineMath(doc, hyperCaptureInlineMathInsertion(doc, selection(2)), 'new');
    expect(runs(changed.document)).toEqual([{ insert: '🌍' }, atom('new'), atom('original', '$', { bold: true })]);
    reason(() => hyperCaptureInlineMathInsertion(doc, selection(1)), 'invalidPosition');
    reason(() => hyperCaptureInlineMath(doc, 'a', 1), 'invalidPosition');
    for (const [start, end] of [[-1, 0], [0, 4], [2, 0], [0.5, 1]]) reason(() => hyperCaptureInlineMathInsertion(doc, selection(start, end)), 'invalidPosition');
  });

  it('rejects conversion of existing atoms and embeds instead of treating their placeholders as formula text', () => {
    for (const selected of [atom(), { insert: '$', attributes: { mention: { type: 'date', date: '2026-11-11' } } }, { insert: ' ', attributes: { hyper_footnote: { version: 1 } } }, { insert: { future: 'embed' } }]) {
      const doc = document([selected]), before = JSON.stringify(doc);
      reason(() => hyperCaptureInlineMathInsertion(doc, selection(0, 1)), 'unsupported'); expect(JSON.stringify(doc)).toBe(before);
    }
  });

  it('rejects stale formula, surrounding text and attributes without applying an old offset', () => {
    const doc = document(), target = hyperCaptureInlineMath(doc, 'a', 7), insertion = hyperCaptureInlineMathInsertion(doc, selection(0, 6));
    for (const changed of [
      hyperEditText(doc, 'a', [{ insert: 'Before ' }, atom('remote'), { insert: ' after' }]).document,
      hyperEditText(doc, 'a', [{ insert: 'Remote before ' }, atom(), { insert: ' after' }]).document,
      hyperEditText(doc, 'a', [{ insert: 'Before ' }, atom('x+y', '$', { remote: true }), { insert: ' after' }]).document,
    ]) {
      reason(() => hyperSaveInlineMath(changed, target, 'mine'), 'changed'); reason(() => hyperUnwrapInlineMath(changed, target), 'changed'); reason(() => hyperSaveInlineMath(changed, insertion, 'mine'), 'changed');
    }
  });

  it('guards page identity, structural paths, repeated children and detached or code blocks', () => {
    const doc = document(), target = hyperCaptureInlineMath(doc, 'a', 7);
    for (const change of [
      (value: DocumentDataPB) => { value.pageId = 'b'; },
      (value: DocumentDataPB) => { value.blocks.a.parentId = 'b'; value.meta!.childrenMap['b-children'].children = ['a']; },
      (value: DocumentDataPB) => { value.meta!.childrenMap['page-children'].children = ['b']; },
      (value: DocumentDataPB) => { value.meta!.childrenMap['page-children'].children = ['a', 'a', 'b']; },
    ]) { const changed = clone(DocumentDataPBSchema, doc); change(changed); reason(() => hyperSaveInlineMath(changed, target, 'mine'), 'changed'); }
    const code = clone(DocumentDataPBSchema, doc); code.blocks.a.ty = 'code'; expect(hyperCaptureInlineMath(code, 'a', 7).editable).toBe(false); reason(() => hyperCaptureInlineMathInsertion(code, selection(0, 6)), 'unsupported');
  });

  it('accepts equivalent fresh JSON key order but preserves unknown values and rejects their changes', () => {
    const doc = document([atom('x', '$', { opaque: { first: 1, second: 2 }, bold: true })]), target = hyperCaptureInlineMath(doc, 'a', 0), fresh = clone(DocumentDataPBSchema, doc);
    fresh.meta!.textMap['a-text'] = '[{"attributes":{"bold":true,"opaque":{"second":2,"first":1},"formula":"x"},"insert":"$"}]';
    expect(hyperReadInlineMath(runs(hyperSaveInlineMath(fresh, target, 'y').document)[0])?.formula).toBe('y');
    fresh.meta!.textMap['a-text'] = fresh.meta!.textMap['a-text'].replace('"second":2', '"second":3'); reason(() => hyperSaveInlineMath(fresh, target, 'y'), 'changed');
  });

  it('retains untouched legacy objects in native text and emits only string inserts', () => {
    const doc = document([{ insert: { future: 'retained object' } }, atom()]), changed = hyperSaveInlineMath(doc, hyperCaptureInlineMath(doc, 'a', 1), 'updated');
    expect(runs(changed.document)[0].insert).toEqual({ future: 'retained object' });
    for (const action of changed.actions) if (action.payload?.oneOfDelta.case === 'delta') for (const part of JSON.parse(action.payload.oneOfDelta.value)) if ('insert' in part) expect(typeof part.insert).toBe('string');
    const legacy = clone(DocumentDataPBSchema, doc); legacy.blocks.a.oneOfExternalId = { case: undefined }; legacy.blocks.a.data = JSON.stringify({ delta: runs(doc), opaque: true });
    expect(hyperCaptureInlineMath(legacy, 'a', 1).editable).toBe(false); reason(() => hyperSaveInlineMath(legacy, hyperCaptureInlineMath(legacy, 'a', 1), 'updated'), 'unsupported');
  });

  it('bounds source by UTF-16 units while leaving existing oversized data read-only', () => {
    expect(HYPER_INLINE_MATH_SOURCE_LIMIT).toBe(8192);
    const doc = document([{ insert: 'x' }]), target = hyperCaptureInlineMathInsertion(doc, selection(0, 1));
    const formula = '🌍'.repeat(4096), changed = hyperSaveInlineMath(doc, target, formula);
    expect(hyperReadInlineMath(runs(changed.document)[0])?.formula).toBe(formula);
    reason(() => hyperSaveInlineMath(doc, target, formula + 'x'), 'sourceLimit');
    reason(() => hyperCaptureInlineMathInsertion(document([{ insert: formula + 'x' }]), selection(0, formula.length + 1)), 'sourceLimit');
    expect(hyperPlainText(runs(doc))).toBe('x');
  });
  it('keeps a block with future formula operation fields read-only when editing neighboring text', () => {
    for (const value of [{ ...atom(), futureOperation: { version: 2 } } as HyperTextRun, atom('x', 'malformed source')]) {
      const doc = document([{ insert: 'Before ' }, value]), before = JSON.stringify(doc);
      reason(() => hyperCaptureInlineMathInsertion(doc, selection(0, 6)), 'unsupported'); expect(JSON.stringify(doc)).toBe(before);
    }
  });
  it('bounds existing and prospective atom counts without expanding huge merged runs', () => {
    expect(HYPER_INLINE_MATH_ATOM_LIMIT).toBe(64);
    const doc = document([atom('x', '$'.repeat(64)), { insert: ' tail' }]), before = JSON.stringify(doc);
    expect(hyperInlineMathWithinAtomLimit(runs(doc))).toBe(true);
    const insertion = hyperCaptureInlineMathInsertion(doc, selection(64)); reason(() => hyperSaveInlineMath(doc, insertion, 'new'), 'atomLimit');
    expect(JSON.stringify(doc)).toBe(before);
    expect(hyperSaveInlineMath(doc, hyperCaptureInlineMath(doc, 'a', 63), 'edit').actions).toHaveLength(1);
    expect(hyperUnwrapInlineMath(doc, hyperCaptureInlineMath(doc, 'a', 63)).actions).toHaveLength(1);
    const huge = document([atom('x', '$'.repeat(100_000))]); expect(hyperInlineMathWithinAtomLimit(runs(huge))).toBe(false);
    expect(hyperCaptureInlineMath(huge, 'a', 99_999).editable).toBe(false); reason(() => hyperCaptureInlineMathInsertion(huge, selection(100_000)), 'unsupported');
  });
});
