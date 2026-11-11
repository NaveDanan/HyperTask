import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperUpdateBlock, hyperBlockData } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { hyperViewAppearance } from '../src/renderer/features/view-appearance/HyperViewAppearanceService';
import { hyperReadViewCover, hyperAppearanceExtra, hyperLegacyCoverField } from '../src/renderer/features/view-appearance/HyperViewAppearanceModel';
import { HyperAssets } from '../src/main/HyperAssets';
import { hyperCaptureAppearanceOwner } from '../src/renderer/features/view-appearance/HyperViewAppearanceService';
import { useAppStore } from '../src/renderer/startup/app-store';
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper page appearance through the actual core', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-appearance-core-')), events: string[] = []; let core = new CoreProcess(binary); let session: HyperDocumentSession | undefined;
  async function request(event: string, input?: [DescMessage, object]) { events.push(event); const result = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input)); }
  async function initialize() { await core.start(() => {}); expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-appearance-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  const view = (value: string) => call('GetView', ViewPBSchema, [ViewIdPBSchema, { value }]);
  afterAll(async () => { await session?.dispose(); await core.stop(); useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null }); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('changes icon/covers without touching legacy data, keeps shared assets, rejects locks and persists after restart', async () => {
    const assetRoot = path.join(support, 'managed'); fs.mkdirSync(assetRoot); const assets = new HyperAssets(() => assetRoot);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => { events.push(event); return core.request(event, payload); }, onNotification: () => () => {} }, assets: { importFile: (source: string) => assets.importFile(source, 'image'), previewUrl: (value: string) => assets.previewUrl(value) } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-appearance-test' }]), workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) }); const owner = hyperGetDocumentOwner()!;
    const page = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Appearance', layout: ViewLayoutPB.Document }]); session = new HyperDocumentSession(page.id, undefined, owner); await session.flush();
    const legacy = { cover_selection_type: 'CoverType.color', cover_selection: '0xff112233', selected_icon: 'legacy', unknown: { keep: 'root' } }; session.change(doc => hyperUpdateBlock(doc, doc.pageId, legacy)); await session.flush(); const initial = await read(page.id), rootData = initial.blocks[initial.pageId].data;
    expect(hyperReadViewCover(await view(page.id), initial)).toEqual({ cover: { type: 'color', value: '0xff112233' }, legacy: true });
    const staleLegacy = hyperViewAppearance.capture(await view(page.id), 'cover'); staleLegacy.legacySource = { documentId: page.id, original: hyperLegacyCoverField(rootData) }; session.change(doc => hyperUpdateBlock(doc, doc.pageId, { cover_selection: '0xffabcdef' })); await session.flush(); await expect(hyperViewAppearance.save(staleLegacy, { type: 'none', value: '' })).rejects.toThrow('legacy cover changed'); session.change(doc => hyperUpdateBlock(doc, doc.pageId, legacy)); await session.flush(); const documentWrites = events.filter(event => event === 'ApplyAction').length;
    await request('UpdateView', [await import('@shared/protobuf/flowy-folder/view_pb').then(m => m.UpdateViewPayloadPBSchema), { viewId: page.id, oneOfExtra: { case: 'extra', value: JSON.stringify({ font: 'Geist', unknown: { keep: 'view' } }) } }]);
    let current = await view(page.id); current = await hyperViewAppearance.save(hyperViewAppearance.capture(current, 'cover'), { type: 'gradient', value: 'appflowy_them_color_gradient7' });
    expect(hyperAppearanceExtra(current)).toMatchObject({ font: 'Geist', unknown: { keep: 'view' } }); expect(JSON.parse((await read(page.id)).blocks[initial.pageId].data)).toEqual(JSON.parse(rootData)); expect(events.filter(event => event === 'ApplyAction')).toHaveLength(documentWrites);
    for (let i = 1; i <= 6; i++) current = await hyperViewAppearance.save(hyperViewAppearance.capture(current, 'cover'), { type: 'built_in', value: String(i) });
    const source = path.join(support, 'source.png'); fs.writeFileSync(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO6n4QAAAABJRU5ErkJggg==', 'base64'));
    const target = hyperViewAppearance.capture(current, 'cover'), asset = await hyperViewAppearance.importImage(target, source); current = await hyperViewAppearance.save(target, { type: 'local', value: asset.path }, asset.path); fs.unlinkSync(source); expect(await assets.resolve(asset.previewUrl)).toBe(asset.path);
    current = await hyperViewAppearance.save(hyperViewAppearance.capture(current, 'icon'), { ty: 1, value: asset.path }, asset.path);
    current = await hyperViewAppearance.save(hyperViewAppearance.capture(current, 'icon'), { ty: 0, value: '🌍' }); expect(fs.existsSync(asset.path)).toBe(true); expect(events).not.toContain('DeleteFile');
    const targetBeforeLock = hyperViewAppearance.capture(current, 'cover'); await request('LockView', [ViewIdPBSchema, { value: page.id }]); const writes = events.filter(event => event === 'UpdateView').length; await expect(hyperViewAppearance.save(targetBeforeLock, { type: 'none', value: '' })).rejects.toThrow('locked'); expect(events.filter(event => event === 'UpdateView')).toHaveLength(writes); await request('UnlockView', [ViewIdPBSchema, { value: page.id }]);
    const scope = hyperCaptureAppearanceOwner(owner)!; const launch = useAppStore.getState().launchId; useAppStore.setState({ launchId: launch + 1 }); expect(scope.isCurrent()).toBe(false); useAppStore.setState({ launchId: launch }); expect(scope.isCurrent()).toBe(false);
    await session.dispose(); session = undefined; await core.stop(); core = new CoreProcess(binary); await initialize(); const restarted = await view(page.id); expect(hyperReadViewCover(restarted).cover).toEqual({ type: 'local', value: asset.path }); expect(restarted.oneOfIcon.value?.value).toBe('🌍'); expect(hyperBlockData((await read(page.id)).blocks[initial.pageId])).toMatchObject(legacy); expect(fs.existsSync(asset.path)).toBe(true);
  }, 40_000);
});
