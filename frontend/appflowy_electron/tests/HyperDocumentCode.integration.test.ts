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
import { createHyperDocumentCodeStore } from '../src/renderer/features/document-code/HyperDocumentCodeStore';
import { hyperCaptureDocumentCode, hyperCodeSource, hyperIndentDocumentCode } from '../src/renderer/features/document-code/HyperDocumentCodeModel';
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper code language and indentation with actual native persistence', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-code-core-')), events: string[] = [], previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
  let core = new CoreProcess(binary); const sessions: HyperDocumentSession[] = [];
  async function request(event: string, input?: [DescMessage, object]) { events.push(event); const result = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (result.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function initialize() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-code-core', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  const boundary = () => new Promise(resolve => setTimeout(resolve, 650));
  afterAll(async () => { for (const session of sessions) await session.dispose(); await core.stop(); useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('persists exact code and unknown metadata, uses native history, checks row-body locks and survives restart', async () => {
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => { events.push(event); return core.request(event, payload); }, onNotification: () => () => {} } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Code', password: 'Guest!@123456', authType: 0, deviceId: 'hyper-code-core' }]), workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    useAppStore.setState({ dataDirectory: support }); useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId }), actionResult: null }); const owner = hyperGetDocumentOwner()!;
    const page = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Code', layout: ViewLayoutPB.Document }]), session = new HyperDocumentSession(page.id, undefined, owner); sessions.push(session); await session.flush();
    const first = hyperChildren(session.store.getState().document!, session.store.getState().document!.blocks[session.store.getState().document!.pageId])[0], raw = '😀const x = 1;\n  next();\n';
    session.change(doc => hyperUpdateBlock(doc, first, { unknown: { keep: 'native' }, language: null }, 'code')); session.change(doc => hyperEditText(doc, first, [{ insert: raw, attributes: { future: 'kept' } }])); await session.flush(); await boundary();
    const store = createHyperDocumentCodeStore({ session, owner, editable: () => true }); await store.open(first); expect(store.getState().status).toBe('editing'); store.setLanguage('future language#2'); expect(await store.save()).toBe(true);
    expect(hyperCodeSource(await read(page.id), first)).toBe(raw); expect(hyperBlockData((await read(page.id)).blocks[first])).toMatchObject({ language: 'future language#2', unknown: { keep: 'native' } });
    await boundary(); await session.history(false); expect(hyperBlockData(session.store.getState().document!.blocks[first]).language).toBeNull(); await session.history(true); expect(hyperBlockData(session.store.getState().document!.blocks[first]).language).toBe('future language#2');
    await boundary(); session.change(doc => hyperIndentDocumentCode(doc, hyperCaptureDocumentCode(doc, first), { start: 0, end: raw.length }, false)); await session.flush(); const indented = '  😀const x = 1;\n    next();\n'; expect(hyperCodeSource(await read(page.id), first)).toBe(indented); await boundary(); await session.history(false); expect(hyperCodeSource(session.store.getState().document!, first)).toBe(raw); await session.history(true); expect(hyperCodeSource(session.store.getState().document!, first)).toBe(indented); expect(hyperBlockText(session.store.getState().document!, session.store.getState().document!.blocks[first]).some(run => run.attributes?.future === 'kept')).toBe(true);
    const grid = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Code rows', layout: ViewLayoutPB.Grid }]), database = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]), row = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: grid.id, rowId: database.rows[0].id }]), rowDocId = row.oneOfDocumentId.value! as string;
    await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId: rowDocId }]); await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: grid.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }]); const rowSession = new HyperDocumentSession(rowDocId, undefined, owner); sessions.push(rowSession); await rowSession.flush(); const rowDoc = rowSession.store.getState().document!, rowCode = hyperChildren(rowDoc, rowDoc.blocks[rowDoc.pageId])[0];
    rowSession.change(doc => hyperUpdateBlock(doc, rowCode, { language: null }, 'code')); rowSession.change(doc => hyperEditText(doc, rowCode, [{ insert: '  row source\n' }])); await rowSession.flush(); const rowStore = createHyperDocumentCodeStore({ session: rowSession, owner, editable: () => true, rowScope: { viewId: grid.id, rowId: row.id } }); await rowStore.open(rowCode); rowStore.setLanguage('rust'); expect(await rowStore.save()).toBe(true);
    await rowStore.open(rowCode); rowStore.setLanguage('python'); await request('LockView', [ViewIdPBSchema, { value: grid.id }]); const before = events.filter(event => event === 'ApplyAction').length; expect(await rowStore.save()).toBe(false); expect(events.filter(event => event === 'ApplyAction')).toHaveLength(before); await request('UnlockView', [ViewIdPBSchema, { value: grid.id }]);
    const wrong = createHyperDocumentCodeStore({ session: rowSession, owner, editable: () => true, rowScope: { viewId: grid.id, rowId: database.rows[1].id } }); await wrong.open(rowCode); expect(wrong.getState().status).toBe('error');
    await store.open(first); store.setLanguage('foreign'); useAppStore.setState({ dataDirectory: support + '-other' }); useAppStore.setState({ dataDirectory: support }); expect(await store.save()).toBe(false); expect(hyperBlockData((await read(page.id)).blocks[first]).language).toBe('future language#2');
    store.dispose(); rowStore.dispose(); wrong.dispose(); for (const active of sessions.splice(0)) await active.dispose(); await core.stop(); core = new CoreProcess(binary); await initialize(); const restarted = await read(page.id); expect(hyperCodeSource(restarted, first)).toBe(indented); expect(hyperBlockData(restarted.blocks[first])).toMatchObject({ language: 'future language#2', unknown: { keep: 'native' } }); expect(hyperBlockText(restarted, restarted.blocks[first]).some(run => run.attributes?.future === 'kept')).toBe(true); const restartedRow = await read(rowDocId); expect(hyperCodeSource(restartedRow, rowCode)).toBe('  row source\n'); expect(hyperBlockData(restartedRow.blocks[rowCode]).language).toBe('rust');
  }, 40_000);
});
