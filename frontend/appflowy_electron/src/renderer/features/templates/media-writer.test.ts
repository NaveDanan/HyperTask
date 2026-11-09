import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/startup/app-store';
import { saveHyperTemplateMedia } from './media-writer';
import { manifest } from './test-support';

afterEach(() => { vi.unstubAllGlobals(); useAppStore.setState({ dataDirectory: '', info: null }); });
describe('media destinations', () => {
  it('writes owned binary copies under the resolved custom data root using fresh UUIDs and the original extensions', async () => {
    useAppStore.setState({ dataDirectory: '/custom/data' });
    const writeBytes = vi.fn(async () => {}); vi.stubGlobal('window', { appflowy: { fs: { writeBytes } } });
    const image = manifest.media.find(m => m.isImage)!, file = manifest.media.find(m => !m.isImage)!, bytes = new Uint8Array([0, 255, 128]);
    const first = await saveHyperTemplateMedia(image, bytes), second = await saveHyperTemplateMedia(image, bytes), attachment = await saveHyperTemplateMedia(file, bytes);
    expect(first).toMatch(/^\/custom\/data\/images\/[0-9a-f-]{36}\.[a-z]+$/); expect(second).not.toBe(first);
    expect(attachment).toMatch(/^\/custom\/data\/files\/[0-9a-f-]{36}\.pdf$/); expect(first.split('.').pop()).toBe(image.path.split('.').pop());
    expect(writeBytes).toHaveBeenCalledWith(first, bytes); expect(writeBytes).toHaveBeenCalledTimes(3);
  });
  it('does not write before data storage is initialized and propagates write failures', async () => {
    const writeBytes = vi.fn(async () => { throw new Error('disk full'); }); vi.stubGlobal('window', { appflowy: { fs: { writeBytes } } });
    await expect(saveHyperTemplateMedia(manifest.media[0], new Uint8Array())).rejects.toThrow('not initialized'); expect(writeBytes).not.toHaveBeenCalled();
    useAppStore.setState({ dataDirectory: '/data' }); await expect(saveHyperTemplateMedia(manifest.media[0], new Uint8Array())).rejects.toThrow('disk full');
  });
});