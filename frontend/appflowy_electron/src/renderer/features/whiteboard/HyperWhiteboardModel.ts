import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import {
  hyperBlockData, hyperBlockText, hyperChildren, hyperDeleteBlock, hyperEditText, hyperInsertBlock,
  hyperPlainText, hyperSliceText, hyperTextTypes, hyperUpdateBlock, type HyperDocumentChange,
} from '../document/HyperDocumentModel';

export const hyperCanvasKinds = ['rectangle', 'ellipse', 'text', 'pen', 'connector', 'frame', 'note', 'image'] as const;
export type HyperCanvasKind = typeof hyperCanvasKinds[number];
export type HyperCanvasPoint = { x: number; y: number };
export type HyperCanvasColor = 'foreground' | 'primary' | 'info' | 'success' | 'warning' | 'destructive';
export interface HyperCanvasElement {
  id: string; kind: HyperCanvasKind; x: number; y: number; width: number; height: number;
  color: HyperCanvasColor; text: string; points: HyperCanvasPoint[];
  fromId?: string; toId?: string; sourceId?: string; mindMapRootId?: string; mindMapParentId?: string;
  imagePath?: string; alt?: string;
}
export interface HyperCanvasGeometry { x: number; y: number; width: number; height: number }
export interface HyperCanvasSnapshot { elements: HyperCanvasElement[]; unsupportedIds: string[] }
export const hyperCanvasColors: HyperCanvasColor[] = ['foreground', 'primary', 'info', 'success', 'warning', 'destructive'];
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e7;
const stringId = (value: unknown) => typeof value === 'string' && value ? value : undefined;
// Paths are persisted for compatibility. Main-process asset APIs grant actual access.
export function hyperIsCanvasImagePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384 && !/[\u0000-\u001f\u007f]/.test(value)
    && (/^\/(?!\/)/.test(value) || /^[a-z]:[\\/]/i.test(value))
    && !/(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(value) && /[\\/]images[\\/][^\\/]+\.(png|jpe?g|gif|webp)$/i.test(value);
}

export function hyperReadCanvas(doc: DocumentDataPB): HyperCanvasSnapshot {
  const elements: HyperCanvasElement[] = [], unsupportedIds: string[] = [];
  const root = doc.blocks[doc.pageId];
  if (!root) return { elements, unsupportedIds: [doc.pageId] };
  for (const containerId of hyperChildren(doc, root)) {
    const container = doc.blocks[containerId];
    if (container?.ty !== 'hyper_canvas') continue;
    try {
      if (hyperBlockData(container).version !== 1) { unsupportedIds.push(containerId); continue; }
    } catch { unsupportedIds.push(containerId); continue; }
    for (const id of hyperChildren(doc, container)) {
      const block = doc.blocks[id];
      if (!block || !hyperCanvasKinds.some(kind => block.ty === `hyper_canvas_${kind}`)) { unsupportedIds.push(id); continue; }
      try {
        const data = hyperBlockData(block);
        if (data.version !== 1 || !number(data.x) || !number(data.y) || !number(data.width) || !number(data.height) || (data.width as number) < 0 || (data.height as number) < 0) { unsupportedIds.push(id); continue; }
        if (block.ty === 'hyper_canvas_image' && (!hyperIsCanvasImagePath(data.imagePath) || typeof data.alt !== 'string' || data.alt.length > 32_768 || !data.width || !data.height)) { unsupportedIds.push(id); continue; }
        const points = Array.isArray(data.points) ? data.points : [];
        if (points.some(point => !point || typeof point !== 'object' || !number(point.x) || !number(point.y))) { unsupportedIds.push(id); continue; }
        elements.push({ id, kind: block.ty.slice('hyper_canvas_'.length) as HyperCanvasKind,
          x: data.x as number, y: data.y as number, width: data.width as number, height: data.height as number,
          text: typeof data.text === 'string' ? data.text : '',
          color: hyperCanvasColors.includes(data.color as HyperCanvasColor) ? data.color as HyperCanvasColor : 'foreground',
          points: points as HyperCanvasPoint[], fromId: stringId(data.fromId), toId: stringId(data.toId), sourceId: stringId(data.sourceId), mindMapRootId: stringId(data.mindMapRootId), mindMapParentId: stringId(data.mindMapParentId),
          ...(block.ty === 'hyper_canvas_image' ? { imagePath: data.imagePath as string, alt: data.alt as string } : {}),
        });
      } catch { unsupportedIds.push(id); }
    }
  }
  return { elements, unsupportedIds };
}

export function hyperCanvasGeometry(start: HyperCanvasPoint, end: HyperCanvasPoint): HyperCanvasGeometry {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}
export function hyperCanvasStrokeGeometry(points: HyperCanvasPoint[]): HyperCanvasGeometry {
  if (!points.length) throw new Error('A canvas stroke needs at least one point.');
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of points) {
    if (!number(point.x) || !number(point.y)) throw new Error('Canvas stroke contains an invalid point.');
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export const hyperCanvasCenter = (element: HyperCanvasGeometry): HyperCanvasPoint => ({ x: element.x + element.width / 2, y: element.y + element.height / 2 });
export function hyperCanvasConnector(element: HyperCanvasElement, elements: HyperCanvasElement[]): [HyperCanvasPoint, HyperCanvasPoint] {
  const from = elements.find(candidate => candidate.id === element.fromId), to = elements.find(candidate => candidate.id === element.toId);
  const start = element.points[0] ?? { x: 0, y: 0 }, end = element.points[1] ?? { x: element.width, y: element.height };
  return [from ? hyperCanvasCenter(from) : { x: element.x + start.x, y: element.y + start.y }, to ? hyperCanvasCenter(to) : { x: element.x + end.x, y: element.y + end.y }];
}
export function hyperCanvasHitTest(elements: HyperCanvasElement[], point: HyperCanvasPoint): HyperCanvasElement | undefined {
  return [...elements].reverse().find(element => !['pen', 'connector', 'frame'].includes(element.kind) && point.x >= element.x && point.x <= element.x + element.width && point.y >= element.y && point.y <= element.y + element.height)
    ?? [...elements].reverse().find(element => element.kind === 'frame' && point.x >= element.x && point.x <= element.x + element.width && point.y >= element.y && point.y <= element.y + element.height);
}
export function hyperCanvasPaintOrder(elements: HyperCanvasElement[]): HyperCanvasElement[] {
  // Frames must sit behind their content even when they were created later.
  return [...elements].sort((left, right) => left.kind === 'frame' ? right.kind === 'frame' ? right.width * right.height - left.width * left.height : -1 : right.kind === 'frame' ? 1 : 0);
}
export function hyperCanvasLabel(element: HyperCanvasElement, doc: DocumentDataPB): string {
  if (element.kind === 'image') return element.alt ?? '';
  if (element.kind !== 'note' || !element.sourceId || !doc.blocks[element.sourceId]) return element.text;
  try { return hyperPlainText(hyperBlockText(doc, doc.blocks[element.sourceId])); } catch { return element.text; }
}
function validateGeometry(geometry: HyperCanvasGeometry) {
  if (![geometry.x, geometry.y, geometry.width, geometry.height].every(number) || geometry.width < 0 || geometry.height < 0) throw new Error('Canvas geometry is invalid.');
}
export function hyperInsertCanvasElement(doc: DocumentDataPB, kind: HyperCanvasKind, geometry: HyperCanvasGeometry, properties: { color?: HyperCanvasColor; text?: string; points?: HyperCanvasPoint[]; fromId?: string; toId?: string; sourceId?: string; imagePath?: string; alt?: string } = {}): HyperDocumentChange {
  validateGeometry(geometry);
  if (!hyperCanvasKinds.includes(kind)) throw new Error('Unknown canvas element type.');
  if (kind === 'image' && (!hyperIsCanvasImagePath(properties.imagePath) || (properties.alt !== undefined && (typeof properties.alt !== 'string' || properties.alt.length > 32_768)) || geometry.width <= 0 || geometry.height <= 0)) throw new Error('Canvas images require a managed raster attachment path and positive dimensions.');
  if (kind !== 'image' && (properties.imagePath !== undefined || properties.alt !== undefined)) throw new Error('Image attachments require an image element.');
  if (properties.color && !hyperCanvasColors.includes(properties.color)) throw new Error('Unknown canvas color.');
  if (properties.points?.some(point => !number(point.x) || !number(point.y))) throw new Error('Canvas stroke contains an invalid point.');
  if (properties.sourceId && (!doc.blocks[properties.sourceId] || !hyperTextTypes.has(doc.blocks[properties.sourceId].ty))) throw new Error('The linked page block is not an editable text block.');
  const root = doc.blocks[doc.pageId];
  if (!root) throw new Error('Document root is missing.');
  if (kind === 'note' && !properties.sourceId) {
    const paragraph = hyperInsertBlock(doc, doc.pageId, hyperChildren(doc, root).at(-1) ?? '', 'paragraph');
    const sourceId = paragraph.focus!.id;
    const text = hyperEditText(paragraph.document, sourceId, properties.text ? [{ insert: properties.text }] : []);
    const note = hyperInsertCanvasElement(text.document, kind, geometry, { ...properties, sourceId });
    return { document: note.document, actions: [...paragraph.actions, ...text.actions, ...note.actions], focus: note.focus };
  }
  let containerId = hyperChildren(doc, root).find(id => {
    try { return doc.blocks[id]?.ty === 'hyper_canvas' && hyperBlockData(doc.blocks[id]).version === 1; } catch { return false; }
  });
  let base: HyperDocumentChange = { document: doc, actions: [] };
  if (!containerId) {
    base = hyperInsertBlock(doc, doc.pageId, hyperChildren(doc, root).at(-1) ?? '', 'hyper_canvas', { version: 1 });
    containerId = base.focus!.id;
  }
  const container = base.document.blocks[containerId];
  const inserted = hyperInsertBlock(base.document, containerId, hyperChildren(base.document, container).at(-1) ?? '', `hyper_canvas_${kind}`, { version: 1, ...geometry, color: 'foreground', text: '', ...properties, ...(kind === 'image' ? { alt: properties.alt ?? '' } : {}) });
  return { document: inserted.document, actions: [...base.actions, ...inserted.actions], focus: inserted.focus };
}
export function hyperUpdateCanvasElement(doc: DocumentDataPB, id: string, patch: Partial<HyperCanvasGeometry> & { text?: string; color?: HyperCanvasColor; alt?: string }): HyperDocumentChange {
  const element = hyperReadCanvas(doc).elements.find(element => element.id === id);
  if (!element) throw new Error('Canvas element is missing or cannot be edited.');
  validateGeometry({ ...element, ...patch });
  if (element.kind === 'image' && ((patch.width ?? element.width) <= 0 || (patch.height ?? element.height) <= 0)) throw new Error('Canvas images require positive dimensions.');
  if (patch.alt !== undefined && (element.kind !== 'image' || typeof patch.alt !== 'string' || patch.alt.length > 32_768)) throw new Error('Canvas image description is invalid.');
  if (patch.color && !hyperCanvasColors.includes(patch.color)) throw new Error('Unknown canvas color.');
  const scaleX = patch.width !== undefined && element.width > 0 ? patch.width / element.width : 1;
  const scaleY = patch.height !== undefined && element.height > 0 ? patch.height / element.height : 1;
  const points = (scaleX !== 1 || scaleY !== 1) && element.points.length
    ? element.points.map(point => ({ x: point.x * scaleX, y: point.y * scaleY })) : undefined;
  if (points?.some(point => !number(point.x) || !number(point.y))) throw new Error('Canvas stroke contains an invalid point.');
  return hyperUpdateBlock(doc, id, { ...patch, ...(points ? { points } : {}) });
}
export function hyperDeleteCanvasElement(doc: DocumentDataPB, id: string): HyperDocumentChange {
  if (!hyperReadCanvas(doc).elements.some(element => element.id === id)) throw new Error('Canvas element is missing or cannot be edited.');
  return hyperDeleteBlock(doc, id);
}
export function hyperEditCanvasLabel(doc: DocumentDataPB, id: string, text: string): HyperDocumentChange {
  const element = hyperReadCanvas(doc).elements.find(element => element.id === id);
  if (!element) throw new Error('Canvas element is missing or cannot be edited.');
  if (element.kind === 'image') return hyperUpdateCanvasElement(doc, id, { alt: text });
  if (element.kind === 'note' && element.sourceId) {
    const block = doc.blocks[element.sourceId];
    if (!block) throw new Error('The linked page block no longer exists.');
    // Keep inline styles and mentions on unchanged text when editing a note's plain label.
    const runs = hyperBlockText(doc, block), before = Array.from(hyperPlainText(runs)), after = Array.from(text);
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const start = before.slice(0, prefix).join('').length, end = before.slice(0, before.length - suffix).join('').length;
    const inserted = after.slice(prefix, after.length - suffix).join('');
    const attributes = hyperSliceText(runs, Math.max(0, start - 1), start).at(-1)?.attributes;
    return hyperEditText(doc, element.sourceId, [...hyperSliceText(runs, 0, start), ...(inserted ? [{ insert: inserted, attributes }] : []), ...hyperSliceText(runs, end)]);
  }
  return hyperUpdateCanvasElement(doc, id, { text });
}
