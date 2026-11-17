import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { endpointApiUrl, shouldUseResponses, validateEndpointUrl } from '@shared/openai-endpoint';
import type { HyperBotsChatMessage, HyperBotsToolCall, HyperBotsToolSpec } from './HyperBotsStore';

export type { HyperBotsChatMessage, HyperBotsToolCall, HyperBotsToolSpec } from './HyperBotsStore';
export type HyperBotsEndpoint = { baseUrl: string; apiKey: string; defaultModel: string };
export type HyperBotsAssistantMessage = Extract<HyperBotsChatMessage, { role: 'assistant' }>;

export const HYPER_BOTS_MAX_BODY = 2 * 1024 * 1024;
const SETUP = 'Set up the model endpoint in Settings → AI.';

export class HyperBotsEngineError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) { super(message); this.name = 'HyperBotsEngineError'; this.status = status; }
}

export interface HyperBotsEngine {
  /** One non-streaming chat completion. Throws HyperBotsEngineError on endpoint, transport, HTTP or shape failures. */
  complete(input: { model: string; messages: HyperBotsChatMessage[]; tools: HyperBotsToolSpec[] }, signal: AbortSignal):
    Promise<{ message: HyperBotsAssistantMessage; finishReason: string | null }>;
}

/** Reads a response body up to `max` bytes; throws if larger. */
export async function hyperBotsReadCapped(res: Response, max = HYPER_BOTS_MAX_BODY): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > max) { await res.body?.cancel().catch(() => {}); throw new Error(`response body exceeds ${max} bytes`); }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Error(`response body exceeds ${max} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function hyperBotsTrim(text: string, n = 500): string {
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

/** Every form a credential can take in error text: as given, an Authorization value's token, a Basic credential decoded, and escaped copies. */
function hyperBotsSecretForms(secrets: Array<string | null | undefined>): string[] {
  const forms = new Set<string>();
  const add = (s: string) => { forms.add(s); forms.add(JSON.stringify(s).slice(1, -1)); try { forms.add(encodeURIComponent(s)); } catch { /* lone surrogate */ } };
  for (const secret of secrets) {
    if (!secret) continue;
    add(secret);
    const auth = /^(basic|bearer)\s+(\S+)\s*$/i.exec(secret);
    if (!auth) continue;
    add(auth[2]);
    if (auth[1].toLowerCase() !== 'basic') continue;
    const plain = Buffer.from(auth[2], 'base64').toString('utf8'), colon = plain.indexOf(':');
    if (colon >= 0) { add(plain); add(plain.slice(colon + 1)); }
  }
  // Longest first, so a full Authorization value is replaced before its token.
  return [...forms].filter(f => f.length >= 4).sort((a, b) => b.length - a.length);
}

/** The one way external error text reaches a message: every secret form is removed BEFORE clipping, so a cut never leaves a prefix. */
export function hyperBotsSafeError(text: string, secrets: Array<string | null | undefined>, max = 500): string {
  // fetch echoes an invalid header value (e.g. a key with a newline) verbatim.
  if (/invalid header value|header value/i.test(text)) return 'the request headers were rejected (check the saved credentials)';
  let t = text;
  for (const form of hyperBotsSecretForms(secrets)) t = t.split(form).join('[redacted]');
  return hyperBotsTrim(t, max);
}

const shapeError = (msg: string, status: number) => new HyperBotsEngineError(`The model endpoint returned an invalid completion: ${msg}`, status);

export class HyperBotsOpenAIEngine implements HyperBotsEngine {
  private readonly endpoint: () => Promise<HyperBotsEndpoint>;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: { endpoint: () => Promise<HyperBotsEndpoint>; fetch?: typeof fetch; timeoutMs?: number }) {
    this.endpoint = opts.endpoint;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async complete(input: { model: string; messages: HyperBotsChatMessage[]; tools: HyperBotsToolSpec[] }, signal: AbortSignal):
    Promise<{ message: HyperBotsAssistantMessage; finishReason: string | null }> {
    const ep = await this.endpoint();
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (ep.apiKey) headers.authorization = `Bearer ${ep.apiKey}`;
    const secrets = [ep.apiKey, headers.authorization];
    const route = `${ep.baseUrl}\n${input.model}`;
    if (!this.responsesOnly.has(route)) {
      const body: Record<string, unknown> = { model: input.model, messages: input.messages, stream: false };
      if (input.tools.length) { body.tools = input.tools; body.tool_choice = 'auto'; }
      const { res, text } = await this.post(ep.baseUrl, 'chat/completions', headers, body, secrets, signal);
      if (res.ok) return parseCompletion(text, res.status);
      // Same rule as Settings → AI's test: some endpoints serve a model only through the Responses API.
      // Nothing ran yet (a refused request), so asking again through /responses cannot repeat any work.
      if (!shouldUseResponses(res.status, text)) throw httpError(res, text, secrets);
      this.responsesOnly.add(route);
    }
    const { res, text } = await this.post(ep.baseUrl, 'responses', headers, hyperBotsResponsesBody(input), secrets, signal);
    if (!res.ok) throw httpError(res, text, secrets);
    return parseResponses(text, res.status);
  }

  /** Models (per base URL) that the endpoint serves only through /responses, learned from its own refusal. */
  private readonly responsesOnly = new Set<string>();

  private async post(baseUrl: string, api: string, headers: Record<string, string>, body: unknown, secrets: string[], signal: AbortSignal): Promise<{ res: Response; text: string }> {
    try {
      // A credential must never follow a redirect: 'manual' surfaces it and it is refused below.
      const res = await this.fetch(endpointApiUrl(baseUrl, api), {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        await res.body?.cancel().catch(() => {});
        throw new HyperBotsEngineError(`The model endpoint answered with a redirect (HTTP ${res.status || 'redirect'}); redirects are refused. Check the base URL in Settings → AI.`, res.status || null);
      }
      return { res, text: await hyperBotsReadCapped(res) };
    } catch (err) {
      if (err instanceof HyperBotsEngineError) throw err;
      throw new HyperBotsEngineError(`The model endpoint request failed: ${hyperBotsSafeError((err as Error)?.message ?? String(err), secrets)}`);
    }
  }
}

const httpError = (res: Response, text: string, secrets: string[]) =>
  new HyperBotsEngineError(`The model endpoint returned HTTP ${res.status}: ${hyperBotsSafeError(text.trim() || res.statusText, secrets)}`, res.status);

/** The same conversation as a Responses API request: system text becomes instructions, tool calls and results become items. */
export function hyperBotsResponsesBody(input: { model: string; messages: HyperBotsChatMessage[]; tools: HyperBotsToolSpec[] }): Record<string, unknown> {
  const instructions: string[] = [];
  const items: unknown[] = [];
  for (const m of input.messages) {
    if (m.role === 'system') instructions.push(m.content);
    else if (m.role === 'user') items.push({ role: 'user', content: m.content });
    else if (m.role === 'tool') items.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content });
    else if (m.role === 'assistant') {
      if (m.content) items.push({ role: 'assistant', content: m.content });
      for (const c of m.tool_calls ?? []) items.push({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments });
    }
  }
  const body: Record<string, unknown> = { model: input.model, input: items, store: false, stream: false };
  if (instructions.length) body.instructions = instructions.join('\n\n');
  if (input.tools.length) {
    // /responses makes function tools strict by default, and a strict model fills every optional field (an "unchanged"
    // description, a 1970 "since"); the tools validate their own arguments, so optional stays optional.
    body.tools = input.tools.map(t => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false }));
    body.tool_choice = 'auto';
  }
  return body;
}

function parseResponses(text: string, status: number): { message: HyperBotsAssistantMessage; finishReason: string | null } {
  let json: any;
  try { json = JSON.parse(text); } catch { throw shapeError('the body is not JSON', status); }
  if (json?.error || json?.status === 'failed') throw new HyperBotsEngineError('The model endpoint could not complete the response.', status);
  if (!Array.isArray(json?.output)) throw shapeError('missing output', status);
  const parts: string[] = [];
  const calls: HyperBotsToolCall[] = [];
  json.output.forEach((item: any, i: number) => {
    if (item?.type === 'message') {
      if (!Array.isArray(item.content)) throw shapeError(`output[${i}].content must be an array`, status);
      for (const part of item.content) if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    } else if (item?.type === 'function_call') {
      if (typeof item.name !== 'string' || !item.name) throw shapeError(`output[${i}].name missing`, status);
      const args = item.arguments === undefined || item.arguments === null ? '{}' : typeof item.arguments === 'object' ? JSON.stringify(item.arguments) : item.arguments;
      if (typeof args !== 'string') throw shapeError(`output[${i}].arguments invalid`, status);
      const id = typeof item.call_id === 'string' && item.call_id ? item.call_id : `call_${randomUUID()}`;
      calls.push({ id, type: 'function', function: { name: item.name, arguments: args } });
    }
  });
  const message: HyperBotsAssistantMessage = { role: 'assistant', content: parts.length ? parts.join('') : null };
  if (calls.length) message.tool_calls = calls;
  return { message, finishReason: calls.length ? 'tool_calls' : json.status === 'incomplete' ? 'length' : 'stop' };
}

function parseCompletion(text: string, status: number): { message: HyperBotsAssistantMessage; finishReason: string | null } {
  // Shape errors name the field only: response values are never echoed (an endpoint can reflect the key into any field).
  let json: any;
  try { json = JSON.parse(text); } catch { throw shapeError('the body is not JSON', status); }
  const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined;
  const m = choice?.message;
  if (!m || typeof m !== 'object') throw shapeError('missing choices[0].message', status);
  if (m.role !== 'assistant') throw shapeError('choices[0].message.role must be "assistant"', status);
  if (m.content !== null && m.content !== undefined && typeof m.content !== 'string') throw shapeError('content must be a string or null', status);
  const message: HyperBotsAssistantMessage = { role: 'assistant', content: typeof m.content === 'string' ? m.content : null };
  if (m.tool_calls !== undefined && m.tool_calls !== null) {
    if (!Array.isArray(m.tool_calls)) throw shapeError('tool_calls must be an array', status);
    const calls: HyperBotsToolCall[] = m.tool_calls.map((c: any, i: number) => {
      const fn = c?.function;
      if (!fn || typeof fn.name !== 'string' || !fn.name) throw shapeError(`tool_calls[${i}].function.name missing`, status);
      let args = fn.arguments;
      if (args === undefined || args === null) args = '{}';
      else if (typeof args === 'object') args = JSON.stringify(args);
      else if (typeof args !== 'string') throw shapeError(`tool_calls[${i}].function.arguments invalid`, status);
      // Missing ids get a unique id: a positional call_0 would collide across steps of one run.
      const id = typeof c.id === 'string' && c.id ? c.id : `call_${randomUUID()}`;
      return { id, type: 'function', function: { name: fn.name, arguments: args } };
    });
    if (calls.length) message.tool_calls = calls;
  }
  const fr = choice.finish_reason;
  return { message, finishReason: typeof fr === 'string' ? fr : null };
}

/** The endpoint from Settings → AI (`<support>/local_ai/openai-endpoint.json`), key decrypted per call. */
export async function hyperBotsReadEndpoint(supportDirectory: string, unprotect: (protectedKey: string) => Promise<string>): Promise<HyperBotsEndpoint> {
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(supportDirectory, 'local_ai', 'openai-endpoint.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    json = parsed as Record<string, unknown>;
  } catch { throw new HyperBotsEngineError(SETUP); }
  const str = (key: string) => (typeof json[key] === 'string' ? (json[key] as string).trim() : '');
  const baseUrl = str('base_url'), model = str('model');
  if (json.enabled !== true || !baseUrl || !model) throw new HyperBotsEngineError(SETUP);
  try { validateEndpointUrl(baseUrl); } catch (e) { throw new HyperBotsEngineError(`${(e as Error).message} (Settings → AI)`); }
  const protectedKey = str('protected_key');
  let apiKey = '';
  if (protectedKey) {
    try { apiKey = await unprotect(protectedKey); } catch { throw new HyperBotsEngineError('Could not decrypt the model endpoint key. Save it again in Settings → AI.'); }
  }
  return { baseUrl, apiKey, defaultModel: model };
}
