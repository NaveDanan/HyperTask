import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperPlainText, hyperUpdateBlock } from '../document/HyperDocumentModel';
import { hyperCanvasConnector, hyperCanvasGeometry, hyperCanvasHitTest, hyperCanvasLabel, hyperCanvasPaintOrder, hyperCanvasStrokeGeometry, hyperDeleteCanvasElement, hyperEditCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas, hyperUpdateCanvasElement } from './HyperWhiteboardModel';

const document = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
const geometry = { x: 10, y: 20, width: 100, height: 80 };
describe('Hyper whiteboard model', () => {
  it('stores elements separately under one versioned container without changing the original document', () => {
    const original = document(), first = hyperInsertCanvasElement(original, 'rectangle', geometry);
    const second = hyperInsertCanvasElement(first.document, 'ellipse', { ...geometry, x: 200 });
    expect(hyperChildren(original, original.blocks.root)).toEqual([]);
    expect(hyperChildren(second.document, second.document.blocks.root)).toHaveLength(1);
    expect(hyperReadCanvas(second.document).elements.map(e => e.kind)).toEqual(['rectangle', 'ellipse']);
    expect(second.actions).toHaveLength(1);
    const updated = hyperUpdateCanvasElement(second.document, first.focus!.id, { x: -20 });
    expect(updated.actions).toHaveLength(1);
    expect(hyperReadCanvas(updated.document).elements[1]).toEqual(hyperReadCanvas(second.document).elements[1]);
  });
  it('creates shared page paragraphs for notes and leaves text intact when the note is deleted', () => {
    const inserted = hyperInsertCanvasElement(document(), 'note', geometry, { text: 'Page and canvas' });
    const note = hyperReadCanvas(inserted.document).elements[0];
    expect(note.sourceId).toBeTruthy();
    expect(inserted.document.blocks[note.sourceId!].ty).toBe('paragraph');
    const edited = hyperEditCanvasLabel(inserted.document, note.id, 'Edited on canvas');
    expect(hyperPlainText(hyperBlockText(edited.document, edited.document.blocks[note.sourceId!]))).toBe('Edited on canvas');
    const deleted = hyperDeleteCanvasElement(edited.document, note.id);
    expect(deleted.document.blocks[note.sourceId!]).toBeDefined();
    expect(hyperReadCanvas(deleted.document).elements).toEqual([]);
  });
  it('keeps inline formatting and embedded mentions outside note text edits', () => {
    const inserted = hyperInsertCanvasElement(document(), 'note', geometry);
    const note = hyperReadCanvas(inserted.document).elements[0];
    // Seed a legacy snapshot without pretending the native text API accepts new object inserts.
    let doc = clone(DocumentDataPBSchema, inserted.document);
    const source = doc.blocks[note.sourceId!];
    if (source.oneOfExternalId.case !== 'externalId') throw new Error('Missing fixture text ID');
    doc.meta!.textMap[source.oneOfExternalId.value] = JSON.stringify([{ insert: 'Hello ', attributes: { bold: true } }, { insert: { mention: 'page' } }]);
    doc = hyperEditCanvasLabel(doc, note.id, 'Hello new \uFFFC').document;
    expect(hyperBlockText(doc, doc.blocks[note.sourceId!])[0].attributes?.bold).toBe(true);
    expect(hyperBlockText(doc, doc.blocks[note.sourceId!]).at(-1)!.insert).toEqual({ mention: 'page' });
    expect(hyperCanvasLabel(note, doc)).toBe('Hello new \uFFFC');
  });
  it('scales freehand points on resize and preserves future metadata', () => {
    const inserted = hyperInsertCanvasElement(document(), 'pen', geometry, { points: [{ x: 0, y: 0 }, { x: 100, y: 80 }] });
    const id = inserted.focus!.id;
    const future = hyperUpdateBlock(inserted.document, id, { future: { keep: true } });
    const resized = hyperUpdateCanvasElement(future.document, id, { width: 200, height: 40 });
    expect(hyperReadCanvas(resized.document).elements[0].points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 40 }]);
    expect(hyperBlockData(resized.document.blocks[id]).future).toEqual({ keep: true });
  });
  it('preserves unknown versions and malformed elements without editing them', () => {
    const first = hyperInsertCanvasElement(document(), 'rectangle', geometry);
    const unknown = hyperUpdateBlock(first.document, first.focus!.id, { version: 2 });
    expect(hyperReadCanvas(unknown.document).unsupportedIds).toEqual([first.focus!.id]);
    expect(() => hyperUpdateCanvasElement(unknown.document, first.focus!.id, { x: 2 })).toThrow('cannot be edited');
    const second = hyperInsertCanvasElement(unknown.document, 'ellipse', geometry);
    expect(second.document.blocks[first.focus!.id]).toEqual(unknown.document.blocks[first.focus!.id]);
  });
  it('tracks connector endpoints when attached shapes move and uses saved points after deletion', () => {
    const first = hyperInsertCanvasElement(document(), 'rectangle', geometry);
    const second = hyperInsertCanvasElement(first.document, 'ellipse', { ...geometry, x: 300 });
    const connector = hyperInsertCanvasElement(second.document, 'connector', geometry, { fromId: first.focus!.id, toId: second.focus!.id, points: [{ x: 0, y: 0 }, { x: 100, y: 80 }] });
    const moved = hyperUpdateCanvasElement(connector.document, first.focus!.id, { x: 50 });
    const elements = hyperReadCanvas(moved.document).elements;
    expect(hyperCanvasConnector(elements[2], elements)).toEqual([{ x: 100, y: 60 }, { x: 350, y: 60 }]);
    const deleted = hyperDeleteCanvasElement(moved.document, first.focus!.id), remaining = hyperReadCanvas(deleted.document).elements;
    expect(hyperCanvasConnector(remaining[1], remaining)[0]).toEqual({ x: 10, y: 20 });
  });
  it('normalizes reverse drags and hits topmost shapes before enclosing frames', () => {
    expect(hyperCanvasGeometry({ x: 10, y: 20 }, { x: -10, y: -20 })).toEqual({ x: -10, y: -20, width: 20, height: 40 });
    const shape = hyperInsertCanvasElement(document(), 'rectangle', geometry);
    const frame = hyperInsertCanvasElement(shape.document, 'frame', { x: 0, y: 0, width: 500, height: 500 });
    expect(hyperCanvasHitTest(hyperReadCanvas(frame.document).elements, { x: 20, y: 30 })?.id).toBe(shape.focus!.id);
    expect(hyperCanvasPaintOrder(hyperReadCanvas(frame.document).elements).map(element => element.id)).toEqual([frame.focus!.id, shape.focus!.id]);
  });
  it('bounds the entire freehand stroke even when it ends back at its starting point', () => {
    expect(hyperCanvasStrokeGeometry([{ x: 0, y: 0 }, { x: -80, y: 120 }, { x: 90, y: -20 }, { x: 0, y: 0 }])).toEqual({ x: -80, y: -20, width: 170, height: 140 });
    expect(() => hyperCanvasStrokeGeometry([])).toThrow('at least one');
    expect(() => hyperCanvasStrokeGeometry([{ x: NaN, y: 0 }])).toThrow('invalid point');
  });
  it('rejects invalid coordinates and nontext note sources', () => {
    expect(() => hyperInsertCanvasElement(document(), 'rectangle', { ...geometry, x: NaN })).toThrow('geometry');
    expect(() => hyperInsertCanvasElement(document(), 'rectangle', { ...geometry, width: -1 })).toThrow('geometry');
    expect(() => hyperInsertCanvasElement(document(), 'note', geometry, { sourceId: 'root' })).toThrow('text block');
    expect(() => hyperInsertCanvasElement(document(), 'pen', geometry, { points: [{ x: Infinity, y: 0 }] })).toThrow('invalid point');
  });
  it('persists an image attachment and description through moving, resizing and label changes', () => {
    const imagePath = '/workspace/images/generated.png';
    const first = hyperInsertCanvasElement(document(), 'image', geometry, { imagePath, alt: 'A generated sketch' });
    const id = first.focus!.id;
    const moved = hyperUpdateCanvasElement(first.document, id, { x: -100, width: 240, height: 160 });
    const edited = hyperEditCanvasLabel(moved.document, id, 'A clearer description');
    const image = hyperReadCanvas(edited.document).elements[0];
    expect(image).toMatchObject({ id, kind: 'image', imagePath, alt: 'A clearer description', x: -100, width: 240, height: 160 });
    expect(hyperCanvasLabel(image, edited.document)).toBe('A clearer description');
    expect(hyperReadCanvas(first.document).elements[0]).toMatchObject({ x: 10, width: 100, alt: 'A generated sketch' });
    const deleted = hyperDeleteCanvasElement(edited.document, id);
    expect(hyperReadCanvas(deleted.document).elements).toEqual([]);
    expect(deleted.actions).toHaveLength(1);
    expect(hyperBlockData(edited.document.blocks[id]).imagePath).toBe(imagePath);
  });
  it('rejects image URLs and invalid attachments while preserving unsupported stored images', () => {
    for (const imagePath of ['https://example.test/image.png', 'file:///workspace/images/image.png', 'appflowy-file://local/images/image.png', 'data:image/png;base64,eA==', '../images/image.png', '/workspace/images/../image.png', '/workspace/files/image.png', '/workspace/images/vector.svg', '/workspace/images/\0image.png']) {
      expect(() => hyperInsertCanvasElement(document(), 'image', geometry, { imagePath })).toThrow('managed raster');
    }
    expect(() => hyperInsertCanvasElement(document(), 'image', geometry)).toThrow('managed raster');
    expect(() => hyperInsertCanvasElement(document(), 'image', { ...geometry, width: 0 }, { imagePath: '/workspace/images/image.png' })).toThrow('positive');
    const first = hyperInsertCanvasElement(document(), 'image', geometry, { imagePath: 'C:\\workspace\\images\\image.webp' });
    expect(hyperReadCanvas(first.document).elements[0].alt).toBe('');
    expect(() => hyperUpdateCanvasElement(first.document, first.focus!.id, { width: 0 })).toThrow('positive');
    const unsupported = hyperUpdateBlock(first.document, first.focus!.id, { imagePath: 'https://example.test/image.png' });
    expect(hyperReadCanvas(unsupported.document)).toMatchObject({ elements: [], unsupportedIds: [first.focus!.id] });
    const next = hyperInsertCanvasElement(unsupported.document, 'rectangle', geometry);
    expect(next.document.blocks[first.focus!.id]).toEqual(unsupported.document.blocks[first.focus!.id]);
  });
});
