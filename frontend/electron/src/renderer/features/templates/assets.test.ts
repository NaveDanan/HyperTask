import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperAssetTemplateSource } from './assets';

afterEach(() => vi.unstubAllGlobals());
describe('Vite bundled source', () => {
  it('reads the imported JSON manifest without fetching payloads', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await new HyperAssetTemplateSource().readManifest()).templates).toHaveLength(52); expect(fetch).not.toHaveBeenCalled();
  });
  it('resolves payloads and binary media to local Vite URLs on demand', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { kind: 'document' } }), arrayBuffer: async () => new Uint8Array([0, 255, 128]).buffer }));
    vi.stubGlobal('fetch', fetch); const source = new HyperAssetTemplateSource();
    expect(await source.readPayload('payloads/Weekly-To-Do-List.json')).toEqual({ data: { kind: 'document' } });
    expect(fetch.mock.calls.length).toBe(1);
    const manifest = await source.readManifest();
    expect(await source.readMedia(manifest.media[0].path)).toEqual(new Uint8Array([0, 255, 128]));
    expect(fetch).toHaveBeenCalledTimes(2);
    // Both resources come from the packaged Vite source, never the source hosts.
    for (const [url] of fetch.mock.calls as unknown as [string][]) expect(url).not.toMatch(/^https?:/);
    await expect(source.readPayload('payloads/missing.json')).rejects.toThrow('missing');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});