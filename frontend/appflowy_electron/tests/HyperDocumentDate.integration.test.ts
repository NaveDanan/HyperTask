import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { RepeatedReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
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
import { hyperChildren } from '../src/renderer/features/document/HyperDocumentModel';
import { createHyperDocumentDateStore, type HyperDocumentDateStore } from '../src/renderer/features/document-date/HyperDocumentDateStore';
import { hyperCaptureDocumentDate, hyperDocumentDateSchedule, hyperDocumentDateValue } from '../src/renderer/features/document-date/HyperDocumentDateModel';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { reminderActions, useReminderStore } from '../src/renderer/features/sidebar/stores/reminder-store';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper document dates and reminders with Rust', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-document-date-'));
  let core = new CoreProcess(binary), session: HyperDocumentSession | undefined, store: HyperDocumentDateStore | undefined;
  async function request(event: string, schema?: DescMessage, value: object = {}) {
    const reply = await core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array());
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input?.[0], input?.[1])); }
  async function init() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-date-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const reminders = () => call('GetAllReminders', RepeatedReminderPBSchema);
  afterAll(async () => { store?.dispose(); await session?.dispose(); reminderActions.dispose(); await core.stop(); useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null }); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('persists insert/edit/remove, schedules future and due reminders, shows exact due mentions and restores after restarting', async () => {
    vi.stubGlobal('window', { clearInterval, setInterval, removeEventListener: () => {}, appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload), onNotification: () => () => {} } } });
    await init(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-date-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'Hyper date reminders', layout: ViewLayoutPB.Document }]);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) }); const owner = hyperGetDocumentOwner()!;
    const read = () => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    const openSession = async () => { session = new HyperDocumentSession(view.id, { open: () => call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]), read, apply: async (documentId, actions) => { await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions }); }, close: async () => {}, history: async () => {}, listen: () => () => {} }, owner); await session.flush(); store = createHyperDocumentDateStore({ session, owner, editable: () => true }); store.start(); };
    await openSession(); const original = session!.store.getState().document!, first = hyperChildren(original, original.blocks[original.pageId])[0];
    await store!.open(null, first ? hyperCaptureMentionSelection(original, { id: first, selection: { start: 0, end: 0 } }) : null); expect((await reminders()).items).toHaveLength(0);
    const future = { date: '2030-05-08', time: '10:30:00', includeTime: true, reminderOption: 'fiveMinsBefore', customTime: '' };
    const focus = (await store!.save(future))!, created = (await reminders()).items[0];
    expect(created.objectId).toBe(view.id); expect(created.scheduledAt).toBe(hyperDocumentDateSchedule(future, hyperDocumentDateValue(future))); expect(created.meta.block_id).toBe(focus.id); expect(created.meta.date.length).toBeGreaterThan(10);
    await reminderActions.refresh(); expect(useReminderStore.getState().serverReminders).toHaveLength(1); expect(useReminderStore.getState().reminders).toHaveLength(0);
    await store!.open(hyperCaptureDocumentDate(session!.store.getState().document!, focus.id, 0)); await store!.save({ ...future, date: '2020-01-02', reminderOption: 'atTimeOfEvent' });
    const updated = (await reminders()).items[0]; expect(updated.id).toBe(created.id); expect(updated.scheduledAt).toBeLessThan(BigInt(Math.floor(Date.now() / 1000))); await reminderActions.refresh(); expect(useReminderStore.getState().reminders.map(item => item.id)).toEqual([created.id]);
    const pressed = reminderActions.pressReminder(created.id); expect(pressed?.objectId).toBe(view.id); expect(pressed?.meta.block_id).toBe(focus.id); await vi.waitFor(() => expect(useReminderStore.getState().reminders[0]?.isRead).toBe(true));
    const saved = await read(); store!.dispose(); await session!.dispose(); session = undefined; await core.stop(); core = new CoreProcess(binary); await init(); await openSession();
    const restored = await read(); expect(restored.pageId).toBe(saved.pageId); expect(restored.blocks).toEqual(saved.blocks); expect(restored.meta?.childrenMap).toEqual(saved.meta?.childrenMap);
    for (const [id, text] of Object.entries(saved.meta?.textMap ?? {})) expect(JSON.parse(restored.meta!.textMap[id])).toEqual(JSON.parse(text));
    expect((await reminders()).items[0]).toMatchObject({ id: created.id, scheduledAt: updated.scheduledAt, isRead: true });
    await store!.open(hyperCaptureDocumentDate(session!.store.getState().document!, focus.id, 0)); await store!.save({ ...store!.getState().draft, reminderOption: 'none' }); expect((await reminders()).items).toHaveLength(0); await reminderActions.refresh(); expect(useReminderStore.getState().reminders).toHaveLength(0); expect(hyperCaptureDocumentDate(await read(), focus.id, 0).mention.reminder_id).toBeUndefined();
  }, 35_000);
});
