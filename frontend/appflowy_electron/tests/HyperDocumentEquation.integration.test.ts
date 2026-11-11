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
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperChildren, hyperEditText, hyperUpdateBlock, hyperBlockData } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { createHyperDocumentEquationStore } from '../src/renderer/features/document-equation/HyperDocumentEquationStore';
import { hyperCaptureDocumentEquation, hyperCaptureEquationInsertion, hyperReadDocumentEquation } from '../src/renderer/features/document-equation/HyperDocumentEquationModel';
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper equations with native document persistence and owner permissions', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-equation-core-')), events: string[] = []; let core = new CoreProcess(binary); const sessions: HyperDocumentSession[] = [];
  async function request(event: string, input?: [DescMessage, object]) { events.push(event); const result = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function initialize() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-equation-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  const boundary = () => new Promise(resolve => setTimeout(resolve, 650));
  afterAll(async () => { for (const session of sessions) await session.dispose(); await core.stop(); useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null }); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('saves/edits/undoes real leaf formulas, guards locked row bodies and persists exact source plus unknown data through restart', async () => {
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => { events.push(event); return core.request(event, payload); }, onNotification: () => () => {} } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-equation-test' }]), workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) }); const owner = hyperGetDocumentOwner()!;
    const page = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Native equations', layout: ViewLayoutPB.Document }]), session = new HyperDocumentSession(page.id, undefined, owner); sessions.push(session); await session.flush();
    const first = hyperChildren(session.store.getState().document!, session.store.getState().document!.blocks[session.store.getState().document!.pageId])[0], store = createHyperDocumentEquationStore({ session, owner, editable: () => true });
    await store.open(hyperCaptureEquationInsertion(session.store.getState().document!, first)); store.setFormula(String.raw`\sum_{n=0}^{\infty}x_n`); const focus = (await store.save())!; expect(focus).toBeDefined(); expect(hyperReadDocumentEquation(await read(page.id), focus.id)).toBe(String.raw`\sum_{n=0}^{\infty}x_n`);
    session.change(doc => hyperUpdateBlock(doc, focus.id, { unknown: { keep: 'native' } })); await session.flush(); await boundary(); await store.open(hyperCaptureDocumentEquation(session.store.getState().document!, focus.id)); store.setFormula(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`); session.change(doc => hyperEditText(doc, first, [{ insert: 'An unrelated edit is kept' }])); await session.flush(); const edited = await store.save(); expect(edited).toBeDefined(); expect(hyperBlockData((await read(page.id)).blocks[focus.id]).unknown).toEqual({ keep: 'native' });
    await boundary(); await session.history(false); expect(hyperReadDocumentEquation(session.store.getState().document!, focus.id)).toBe(String.raw`\sum_{n=0}^{\infty}x_n`); await session.history(true); expect(hyperReadDocumentEquation(session.store.getState().document!, focus.id)).toBe(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`);
    const grid = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Equation row bodies', layout: ViewLayoutPB.Grid }]), database = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]), row = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: grid.id, rowId: database.rows[0].id }]);
    const rowDocId = row.oneOfDocumentId.value! as string; await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId: rowDocId }]); await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, { viewId: grid.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }]); const rowSession = new HyperDocumentSession(rowDocId, undefined, owner); sessions.push(rowSession); await rowSession.flush(); const rowDoc = rowSession.store.getState().document!, rowFirst = hyperChildren(rowDoc, rowDoc.blocks[rowDoc.pageId])[0];
    const rowStore = createHyperDocumentEquationStore({ session: rowSession, owner, editable: () => true, rowScope: { viewId: grid.id, rowId: row.id } }); await rowStore.open(hyperCaptureEquationInsertion(rowDoc, rowFirst)); rowStore.setFormula(String.raw`\frac{a}{b}`); const rowFocus = (await rowStore.save())!; expect(rowFocus).toBeDefined();
    await rowStore.open(hyperCaptureDocumentEquation(rowSession.store.getState().document!, rowFocus.id)); rowStore.setFormula('z'); await request('LockView', [ViewIdPBSchema, { value: grid.id }]); const before = events.filter(event => event === 'ApplyAction').length; expect(await rowStore.save()).toBeUndefined(); expect(events.filter(event => event === 'ApplyAction')).toHaveLength(before); expect(hyperReadDocumentEquation(await read(rowDocId), rowFocus.id)).toBe(String.raw`\frac{a}{b}`);
    const wrong = createHyperDocumentEquationStore({ session: rowSession, owner, editable: () => true, rowScope: { viewId: grid.id, rowId: database.rows[1].id } }); await request('UnlockView', [ViewIdPBSchema, { value: grid.id }]); await wrong.open(hyperCaptureDocumentEquation(rowSession.store.getState().document!, rowFocus.id)); expect(wrong.getState().status).toBe('error');
    store.dispose(); rowStore.dispose(); wrong.dispose(); for (const active of sessions.splice(0)) await active.dispose(); await core.stop(); core = new CoreProcess(binary); await initialize(); const restarted = await read(page.id); expect(hyperReadDocumentEquation(restarted, focus.id)).toBe(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`); expect(hyperBlockData(restarted.blocks[focus.id]).unknown).toEqual({ keep: 'native' }); expect(hyperReadDocumentEquation(await read(rowDocId), rowFocus.id)).toBe(String.raw`\frac{a}{b}`);
  }, 40_000);
});
