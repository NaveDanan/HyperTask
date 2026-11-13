import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadFilePBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema, RepeatedUserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { AuthenticatorType } from '@/startup/cloud-env';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { HyperDocumentMediaService } from './HyperDocumentMediaService';
import type { HyperDocumentMediaReference } from './HyperDocumentMediaModel';
const originalApp = useAppStore.getState(), originalWorkspace = useWorkspaceStore.getState();
const url = 'https://private.invalid/api/file_storage/workspace/v1/blob/page/file.pdf';
const media: HyperDocumentMediaReference = { id: 'file', kind: 'file', source: 'cloud', url, name: 'Report.pdf', alt: '', caption: '' };
const ok = (schema: DescMessage, input: object) => ({ status: 0, payload: toBinary(schema, create(schema, input as MessageInitShape<DescMessage>)) });
beforeEach(() => { useAppStore.setState({ dataDirectory: '/disposable-downloads', env: { authenticatorType: AuthenticatorType.AppFlowyCloudSelfHost, appflowyCloudConfig: { base_url: 'https://private.invalid', ws_base_url: '', gotrue_url: '', base_web_domain: '', enable_sync_trace: false } } }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace', workspaceType: WorkspaceTypePB.ServerW }), actionResult: null }); });
afterEach(() => { useAppStore.setState(originalApp, true); useWorkspaceStore.setState(originalWorkspace, true); vi.unstubAllGlobals(); });
function fixture() {
  const targets: Array<{ url: string; localFilePath: string; waitForCompletion: boolean }> = [];
  let finish!: (reply: { status: number; payload: Uint8Array }) => void;
  const request = vi.fn(async (event: string, payload: Uint8Array) => {
    if (event === 'ReadCurrentWorkspace') return ok(WorkspacePBSchema, { id: 'workspace' });
    if (event === 'GetUserProfile') return ok(UserProfilePBSchema, { id: 7n, token: 'test-only-never-forwarded' });
    if (event === 'GetAllWorkspace') return ok(RepeatedUserWorkspacePBSchema, { items: [{ workspaceId: 'workspace', workspaceType: WorkspaceTypePB.ServerW }] });
    if (event === 'GetView') return ok(ViewPBSchema, { id: 'document', layout: ViewLayoutPB.Document });
    if (event === 'DownloadFile') { targets.push(fromBinary(DownloadFilePBSchema, payload)); return await new Promise<{ status: number; payload: Uint8Array }>(resolve => { finish = resolve; }); }
    throw Error(`Unexpected download fixture event ${event}`);
  });
  const saveFile = vi.fn(async (): Promise<string | null> => '/downloads/new.pdf'), openExternal = vi.fn(async () => {});
  vi.stubGlobal('window', { appflowy: { core: { request }, dialog: { saveFile }, shell: { openExternal } } });
  return { targets, saveFile, openExternal, service: new HyperDocumentMediaService(), finish: (error = '') => finish(error ? { status: 1, payload: toBinary(FlowyErrorSchema, create(FlowyErrorSchema, { msg: error })) } : { status: 0, payload: new Uint8Array() }) };
}
describe('production document media completed downloads', () => {
  it('encodes the completion flag and waits for native completion instead of acknowledging dispatch', async () => {
    const f = fixture(); let settled = false; const pending = f.service.download(media, 'document').then(() => { settled = true; });
    await vi.waitFor(() => expect(f.targets).toHaveLength(1)); expect(f.targets[0]).toMatchObject({ url, localFilePath: '/downloads/new.pdf', waitForCompletion: true }); expect(settled).toBe(false); expect(JSON.stringify(f.targets)).not.toContain('test-only-never-forwarded');
    f.finish(); await pending; expect(settled).toBe(true); expect(f.openExternal).not.toHaveBeenCalled();
  });
  it.each(['The attachment destination already exists', 'The attachment exceeds the preview size limit'])('surfaces completed native errors without a public fallback: %s', async message => {
    const f = fixture(), pending = f.service.open({ ...media, source: 'network' }, 'document'), rejected = expect(pending).rejects.toMatchObject({ msg: message });
    await vi.waitFor(() => expect(f.targets).toHaveLength(1)); expect(f.targets[0].waitForCompletion).toBe(true); f.finish(message); await rejected; expect(f.openExternal).not.toHaveBeenCalled();
  });
  it('does not dispatch after the save dialog is cancelled or the owner changes while it is open', async () => {
    const f = fixture(); f.saveFile.mockResolvedValueOnce(null); await f.service.download(media, 'document'); expect(f.targets).toEqual([]);
    f.saveFile.mockImplementationOnce(async () => { useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 8n }) }); return '/downloads/foreign.pdf'; });
    await expect(f.service.download(media, 'document')).rejects.toThrow('changed'); expect(f.targets).toEqual([]); expect(f.openExternal).not.toHaveBeenCalled();
  });
});
