import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthenticatorType } from '@/startup/cloud-env';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperInlineDocumentExport, hyperSaveDocumentExport, hyperValidateDocumentExport } from '../document/HyperDocumentExportBundle';
import { hyperExportDocument } from '../document/HyperDocumentExport';
import { hyperDocumentProtectedImages, hyperPrepareProtectedDocumentImages } from './HyperDocumentProtectedExport';
import { HyperDocumentMediaService } from './HyperDocumentMediaService';
const originalApp = useAppStore.getState(), originalWorkspace = useWorkspaceStore.getState();
const url = 'https://private.invalid/base/api/file_storage/workspace/v1/blob/photo.png';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
function document() { return create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' }, image: { id: 'image', parentId: 'root', ty: 'image', childrenId: 'image-children', data: JSON.stringify({ image_type: 1, url, alt: 'Protected image', custom: { kept: true } }) }, again: { id: 'again', parentId: 'root', ty: 'image', data: JSON.stringify({ image_type: 2, url }) }, public: { id: 'public', parentId: 'root', ty: 'image', data: '{"image_type":2,"url":"https://public.invalid/picture.png"}' }, detached: { id: 'detached', ty: 'image', data: '{"image_type":1,"url":"https://private.invalid/base/api/file_storage/foreign/ignored.png"}' } }, meta: { childrenMap: { children: { children: ['image', 'again', 'public'] } } } }); }
function fixture() { const previewCloud = vi.fn(async (_url: string, _owner: { actorId: string; workspaceId: string }) => png), writeText = vi.fn(async (_path: string, _content: string) => {}), exportFile = vi.fn(async () => {}), inlineUrl = vi.fn(async () => png); vi.stubGlobal('window', { appflowy: { assets: { previewCloud }, shell: { openExternal: vi.fn() } } }); return { previewCloud, io: { assets: { exportFile, inlineUrl }, writeText }, doc: document() }; }
beforeEach(() => { useAppStore.setState({ dataDirectory: '/disposable-media', launchId: 1, env: { authenticatorType: AuthenticatorType.AppFlowyCloudSelfHost, appflowyCloudConfig: { base_url: 'https://private.invalid/base', ws_base_url: '', gotrue_url: '', enable_sync_trace: false, base_web_domain: '' } } }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(originalApp, true); useWorkspaceStore.setState(originalWorkspace, true); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('protected document media previews and portable exports', () => {
  it('previews through the owner-only native bridge for cloud and copied network addresses without fetch or metadata mutation', async () => {
    const f = fixture(), before = JSON.stringify(f.doc), service = new HyperDocumentMediaService();
    for (const source of ['cloud', 'network'] as const) expect(await service.preview({ id: 'image', source, kind: 'image', url, name: 'photo.png', alt: '', caption: '' })).toBe(png);
    expect(f.previewCloud).toHaveBeenCalledWith(url, { actorId: '7', workspaceId: 'workspace' }); expect(f.previewCloud.mock.calls.every(call => call.length === 2)).toBe(true); expect(JSON.stringify(f.doc)).toBe(before);
    f.previewCloud.mockRejectedValueOnce(Error('Private image denied')); await expect(service.preview({ id: 'image', source: 'cloud', kind: 'image', url, name: 'photo.png', alt: '', caption: '' })).rejects.toThrow('denied');
  });
  it('validates without I/O then embeds each reachable private source once into HTML, PDF input and Markdown', async () => {
    const f = fixture(), before = JSON.stringify(f.doc); expect(hyperDocumentProtectedImages(f.doc)).toEqual([url]);
    expect(() => hyperExportDocument(f.doc, 'html')).toThrow('Protected images must be included');
    expect(hyperValidateDocumentExport(f.doc, 'html', 'Page')).toContain('data:image/png'); expect(f.previewCloud).not.toHaveBeenCalled();
    const html = await hyperInlineDocumentExport(f.doc, 'html', 'PDF input', {}, f.io); expect(html).toContain(`<img src="${png}"`); expect(html).not.toContain(url); expect(html).toContain('https://public.invalid/picture.png'); expect(f.previewCloud).toHaveBeenCalledTimes(1); expect(f.io.assets.inlineUrl).not.toHaveBeenCalled();
    await hyperSaveDocumentExport(f.doc, 'markdown', 'Page', '/exports/page.md', {}, f.io); expect(f.io.writeText).toHaveBeenCalledTimes(1); expect(f.io.writeText.mock.calls[0][1]).toContain(png); expect(f.io.writeText.mock.calls[0][1]).not.toContain(url); expect(f.io.assets.exportFile).not.toHaveBeenCalled(); expect(JSON.stringify(f.doc)).toBe(before);
  });
  it.each(['denied', 'missing', 'unsafe', 'foreign'] as const)('keeps previous exports intact and never falls back for a %s private image', async mode => {
    const f = fixture(); if (mode === 'denied') f.previewCloud.mockRejectedValue(Error('Denied')); if (mode === 'missing') vi.stubGlobal('window', { appflowy: { assets: {} } }); if (mode === 'unsafe') f.previewCloud.mockResolvedValue('data:image/svg+xml;base64,PHN2Zz4='); if (mode === 'foreign') f.previewCloud.mockRejectedValue(Error('Workspace mismatch'));
    await expect(hyperSaveDocumentExport(f.doc, 'html', 'Page', '/exports/existing.html', {}, f.io)).rejects.toThrow(); expect(f.io.writeText).not.toHaveBeenCalled(); expect(f.io.assets.exportFile).not.toHaveBeenCalled();
  });
  it.each(['actor', 'actor-ABA', 'server', 'storage', 'launch', 'source', 'caller'] as const)('drops a late %s result before export writes', async mode => {
    const f = fixture(); let release!: (value: string) => void, current = true; f.previewCloud.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const pending = hyperSaveDocumentExport(f.doc, 'html', 'Page', '/exports/existing.html', {}, { ...f.io, current: () => current }); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (mode.startsWith('actor')) { useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 8n }) }); if (mode === 'actor-ABA') useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }) }); }
    if (mode === 'server') useAppStore.setState({ env: { ...useAppStore.getState().env!, appflowyCloudConfig: { ...useAppStore.getState().env!.appflowyCloudConfig, base_url: 'https://other.invalid' } } });
    if (mode === 'storage') useAppStore.setState({ dataDirectory: '/changed-storage' }); if (mode === 'launch') useAppStore.setState({ launchId: 2 }); if (mode === 'source') f.doc.blocks.image.data = '{"url":"https://public.invalid/new.png"}'; if (mode === 'caller') current = false;
    release(png); await expect(pending).rejects.toThrow(/changed/); expect(f.io.writeText).not.toHaveBeenCalled(); expect(f.io.assets.exportFile).not.toHaveBeenCalled();
  });
  it('classifies canonical browser addresses and refuses embedded credentials before privileged I/O', async () => {
    const f = fixture(); f.doc.blocks.image.data = JSON.stringify({ url: '  ' + url + '  ', image_type: 1 });
    const html = await hyperInlineDocumentExport(f.doc, 'html', 'Page', {}, f.io); expect(html).not.toContain(url); expect(f.previewCloud).toHaveBeenCalledExactlyOnceWith(url, { actorId: '7', workspaceId: 'workspace' });
    f.doc.blocks.image.data = JSON.stringify({ url: url.replace('https://', 'https://user:secret@'), image_type: 1 }); f.previewCloud.mockClear(); await expect(hyperInlineDocumentExport(f.doc, 'html', 'Page', {}, f.io)).rejects.toThrow('embedded credentials'); expect(f.previewCloud).not.toHaveBeenCalled();
  });
  it('bounds repeated private image embeds before a large portable file can be written', () => {
    const f = fixture(), large = 'data:image/png;base64,' + 'A'.repeat(25 * 1024 * 1024);
    expect(() => hyperExportDocument(f.doc, 'html', 'Page', { mediaUrls: { [url]: large } })).toThrow('too large');
    expect(f.io.writeText).not.toHaveBeenCalled();
  });
  it('enforces the combined portable image limit before any target write', async () => {
    const f = fixture(), preview = vi.fn(async () => png); await expect(hyperPrepareProtectedDocumentImages(f.doc, 48 * 1024 * 1024, () => {}, preview)).rejects.toThrow('too large'); expect(preview).toHaveBeenCalledTimes(1); expect(f.io.writeText).not.toHaveBeenCalled();
  });
});
