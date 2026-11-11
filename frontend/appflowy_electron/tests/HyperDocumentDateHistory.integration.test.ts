import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { ReminderPBSchema, RepeatedReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { hyperCaptureMentionSelection } from '../src/renderer/features/document/HyperDocumentMentions';
import { hyperBlockText, hyperChildren, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { createHyperDocumentDateStore, type HyperDocumentDateStore } from '../src/renderer/features/document-date/HyperDocumentDateStore';
import { hyperCaptureDocumentDate, hyperDocumentCustomSchedule, hyperDocumentDateMention } from '../src/renderer/features/document-date/HyperDocumentDateModel';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { reminderActions } from '../src/renderer/features/sidebar/stores/reminder-store';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper reminder history with native Rust undo groups', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-date-history-')), core = new CoreProcess(binary), events: string[] = [];
  let session: HyperDocumentSession | undefined, store: HyperDocumentDateStore | undefined;
  async function request(event: string, schema?: DescMessage, value: object = {}) { events.push(event); const reply = await core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array()); if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`); return reply.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input?.[0], input?.[1])); }
  const reminders = () => call('GetAllReminders', RepeatedReminderPBSchema);
  const boundary = () => new Promise<void>(resolve => setTimeout(resolve, 650));
  afterAll(async () => { store?.dispose(); await session?.dispose(); reminderActions.dispose(); await core.stop(); useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null }); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('restores timers through native insert/reschedule/custom/disable/move undo and redo, respecting grouped edits', async () => {
    vi.stubGlobal('window', { clearInterval, setInterval, removeEventListener: () => {}, appflowy: { core: { request: (event: string, payload: Uint8Array) => { events.push(event); return core.request(event, payload); }, onNotification: () => () => {} } } });
    await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-history-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-history-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'Hyper native reminder history', layout: ViewLayoutPB.Document }]);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) }); const owner = hyperGetDocumentOwner()!;
    const read = () => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    session = new HyperDocumentSession(view.id, { open: () => call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]), read, apply: async (documentId, actions) => { await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions }); }, close: async () => {}, history: async (documentId, redo) => { await request(redo ? 'Redo' : 'Undo', DocumentRedoUndoPayloadPBSchema, { documentId }); }, listen: () => () => {} }, owner); await session.flush();
    store = createHyperDocumentDateStore({ session, owner, editable: () => !session!.store.getState().historyPending, canWrite: () => true }); store.start();
    const doc = session.store.getState().document!, first = hyperChildren(doc, doc.blocks[doc.pageId])[0]; await store.open(null, first ? hyperCaptureMentionSelection(doc, { id: first, selection: { start: 0, end: 0 } }) : null);
    const form = { date: '2030-05-06', time: '10:30:00', includeTime: true, reminderOption: 'atTimeOfEvent', customTime: '' }, focus = (await store.save(form))!, id = (await reminders()).items[0].id, original = (await reminders()).items[0].scheduledAt;
    await boundary(); await session.history(false); expect((await reminders()).items).toHaveLength(0); await session.history(true); expect((await reminders()).items[0]).toMatchObject({ id, scheduledAt: original });
    await boundary(); await store.open(hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0)); await store.save({ ...form, date: '2031-05-06', reminderOption: 'oneHourBefore' }); const rescheduled = (await reminders()).items[0].scheduledAt;
    await boundary(); await session.history(false); expect((await reminders()).items[0].scheduledAt).toBe(original); await session.history(true); expect((await reminders()).items[0].scheduledAt).toBe(rescheduled);
    await boundary(); await store.open(hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0)); await store.save({ ...form, date: '2031-05-06', reminderOption: 'custom', customTime: '2031-05-05T08:15:00' }); const customA = (await reminders()).items[0].scheduledAt;
    await boundary(); await store.open(hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0)); await store.save({ ...store.getState().draft, customTime: '2031-05-04T07:45:00' }); const customB = (await reminders()).items[0].scheduledAt; expect(customB).not.toBe(customA);
    await boundary(); await session.history(false); expect((await reminders()).items[0].scheduledAt).toBe(customA); await session.history(true); expect((await reminders()).items[0].scheduledAt).toBe(customB);
    await boundary(); await store.open(hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0)); await store.save({ ...store.getState().draft, reminderOption: 'none' }); expect((await reminders()).items).toHaveLength(0);
    await boundary(); await session.history(false); expect((await reminders()).items[0]).toMatchObject({ id, scheduledAt: customB }); await session.history(true); expect((await reminders()).items).toHaveLength(0); await session.history(false);
    await boundary();
    for (const customTime of ['2031-05-03T06:30:00', '2031-05-02T05:20:00']) { await store.open(hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0)); await store.save({ ...store.getState().draft, customTime }); }
    await session.history(false); const grouped = hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0); expect((await reminders()).items[0].scheduledAt).toBe(hyperDocumentCustomSchedule(grouped.attributes)); expect(store.history.store.getState().pending).toBe(false);
    await boundary(); const paragraph = session.change(doc => hyperInsertBlock(doc, doc.pageId, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '', 'paragraph'))!; await session.flush();
    await boundary(); session.change(doc => hyperEditText(doc, paragraph.focus!.id, [{ insert: 'Ordinary text' }])); await session.flush(); const eventStart = events.length; await session.history(false); expect(events.slice(eventStart).filter(event => ['CreateReminder', 'UpdateReminder', 'RemoveReminder'].includes(event))).toEqual([]);
    await boundary(); const target = hyperCaptureDocumentDate(session.store.getState().document!, focus.id, 0), dateRun = { insert: '$', attributes: target.attributes };
    session.change(doc => { const clear = hyperEditText(doc, focus.id, []), moved = hyperEditText(clear.document, paragraph.focus!.id, [dateRun]); return { document: moved.document, actions: [...clear.actions, ...moved.actions] }; }); await session.flush();
    await boundary(); await session.history(false); expect((await reminders()).items[0].meta.block_id).toBe(focus.id); expect(store.history.store.getState().pending).toBe(false); await session.history(true); expect((await reminders()).items[0].meta.block_id).toBe(paragraph.focus!.id);
    const current = (await reminders()).items[0]; await request('UpdateReminder', ReminderPBSchema, { ...current, isRead: true, meta: { ...current.meta, is_archived: 'true', keep: 'unknown' } });
    await session.history(false); const restored = (await reminders()).items[0]; expect(restored).toMatchObject({ id, isRead: true, meta: { block_id: focus.id, is_archived: 'true', keep: 'unknown' } });
    const saved = await read(); expect(hyperBlockText(saved, saved.blocks[focus.id]).some(run => hyperDocumentDateMention(run)?.reminder_id === id)).toBe(true); expect(session.store.getState()).toMatchObject({ status: 'ready', error: null, historyPending: false });
  }, 45_000);
});
