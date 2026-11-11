import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '../src/renderer/startup/app-store';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { AuthenticatorType } from '../src/renderer/startup/cloud-env';
import { hyperCloudAssetIsProtected, hyperPreviewCloudAsset } from '../src/renderer/features/cloud-assets/HyperCloudAssetPreview';
const originalApp = useAppStore.getState(), originalWorkspace = useWorkspaceStore.getState();
const environment = (base_url: string) => ({ authenticatorType: AuthenticatorType.AppFlowyCloudSelfHost, appflowyCloudConfig: { base_url, ws_base_url: '', gotrue_url: '', enable_sync_trace: false, base_web_domain: '' } });
const privateUrl = 'https://private.example/prefix/api/file_storage/workspace-A/v1/blob/page/picture.png';
const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=';
beforeEach(() => {
  useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace-A' }), actionResult: null });
  useAppStore.setState({ dataDirectory: '/temporary/cloud-assets', env: environment('https://private.example/prefix'), launchId: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); useWorkspaceStore.setState({ userProfile: originalWorkspace.userProfile, currentWorkspace: originalWorkspace.currentWorkspace, actionResult: originalWorkspace.actionResult }); useAppStore.setState({ dataDirectory: originalApp.dataDirectory, env: originalApp.env, launchId: originalApp.launchId }); });
describe('Hyper protected asset renderer routing', () => {
  it('classifies configured base paths and every workspace without matching foreign origins or sibling routes', () => {
    for (const value of [privateUrl, privateUrl.replace('workspace-A', 'workspace-B'), `${privateUrl}?download=1`, `${privateUrl}#private-fragment`]) expect(hyperCloudAssetIsProtected(value)).toBe(true);
    for (const value of [privateUrl.replace('private.example', 'foreign.example'), privateUrl.replace('/prefix/', '/prefix-two/'), privateUrl.replace('/api/file_storage/', '/api/file_storage_other/'), 'https://private.example/prefix/logo.png', 'file:///private.png', 'javascript:alert(1)']) expect(hyperCloudAssetIsProtected(value)).toBe(false);
    useAppStore.setState({ env: environment('https://private.example/') }); expect(hyperCloudAssetIsProtected('https://private.example/api/file_storage/other/blob/picture')).toBe(true);
  });
  it('returns public HTTP(S) without privileged bridge or renderer network requests', async () => {
    const bridge = vi.fn(), fetch = vi.fn(); vi.stubGlobal('window', { appflowy: { assets: { previewCloud: bridge } } }); vi.stubGlobal('fetch', fetch);
    expect(await hyperPreviewCloudAsset('https://public.example/image?q=one')).toBe('https://public.example/image?q=one'); expect(bridge).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('passes the captured actor/workspace to the bridge without inspecting renderer credentials', async () => {
    const bridge = vi.fn(async () => raster), fetch = vi.fn(); vi.stubGlobal('window', { appflowy: { assets: { previewCloud: bridge } } }); vi.stubGlobal('fetch', fetch);
    useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n, token: 'renderer-secret-must-not-be-read' }) });
    expect(await hyperPreviewCloudAsset(privateUrl)).toBe(raster); expect(bridge).toHaveBeenCalledExactlyOnceWith(privateUrl, { actorId: '7', workspaceId: 'workspace-A' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('sends a foreign-workspace route to native rejection and never falls back after failure', async () => {
    const bridge = vi.fn(async () => { throw Error('Foreign workspace'); }), fetch = vi.fn(); vi.stubGlobal('window', { appflowy: { assets: { previewCloud: bridge } } }); vi.stubGlobal('fetch', fetch);
    const foreign = privateUrl.replace('workspace-A', 'workspace-B'); await expect(hyperPreviewCloudAsset(foreign)).rejects.toThrow('Foreign workspace'); expect(bridge).toHaveBeenCalledExactlyOnceWith(foreign, { actorId: '7', workspaceId: 'workspace-A' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unavailable private bridge, malformed results and active/credential URL inputs', async () => {
    vi.stubGlobal('window', { appflowy: { assets: {} } }); await expect(hyperPreviewCloudAsset(privateUrl)).rejects.toThrow('unavailable');
    for (const value of ['file:///private.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://user:secret@private.example/image', `${privateUrl}\n`]) await expect(hyperPreviewCloudAsset(value)).rejects.toThrow();
    const bridge = vi.fn(); vi.stubGlobal('window', { appflowy: { assets: { previewCloud: bridge } } });
    for (const value of ['https://public.example/fallback.png', 'data:image/svg+xml;base64,AAAA', 'file:///cache/private.png', 'data:image/png;base64,<>']) { bridge.mockResolvedValueOnce(value); await expect(hyperPreviewCloudAsset(privateUrl)).rejects.toThrow('unsupported'); }
  });
  it('rejects delayed private bytes after storage, server, account, workspace and launch ABA changes', async () => {
    for (const mode of ['storage', 'server', 'account', 'workspace', 'launch']) {
      let release!: (value: string) => void; const bridge = vi.fn(() => new Promise<string>(resolve => { release = resolve; })); vi.stubGlobal('window', { appflowy: { assets: { previewCloud: bridge } } });
      const request = hyperPreviewCloudAsset(privateUrl), rejected = expect(request).rejects.toThrow('changed');
      if (mode === 'storage') { useAppStore.setState({ dataDirectory: '/temporary/other' }); useAppStore.setState({ dataDirectory: '/temporary/cloud-assets' }); }
      if (mode === 'server') { useAppStore.setState({ env: environment('https://other.example/prefix') }); useAppStore.setState({ env: environment('https://private.example/prefix') }); }
      if (mode === 'account') { useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 8n }) }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }) }); }
      if (mode === 'workspace') { useWorkspaceStore.setState({ currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace-B' }) }); useWorkspaceStore.setState({ currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace-A' }) }); }
      if (mode === 'launch') { useAppStore.setState({ launchId: 2 }); useAppStore.setState({ launchId: 1 }); }
      release(raster); await rejected;
    }
  });
});
