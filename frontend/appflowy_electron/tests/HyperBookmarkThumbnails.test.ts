import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HyperAssets } from '../src/main/HyperAssets';
import { HyperBookmarkThumbnails, HYPER_BOOKMARK_THUMBNAIL_BYTES } from '../src/main/HyperBookmarkThumbnails';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=', 'base64'), owner = { actorId: '1', workspaceId: 'workspace' };
function sizedPng(width: number, height: number, noise = false) {
  const chunk = (type: string, bytes: Buffer) => { const result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); result.write(type, 4, 'ascii'); bytes.copy(result, 8); result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4); return result; }, header = Buffer.alloc(13), rows = noise ? randomBytes((width + 1) * height) : Buffer.alloc((width + 1) * height);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; for (let row = 0; row < height; row++) rows[row * (width + 1)] = 0;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
describe('Hyper credential-free managed bookmark thumbnails', () => {
  let root = '', server: http.Server, origin = '', revision = 0;
  const requests: Array<{ path: string; headers: http.IncomingHttpHeaders }> = [];
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-bookmark-thumbnails-'));
    server = http.createServer((request, response) => {
      const route = request.url!; requests.push({ path: route, headers: request.headers }); response.setHeader('Content-Type', 'image/png');
      if (route === '/redirect') { response.writeHead(302, { Location: '/image', 'Set-Cookie': 'private=SECRET' }); response.end(); }
      else if (route === '/cycle') { response.writeHead(302, { Location: '/cycle' }); response.end(); }
      else if (route.startsWith('/hop/')) { response.writeHead(302, { Location: '/hop/' + (Number(route.split('/').at(-1)) + 1) }); response.end(); }
      else if (route === '/scheme') { response.writeHead(302, { Location: 'file:///etc/passwd' }); response.end(); }
      else if (route === '/credentials') { response.writeHead(302, { Location: 'https://user:SECRET@example.com/image' }); response.end(); }
      else if (route === '/switch') { revision++; response.writeHead(302, { Location: '/after-switch' }); response.end(); }
      else if (route === '/large') { response.setHeader('Content-Length', HYPER_BOOKMARK_THUMBNAIL_BYTES + 1); response.end(); }
      else if (route === '/chunked') response.end(Buffer.alloc(HYPER_BOOKMARK_THUMBNAIL_BYTES + 1));
      else if (route === '/html') { response.setHeader('Content-Type', 'text/html'); response.end('<script>SECRET</script>'); }
      else if (route === '/compressed') { response.setHeader('Content-Encoding', 'gzip'); response.end(png); }
      else if (route === '/svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg/>'); }
      else if (route === '/bad') response.end('not a raster');
      else if (route === '/error') { response.writeHead(401); response.end('SECRET'); }
      else if (route === '/slow') { /* Held until client cancellation. */ }
      else response.end(png);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); });
  function fixture() { const assets = new HyperAssets(() => root, () => revision), importImage = vi.fn(assets.importGeneratedImage.bind(assets)), normalize = vi.fn((bytes: Buffer) => bytes), runtime = { revision: () => revision, root: () => root, identity: async () => owner, normalize, importImage }; return { assets, importImage, normalize, runtime, service: new HyperBookmarkThumbnails(runtime) }; }
  it('follows public redirects without browser headers, normalizes and retains content-addressed managed bytes', async () => {
    const f = fixture(), result = await f.service.loadUrl(origin + '/redirect', owner); expect(result).toMatchObject({ width: 2, height: 3 }); expect(await fs.readFile(result.path)).toEqual(png); expect(result.previewUrl).toMatch(/^appflowy-file:\/\/local\/images\//u); expect(f.normalize).toHaveBeenCalledTimes(1);
    expect((await f.service.loadUrl(origin + '/image', owner)).path).toBe(result.path);
    for (const request of requests.filter(request => ['/redirect', '/image'].includes(request.path))) { expect(request.headers.cookie).toBeUndefined(); expect(request.headers.authorization).toBeUndefined(); expect(request.headers.referer).toBeUndefined(); expect(request.headers['accept-encoding']).toBe('identity'); }
  });
  it.each(['/cycle', '/hop/0', '/scheme', '/credentials', '/large', '/chunked', '/html', '/compressed', '/svg', '/bad', '/error'])('rejects invalid or bounded responses without storing bytes: %s', async route => { const f = fixture(); await expect(f.service.loadUrl(origin + route, owner)).rejects.not.toThrow('SECRET'); expect(f.importImage).not.toHaveBeenCalled(); });
  it('rejects foreign owners before HTTP and owner changes before another redirect', async () => { const f = fixture(), count = requests.length; await expect(f.service.loadUrl(origin + '/image', { ...owner, actorId: 'other' })).rejects.toThrow('changed'); expect(requests).toHaveLength(count); await expect(f.service.loadUrl(origin + '/switch', owner)).rejects.toThrow('changed'); expect(requests.some(request => request.path === '/after-switch')).toBe(false); expect(f.importImage).not.toHaveBeenCalled(); });
  it('cancels active sockets and never stores a result after invalidation', async () => { const f = fixture(), promise = f.service.loadUrl(origin + '/slow', owner); const rejection = expect(promise).rejects.toThrow(); await vi.waitFor(() => expect(requests.some(request => request.path === '/slow')).toBe(true)); f.service.invalidate(); await rejection; expect(f.importImage).not.toHaveBeenCalled(); });
  it('imports only canonical embedded raster bytes without any network or local file reads', async () => { const f = fixture(), count = requests.length, result = await f.service.importData('data:image/png;base64,' + png.toString('base64'), owner); expect(await fs.readFile(result.path)).toEqual(png); expect(requests).toHaveLength(count); for (const value of ['file:///etc/passwd', origin + '/image', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,AA=']) await expect(f.service.importData(value, owner)).rejects.toThrow(); });
  it('uses one deadline including identity waits and bounds concurrent requests', async () => { const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.runtime.identity = async () => { await gate; return owner; }; const service = new HyperBookmarkThumbnails(f.runtime), jobs = [service.loadUrl(origin + '/image', owner), service.loadUrl(origin + '/image', owner)]; await expect(service.loadUrl(origin + '/image', owner)).rejects.toThrow('other thumbnail'); release(); await Promise.all(jobs); await expect(service.loadUrl(origin + '/slow', owner)).rejects.toThrow('timed out'); }, 10_000);
  it('blocks changed roots and normalizer dimension/content errors before publication', async () => { const f = fixture(); f.normalize.mockImplementation(() => { revision++; return png; }); await expect(new HyperBookmarkThumbnails(f.runtime).loadUrl(origin + '/image', owner)).rejects.toThrow('changed'); expect(f.importImage).not.toHaveBeenCalled(); f.normalize.mockImplementation(() => Buffer.from('not png')); await expect(new HyperBookmarkThumbnails(f.runtime).loadUrl(origin + '/image', owner)).rejects.toThrow(); expect(f.importImage).not.toHaveBeenCalled(); });
  it('rejects oversized decoded dimensions/pixels and normalized snapshots before managed publication', async () => {
    for (const bytes of [sizedPng(4097, 1), sizedPng(2049, 2049), sizedPng(2048, 2048, true)]) {
      const f = fixture(), service = new HyperBookmarkThumbnails(f.runtime, async () => bytes); await expect(service.loadUrl(origin + '/image', owner)).rejects.toThrow(/pixels|MiB/u); expect(f.importImage).not.toHaveBeenCalled();
    }
  });
});
