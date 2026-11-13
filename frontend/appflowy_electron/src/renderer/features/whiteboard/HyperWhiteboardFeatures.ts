import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperDeleteBlock, hyperUpdateBlock, type HyperDocumentChange } from '../document/HyperDocumentModel';
import {
  hyperCanvasCenter, hyperInsertCanvasElement, hyperReadCanvas, hyperUpdateCanvasElement,
  type HyperCanvasElement, type HyperCanvasGeometry,
} from './HyperWhiteboardModel';

export function hyperCanvasFrameContents(frame: HyperCanvasElement, elements: HyperCanvasElement[]): HyperCanvasElement[] {
  if (frame.kind !== 'frame') return [];
  return elements.filter(element => element.id !== frame.id && element.x >= frame.x && element.y >= frame.y && element.x + element.width <= frame.x + frame.width && element.y + element.height <= frame.y + frame.height);
}
export function hyperCanvasGroupMembers(selected: HyperCanvasElement, elements: HyperCanvasElement[]): HyperCanvasElement[] {
  return selected.kind === 'frame' ? hyperCanvasFrameContents(selected, elements)
    : selected.mindMapRootId === selected.id ? elements.filter(element => element.id !== selected.id && element.mindMapRootId === selected.id) : [];
}
export function hyperCanvasMoveGroup(doc: DocumentDataPB, id: string, x: number, y: number): HyperDocumentChange {
  const elements = hyperReadCanvas(doc).elements, selected = elements.find(element => element.id === id);
  if (!selected) throw new Error('Canvas element is missing or cannot be edited.');
  const grouped = hyperCanvasGroupMembers(selected, elements);
  const dx = x - selected.x, dy = y - selected.y;
  let change = hyperUpdateCanvasElement(doc, id, { x, y });
  for (const element of grouped) {
    const next = hyperUpdateCanvasElement(change.document, element.id, { x: element.x + dx, y: element.y + dy });
    change = { document: next.document, actions: [...change.actions, ...next.actions] };
  }
  return { ...change, focus: { id, offset: 0 } };
}

export function hyperCanvasFitFrame(frame: HyperCanvasGeometry, viewport: { width: number; height: number }, padding = 32): { x: number; y: number; zoom: number } {
  if (![frame.x, frame.y, frame.width, frame.height, viewport.width, viewport.height, padding].every(Number.isFinite) || frame.width <= 0 || frame.height <= 0 || viewport.width <= 0 || viewport.height <= 0 || padding < 0) throw new Error('Invalid frame or viewport geometry.');
  const zoom = Math.max(Number.EPSILON, Math.min(8, Math.max(1, viewport.width - 2 * padding) / frame.width, Math.max(1, viewport.height - 2 * padding) / frame.height));
  return { x: viewport.width / 2 - (frame.x + frame.width / 2) * zoom, y: viewport.height / 2 - (frame.y + frame.height / 2) * zoom, zoom };
}
export interface HyperMindMapLine { text: string; depth: number }
export function hyperParseMindMapOutline(outline: string): HyperMindMapLine[] {
  const lines = outline.replace(/\r\n?/g, '\n').replaceAll('\t', '  ').split('\n').filter(line => line.trim());
  if (!lines.length || lines.length > 200) throw new Error('A mind map needs between 1 and 200 topics.');
  let previousDepth = 0;
  return lines.map((line, index) => {
    const spaces = line.length - line.trimStart().length;
    const depth = spaces / 2;
    if (!Number.isInteger(depth) || index === 0 && depth !== 0 || index > 0 && (depth === 0 || depth > previousDepth + 1)) throw new Error('Use two spaces per level, with one unindented root topic.');
    previousDepth = depth;
    return { text: line.trim(), depth };
  });
}
function combine(change: HyperDocumentChange, next: HyperDocumentChange): HyperDocumentChange {
  return { document: next.document, actions: [...change.actions, ...next.actions], focus: next.focus };
}
function connect(change: HyperDocumentChange, parentId: string, childId: string, rootId: string) {
  const elements = hyperReadCanvas(change.document).elements;
  const from = hyperCanvasCenter(elements.find(element => element.id === parentId)!);
  const to = hyperCanvasCenter(elements.find(element => element.id === childId)!);
  const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y);
  const line = hyperInsertCanvasElement(change.document, 'connector', { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) }, { fromId: parentId, toId: childId, points: [{ x: from.x - x, y: from.y - y }, { x: to.x - x, y: to.y - y }] });
  const tagged = hyperUpdateBlock(line.document, line.focus!.id, { mindMapRootId: rootId });
  return combine(combine(change, line), tagged);
}
export function hyperInsertMindMap(doc: DocumentDataPB, outline: string, origin = { x: 0, y: 0 }): HyperDocumentChange {
  const lines = hyperParseMindMapOutline(outline), parents: string[] = [];
  let change: HyperDocumentChange = { document: doc, actions: [] }, rootId = '';
  for (const [index, line] of lines.entries()) {
    const note = hyperInsertCanvasElement(change.document, 'note', { x: origin.x + line.depth * 280, y: origin.y + index * 120, width: 220, height: 80 }, { text: line.text });
    const id = note.focus!.id, parentId = parents[line.depth - 1];
    rootId ||= id;
    change = combine(change, note);
    change = combine(change, hyperUpdateBlock(change.document, id, { mindMapRootId: rootId, ...(parentId ? { mindMapParentId: parentId } : {}) }));
    parents[line.depth] = id;
    if (parentId) change = connect(change, parentId, id, rootId);
  }
  return { ...change, focus: { id: rootId, offset: 0 } };
}
export function hyperAddMindMapChild(doc: DocumentDataPB, parentId: string, text: string): HyperDocumentChange {
  if (!text.trim()) throw new Error('Enter a topic for the new child.');
  const elements = hyperReadCanvas(doc).elements, parent = elements.find(element => element.id === parentId);
  if (!parent?.mindMapRootId) throw new Error('Choose a mind map topic first.');
  const group = elements.filter(element => element.mindMapRootId === parent.mindMapRootId && element.kind !== 'connector');
  if (group.length >= 200) throw new Error('A mind map can contain up to 200 topics.');
  const note = hyperInsertCanvasElement(doc, 'note', { x: parent.x + 280, y: Math.max(...group.map(element => element.y)) + 120, width: 220, height: 80 }, { text: text.trim() });
  const childId = note.focus!.id;
  const tagged = hyperUpdateBlock(note.document, childId, { mindMapRootId: parent.mindMapRootId, mindMapParentId: parentId });
  return { ...connect(combine(note, tagged), parentId, childId, parent.mindMapRootId), focus: { id: childId, offset: 0 } };
}
export function hyperDeleteMindMapBranch(doc: DocumentDataPB, id: string): HyperDocumentChange {
  const elements = hyperReadCanvas(doc).elements, selected = elements.find(element => element.id === id);
  if (!selected?.mindMapRootId || selected.kind === 'connector') throw new Error('Choose a mind map topic first.');
  const removed = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const element of elements) {
      if (element.mindMapRootId === selected.mindMapRootId && element.mindMapParentId && removed.has(element.mindMapParentId) && !removed.has(element.id)) { removed.add(element.id); added = true; }
    }
  }
  for (const element of elements) if (element.kind === 'connector' && element.mindMapRootId === selected.mindMapRootId && (removed.has(element.fromId ?? '') || removed.has(element.toId ?? ''))) removed.add(element.id);
  let change: HyperDocumentChange = { document: doc, actions: [] };
  for (const element of elements) if (removed.has(element.id)) change = combine(change, hyperDeleteBlock(change.document, element.id));
  return change;
}
