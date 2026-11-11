import { fromBinary, toJson } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DownloadFilePBSchema } from '../shared/protobuf/flowy-document/entities_pb';
import { createHyperCloudPreviewDownload, hyperCloudPreviewIpc } from './HyperCloudPreviewIpc';
const supportsCompletion = DownloadFilePBSchema.fields.some(field => field.name === 'wait_for_completion');
describe('Hyper protected image IPC contract', () => {
  it('requires the original captured account/workspace before touching native identity or files', async () => {
    const previews = { previewUrl: vi.fn(async () => 'data:image/png;base64,AAAA') };
    for (const owner of [undefined, null, [], {}, { actorId: '7' }, { actorId: '7', workspaceId: '' }, { actorId: '7', workspaceId: 'workspace', token: 'secret' }, { actorId: 7, workspaceId: 'workspace' }, { actorId: '7', workspaceId: 'workspace\n' }]) await expect(hyperCloudPreviewIpc(previews, 'https://private.example/image', owner)).rejects.toThrow('captured');
    expect(previews.previewUrl).not.toHaveBeenCalled();
    await hyperCloudPreviewIpc(previews, 'https://private.example/image', { actorId: '7', workspaceId: 'workspace' }); expect(previews.previewUrl).toHaveBeenCalledExactlyOnceWith('https://private.example/image', { actorId: '7', workspaceId: 'workspace' });
  });
  it('does not send any DownloadFile until the descriptor supports explicit completion', async () => {
    const request = vi.fn(async (_event: string, _payload: Uint8Array) => ({ status: 0, payload: new Uint8Array() })), download = createHyperCloudPreviewDownload({ request });
    if (!supportsCompletion) { await expect(download('https://private.example/image', '/private/staging/image')).rejects.toThrow('protocol is unavailable'); expect(request).not.toHaveBeenCalled(); }
    else { await download('https://private.example/image', '/private/staging/image'); const payload = request.mock.calls[0][1]; expect(toJson(DownloadFilePBSchema, fromBinary(DownloadFilePBSchema, payload))).toMatchObject({ waitForCompletion: true }); }
  });
  it('sanitizes private paths/provider diagnostics across the Electron error boundary', async () => {
    const previews = { previewUrl: vi.fn(async () => { throw Error('/private/storage/account: Bearer provider-secret'); }) };
    const error = await hyperCloudPreviewIpc(previews, 'https://private.example/image', { actorId: '7', workspaceId: 'workspace' }).catch(error => error as Error);
    expect(String(error)).toContain('original workspace'); expect(String(error)).not.toMatch(/Bearer|provider-secret|\/private\/storage/u);
  });
});
