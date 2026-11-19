import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { HyperBotsEvent } from '@shared/HyperBots';
import { validateEndpointUrl } from '@shared/openai-endpoint';
import { hyperBotsReadCapped } from './HyperBotsEngine';
import { HyperSseParser } from './HyperSseParser';
import { HyperBotsHostEvent, hyperBotsHostDecode, hyperBotsHostEncode } from './HyperBotsHostWire';
import { SettingsError } from './settings-error';

const Result = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown().optional() }),
  z.object({ ok: z.literal(false), kind: z.enum(['format', 'state', 'unsupported', 'other']), message: z.string().max(4096) }),
]);
const ownerPattern = /^[a-f0-9]{64}$/;
export const HYPER_BOTS_HOST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export class HyperBotsHostClient {
  static fromEnvironment(env: NodeJS.ProcessEnv): HyperBotsHostClient | undefined {
    if (!env.HYPER_BOTS_HOST_URL) return;
    const { HYPER_BOTS_HOST_URL: url, HYPER_BOTS_HOST_TOKEN: token, HYPER_BOTS_HOST_OWNER: owner } = env;
    if (!token || !HYPER_BOTS_HOST_TOKEN_PATTERN.test(token) || !owner || !ownerPattern.test(owner)) {
      throw new SettingsError('format', 'Hyper-Bot host mode requires a host token and a native account key.');
    }
    validateEndpointUrl(url);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !['127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new SettingsError('format', 'Hyper-Bot host mode requires HTTPS or a loopback tunnel.');
    }
    return new HyperBotsHostClient(url.replace(/\/+$/, ''), token, owner);
  }

  constructor(private readonly baseUrl: string, private readonly token: string, private readonly owner: string, private readonly fetcher = globalThis.fetch) {}

  assertOwner(key: string) {
    if (key !== this.owner) throw new SettingsError('state', 'This account does not own the configured Hyper-Bot host.');
  }

  async call(channel: string, args: unknown, lease: AbortSignal): Promise<unknown> {
    const signal = AbortSignal.any([lease, AbortSignal.timeout(75_000)]);
    try {
      const response = await this.fetcher(this.baseUrl + '/rpc', {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
        body: hyperBotsHostEncode({ channel, args }),
      });
      if (response.status === 401) throw new SettingsError('state', 'The Hyper-Bot host rejected its access token.');
      if (!response.ok) throw new Error();
      const result = Result.parse(hyperBotsHostDecode(await hyperBotsReadCapped(response, 24 * 1024 * 1024)));
      lease.throwIfAborted();
      if (!result.ok) throw new SettingsError(result.kind, result.message);
      return result.value;
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw new SettingsError('state', lease.aborted ? 'The HyperTask account changed.' : 'The Hyper-Bot host could not answer.');
    }
  }

  follow(signal: AbortSignal, listener: (event: HyperBotsEvent) => void) {
    const run = async () => {
      while (!signal.aborted) {
        try {
          const attempt = AbortSignal.any([signal, AbortSignal.timeout(70_000)]);
          const response = await this.fetcher(this.baseUrl + '/events', {
            redirect: 'error', signal: attempt, headers: { authorization: 'Bearer ' + this.token },
          });
          if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
            await response.body?.cancel();
            if (response.status === 401) return;
          } else {
            const stream = response.body.getReader();
            try {
              const parser = new HyperSseParser();
              if (!signal.aborted) listener({ type: 'settings' });
              while (!signal.aborted) {
                const chunk = await stream.read();
                if (chunk.done || signal.aborted) break;
                for (const data of parser.push(chunk.value)) {
                  const parsed = HyperBotsHostEvent.safeParse(JSON.parse(data));
                  if (parsed.success && !signal.aborted) listener(parsed.data);
                }
              }
            } finally {
              await stream.cancel().catch(() => {});
              stream.releaseLock();
            }
          }
        } catch { /* The actor can reconnect after a restart or loss of the tunnel. */ }
        await delay(1500, undefined, { signal }).catch(() => {});
      }
    };
    void run();
  }
}
