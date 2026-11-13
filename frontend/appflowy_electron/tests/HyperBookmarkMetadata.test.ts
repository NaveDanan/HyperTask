import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HyperBookmarkMetadata, HYPER_BOOKMARK_MAX_BYTES, hyperBookmarkRequestUrl, hyperLoadBookmarkHtml } from '../src/main/HyperBookmarkMetadata';
const owner = { actorId: '1', workspaceId: 'workspace' };
describe('Hyper explicit bounded metadata transport', () => {
  let server: http.Server, origin = '', revision = 0; const requests: Array<{ path: string; headers: http.IncomingHttpHeaders }> = [];
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      requests.push({ path: request.url!, headers: request.headers });
      const path = request.url!; response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (path === '/redirect') { response.writeHead(302, { Location: '/final', 'Set-Cookie': 'bookmark-private=secret' }); response.end(); }
      else if (path === '/cycle') { response.writeHead(301, { Location: '/cycle' }); response.end(); }
      else if (path.startsWith('/hop/')) { response.writeHead(302, { Location: '/hop/' + (Number(path.split('/').at(-1)) + 1) }); response.end(); }
      else if (path === '/scheme') { response.writeHead(302, { Location: 'file:///etc/passwd' }); response.end(); }
      else if (path === '/credentials') { response.writeHead(302, { Location: 'https://user:password@example.com' }); response.end(); }
      else if (path === '/switch') { revision++; response.writeHead(302, { Location: '/after-switch' }); response.end(); }
      else if (path === '/large') response.end('x'.repeat(HYPER_BOOKMARK_MAX_BYTES + 1));
      else if (path === '/compressed') { response.setHeader('Content-Encoding', 'gzip'); response.end('not compressed'); }
      else if (path === '/binary') { response.setHeader('Content-Type', 'image/png'); response.end('binary'); }
      else if (path === '/error') { response.writeHead(401); response.end('SECRET provider response'); }
      else if (path === '/slow') { /* Deliberately never finish until client cancels. */ }
      else response.end('<title>Final &amp; private-free</title>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const service = () => new HyperBookmarkMetadata({ revision: () => revision, identity: async () => owner });
  it('follows validated redirects with final URL and never forwards cookie/auth/referrer headers', async () => {
    const result = await service().loadUrl(origin + '/redirect', owner); expect(result.url).toBe(origin + '/final'); expect(result.html).toContain('Final');
    for (const request of requests.filter(request => ['/redirect', '/final'].includes(request.path))) { expect(request.headers.cookie).toBeUndefined(); expect(request.headers.authorization).toBeUndefined(); expect(request.headers.referer).toBeUndefined(); expect(request.headers['accept-encoding']).toBe('identity'); }
  });
  it.each(['/cycle', '/hop/0', '/scheme', '/credentials'])('rejects cycles, hop limits and unsafe redirect targets: %s', async path => { await expect(service().loadUrl(origin + path, owner)).rejects.toThrow(/redirect/); });
  it('rechecks native identity/context before following another hop', async () => {
    await expect(service().loadUrl(origin + '/switch', owner)).rejects.toThrow('changed'); expect(requests.some(request => request.path === '/after-switch')).toBe(false);
    const foreign = { ...owner, actorId: 'another' }; const count = requests.length; await expect(service().loadUrl(origin + '/final', foreign)).rejects.toThrow('changed'); expect(requests).toHaveLength(count);
  });
  it.each(['/large', '/compressed', '/binary', '/error'])('bounds and sanitizes response errors: %s', async path => { await expect(service().loadUrl(origin + path, owner)).rejects.not.toThrow('SECRET'); });
  it('aborts pending requests on context invalidation without publishing partial HTML', async () => {
    const instance = service(), promise = instance.loadUrl(origin + '/slow', owner); await vi.waitFor(() => expect(requests.some(request => request.path === '/slow')).toBe(true)); instance.invalidate(); await expect(promise).rejects.toThrow('cancelled');
  });
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://name:secret@example.com', 'https://example.com\nsecret', 'https://beta.appflowy.cloud'])('rejects unsupported initial URLs without contacting them: %s', value => expect(() => hyperBookmarkRequestUrl(value)).toThrow());
  it('requires exact captured owner payloads and caps concurrent identity checks', async () => {
    await expect(service().loadUrl(origin, { ...owner, token: 'secret' })).rejects.toThrow('captured');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), runtime = { revision: () => 0, identity: async () => { await gate; return owner; } }, loader = vi.fn(async (url: URL) => ({ url: url.href, html: '' })), instance = new HyperBookmarkMetadata(runtime, loader);
    const jobs = Array.from({ length: 4 }, () => instance.loadUrl(origin, owner)); await expect(instance.loadUrl(origin, owner)).rejects.toThrow('other link'); release(); await Promise.all(jobs); expect(loader).toHaveBeenCalledTimes(4);
  });
  it('uses one total deadline for redirects and the final response', async () => {
    await expect(hyperLoadBookmarkHtml(new URL(origin + '/slow'), new AbortController().signal)).rejects.toThrow('timed out');
  }, 10_000);
});
