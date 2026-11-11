import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas } from './HyperWhiteboardModel';
import { hyperAddMindMapChild, hyperCanvasFitFrame, hyperCanvasMoveGroup, hyperDeleteMindMapBranch, hyperInsertMindMap, hyperParseMindMapOutline } from './HyperWhiteboardFeatures';

const empty = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
describe('Hyper canvas frames and mind maps', () => {
  it('moves enclosed elements once, including nested frames, while leaving overlapping and outside elements untouched', () => {
    const outer = hyperInsertCanvasElement(empty(), 'frame', { x: 0, y: 0, width: 500, height: 400 });
    const inner = hyperInsertCanvasElement(outer.document, 'frame', { x: 20, y: 20, width: 200, height: 200 });
    const child = hyperInsertCanvasElement(inner.document, 'note', { x: 40, y: 40, width: 100, height: 80 }, { text: 'Shared' });
    const overlap = hyperInsertCanvasElement(child.document, 'rectangle', { x: 450, y: 200, width: 100, height: 80 });
    const moved = hyperCanvasMoveGroup(overlap.document, outer.focus!.id, 100, -50);
    const elements = hyperReadCanvas(moved.document).elements;
    expect(elements.find(e => e.id === inner.focus!.id)).toMatchObject({ x: 120, y: -30 });
    expect(elements.find(e => e.id === child.focus!.id)).toMatchObject({ x: 140, y: -10 });
    expect(elements.find(e => e.id === overlap.focus!.id)).toMatchObject({ x: 450, y: 200 });
    expect(moved.actions).toHaveLength(3);
    expect(hyperReadCanvas(overlap.document).elements[0].x).toBe(0);
  });
  it('fits the entire frame with padding even at extreme canvas scales', () => {
    const view = hyperCanvasFitFrame({ x: -100, y: 20, width: 1000, height: 500 }, { width: 800, height: 600 });
    expect(view.zoom).toBeCloseTo(0.736);
    expect(view.x + -100 * view.zoom).toBeCloseTo(32);
    expect(view.y + 20 * view.zoom).toBeGreaterThanOrEqual(32);
    const large = hyperCanvasFitFrame({ x: 0, y: 0, width: 10000000, height: 10000000 }, { width: 800, height: 600 });
    expect(large.zoom * 10000000).toBeLessThanOrEqual(536);
    expect(() => hyperCanvasFitFrame({ x: 0, y: 0, width: 0, height: 1 }, { width: 800, height: 600 })).toThrow('geometry');
  });
  it('creates a nested mind map from shared notes and separately persisted connectors', () => {
    const map = hyperInsertMindMap(empty(), 'Project\n  Goals\n  Tasks\n    First task');
    const elements = hyperReadCanvas(map.document).elements, nodes = elements.filter(e => e.kind === 'note'), connectors = elements.filter(e => e.kind === 'connector');
    expect(nodes).toHaveLength(4); expect(connectors).toHaveLength(3);
    expect(nodes.map(node => hyperCanvasLabel(node, map.document))).toEqual(['Project', 'Goals', 'Tasks', 'First task']);
    expect(nodes[3].mindMapParentId).toBe(nodes[2].id);
    expect(nodes.every(node => node.mindMapRootId === nodes[0].id)).toBe(true);
    expect(connectors.every(line => nodes.some(node => node.id === line.fromId) && nodes.some(node => node.id === line.toId))).toBe(true);
    expect(nodes.every(node => map.document.blocks[node.sourceId!].ty === 'paragraph')).toBe(true);
  });
  it('adds branches and moves the whole map by its root without changing shared text', () => {
    const map = hyperInsertMindMap(empty(), 'Topic\n  Idea');
    const expanded = hyperAddMindMapChild(map.document, map.focus!.id, 'New idea');
    const original = hyperReadCanvas(expanded.document).elements;
    const moved = hyperCanvasMoveGroup(expanded.document, map.focus!.id, 100, 50);
    for (const node of hyperReadCanvas(moved.document).elements) {
      const before = original.find(e => e.id === node.id)!;
      expect(node.x).toBe(before.x + 100); expect(node.y).toBe(before.y + 50);
      expect(hyperCanvasLabel(node, moved.document)).toBe(hyperCanvasLabel(before, expanded.document));
    }
  });
  it('deletes a branch and its connectors while retaining other branches and page text', () => {
    const map = hyperInsertMindMap(empty(), 'Topic\n  Keep\n  Remove\n    Descendant');
    const before = hyperReadCanvas(map.document).elements, remove = before.find(e => e.kind === 'note' && hyperCanvasLabel(e, map.document) === 'Remove')!;
    const changed = hyperDeleteMindMapBranch(map.document, remove.id), remaining = hyperReadCanvas(changed.document).elements;
    expect(remaining.filter(e => e.kind === 'note').map(e => hyperCanvasLabel(e, changed.document))).toEqual(['Topic', 'Keep']);
    expect(remaining.filter(e => e.kind === 'connector')).toHaveLength(1);
    for (const note of before.filter(e => e.kind === 'note')) expect(changed.document.blocks[note.sourceId!]).toBeDefined();
  });
  it('rejects malformed and oversized outlines before writing anything', () => {
    for (const outline of ['', '  Root', 'Root\nSecond root', 'Root\n    Skipped level', 'Root\n Child']) expect(() => hyperParseMindMapOutline(outline)).toThrow();
    expect(() => hyperParseMindMapOutline('Root\n' + Array(201).fill('  Child').join('\n'))).toThrow('200');
    expect(hyperParseMindMapOutline('Root\n\tChild')).toEqual([{ text: 'Root', depth: 0 }, { text: 'Child', depth: 1 }]);
  });
});
