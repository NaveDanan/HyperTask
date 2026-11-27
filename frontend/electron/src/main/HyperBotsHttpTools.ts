import { z } from 'zod';
import type { HyperBotsToolName } from '@shared/HyperBots';
import { hyperBotsRedactSecrets, hyperBotsSafeError } from './HyperBotsEngine';
import { hyperBotsParseArgs, type HyperBotsBoundTool } from './HyperBotsOutlookTools';
import { HyperBotsToolError, type HyperBotsBinding } from './HyperBotsRuntime';

export interface HyperBotsHttpAccess { baseUrl: string; authorization: string }
export interface HyperBotsHttpDeps<A extends HyperBotsHttpAccess> {
  access: () => Promise<A>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export interface HyperBotsHttpRequest {
  path: string;
  expectedStatus?: number;
  method?: 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function hyperBotsReadResponse(response: Response, service: string): Promise<string> {
  const maxBytes = 4 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`The ${service} response was too large.`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString('utf8');
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`The ${service} response was too large.`);
    }
    chunks.push(value);
  }
}

export async function hyperBotsHttpRequest(
  service: string, access: HyperBotsHttpAccess, request: HyperBotsHttpRequest, signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch, timeoutMs = 30_000,
): Promise<unknown> {
  const secrets = [access.authorization];
  if (signal.aborted) throw new HyperBotsToolError('refused', `Stopped before the ${service} request was sent.`);
  let response: Response, text: string;
  try {
    response = await fetcher(access.baseUrl + request.path, {
      method: request.method ?? 'GET', redirect: 'manual', credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers: { accept: 'application/json', authorization: access.authorization, ...(request.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw new HyperBotsToolError('refused', `${service} redirected the request. Check the connection URL and credentials.`);
    }
    text = await hyperBotsReadResponse(response, service);
  } catch (error) {
    if (error instanceof HyperBotsToolError) throw error;
    throw new HyperBotsToolError('transport', `${service} request failed. ${hyperBotsSafeError(errorText(error), secrets)}`);
  }
  const sanitized = hyperBotsRedactSecrets(text, secrets);
  if (!response.ok) throw new HyperBotsToolError(response.status >= 500 ? 'transport' : 'refused',
    `${service} returned HTTP ${response.status}. ${hyperBotsSafeError(sanitized, secrets)}`.trim());
  if (request.expectedStatus !== undefined && response.status !== request.expectedStatus) {
    throw new HyperBotsToolError('transport', service + ' returned an unexpected acknowledgement.');
  }
  if (response.status === 204) return null;
  try {
    return JSON.parse(sanitized);
  } catch {
    throw new HyperBotsToolError('transport', `${service} returned an invalid JSON response.`);
  }
}

/** Resolve the current authorization locally and compare it with the approved destination before sending. */
export function hyperBotsHttpTools<A extends HyperBotsHttpAccess>(
  service: string, deps: HyperBotsHttpDeps<A>, binding: (access: A) => HyperBotsBinding,
) {
  const resolve = async () => {
    try { return await deps.access(); }
    catch (error) { throw new HyperBotsToolError('refused', errorText(error)); }
  };
  return <S extends z.ZodType>(options: {
    name: HyperBotsToolName;
    access: 'read' | 'write';
    description: string;
    schema: S;
    summarize: (args: z.output<S>) => string;
    request: (args: z.output<S>, access: A) => HyperBotsHttpRequest;
    result?: (response: unknown, args: z.output<S>, access: A) => unknown;
  }): HyperBotsBoundTool => ({
    name: options.name,
    access: options.access,
    description: options.description,
    parameters: z.toJSONSchema(options.schema, { io: 'input', target: 'draft-7' }),
    parse: args => hyperBotsParseArgs(options.schema, args),
    summarize: args => options.summarize(args as z.output<S>),
    async bind(_args, signal) {
      signal.throwIfAborted();
      return binding(await resolve());
    },
    async run(args, signal, fingerprint) {
      const access = await resolve();
      if (fingerprint && binding(access).fingerprint !== fingerprint) {
        throw new HyperBotsToolError('refused', `The ${service} connection changed after approval.`);
      }
      const parsed = args as z.output<S>;
      const response = await hyperBotsHttpRequest(service, access, options.request(parsed, access), signal, deps.fetch, deps.timeoutMs);
      return options.result ? options.result(response, parsed, access) : response;
    },
  });
}
