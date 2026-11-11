import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CreateViewPayloadPBSchema, DuplicateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DatabaseViewRowIdPBSchema, HyperDuplicateRowPayloadPBSchema, RepeatedRowIdPBSchema, RowMetaPBSchema, UpdateRowMetaChangesetPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { ApplyActionPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperEditText } from '../src/renderer/features/document/HyperDocumentModel';
import { CreateFieldPayloadPBSchema, FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DateCellChangesetPBSchema, DateCellDataPBSchema } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { CellIdPBSchema, CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { ReminderPBSchema, RepeatedReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
import { hyperDuplicateDateReferences, hyperDuplicateReminderId } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper dataset duplication against the actual Rust core', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-dataset-duplicate-'));
  let core = new CoreProcess(binary), workspaceId = '';
  async function request(event: string, input?: [DescMessage, object] | Uint8Array) {
    const result = await core.request(event, input instanceof Uint8Array ? input : input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array());
    if (result.status !== 0) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`);
    return result.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function start() {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-dataset-duplicate', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  const database = (viewId: string) => call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: viewId }]);
  const metadata = (viewId: string, rowId: string) => call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId, rowId }]);
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  // The generated request retains the legacy prefix and adds optional wire field 4.
  const rowOperation = (viewId: string, rowId: string, operationId: string) => {
    const legacy = toBinary(DatabaseViewRowIdPBSchema, create(DatabaseViewRowIdPBSchema, { viewId, rowId })), id = new TextEncoder().encode(operationId);
    const typed = toBinary(HyperDuplicateRowPayloadPBSchema, create(HyperDuplicateRowPayloadPBSchema, { viewId, rowId, oneOfOperationId: { case: 'operationId', value: operationId } }));
    expect(typed).toEqual(new Uint8Array([...legacy, 0x22, id.length, ...id]));
    return typed;
  };
  const text = async (documentId: string) => {
    const doc = await read(documentId);
    return hyperChildren(doc, doc.blocks[doc.pageId]).flatMap(id => hyperBlockText(doc, doc.blocks[id])).map(run => run.insert).join('');
  };
  async function source() {
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspaceId, name: 'Rows with bodies', layout: ViewLayoutPB.Grid, setAsCurrent: false }]);
    const data = await database(view.id), row = await metadata(view.id, data.rows[0].id), documentId = row.oneOfDocumentId.value as string;
    await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId }]);
    const doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
    const bodyReminder = crypto.randomUUID(), cellReminder = crypto.randomUUID();
    const blockId = hyperChildren(doc, doc.blocks[doc.pageId])[0], edit = hyperEditText(doc, blockId, [{ insert: 'Independent row body 😀' }, { insert: '$', attributes: { bold: true, future_attr: { keep: true }, mention: { type: 'date', date: '2031-05-06T10:30:00.123', include_time: true, reminder_option: 'custom', reminder_id: bodyReminder, unknown: 'keep' } } }]);
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId, actions: edit.actions }]);
    await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: view.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false }, oneOfIconUrl: { case: 'iconUrl', value: '🧪' }, oneOfAttachmentCount: { case: 'attachmentCount', value: 2n } }]);
    const field = await call('CreateField', FieldPBSchema, [CreateFieldPayloadPBSchema, { viewId: view.id, fieldType: FieldType.DateTime, oneOfFieldName: { case: 'fieldName', value: 'Reminder date' } }]);
    await request('UpdateDateCell', [DateCellChangesetPBSchema, { cellId: { viewId: view.id, rowId: row.id, fieldId: field.id }, oneOfTimestamp: { case: 'timestamp', value: 1935741900n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 1935828305n }, oneOfIsRange: { case: 'isRange', value: true }, oneOfIncludeTime: { case: 'includeTime', value: false }, oneOfReminderId: { case: 'reminderId', value: cellReminder } }]);
    await request('CreateReminder', [ReminderPBSchema, { id: bodyReminder, objectId: view.id, scheduledAt: 1935741800n, isRead: true, meta: { row_id: row.id, block_id: blockId, custom: 'exact', is_archived: 'true' } }]);
    await request('CreateReminder', [ReminderPBSchema, { id: cellReminder, objectId: view.id, scheduledAt: 1935741700n, isAck: true, meta: { row_id: row.id, unknown: 'keep' } }]);
    return { view, data, row, documentId, field, bodyReminder, cellReminder, blockId };
  }
  async function assertTimers(original: Awaited<ReturnType<typeof source>>, targetView: string, targetRow: string, targetDocument: string) {
    const body = await read(targetDocument), refs = hyperDuplicateDateReferences(body), expectedBody = hyperDuplicateReminderId(targetDocument, original.blockId, 'Independent row body 😀'.length, original.bodyReminder);
    expect(refs).toHaveLength(1); expect(refs[0].id).toBe(expectedBody); expect(refs[0].mention.unknown).toBe('keep');
    // The UI opens the dataset before mounting its metadata/cell readers.
    expect((await database(targetView)).rows.map(item => item.id)).toContain(targetRow);
    expect((await metadata(targetView, targetRow)).id).toBe(targetRow);
    const cell = await call('GetCell', CellPBSchema, [CellIdPBSchema, { viewId: targetView, rowId: targetRow, fieldId: original.field.id }]), date = fromBinary(DateCellDataPBSchema, cell.data);
    expect(date).toMatchObject({ oneOfTimestamp: { case: 'timestamp', value: 1935741900n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 1935828305n }, isRange: true, includeTime: false }); expect(date.reminderId).not.toBe(original.cellReminder); expect(date.reminderId).not.toBe('');
    const all = (await call('GetAllReminders', RepeatedReminderPBSchema)).items;
    expect(all.find(item => item.id === expectedBody)).toMatchObject({ objectId: targetView, scheduledAt: 1935741800n, isRead: true, meta: { row_id: targetRow, block_id: original.blockId, custom: 'exact', is_archived: 'true' } });
    expect(all.find(item => item.id === date.reminderId)).toMatchObject({ objectId: targetView, scheduledAt: 1935741700n, isAck: true, meta: { row_id: targetRow, unknown: 'keep' } });
    expect(all.find(item => item.id === original.bodyReminder)).toMatchObject({ objectId: original.view.id, meta: { row_id: original.row.id } });
    expect(all.find(item => item.id === original.cellReminder)).toMatchObject({ objectId: original.view.id, meta: { row_id: original.row.id } });
  }
  beforeAll(async () => {
    await start();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Copy fixture', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-dataset-duplicate' }]);
    workspaceId = (await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema)).workspaceId;
  });
  afterAll(async () => { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); });
  it('keeps every source row across restart before copying', async () => {
    const original = await source();
    await core.stop(); core = new CoreProcess(binary); await start();
    expect((await database(original.view.id)).rows.map(item => item.id)).toEqual(original.data.rows.map(item => item.id));
    expect((await metadata(original.view.id, original.row.id)).oneOfIsDocumentEmpty.value).toBe(false);
  }, 45_000);
  it('copies row bodies and metadata during whole-view duplication', async () => {
    const original = await source();
    // Validate the real copied database's upload identity before the local
    // provider's no-op batch. This does not establish remote synchronization.
    const copied = await call('DuplicateView', ViewPBSchema, [DuplicateViewPayloadPBSchema, { viewId: original.view.id, openAfterDuplicate: false, includeChildren: false, syncAfterCreate: true }]);
    const rows = await database(copied.id), metas = await Promise.all(rows.rows.map(row => metadata(copied.id, row.id)));
    const bodies = metas.filter(row => row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && !row.oneOfIsDocumentEmpty.value);
    expect(bodies, 'the copied dataset must retain its nonempty row document').toHaveLength(1);
    const body = bodies[0]; expect(body.oneOfDocumentId.value).not.toBe(original.documentId); expect(body.oneOfIcon.value).toBe('🧪'); expect(body.oneOfAttachmentCount.value).toBe(2n);
    expect(await text(body.oneOfDocumentId.value as string)).toBe('Independent row body 😀$');
    expect(await text(original.documentId)).toBe('Independent row body 😀$');
    await assertTimers(original, copied.id, body.id, body.oneOfDocumentId.value as string);
    await core.stop(); core = new CoreProcess(binary); await start();
    expect(await text(body.oneOfDocumentId.value as string)).toBe('Independent row body 😀$');
    await assertTimers(original, copied.id, body.id, body.oneOfDocumentId.value as string);
  }, 45_000);
  it('copies the document when DuplicateRow copies its nonempty flag', async () => {
    const original = await source();
    const operation = crypto.randomUUID();
    const first = fromBinary(RowMetaPBSchema, await request('DuplicateRow', rowOperation(original.view.id, original.row.id, operation)));
    const copiedRow = (await database(original.view.id)).rows.find(row => !original.data.rows.some(source => source.id === row.id));
    expect(copiedRow).toBeDefined();
    const copied = await metadata(original.view.id, copiedRow!.id);
    expect(first.id).toBe(copied.id);
    expect(copied.oneOfIsDocumentEmpty.value).toBe(false);
    expect(await text(copied.oneOfDocumentId.value as string)).toBe('Independent row body 😀$');
    expect(await text(original.documentId)).toBe('Independent row body 😀$');
    await assertTimers(original, original.view.id, copied.id, copied.oneOfDocumentId.value as string);
    const append = async (documentId: string, value: string) => { const doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]), id = hyperChildren(doc, doc.blocks[doc.pageId])[0], edit = hyperEditText(doc, id, [...hyperBlockText(doc, doc.blocks[id]), { insert: value }]); await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId, actions: edit.actions }]); };
    await append(original.documentId, ' changed source'); await append(copied.oneOfDocumentId.value as string, ' changed copy');
    const repeated = fromBinary(RowMetaPBSchema, await request('DuplicateRow', rowOperation(original.view.id, original.row.id, operation)));
    expect(repeated.id).toBe(copied.id); expect((await database(original.view.id)).rows).toHaveLength(original.data.rows.length + 1);
    expect(await text(copied.oneOfDocumentId.value as string)).toBe('Independent row body 😀$ changed copy');
    expect(await text(original.documentId)).toBe('Independent row body 😀$ changed source');
    await core.stop(); core = new CoreProcess(binary); await start();
    expect(fromBinary(RowMetaPBSchema, await request('DuplicateRow', rowOperation(original.view.id, original.row.id, operation))).id).toBe(copied.id);
    expect(await text(copied.oneOfDocumentId.value as string)).toBe('Independent row body 😀$ changed copy');
    await assertTimers(original, original.view.id, copied.id, copied.oneOfDocumentId.value as string);
    expect(new Set((await database(original.view.id)).rows.map(item => item.id))).toEqual(new Set([...original.data.rows.map(item => item.id), copied.id]));
    expect((await metadata(original.view.id, original.row.id)).oneOfIsDocumentEmpty.value).toBe(false);
    await request('DeleteRows', [RepeatedRowIdPBSchema, { viewId: original.view.id, rowIds: [copied.id] }]);
    await core.stop(); core = new CoreProcess(binary); await start();
    await expect(request('DuplicateRow', rowOperation(original.view.id, original.row.id, operation))).rejects.toThrow(/removed|not recreated/i);
    expect((await database(original.view.id)).rows.map(item => item.id)).not.toContain(copied.id);
    expect((await database(original.view.id)).rows.map(item => item.id)).toEqual(original.data.rows.map(item => item.id));
    expect((await metadata(original.view.id, original.row.id)).oneOfIsDocumentEmpty.value).toBe(false);
    expect(await text(original.documentId)).toBe('Independent row body 😀$ changed source');
  }, 45_000);
  it('rejects a missing nonempty source body before inserting any copied row', async () => {
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspaceId, name: 'Missing body', layout: ViewLayoutPB.Grid, setAsCurrent: false }]);
    const before = await database(view.id), row = await metadata(view.id, before.rows[0].id);
    await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: view.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }]);
    await expect(request('DuplicateRow', rowOperation(view.id, row.id, crypto.randomUUID()))).rejects.toThrow(/not found|missing/i);
    expect((await database(view.id)).rows.map(item => item.id)).toEqual(before.rows.map(item => item.id));
    await expect(call('DuplicateView', ViewPBSchema, [DuplicateViewPayloadPBSchema, { viewId: view.id, openAfterDuplicate: false, includeChildren: false, syncAfterCreate: false }])).rejects.toThrow(/not found|missing/i);
    expect((await metadata(view.id, row.id)).oneOfIsDocumentEmpty.value).toBe(false);
  }, 45_000);
});
