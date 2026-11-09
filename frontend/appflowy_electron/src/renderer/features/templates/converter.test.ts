import { describe, expect, it } from 'vitest';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { databaseImportFromSnapshot, documentDataPbFromSnapshot, embeddedDatabaseViewIdsIn, remoteAssetUrlsIn, rowDocumentIdForRow, uuidV5 } from './converter';
import { asList, asMap, type HyperJsonObject } from './models';
import { localUrls, manifest, readPayload } from './test-support';

const rawDatabase = (payload: HyperJsonObject) => asMap(asMap(asMap(payload.data).database).raw);
const databaseJson = (result: ReturnType<typeof databaseImportFromSnapshot>): HyperJsonObject => JSON.parse(new TextDecoder().decode(result.initialData));
const maps = (value: unknown) => asList(value).map(asMap);
const documentPayload = (raw: HyperJsonObject) => ({ data: { document: { raw: { data: raw } } } });

describe('UUIDv5', () => {
  it('matches the RFC 4122 vector', () => expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d'));
  it('derives every row page id stored in the snapshots', () => {
    for (const entry of manifest.availableTemplates.filter(t => t.kind === 'database')) {
      const raw = rawDatabase(readPayload(entry.publishName)), pageIds = Object.keys(asMap(raw.row_documents));
      expect(Object.keys(asMap(raw.rows)).map(rowDocumentIdForRow).filter(id => pageIds.includes(id)).sort()).toEqual(pageIds.sort());
    }
  });
});
describe('document conversion', () => {
  it('maps the tree, block metadata, string and non-string text deltas', () => {
    const document = documentDataPbFromSnapshot(documentPayload({ page_id: 'p', blocks: {
      p: { id: 'p', ty: 'page', children: 'c0', data: {} }, b: { id: 'b', ty: 'todo_list', parent: 'p', children: 'c1', external_id: 'x', external_type: 'text', data: { checked: true } },
    }, meta: { children_map: { c0: ['b'], c1: [] }, text_map: { x: '[{"insert":"hi"}]', y: [{ insert: 'array' }] } } }));
    expect(document.pageId).toBe('p'); expect(Object.keys(document.blocks)).toEqual(['p', 'b']);
    expect(document.blocks.b).toMatchObject({ ty: 'todo_list', parentId: 'p', childrenId: 'c1', oneOfExternalId: { case: 'externalId', value: 'x' }, oneOfExternalType: { case: 'externalType', value: 'text' } });
    expect(JSON.parse(document.blocks.b.data)).toEqual({ checked: true });
    expect(document.meta?.childrenMap.c0.children).toEqual(['b']); expect(document.meta?.textMap.x).toBe('[{"insert":"hi"}]');
    expect(JSON.parse(document.meta!.textMap.y)).toEqual([{ insert: 'array' }]);
  });
  it('rejects a missing page block', () => expect(() => documentDataPbFromSnapshot(documentPayload({ page_id: 'missing', blocks: {} }))).toThrow('no page block'));
  it('preserves all blocks and text and survives the protobuf round trip', () => {
    const payload = readPayload('Weekly-To-Do-List'), raw = asMap(asMap(asMap(asMap(payload.data).document).raw).data);
    const document = documentDataPbFromSnapshot(payload), decoded = fromBinary(DocumentDataPBSchema, toBinary(DocumentDataPBSchema, document));
    expect(decoded).toEqual(document); expect(Object.keys(decoded.blocks)).toHaveLength(Object.keys(asMap(raw.blocks)).length);
    expect(Object.keys(decoded.meta!.textMap)).toHaveLength(Object.keys(asMap(asMap(raw.meta).text_map)).length);
    for (const block of Object.values(decoded.blocks)) if (block.childrenId) expect(decoded.meta!.childrenMap).toHaveProperty(block.childrenId);
  });
  it('localizes images, files and covers and switches the source types', () => {
    const remote = 'https://images.unsplash.com/picture', path = '/user/images/image.png';
    const document = documentDataPbFromSnapshot(documentPayload({ page_id: 'p', blocks: {
      p: { ty: 'page', data: { cover_selection: remote, cover_type: 2 } }, image: { ty: 'image', data: { url: remote, image_type: 2 } }, file: { ty: 'file', data: { url: remote, url_type: 2 } },
    } }), { [remote]: path });
    expect(JSON.parse(document.blocks.p.data)).toEqual({ cover_selection: path, cover_type: 2 });
    expect(JSON.parse(document.blocks.image.data)).toEqual({ url: path, image_type: 0 });
    expect(JSON.parse(document.blocks.file.data)).toEqual({ url: path, url_type: 0 });
  });
  it('leaves plain web links alone', () => {
    const payload = readPayload('Simple-Startup-Company-Home-54f9981f-b467-42ed-91f7-f4baa829fe14');
    const document = documentDataPbFromSnapshot(payload, localUrls(payload, remoteAssetUrlsIn(payload)));
    expect(JSON.parse(Object.values(document.blocks).find(b => b.ty === 'link_preview')!.data)).toEqual({ url: 'https://github.com/AppFlowy-IO/AppFlowy' });
  });
});
describe('typed database conversion', () => {
  const bug = () => databaseImportFromSnapshot(readPayload('Bug-Tracker-13a84186'));
  it('keeps field types, icons, primary flags and select options', () => {
    const result = bug(), json = databaseJson(result), fields = maps(json.fields), source = fields.find(f => f.name === 'Source')!;
    expect(fields).toHaveLength(7); expect(source.field_type).toBe(3);
    const options = JSON.parse(String(asMap(asMap(source.type_options)['3']).content)).options;
    expect(options.some((o: HyperJsonObject) => o.name === 'Internal')).toBe(true);
    expect(fields.find(f => f.is_primary)!.name).toBe('Description'); expect(fields.map(f => f.field_type)).toContain(2);
  });
  it('keeps every select cell pointing at an option of its field', () => {
    const json = databaseJson(bug());
    for (const field of maps(json.fields).filter(f => f.field_type === 3)) {
      const options: HyperJsonObject[] = JSON.parse(String(asMap(asMap(field.type_options)['3']).content)).options;
      for (const row of maps(json.rows)) { const id = asMap(asMap(row.cells)[String(field.id)]).data; if (typeof id === 'string' && id) expect(options.map(o => o.id)).toContain(id); }
    }
  });
  it('preserves view layouts, orders, settings, filters, sorts, groups and timestamps', () => {
    const payload = readPayload('Bug-Tracker-13a84186'), result = databaseImportFromSnapshot(payload), json = databaseJson(result);
    const raw = asMap(rawDatabase(payload).database), rawViews = asMap(raw.views);
    expect(maps(json.views).map(v => v.layout).sort()).toEqual([0, 1]);
    for (const view of maps(json.views)) {
      const original = Object.values(rawViews).map(asMap).find(v => v.name === view.name)!;
      expect(view.database_id).toBe(json.database_id); expect(maps(view.row_orders)).toHaveLength(8);
      expect(maps(view.row_orders).every(o => maps(json.rows).some(r => r.id === o.id))).toBe(true);
      expect(maps(view.field_orders).every(o => maps(json.fields).some(f => f.id === o.id))).toBe(true);
      for (const key of ['layout_settings', 'filters', 'sorts', 'field_orders', 'field_settings', 'created_at', 'modified_at']) expect(view[key]).toEqual(original[key]);
      expect(view.group_settings).toEqual(original.groups);
    }
    expect(result.layout).toBe(maps(json.views)[0].layout === 1 ? ViewLayoutPB.Board : ViewLayoutPB.Grid);
  });
  it('keeps calendar layout settings', () => {
    const json = databaseJson(databaseImportFromSnapshot(readPayload('Daily-Journal-706323c0-f8bf-49be-b73b-059b10f7ac96')));
    const calendar = maps(json.views).find(v => v.layout === 2)!;
    expect(asMap(asMap(calendar.layout_settings)['2']).field_id).toBe('JCXYO7');
  });
  it('generates independent database, view and row IDs while retaining field IDs', () => {
    const first = databaseJson(bug()), second = databaseJson(bug());
    expect(first.database_id).not.toBe(second.database_id);
    for (const key of ['rows', 'views']) expect(maps(first[key]).some(item => maps(second[key]).some(other => item.id === other.id))).toBe(false);
    expect(maps(first.fields).map(f => f.id)).toEqual(maps(second.fields).map(f => f.id));
  });
  it('keeps external relation targets and counts unresolved cells', () => {
    const payload = readPayload('Opportunities-20e79978'), result = databaseImportFromSnapshot(payload), json = databaseJson(result);
    const relation = maps(json.fields).find(f => f.field_type === 10)!;
    expect(asMap(asMap(relation.type_options)['10']).database_id).toBe('01cdd149-0f42-479d-b8c2-b39cc1c0a2a4');
    const expected = Object.values(asMap(rawDatabase(payload).rows)).map(asMap).flatMap(r => Object.values(asMap(asMap(r.data).cells)).map(asMap)).filter(c => c.field_type === 10).reduce((n, c) => n + asList(c.data).length, 0);
    expect(result.fidelity.relationFieldCount).toBe(1); expect(result.fidelity.unresolvedRelationCellCount).toBe(expected);
  });
  it('remaps same-database relation options and cells and drops unknown row orders', () => {
    const payload = readPayload('Bug-Tracker-13a84186'), raw = rawDatabase(payload), database = asMap(raw.database), rows = asMap(raw.rows), ids = Object.keys(rows);
    asMap(database.fields).relation = { id: 'relation', ty: 10, type_option: { '10': { database_id: database.id } } };
    asMap(asMap(rows[ids[0]]).data).cells = { relation: { field_type: 10, data: [ids[1], 'outside'] } };
    const json = databaseJson(databaseImportFromSnapshot(payload));
    expect(asMap(asMap(maps(json.fields).find(f => f.id === 'relation')!.type_options)['10']).database_id).toBe(json.database_id);
    expect(asMap(asMap(maps(json.rows)[0].cells).relation).data).toEqual([maps(json.rows)[1].id, 'outside']);
  });
  it('keeps rollup and formula fields and reports them', () => {
    const result = databaseImportFromSnapshot(readPayload('project-completion-tracker')), types = maps(databaseJson(result).fields).map(f => Number(f.field_type));
    expect(types).toContain(16); expect(types).toContain(19); expect(result.fidelity.unsupportedFieldCount).toBe(types.filter(t => t > 14).length);
  });
  it('recreates every row page under the new derived ID', () => {
    const result = databaseImportFromSnapshot(readPayload('Class-Notes-6f3a0877-5372-4ecc-a68b-60457f2c8e9a'));
    expect(result.rowDocuments).toHaveLength(2);
    for (const row of result.rowDocuments) { expect(row.documentId).toBe(rowDocumentIdForRow(row.rowId)); expect(maps(databaseJson(result).rows).map(r => r.id)).toContain(row.rowId); expect(Object.keys(row.document.blocks).length).toBeGreaterThan(0); }
  });
  it('counts comments, hidden views, fields, rows and row pages', () => {
    const payload = readPayload('Bug-Tracker-13a84186'), rows = asMap(rawDatabase(payload).rows);
    asMap(rows[Object.keys(rows)[0]]).comment = { comment: 'not restored' };
    expect(databaseImportFromSnapshot(payload).fidelity).toMatchObject({ fieldCount: 7, rowCount: 8, viewCount: 2, hiddenViewCount: 1, rowDocumentCount: 0, droppedCommentCount: 1 });
  });
  it('rejects databases without fields or views', () => {
    expect(() => databaseImportFromSnapshot({ data: { database: { raw: { database: {} } } } })).toThrow('no fields');
    expect(() => databaseImportFromSnapshot({ data: { database: { raw: { database: { fields: { f: {} } } } } } })).toThrow('no views');
  });
});
describe('all bundled snapshots', () => {
  it.each(manifest.availableTemplates)('imports $publishName without remote assets and preserves its content', entry => {
    const payload = readPayload(entry.publishName), urls = localUrls(payload, remoteAssetUrlsIn(payload));
    if (entry.kind === 'document') {
      const document = documentDataPbFromSnapshot(payload, urls);
      expect(remoteAssetUrlsIn(Object.values(document.blocks).map(b => JSON.parse(b.data))).size).toBe(0);
    } else {
      const result = databaseImportFromSnapshot(payload, urls), json = databaseJson(result), raw = rawDatabase(payload);
      expect(remoteAssetUrlsIn(json).size).toBe(0);
      expect(maps(json.fields)).toHaveLength(Object.keys(asMap(asMap(raw.database).fields)).length);
      const originals = Object.values(asMap(raw.rows)).map(asMap);
      maps(json.rows).forEach((row, index) => {
        const data = asMap(originals[index].data);
        expect(row.height).toBe(data.height ?? 60); expect(row.visibility).toBe(data.visibility !== false);
        expect(row.created_at).toBe(Number(data.created_at ?? 0)); expect(row.modified_at).toBe(Number(data.last_modified ?? 0));
        for (const [key, cell] of Object.entries(asMap(data.cells))) if (asMap(cell).field_type !== 10) expect(asMap(row.cells)[key]).toEqual(cell);
      });
      result.rowDocuments.forEach(row => expect(remoteAssetUrlsIn(Object.values(row.document.blocks).map(b => JSON.parse(b.data))).size).toBe(0));
    }
  });
  it('reports embedded view IDs which the store cannot recreate', () => {
    const ids = embeddedDatabaseViewIdsIn(readPayload('Fundraising-tracker-4c488d3f-0aa2-4da8-99a5-9198afdeb97c'));
    expect([...ids]).toEqual(['a4210294-e883-40da-b24e-f433f5e5813f']);
    const views = manifest.availableTemplates.filter(t => t.kind === 'database').flatMap(t => Object.keys(asMap(asMap(rawDatabase(readPayload(t.publishName)).database).views)));
    expect(views).not.toContain([...ids][0]);
  });
});