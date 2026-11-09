import { create } from '@bufbuild/protobuf';
import { BlockPBSchema, ChildrenPBSchema, DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { asInt, asList, asMap, asString, stringList, type HyperJsonObject } from './models';

/** RFC 4122 SHA-1 UUIDv5, matching collab-database's row document derivation. */
export function uuidV5(namespace: string, name: string): string {
  const hex = namespace.replaceAll('-', '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error('Invalid UUID namespace');
  const message = [...Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)), ...new TextEncoder().encode(name)];
  const bitLength = message.length * 8;
  message.push(0x80);
  while (message.length % 64 !== 56) message.push(0);
  for (let shift = 7; shift >= 0; shift--) message.push(Math.floor(bitLength / 2 ** (shift * 8)) & 0xff);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const rotate = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));
  for (let chunk = 0; chunk < message.length; chunk += 64) {
    const w = Array<number>(80).fill(0);
    for (let i = 0; i < 16; i++) { const at = chunk + i * 4; w[i] = (message[at] << 24) | (message[at + 1] << 16) | (message[at + 2] << 8) | message[at + 3]; }
    for (let i = 16; i < 80; i++) w[i] = rotate(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (rotate(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotate(b, 30); b = a; a = temp;
    }
    [a, b, c, d, e].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  const bytes = h.flatMap(v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
  const result = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${result.slice(0, 8)}-${result.slice(8, 12)}-${result.slice(12, 16)}-${result.slice(16, 20)}-${result.slice(20)}`;
}
export const rowDocumentIdForRow = (rowId: string) => uuidV5(rowId, 'document_id');
const snapshotData = (payload: HyperJsonObject) => payload.data !== null && typeof payload.data === 'object' && !Array.isArray(payload.data) ? asMap(payload.data) : payload;
export function replaceHyperTemplateUrls(node: unknown, localUrls: Record<string, string>): unknown {
  if (typeof node === 'string') return localUrls[node] ?? node;
  if (Array.isArray(node)) return node.map(item => replaceHyperTemplateUrls(item, localUrls));
  if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, replaceHyperTemplateUrls(value, localUrls)]));
  return node;
}
export function remoteAssetUrlsIn(payload: unknown): Set<string> {
  const found = new Set<string>();
  function walk(node: unknown) {
    if (typeof node === 'string' && /^https:\/\/(beta\.appflowy\.cloud\/api\/file_storage\/|images\.unsplash\.com\/)/.test(node)) found.add(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
  }
  walk(payload); return found;
}
export function embeddedDatabaseViewIdsIn(payload: HyperJsonObject): Set<string> {
  const raw = asMap(asMap(asMap(snapshotData(payload).document).raw).data);
  return new Set(Object.values(asMap(raw.blocks)).map(asMap).filter(b => b.ty === 'grid' || b.ty === 'calendar').map(b => asString(asMap(b.data).view_id)).filter(Boolean));
}
function documentFromRaw(raw: HyperJsonObject, localUrls: Record<string, string>): DocumentDataPB {
  const pageId = asString(raw.page_id), blocksJson = asMap(raw.blocks);
  if (!pageId || !Object.hasOwn(blocksJson, pageId)) throw new Error('Document snapshot has no page block');
  const blocks = Object.fromEntries(Object.entries(blocksJson).map(([key, value]) => {
    const block = asMap(value), id = asString(block.id, key), ty = asString(block.ty), data = asMap(block.data);
    const localized = asMap(replaceHyperTemplateUrls(data, localUrls));
    if (localized.url !== data.url && ty === 'image') localized.image_type = 0;
    if (localized.url !== data.url && ty === 'file') localized.url_type = 0;
    return [id, create(BlockPBSchema, { id, ty, data: JSON.stringify(localized), childrenId: asString(block.children), parentId: asString(block.parent),
      oneOfExternalId: { case: 'externalId', value: asString(block.external_id) }, oneOfExternalType: { case: 'externalType', value: asString(block.external_type) } })];
  }));
  const meta = asMap(raw.meta);
  return create(DocumentDataPBSchema, { pageId, blocks, meta: {
    childrenMap: Object.fromEntries(Object.entries(asMap(meta.children_map)).map(([key, value]) => [key, create(ChildrenPBSchema, { children: typeof value === 'string' ? (value ? [value] : []) : stringList(value) })])),
    textMap: Object.fromEntries(Object.entries(asMap(meta.text_map)).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])),
  } });
}
export function documentDataPbFromSnapshot(payload: HyperJsonObject, localUrls: Record<string, string> = {}) {
  return documentFromRaw(asMap(asMap(asMap(snapshotData(payload).document).raw).data), localUrls);
}
export interface HyperTemplateDatabaseFidelity {
  fieldCount: number; viewCount: number; hiddenViewCount: number; rowCount: number; rowDocumentCount: number;
  unsupportedFieldCount: number; relationFieldCount: number; unresolvedRelationCellCount: number; droppedCommentCount: number;
}
export interface HyperTemplateRowDocument { rowId: string; documentId: string; document: DocumentDataPB }
export interface HyperTemplateDatabaseImport { layout: ViewLayoutPB; initialData: Uint8Array; rowDocuments: HyperTemplateRowDocument[]; fidelity: HyperTemplateDatabaseFidelity }
export function databaseImportFromSnapshot(payload: HyperJsonObject, localUrls: Record<string, string> = {}): HyperTemplateDatabaseImport {
  const database = asMap(snapshotData(payload).database), raw = asMap(database.raw), rawDatabase = asMap(raw.database);
  const rawFields = asMap(rawDatabase.fields), rawViews = asMap(rawDatabase.views), rawRows = asMap(raw.rows), rawDocuments = asMap(raw.row_documents);
  const summaries = asList(database.views).map(asMap), summary = (id: string) => summaries.find(view => asString(view.viewId) === id) ?? {};
  if (!Object.keys(rawFields).length) throw new Error('Database snapshot has no fields');
  const sourceDatabaseId = asString(rawDatabase.id, asString(database.databaseId));
  let viewOrder = summaries.map(view => asString(view.viewId)).filter(id => Object.hasOwn(rawViews, id));
  if (!viewOrder.length) viewOrder = Object.keys(rawViews);
  if (!viewOrder.length) throw new Error('Database snapshot has no views');
  const activeViewId = asString(database.activeViewId);
  if (viewOrder.includes(activeViewId)) viewOrder = [activeViewId, ...viewOrder.filter(id => id !== activeViewId)];
  const databaseId = crypto.randomUUID();
  const viewIds = Object.fromEntries(viewOrder.map(id => [id, crypto.randomUUID()]));
  const rowIds = Object.fromEntries(Object.keys(rawRows).map(id => [id, crypto.randomUUID()]));
  let unsupportedFieldCount = 0, relationFieldCount = 0, unresolvedRelationCellCount = 0, droppedCommentCount = 0;
  const fields = Object.values(rawFields).map(asMap).map(field => {
    const fieldType = asInt(field.ty) ?? asInt(field.field_type) ?? 0;
    if (fieldType > 14) unsupportedFieldCount++;
    if (fieldType === 10) relationFieldCount++;
    return { id: asString(field.id), name: asString(field.name), field_type: fieldType, icon: asString(field.icon), is_primary: field.is_primary === true,
      type_options: Object.fromEntries(Object.entries(asMap(field.type_option)).map(([key, value]) => [key, asMap(value).database_id === sourceDatabaseId ? { ...asMap(value), database_id: databaseId } : value])) };
  });
  const rows = Object.entries(rawRows).map(([oldId, value]) => {
    const row = asMap(value), data = asMap(row.data);
    if (Object.keys(asMap(row.comment)).length) droppedCommentCount++;
    const cells = Object.fromEntries(Object.entries(asMap(data.cells)).map(([key, value]) => {
      const cell = asMap(value);
      if (asInt(cell.field_type) !== 10) return [key, cell];
      const targets = typeof cell.data === 'string' ? (cell.data ? [cell.data] : []) : stringList(cell.data);
      unresolvedRelationCellCount += targets.filter(id => !Object.hasOwn(rowIds, id)).length;
      return [key, { ...cell, data: targets.map(id => rowIds[id] ?? id) }];
    }));
    return { id: rowIds[oldId], database_id: databaseId, cells, height: asInt(data.height) ?? 60, visibility: data.visibility !== false, created_at: asInt(data.created_at) ?? 0, modified_at: asInt(data.last_modified) ?? 0 };
  });
  const views = viewOrder.map(oldId => {
    const view = asMap(rawViews[oldId]), display = summary(oldId);
    return { id: viewIds[oldId], database_id: databaseId, name: asString(view.name, asString(display.name, 'Grid')),
      layout: asInt(view.layout) ?? asInt(display.layout) ?? 0, layout_settings: asMap(view.layout_settings), filters: asList(view.filters), group_settings: asList(view.groups), sorts: asList(view.sorts),
      row_orders: asList(view.row_orders).map(asMap).filter(order => Object.hasOwn(rowIds, asString(order.id))).map(order => ({ id: rowIds[asString(order.id)], height: asInt(order.height) ?? 60 })),
      field_orders: asList(view.field_orders), field_settings: asMap(view.field_settings), created_at: asInt(view.created_at) ?? 0, modified_at: asInt(view.modified_at) ?? 0, is_inline: false };
  });
  const rowDocuments: HyperTemplateRowDocument[] = [];
  for (const oldId of Object.keys(rawRows)) {
    const document = asMap(asMap(rawDocuments[rowDocumentIdForRow(oldId)]).data);
    if (!Object.keys(document).length) continue;
    rowDocuments.push({ rowId: rowIds[oldId], documentId: rowDocumentIdForRow(rowIds[oldId]), document: documentFromRaw(document, localUrls) });
  }
  const layout = views[0].layout === 1 ? ViewLayoutPB.Board : views[0].layout === 2 ? ViewLayoutPB.Calendar : ViewLayoutPB.Grid;
  return { layout, initialData: new TextEncoder().encode(JSON.stringify({ database_id: databaseId, views, fields, rows })), rowDocuments,
    fidelity: { fieldCount: fields.length, viewCount: views.length, hiddenViewCount: Object.keys(rawViews).length - views.length, rowCount: rows.length, rowDocumentCount: rowDocuments.length,
      unsupportedFieldCount, relationFieldCount, unresolvedRelationCellCount, droppedCommentCount } };
}