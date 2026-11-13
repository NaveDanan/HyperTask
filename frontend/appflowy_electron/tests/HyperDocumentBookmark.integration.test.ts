import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CreateDocumentPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DatabaseViewRowIdPBSchema, RowMetaPBSchema, UpdateRowMetaChangesetPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperEditText, hyperUpdateBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { useAppStore } from '../src/renderer/startup/app-store';
import { createHyperDocumentBookmarkStore } from '../src/renderer/features/document-bookmark/HyperDocumentBookmarkStore';
import { hyperCaptureBookmarkInsertion, hyperCaptureDocumentBookmark, hyperReadDocumentBookmark } from '../src/renderer/features/document-bookmark/HyperDocumentBookmarkModel';
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper link cards with actual native document persistence', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-bookmark-core-')), events: string[] = [], previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
  let core = new CoreProcess(binary); const sessions: HyperDocumentSession[] = [];
  async function request(event: string, input?: [DescMessage, object]) { events.push(event); const result = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (result.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function initialize() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-bookmark-core', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  const boundary = () => new Promise(resolve => setTimeout(resolve, 650));
  afterAll(async () => { for (const session of sessions) await session.dispose(); await core.stop(); useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('persists cards, unknown data and aliases, performs native Undo/Redo, validates row bodies/locks and survives restart', async () => {
    const metadata = vi.fn(); vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => { events.push(event); return core.request(event, payload); }, onNotification: () => () => {} }, bookmarks: { load: metadata } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Cards', password: 'Guest!@123456', authType: 0, deviceId: 'hyper-bookmark-core' }]), workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    useAppStore.setState({ dataDirectory: support }); useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId }), actionResult: null }); const owner = hyperGetDocumentOwner()!;
    const page = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Cards', layout: ViewLayoutPB.Document }]), session = new HyperDocumentSession(page.id, undefined, owner); sessions.push(session); await session.flush();
    const doc = session.store.getState().document!, first = hyperChildren(doc, doc.blocks[doc.pageId])[0], store = createHyperDocumentBookmarkStore({ session, owner, editable: () => true });
    await store.open(hyperCaptureBookmarkInsertion(doc, first)); store.setField('url', 'https://youtu.be/AbCdEf_12-3'); store.setField('mode', 'youtube'); store.setField('title', 'Original title'); const focus = (await store.save())!; expect(focus).toBeDefined(); expect(metadata).not.toHaveBeenCalled();
    session.change(current => hyperUpdateBlock(current, focus.id, { unknown: { preserve: 'native' } }, 'video')); await session.flush(); await boundary();
    await store.open(hyperCaptureDocumentBookmark(session.store.getState().document!, focus.id)); store.setField('title', 'Edited title'); store.setField('description', 'Saved description'); session.change(current => hyperEditText(current, first, [{ insert: 'Unrelated document edit' }])); await session.flush(); await store.save();
    const saved = await read(page.id); expect(saved.blocks[focus.id].ty).toBe('video'); expect(hyperBlockData(saved.blocks[focus.id]).unknown).toEqual({ preserve: 'native' }); expect(hyperReadDocumentBookmark(saved, focus.id).fields.title).toBe('Edited title');
    await boundary(); await session.history(false); expect(hyperReadDocumentBookmark(session.store.getState().document!, focus.id).fields.title).toBe('Original title'); await session.history(true); expect(hyperReadDocumentBookmark(session.store.getState().document!, focus.id).fields.title).toBe('Edited title');
    const grid = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Card rows', layout: ViewLayoutPB.Grid }]), database = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]), row = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: grid.id, rowId: database.rows[0].id }]), rowDocId = row.oneOfDocumentId.value! as string;
    await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId: rowDocId }]); await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: grid.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }]); const rowSession = new HyperDocumentSession(rowDocId, undefined, owner); sessions.push(rowSession); await rowSession.flush(); const rowDoc = rowSession.store.getState().document!, rowStore = createHyperDocumentBookmarkStore({ session: rowSession, owner, editable: () => true, rowScope: { viewId: grid.id, rowId: row.id } });
    await rowStore.open(hyperCaptureBookmarkInsertion(rowDoc, hyperChildren(rowDoc, rowDoc.blocks[rowDoc.pageId])[0])); rowStore.setField('url', 'https://example.com/row'); rowStore.setField('caption', 'Row card persisted'); const rowFocus = (await rowStore.save())!; expect(rowFocus).toBeDefined();
    await rowStore.open(hyperCaptureDocumentBookmark(rowSession.store.getState().document!, rowFocus.id)); rowStore.setField('title', 'Blocked'); await request('LockView', [ViewIdPBSchema, { value: grid.id }]); const before = events.filter(event => event === 'ApplyAction').length; expect(await rowStore.save()).toBeUndefined(); expect(events.filter(event => event === 'ApplyAction')).toHaveLength(before);
    await request('UnlockView', [ViewIdPBSchema, { value: grid.id }]); const wrong = createHyperDocumentBookmarkStore({ session: rowSession, owner, editable: () => true, rowScope: { viewId: grid.id, rowId: database.rows[1].id } }); await wrong.open(hyperCaptureDocumentBookmark(rowSession.store.getState().document!, rowFocus.id)); expect(wrong.getState().status).toBe('error');
    await store.open(hyperCaptureDocumentBookmark(session.store.getState().document!, focus.id)); store.setField('title', 'Foreign owner write'); useAppStore.setState({ dataDirectory: support + '-other' }); useAppStore.setState({ dataDirectory: support }); expect(await store.save()).toBeUndefined(); expect(hyperReadDocumentBookmark(await read(page.id), focus.id).fields.title).toBe('Edited title');
    store.dispose(); rowStore.dispose(); wrong.dispose(); for (const active of sessions.splice(0)) await active.dispose(); await core.stop(); core = new CoreProcess(binary); await initialize(); const restarted = await read(page.id); expect(hyperReadDocumentBookmark(restarted, focus.id).fields).toMatchObject({ title: 'Edited title', description: 'Saved description', mode: 'youtube' }); expect(hyperBlockData(restarted.blocks[focus.id]).unknown).toEqual({ preserve: 'native' }); expect(hyperBlockText(restarted, restarted.blocks[first])[0].insert).toBe('Unrelated document edit'); expect(hyperReadDocumentBookmark(await read(rowDocId), rowFocus.id).fields.caption).toBe('Row card persisted');
  }, 40_000);
});
