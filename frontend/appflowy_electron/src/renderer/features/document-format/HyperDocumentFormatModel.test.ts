import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperEditText, hyperPlainText, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperApplyDocumentFormat, hyperCaptureDocumentFormat, hyperDocumentFormatUrl, hyperDocumentFormatValues } from './HyperDocumentFormatModel';
import { hyperDocumentColorAttribute, hyperDocumentColorCss } from './HyperDocumentColor';

function document(runs: HyperTextRun[]) {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' }, p: { id: 'p', ty: 'paragraph', data: JSON.stringify({ delta: runs }), parentId: 'root', childrenId: 'pchildren' } }, meta: { childrenMap: { children: { children: ['p'] } } } });
}
describe('Hyper inline format capture and application', () => {
  it('formats UTF-16 text without discarding other marks or atomic page/date mentions', () => {
    const original: HyperTextRun[] = [{ insert: 'A🌍', attributes: { bold: true, unknown: { keep: true } } }, { insert: '$', attributes: { mention: { type: 'page', page_id: 'target' } } }, { insert: '$', attributes: { mention: { type: 'date', date: '2026-11-11' }, custom: 2 } }, { insert: 'Z', attributes: { italic: true, bg_color: '0x4dffeb3b' } }];
    const doc = document(original), selected = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 1, end: 6 } });
    const result = hyperApplyDocumentFormat(doc, selected, { href: 'https://example.org/path', font_color: '#123456' });
    const runs = hyperBlockText(result.document, result.document.blocks.p);
    expect(hyperPlainText(runs)).toBe('A🌍$$Z');
    expect(runs.find(run => run.insert === '🌍')?.attributes).toEqual({ bold: true, unknown: { keep: true }, href: 'https://example.org/path', font_color: '0xff123456' });
    expect(runs.find(run => run.insert === '$')?.attributes).toEqual({ mention: { type: 'page', page_id: 'target' }, font_color: '0xff123456' });
    expect(runs.find(run => run.attributes?.custom === 2)?.attributes).toEqual({ mention: { type: 'date', date: '2026-11-11' }, custom: 2, font_color: '0xff123456' });
    expect(runs.find(run => run.insert === 'Z')?.attributes).toMatchObject({ italic: true, bg_color: '0x4dffeb3b' });
    expect(hyperBlockText(doc, doc.blocks.p)).toEqual(original);
  });
  it('expands a caret across link fragments with different marks, then removes only that link', () => {
    const doc = document([{ insert: 'Before ' }, { insert: 'one', attributes: { href: 'mailto:test@example.org', bold: true } }, { insert: ' two', attributes: { href: 'mailto:test@example.org', italic: true } }, { insert: ' after' }]);
    const selected = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 9, end: 9 } });
    expect([selected.start, selected.end]).toEqual([7, 14]); expect(hyperDocumentFormatValues(selected).href).toBe('mailto:test@example.org');
    const change = hyperApplyDocumentFormat(doc, selected, { href: null });
    expect(hyperBlockText(change.document, change.document.blocks.p)).toEqual([{ insert: 'Before ' }, { insert: 'one', attributes: { bold: true } }, { insert: ' two', attributes: { italic: true } }, { insert: ' after' }]);
  });
  it('keeps mixed values distinct from cleared values and changes only supplied attributes', () => {
    const doc = document([{ insert: 'A', attributes: { font_color: '0xffff0000', bg_color: '0x4dffeb3b', custom: true } }, { insert: 'B', attributes: { font_color: '0xff0000ff', bg_color: '0x4dffeb3b' } }]);
    const selected = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 0, end: 2 } });
    expect(hyperDocumentFormatValues(selected)).toEqual({ href: null, font_color: undefined, bg_color: '#ffeb3b4d' });
    const result = hyperApplyDocumentFormat(doc, selected, { bg_color: null });
    expect(hyperBlockText(result.document, result.document.blocks.p)).toEqual([{ insert: 'A', attributes: { font_color: '0xffff0000', custom: true } }, { insert: 'B', attributes: { font_color: '0xff0000ff' } }]);
  });
  it('rejects stale text, moved/detached blocks and read-only application', () => {
    const doc = document([{ insert: 'Text' }]), selected = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 0, end: 4 } });
    expect(() => hyperApplyDocumentFormat(hyperEditText(doc, 'p', [{ insert: 'Other' }]).document, selected, { href: null })).toThrow('text changed');
    expect(() => hyperApplyDocumentFormat(doc, selected, { href: null }, false)).toThrow('read-only');
    doc.meta!.childrenMap.children.children = [];
    expect(() => hyperApplyDocumentFormat(doc, selected, { bg_color: null })).toThrow('editable block');
  });
  it('rejects invalid or split-surrogate selections and a link consisting only of atomic content', () => {
    const doc = document([{ insert: '🌍' }, { insert: '$', attributes: { mention: { type: 'page', page_id: 'target' } } }]);
    for (const selection of [{ start: 1, end: 2 }, { start: -1, end: 2 }, { start: 0, end: 5 }]) expect(() => hyperCaptureDocumentFormat(doc, { id: 'p', selection })).toThrow('valid');
    expect(() => hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 0, end: 0 } })).toThrow('Select text');
    const selected = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 2, end: 3 } });
    expect(() => hyperApplyDocumentFormat(doc, selected, { href: 'https://example.org' })).toThrow('ordinary text');
  });
  it('rejects executable URLs and unsafe CSS while preserving source attributes', () => {
    const doc = document([{ insert: 'Text', attributes: { unsupported: 'keep' } }]), selected = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 0, end: 4 } });
    for (const href of ['javascript:alert(1)', 'data:text/html,bad', 'file:///secret', 'https://example.org/\npath', '//example.org', 'https://example.org/a b']) {
      expect(() => hyperApplyDocumentFormat(doc, selected, { href })).toThrow(); expect(() => hyperDocumentFormatUrl(href)).toThrow();
    }
    for (const color of ['url(https://tracker)', 'var(--remote)', 'red; background:url(x)', 'expression(alert(1))', '#12', 'rgb(256,0,0)']) expect(() => hyperApplyDocumentFormat(doc, selected, { font_color: color })).toThrow('valid color');
    expect(hyperBlockText(doc, doc.blocks.p)).toEqual([{ insert: 'Text', attributes: { unsupported: 'keep' } }]);
  });
});
describe('Hyper upstream color conversion', () => {
  it('converts ARGB and legacy CSS safely, including alpha and short hex', () => {
    expect(hyperDocumentColorCss('0x4dffeb3b')).toBe('#ffeb3b4d'); expect(hyperDocumentColorAttribute('#ffeb3b4d')).toBe('0x4dffeb3b');
    expect(hyperDocumentColorAttribute('#abc')).toBe('0xffaabbcc'); expect(hyperDocumentColorAttribute('#abc8')).toBe('0x88aabbcc');
    expect(hyperDocumentColorAttribute('rgb(100%, 0%, 0%)')).toBe('0xffff0000'); expect(hyperDocumentColorAttribute('rgba(255, 128, 0, .5)')).toBe('0x80ff8000');
    expect(hyperDocumentColorCss('rgb(0 10 255 / 50%)')).toBe('#000aff80');
  });
});
