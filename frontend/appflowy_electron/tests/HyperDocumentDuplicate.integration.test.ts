import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ApplyActionPayloadPBSchema, CloseDocumentPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, DocumentRedoUndoResponsePBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { ReminderPBSchema, RepeatedReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DatabaseViewRowIdPBSchema, RowMetaPBSchema, UpdateRowMetaChangesetPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { hyperChildren, hyperEditText, hyperBlockText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperDuplicateDateReferences, hyperDuplicateDocumentSnapshot, hyperDuplicateReminderId } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateModel';
import { hyperDocumentDuplicates, hyperDuplicateView } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateBackend';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { reminderActions } from '../src/renderer/features/sidebar/stores/reminder-store';
import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { createHyperDocumentDateStore, type HyperDocumentDateStore } from '../src/renderer/features/document-date/HyperDocumentDateStore';
import { hyperCaptureDocumentDate } from '../src/renderer/features/document-date/HyperDocumentDateModel';

const root = path.resolve(__dirname, '..'), binary = coreBinaryPath(root, false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper document reminder duplication with actual Rust initialization', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-duplicate-native-')), events: string[] = []; let core = new CoreProcess(binary);
  let session: HyperDocumentSession | undefined, dateStore: HyperDocumentDateStore | undefined;
  async function request(event: string, input?: [DescMessage, object]) { events.push(event); const result = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function initialize() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-duplicate-native', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  async function seed(documentId: string, id: string, legacy = false) {
    const doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]), blockId = hyperChildren(doc, doc.blocks[doc.pageId])[0];
    const change = hyperEditText(doc, blockId, [{ insert: '😀x' }, { insert: '$', attributes: { bold: true, unknown_outer: { keep: true }, mention: { type: legacy ? 'reminder' : 'date', date: '2031-05-06T10:30:00.123', include_time: true, reminder_id: id, reminder_option: 'custom', unknown: 'keep' } } }]);
    await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId, actions: change.actions }]); return blockId;
  }
  afterAll(async () => { dateStore?.dispose(); await session?.dispose(); reminderActions.dispose(); await core.stop(); useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null }); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('copies descendants and exact custom timers, starts with empty native history, preserves source and native row-body timers', async () => {
    vi.stubGlobal('window', { clearInterval, setInterval, removeEventListener: () => {}, appflowy: { core: { request: (event: string, bytes: Uint8Array) => { events.push(event); return core.request(event, bytes); }, onNotification: () => () => {} } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-duplicate-native' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema); useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) });
    const make = (parentViewId: string, name: string, layout = ViewLayoutPB.Document) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId, name, layout, setAsCurrent: false }]);
    const source = await make(workspace.workspaceId, 'Hyper copy source'), child = await make(source.id, 'Child'), grandchild = await make(child.id, 'Grandchild'), grid = await make(source.id, 'Grid', ViewLayoutPB.Grid);
    const sources: { id: string; reminderId: string; blockId: string; digest: string }[] = [];
    for (const [index, view] of [source, child, grandchild].entries()) {
      const reminderId = crypto.randomUUID(), blockId = await seed(view.id, reminderId, index === 0); await request('CreateReminder', [ReminderPBSchema, { id: reminderId, objectId: view.id, scheduledAt: 1935741900n + BigInt(index), isRead: true, title: 'Exact custom', meta: { block_id: blockId, unknown_meta: 'keep', is_archived: 'true' } }]); sources.push({ id: view.id, reminderId, blockId, digest: hyperDuplicateDocumentSnapshot(await read(view.id)).digest });
    }
    const database = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]), row = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: grid.id, rowId: database.rows[0].id }]);
    expect(row.oneOfDocumentId.case).toBe('documentId'); const rowDocumentId = row.oneOfDocumentId.value! as string, rowReminderId = crypto.randomUUID(); await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId: rowDocumentId }]); const rowBlockId = await seed(rowDocumentId, rowReminderId); await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: grid.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }]); await request('CreateReminder', [ReminderPBSchema, { id: rowReminderId, objectId: grid.id, scheduledAt: 1935741903n, meta: { row_id: row.id, block_id: rowBlockId } }]);
    const result = await hyperDuplicateView({ view: source, openAfterDuplicate: true, includeChildren: true, suffix: ' (Copy)', syncAfterDuplicate: false }); expect(result.ok ? '' : result.error.msg).toBe(''); if (!result.ok) return;
    expect(hyperDocumentDuplicates.store.getState().plans).toHaveLength(0); const copied = await call('GetView', ViewPBSchema, [ViewIdPBSchema, { value: result.value.id }]), copiedChild = copied.childViews.find(view => view.name === child.name)!, copiedGrid = copied.childViews.find(view => view.name === grid.name)!, childTree = await call('GetView', ViewPBSchema, [ViewIdPBSchema, { value: copiedChild.id }]), copiedGrandchild = childTree.childViews[0];
    const reminders = (await call('GetAllReminders', RepeatedReminderPBSchema)).items; expect(reminders).toHaveLength(8); expect(new Set(reminders.map(item => item.id)).size).toBe(8); expect(events.filter(event => event === 'DuplicateView')).toHaveLength(1); expect(events.filter(event => event === 'CreateReminder')).toHaveLength(7);
    for (const [index, target] of [copied, copiedChild, copiedGrandchild].entries()) {
      const before = sources[index], doc = await read(target.id), refs = hyperDuplicateDateReferences(doc), expected = hyperDuplicateReminderId(target.id, before.blockId, 3, before.reminderId); expect(refs).toHaveLength(1); expect(refs[0].id).toBe(expected); expect(refs[0].mention.unknown).toBe('keep'); expect(refs[0].attributes.unknown_outer).toEqual({ keep: true });
      expect(reminders.find(item => item.id === expected)).toMatchObject({ objectId: target.id, scheduledAt: 1935741900n + BigInt(index), meta: { block_id: before.blockId, unknown_meta: 'keep', is_archived: 'true' } });
      expect(hyperDuplicateDocumentSnapshot(await read(before.id)).digest).toBe(before.digest); expect(hyperDuplicateDateReferences(await read(before.id))[0].id).toBe(before.reminderId);
      expect((await call('CanUndoRedo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId: target.id }])).canUndo).toBe(false);
    }
    const copiedDoc = await read(copied.id), block = sources[0].blockId, runs = hyperBlockText(copiedDoc, copiedDoc.blocks[block]), edit = hyperEditText(copiedDoc, block, [...runs, { insert: ' typed' }]); await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId: copied.id, actions: edit.actions }]); expect((await call('Undo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId: copied.id }])).isSuccess).toBe(true); expect(hyperDuplicateDateReferences(await read(copied.id))[0].id).toBe(hyperDuplicateReminderId(copied.id, block, 3, sources[0].reminderId));
    const copiedDatabase = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: copiedGrid.id }]);
    expect(copiedDatabase.rows.every(item => !database.rows.some(source => source.id === item.id))).toBe(true);
    const copiedRows = await Promise.all(copiedDatabase.rows.map(item => call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: copiedGrid.id, rowId: item.id }])));
    expect(copiedRows.every(item => item.oneOfDocumentId.value !== rowDocumentId)).toBe(true);
    const nonemptyRows = copiedRows.filter(item => item.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && !item.oneOfIsDocumentEmpty.value);
    expect(nonemptyRows).toHaveLength(1);
    const copiedRow = nonemptyRows[0], copiedRowDocumentId = copiedRow.oneOfDocumentId.value as string;
    const copiedRowDoc = await read(copiedRowDocumentId), copiedRowTimerId = hyperDuplicateReminderId(copiedRowDocumentId, rowBlockId, 3, rowReminderId);
    expect(hyperChildren(copiedRowDoc, copiedRowDoc.blocks[copiedRowDoc.pageId]).flatMap(id => hyperBlockText(copiedRowDoc, copiedRowDoc.blocks[id])).map(run => run.insert).join('')).toBe('😀x$');
    expect(hyperDuplicateDateReferences(copiedRowDoc)).toMatchObject([{ id: copiedRowTimerId, mention: { unknown: 'keep' } }]);
    expect(reminders.filter(item => item.id === copiedRowTimerId)).toHaveLength(1);
    expect(reminders.find(item => item.id === copiedRowTimerId)).toMatchObject({ objectId: copiedGrid.id, scheduledAt: 1935741903n, meta: { row_id: copiedRow.id, block_id: rowBlockId } });
    expect(reminders.find(item => item.id === rowReminderId)).toMatchObject({ objectId: grid.id, meta: { row_id: row.id } });
    const sourceRow = await read(rowDocumentId); expect(hyperDuplicateDateReferences(sourceRow)[0].id).toBe(rowReminderId);
    const owner = hyperGetDocumentOwner()!; session = new HyperDocumentSession(copied.id, undefined, owner); await session.flush(); dateStore = createHyperDocumentDateStore({ session, owner, editable: () => true, canWrite: () => true }); dateStore.start();
    await new Promise(resolve => setTimeout(resolve, 650)); await dateStore.open(hyperCaptureDocumentDate(session.store.getState().document!, block, 0)); await dateStore.save({ ...dateStore.getState().draft, reminderOption: 'none' });
    expect((await call('GetAllReminders', RepeatedReminderPBSchema)).items).toHaveLength(7);
    await new Promise(resolve => setTimeout(resolve, 650)); await session.history(false);
    const copiedTimerId = hyperDuplicateReminderId(copied.id, block, 3, sources[0].reminderId), restored = (await call('GetAllReminders', RepeatedReminderPBSchema)).items;
    expect(restored).toHaveLength(8); expect(restored.find(item => item.id === copiedTimerId)).toMatchObject({ objectId: copied.id, scheduledAt: 1935741900n, meta: { unknown_meta: 'keep', is_archived: 'true' } });
    await session.history(true); expect((await call('GetAllReminders', RepeatedReminderPBSchema)).items).toHaveLength(7); await session.history(false); expect((await call('GetAllReminders', RepeatedReminderPBSchema)).items.filter(item => item.id === sources[0].reminderId)).toHaveLength(1);
    dateStore.dispose(); dateStore = undefined; await session.dispose(); session = undefined;
    await request('CloseDocument', [CloseDocumentPayloadPBSchema, { documentId: copied.id }]); await core.stop(); core = new CoreProcess(binary); await initialize(); const restarted = await read(copied.id); expect(hyperDuplicateDateReferences(restarted)[0].id).toBe(hyperDuplicateReminderId(copied.id, block, 3, sources[0].reminderId)); expect((await call('GetAllReminders', RepeatedReminderPBSchema)).items).toHaveLength(8); expect(hyperDuplicateDateReferences(await read(copiedRowDocumentId))[0].id).toBe(copiedRowTimerId); expect((await call('GetAllReminders', RepeatedReminderPBSchema)).items.filter(item => item.id === copiedRowTimerId)).toHaveLength(1);
  }, 45_000);
});
