import type { HyperBlockCapture } from './HyperDocumentBlockControlsModel';

export const hyperBlockDragMime = 'application/x-hypertask-block';
export interface HyperBlockDrag {
  id: string;
  ownerToken: string;
  documentId: string;
  source: HyperBlockCapture;
  focus?: { id: string; start: number; end: number };
}
const ownerTokens = new WeakMap<object, string>(), active = new Map<string, HyperBlockDrag>();
export function hyperBeginBlockDrag(owner: object, documentId: string, source: HyperBlockCapture, focus?: HyperBlockDrag['focus']): HyperBlockDrag {
  let ownerToken = ownerTokens.get(owner);
  if (!ownerToken) { ownerToken = crypto.randomUUID(); ownerTokens.set(owner, ownerToken); }
  const drag = { id: crypto.randomUUID(), ownerToken, documentId, source, focus }; active.set(ownerToken, drag); return drag;
}
/** The transfer contains opaque IDs only, never text, attributes or owner credentials. */
export const hyperBlockDragPayload = (drag: HyperBlockDrag) => JSON.stringify({ version: 1, id: drag.id, owner: drag.ownerToken, documentId: drag.documentId, blockId: drag.source.blockId });
export function hyperCurrentBlockDrag(owner: object, documentId: string): HyperBlockDrag | null {
  const token = ownerTokens.get(owner), drag = token ? active.get(token) : undefined;
  return drag?.documentId === documentId ? drag : null;
}
export function hyperReadBlockDrag(owner: object, documentId: string, raw: string): HyperBlockDrag {
  if (raw.length > 2048) throw new Error('Invalid block transfer.');
  let value: { version?: unknown; id?: unknown; owner?: unknown; documentId?: unknown; blockId?: unknown };
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid block transfer.'); }
  const drag = hyperCurrentBlockDrag(owner, documentId);
  if (!value || value.version !== 1 || !drag || value.id !== drag.id || value.owner !== drag.ownerToken || value.documentId !== documentId || value.blockId !== drag.source.blockId) throw new Error('Blocks can only move within the same document and owner.');
  return drag;
}
export function hyperEndBlockDrag(drag: HyperBlockDrag) { if (active.get(drag.ownerToken)?.id === drag.id) active.delete(drag.ownerToken); }
