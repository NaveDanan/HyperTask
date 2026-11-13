import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { HyperDatabaseRowDuplicateService } from '../src/renderer/features/database/HyperDatabaseRowDuplicateService';
import { hyperDatabaseRowDuplicateBackend } from '../src/renderer/features/database/HyperDatabaseRowDuplicateBackend';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { acquireHyperDocument } from '../src/renderer/features/document/HyperDocumentSession';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DatabaseViewRowIdPBSchema, HyperDuplicateRowPayloadPBSchema, RepeatedRowIdPBSchema, RowMetaPBSchema, UpdateRowMetaChangesetPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { CreateDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ReminderPBSchema, RepeatedReminderPBSchema } from '@shared/protobuf/flowy-user/reminder_pb';
import { hyperBlockText, hyperChildren, hyperEditText, hyperPlainText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperDuplicateDateReferences } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateModel';
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper production row-copy service with the actual Rust core', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-row-copy-core-')); let core = new CoreProcess(binary);
  const leases: Awaited<ReturnType<typeof acquireHyperDocument>>[] = [], operations: string[] = []; let holdApply = false, applyHeld = false, releaseApply: (() => void) | undefined, loseAck = true, copiedId = '';
  async function request(event: string, input?: [DescMessage, object]) { const result = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function initialize() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-row-copy-service', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  const database = (value: string) => call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value }]);
  afterAll(async () => { for (const lease of leases.splice(0)) { await lease.session.dispose(); lease.release(); } await core.stop(); useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null }); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('flushes the source session, copies native reminders/body, retries one uncertain UUID after source deletion and preserves edits/restart', async () => {
    vi.stubGlobal('window', { appflowy: { core: { request: async (event: string, payload: Uint8Array) => {
      if (event === 'ApplyAction' && holdApply) { applyHeld = true; await new Promise<void>(resolve => { releaseApply = resolve; }); }
      if (event === 'DuplicateRow') { const input = fromBinary(HyperDuplicateRowPayloadPBSchema, payload); expect(input.oneOfOperationId.case).toBe('operationId'); operations.push(input.oneOfOperationId.value!); }
      const response = await core.request(event, payload);
      if (event === 'DuplicateRow' && response.status === 0) { copiedId = fromBinary(RowMetaPBSchema, response.payload).id; if (loseAck) throw new Error('Lost copied-row acknowledgement'); }
      return response;
    }, onNotification: () => () => {} } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Row copy service', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-row-copy-service' }]), workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) }); const owner = hyperGetDocumentOwner()!;
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Service row copies', layout: ViewLayoutPB.Grid }]), initial = await database(view.id), row = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: view.id, rowId: initial.rows[0].id }]), sourceDoc = row.oneOfDocumentId.value! as string;
    await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId: sourceDoc }]); await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: view.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false }, oneOfIconUrl: { case: 'iconUrl', value: '🧪' } }]);
    const source = await acquireHyperDocument(sourceDoc, owner); leases.push(source); await source.session.flush(); const doc = source.session.store.getState().document!, block = hyperChildren(doc, doc.blocks[doc.pageId])[0], timerId = crypto.randomUUID();
    await request('CreateReminder', [ReminderPBSchema, { id: timerId, objectId: view.id, scheduledAt: 1935741800n, isRead: true, meta: { row_id: row.id, block_id: block, custom: 'exact', is_archived: 'true' } }]);
    holdApply = true; source.session.change(value => hyperEditText(value, block, [{ insert: 'Unflushed body 😀' }, { insert: '$', attributes: { future_attr: { keep: true }, mention: { type: 'date', date: '2031-05-06T10:30:00.123', include_time: true, reminder_option: 'custom', reminder_id: timerId, unknown: 'keep' } } }])); await vi.waitFor(() => expect(applyHeld).toBe(true));
    const service = new HyperDatabaseRowDuplicateService(hyperDatabaseRowDuplicateBackend), options = { owner, databaseId: initial.id, viewId: view.id, rowId: row.id, editable: () => true }, copying = service.start(options), rejected = expect(copying).rejects.toThrow('acknowledgement');
    await new Promise(resolve => setTimeout(resolve, 50)); expect(operations).toHaveLength(0); holdApply = false; releaseApply!(); await rejected;
    const plan = service.store.getState().plans[0]; expect(plan.status).toBe('uncertain'); expect(operations).toEqual([plan.request.operationId]); expect((await database(view.id)).rows).toHaveLength(initial.rows.length + 1);
    const copied = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: view.id, rowId: copiedId }]), copiedDoc = copied.oneOfDocumentId.value! as string; expect(copied.oneOfIcon.value).toBe('🧪'); expect(copiedDoc).not.toBe(sourceDoc);
    const copiedBody = await read(copiedDoc), refs = hyperDuplicateDateReferences(copiedBody); expect(refs).toHaveLength(1); expect(refs[0].id).not.toBe(timerId); expect(refs[0].mention.unknown).toBe('keep');
    const timers = (await call('GetAllReminders', RepeatedReminderPBSchema)).items; expect(timers.find(timer => timer.id === refs[0].id)).toMatchObject({ objectId: view.id, scheduledAt: 1935741800n, isRead: true, meta: { row_id: copied.id, block_id: block, custom: 'exact', is_archived: 'true' } });
    const copyLease = await acquireHyperDocument(copiedDoc, owner); leases.push(copyLease); await copyLease.session.flush(); copyLease.session.change(value => hyperEditText(value, block, [...hyperBlockText(value, value.blocks[block]), { insert: ' Kept copy edit' }])); await copyLease.session.flush();
    source.session.change(value => hyperEditText(value, block, [...hyperBlockText(value, value.blocks[block]), { insert: ' Changed source' }])); await source.session.flush(); await source.session.dispose(); source.release(); leases.splice(leases.indexOf(source), 1);
    await request('DeleteRows', [RepeatedRowIdPBSchema, { viewId: view.id, rowIds: [row.id] }]); loseAck = false; const result = await service.retry(plan.key, { owner: hyperGetDocumentOwner()!, editable: () => true }); expect(result.id).toBe(copied.id); expect(operations).toEqual([plan.request.operationId, plan.request.operationId]); expect(hyperPlainText(hyperBlockText(await read(copiedDoc), (await read(copiedDoc)).blocks[block]))).toBe('Unflushed body 😀$ Kept copy edit');
    await copyLease.session.dispose(); copyLease.release(); leases.splice(leases.indexOf(copyLease), 1); await core.stop(); core = new CoreProcess(binary); await initialize();
    await database(view.id); const repeated = await new HyperDatabaseRepository().duplicateRow(plan.request); expect(repeated.id).toBe(copied.id); expect((await database(view.id)).rows).toHaveLength(initial.rows.length); const restarted = await read(copiedDoc); expect(hyperPlainText(hyperBlockText(restarted, restarted.blocks[block]))).toBe('Unflushed body 😀$ Kept copy edit'); expect((await call('GetAllReminders', RepeatedReminderPBSchema)).items.find(timer => timer.id === refs[0].id)?.scheduledAt).toBe(1935741800n);
  }, 45_000);
});
