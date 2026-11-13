import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import type { HyperAssets } from './HyperAssets';

export function hyperRegisterAssetScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'appflowy-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

export function hyperHandleAssetProtocol(assets: HyperAssets) {
  protocol.handle('appflowy-file', async request => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      const target = await assets.resolve(request.url);
      const response = await net.fetch(pathToFileURL(target).href, { method: request.method, headers: request.headers });
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response(null, { status: 404 }); }
  });
}
