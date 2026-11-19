import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { HyperBotsEvent } from '@shared/HyperBots';
import type { HyperBotsActive } from './HyperBotsHub';
import { createHyperBotsRpc, type HyperBotsRpcDeps } from './HyperBotsRpc';
import { HYPER_BOTS_HOST_BODY, hyperBotsHostEncode, hyperBotsHostDecode } from './HyperBotsHostWire';
import { toIpcResult } from './settings-error';

const Call = z.strictObject({ channel: z.string().max(80), args: z.unknown().optional() });
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

async function readBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers['content-length']) > HYPER_BOTS_HOST_BODY) throw new Error('Request too large');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > HYPER_BOTS_HOST_BODY) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(hyperBotsHostEncode(body));
}

/** Private deployment boundary. The reverse proxy or SSH tunnel connects to the loopback listener. */
export function createHyperBotsHost(active: HyperBotsActive, token: string, deps: HyperBotsRpcDeps) {
  const expected = Buffer.from('Bearer ' + token);
  const subscribers = new Set<ServerResponse>();
  const rpc = createHyperBotsRpc(deps);
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const auth = Buffer.from(request.headers.authorization ?? '');
    if (!LOOPBACK.has(request.socket.remoteAddress ?? '') || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      reply(response, 401, { error: 'Unauthorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/events') {
      if (subscribers.size >= 8) { reply(response, 503, { error: 'Too many subscribers' }); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
      response.write(': connected\n\n');
      subscribers.add(response);
      response.once('close', () => subscribers.delete(response));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/rpc') { reply(response, 404, { error: 'Unknown route' }); return; }
    let parsed: z.infer<typeof Call>;
    try {
      parsed = Call.parse(hyperBotsHostDecode(await readBody(request)));
    } catch {
      if (!response.destroyed) reply(response, 400, { error: 'Invalid request' });
      return;
    }
    const prepare = rpc.handlers.get(parsed.channel);
    if (!prepare) { reply(response, 404, { error: 'Unknown operation' }); return; }
    reply(response, 200, await toIpcResult(async () => prepare(parsed.args).run(active)));
  };
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (request, response) => {
    void handler(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else reply(response, 500, { error: 'Host error' });
    });
  });
  const broadcast = (frame: string) => {
    for (const response of subscribers) if (!response.write(frame)) response.end();
  };
  const forward = (event: HyperBotsEvent) => broadcast('data: ' + JSON.stringify(event) + '\n\n');
  const heartbeat = setInterval(() => broadcast(': heartbeat\n\n'), 15_000).unref();
  active.runtime.events.on('event', forward);
  return {
    server,
    async close() {
      clearInterval(heartbeat);
      active.runtime.events.off('event', forward);
      for (const response of subscribers) response.end();
      await Promise.all([
        new Promise<void>(resolve => server.close(() => resolve())),
        active.runtime.stop(),
      ]);
    },
  };
}
