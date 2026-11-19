import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { HyperBotsEngineError, HyperBotsOpenAIEngine, hyperBotsReadEndpoint, hyperBotsSafeError, type HyperBotsEndpoint } from './HyperBotsEngine';
import type { HyperBotsToolSpec } from './HyperBotsStore';

type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: string };

// A local fake endpoint: tests never reach a real model service.
async function fake(handler: (req: Seen, res: ServerResponse) => void): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { const s = { method: req.method!, url: req.url!, headers: req.headers, body }; seen.push(s); handler(s, res); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const sig = () => new AbortController().signal;
const tool: HyperBotsToolSpec = { type: 'function', function: { name: 'x_tool', description: 'd', parameters: { type: 'object' } } };
const engine = (baseUrl: string, apiKey = '', opts: { timeoutMs?: number; fetch?: typeof fetch } = {}) => {
  const ep: HyperBotsEndpoint = { baseUrl, apiKey, defaultModel: 'dm' };
  return new HyperBotsOpenAIEngine({ endpoint: async () => ep, ...opts });
};
const none = { model: 'm', messages: [], tools: [] };

test('engine posts the expected request and returns plain content', async () => {
  const s = await fake((_r, res) => json(res, 200, { choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }));
  try {
    const out = await engine(`${s.url}/v1/`, 'sk-test').complete({ model: 'm1', messages: [{ role: 'user', content: 'yo' }], tools: [tool] }, sig());
    expect(out).toEqual({ message: { role: 'assistant', content: 'hi' }, finishReason: 'stop' });
    const r = s.seen[0];
    expect([r.method, r.url, r.headers.authorization]).toEqual(['POST', '/v1/chat/completions', 'Bearer sk-test']);
    expect(JSON.parse(r.body)).toEqual({ model: 'm1', messages: [{ role: 'user', content: 'yo' }], stream: false, tools: [tool], tool_choice: 'auto' });
  } finally { await s.close(); }
});

test('engine reads the endpoint on every call', async () => {
  const s = await fake((_r, res) => json(res, 200, { choices: [{ message: { role: 'assistant', content: 'x' } }] }));
  try {
    let key = 'key-one';
    const e = new HyperBotsOpenAIEngine({ endpoint: async () => ({ baseUrl: s.url, apiKey: key, defaultModel: 'd' }) });
    await e.complete(none, sig());
    key = 'key-two';
    await e.complete(none, sig());
    expect(s.seen.map((x) => x.headers.authorization)).toEqual(['Bearer key-one', 'Bearer key-two']);
    const broken = new HyperBotsOpenAIEngine({ endpoint: async () => { throw new HyperBotsEngineError('Set up the model endpoint in Settings → Connections → AI endpoint.'); } });
    await expect(broken.complete(none, sig())).rejects.toThrow(/Settings → Connections → AI endpoint/);
  } finally { await s.close(); }
});

test('engine omits Authorization without apiKey and tools when empty', async () => {
  const s = await fake((_r, res) => json(res, 200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [] } }] }));
  try {
    const out = await engine(`${s.url}/v1`).complete(none, sig());
    expect(s.seen[0].headers.authorization).toBeUndefined();
    const body = JSON.parse(s.seen[0].body);
    expect('tools' in body || 'tool_choice' in body).toBe(false);
    expect(out).toEqual({ message: { role: 'assistant', content: null }, finishReason: null });
  } finally { await s.close(); }
});

test('engine normalizes tool calls (missing ids get call_<uuid>)', async () => {
  const s = await fake((_r, res) => json(res, 200, { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [
    { type: 'function', function: { name: 'a_b', arguments: { x: 1 } } },
    { id: 'call_z', type: 'function', function: { name: 'c', arguments: '{"y":2}' } },
    { id: '', type: 'function', function: { name: 'd' } },
  ] } }] }));
  try {
    const out = await engine(s.url).complete(none, sig());
    const calls = out.message.tool_calls!;
    expect(calls[0].id).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(calls[2].id).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(calls[2].id).not.toBe(calls[0].id);
    expect(calls).toEqual([
      { id: calls[0].id, type: 'function', function: { name: 'a_b', arguments: '{"x":1}' } },
      { id: 'call_z', type: 'function', function: { name: 'c', arguments: '{"y":2}' } },
      { id: calls[2].id, type: 'function', function: { name: 'd', arguments: '{}' } },
    ]);
    expect(out.finishReason).toBe('tool_calls');
  } finally { await s.close(); }
});

test('engine maps HTTP errors, bad JSON and bad shapes to HyperBotsEngineError; the key never leaks', async () => {
  let mode = 0;
  const key = 'sk-SECRET-KEY-42';
  const s = await fake((r, res) => {
    if (mode === 0) json(res, 429, { error: { message: `slow down please, ${r.headers.authorization}` } });
    else if (mode === 1) json(res, 200, 'not json{');
    else if (mode === 2) json(res, 200, { choices: [{ message: { role: 'user', content: 'x' } }] });
    else json(res, 200, { choices: [{ message: { role: 'assistant', content: 5 } }] });
  });
  try {
    const e = engine(s.url, key);
    const run = () => e.complete(none, sig()).then(() => null, (err) => err as HyperBotsEngineError);
    const e0 = await run();
    expect(e0).toBeInstanceOf(HyperBotsEngineError);
    expect(e0?.status).toBe(429);
    expect(e0?.message).toMatch(/slow down please/);
    expect(e0?.message).not.toContain(key);
    mode = 1; expect((await run())?.status).toBe(200);
    mode = 2; expect((await run())?.message).toMatch(/role/);
    mode = 3; expect(await run()).toBeInstanceOf(HyperBotsEngineError);
  } finally { await s.close(); }
});

test('engine redacts the key from transport errors (fetch echoes invalid header values)', async () => {
  const key = 'sk-SECRET\ninjected';
  const err = await engine('http://127.0.0.1:9', key).complete(none, sig()).then(() => null, (e) => e as Error);
  expect(err).toBeInstanceOf(HyperBotsEngineError);
  expect(err!.message).not.toContain('SECRET');
  const echo = await engine('http://x.test', 'sk-ECHOED-KEY', { fetch: async () => { throw new Error('failed with sk-ECHOED-KEY'); } })
    .complete(none, sig()).then(() => null, (e) => e as Error);
  expect(echo!.message).toBe('The model endpoint request failed: failed with [redacted]');
});

test('engine refuses redirects and never follows them', async () => {
  const target = await fake((_r, res) => json(res, 200, { choices: [{ message: { role: 'assistant', content: 'stolen' } }] }));
  const s = await fake((_r, res) => { res.writeHead(307, { location: `${target.url}/x` }); res.end(); });
  try {
    const err = await engine(s.url, 'sk-key').complete(none, sig()).then(() => null, (e) => e as HyperBotsEngineError);
    expect(err).toBeInstanceOf(HyperBotsEngineError);
    expect(err!.status).toBe(307);
    expect(err!.message).toMatch(/redirect/);
    expect(target.seen).toHaveLength(0);
  } finally { await s.close(); await target.close(); }
  let init: RequestInit | undefined;
  const opaque = { type: 'opaqueredirect', status: 0, ok: false, statusText: '', headers: new Headers(), body: null } as unknown as Response;
  const e2 = await engine('http://x.test', '', { fetch: async (_u, i) => { init = i; return opaque; } }).complete(none, sig()).then(() => null, (e) => e as Error);
  expect(init?.redirect).toBe('manual');
  expect(e2).toBeInstanceOf(HyperBotsEngineError);
  expect(e2!.message).toMatch(/redirect/);
});

test('engine times out, honours abort and caps response size', async () => {
  const slow = await fake(() => { /* never answers */ });
  try {
    await expect(engine(slow.url, '', { timeoutMs: 100 }).complete(none, sig())).rejects.toBeInstanceOf(HyperBotsEngineError);
    const ac = new AbortController();
    const p = engine(slow.url).complete(none, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(HyperBotsEngineError);
  } finally { await slow.close(); }
  const big = await fake((_r, res) => { res.writeHead(200); res.end('x'.repeat(3 * 1024 * 1024)); });
  try {
    await expect(engine(big.url).complete(none, sig())).rejects.toThrow(/exceeds/);
  } finally { await big.close(); }
});

test('hyperBotsReadEndpoint parses Settings → Connections → AI endpoint and decrypts the key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hyper-bots-endpoint-'));
  const write = (value: unknown) => { mkdirSync(join(dir, 'local_ai'), { recursive: true }); writeFileSync(join(dir, 'local_ai', 'openai-endpoint.json'), typeof value === 'string' ? value : JSON.stringify(value)); };
  const unprotect = async (p: string) => `plain:${p}`;
  const setup = /Set up the model endpoint in Settings → Connections → AI endpoint\./;
  const base = { base_url: 'https://llm.example.test/v1', model: 'gpt-x', embedding_model: '', image_model: '', protected_key: 'BLOB', enabled: true };
  try {
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toThrow(setup);
    write(base);
    expect(await hyperBotsReadEndpoint(dir, unprotect)).toEqual({ baseUrl: 'https://llm.example.test/v1', apiKey: 'plain:BLOB', defaultModel: 'gpt-x' });
    write({ ...base, protected_key: '' });
    expect((await hyperBotsReadEndpoint(dir, async () => { throw new Error('must not decrypt'); })).apiKey).toBe('');
    write({ ...base, enabled: false });
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toThrow(setup);
    write({ ...base, enabled: undefined });
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toThrow(setup);
    write({ ...base, base_url: '' });
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toThrow(setup);
    write({ ...base, model: '  ' });
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toThrow(setup);
    write('{not json');
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toBeInstanceOf(HyperBotsEngineError);
    write({ ...base, base_url: 'https://user:pw@llm.example.test/v1' });
    await expect(hyperBotsReadEndpoint(dir, unprotect)).rejects.toThrow(/without credentials/);
    write(base);
    await expect(hyperBotsReadEndpoint(dir, async () => { throw new Error('dpapi'); })).rejects.toThrow(/decrypt/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Audit #8: an endpoint that reflects the key into a completion field must not get it into the (persisted) error.
test('audit #8: shape errors never echo response values, so a key reflected into message.role stays secret', async () => {
  const key = 'sk-REFLECTED-0123456789';
  const bodies: unknown[] = [{ choices: [{ message: { role: key, content: 'x' } }] }, { choices: [{ message: { role: `Bearer ${key}`, content: 'x' } }] }, `not json ${key}`];
  for (const body of bodies) {
    const fetch = (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })) as typeof globalThis.fetch;
    const err = await engine('http://x.test', key, { fetch }).complete(none, sig()).then(() => null, (e) => e as Error);
    expect(err).toBeInstanceOf(HyperBotsEngineError);
    expect(err!.message).toMatch(/invalid completion/);
    expect(err!.message).not.toContain('REFLECTED');
  }
});

test('audit #8: hyperBotsSafeError redacts every credential form before it clips', () => {
  const key = 'sk-ABCDEFGH"1234';
  const basic = 'Basic ' + Buffer.from('dana:pa$$word!').toString('base64');
  const text = `${'z'.repeat(490)}${key} Bearer ${key} ${JSON.stringify(key)} ${encodeURIComponent(key)} ${basic} ${basic.slice(6)} dana:pa$$word! pa$$word!`;
  expect(hyperBotsSafeError(text, [key, `Bearer ${key}`, basic], 5000)).not.toMatch(/ABCDEFGH|pa\$\$word|ZGFuYTpw/);
  const clipped = hyperBotsSafeError(text, [key], 500);
  expect(clipped.startsWith('z'.repeat(490) + '[redacted]')).toBe(true);
  expect(clipped).not.toMatch(/sk-A/);
  expect(hyperBotsSafeError('Invalid header value: "Bearer sk-x"', [])).toMatch(/headers were rejected/);
});

// The real Settings → Connections → AI endpoint endpoint refuses /chat/completions for gpt-6.x with exactly this body (seen 2026-11-16).
const CHAT_REFUSED = { error: { message: "Invalid type for 'input': expected a string, but got an object instead.", code: 'invalid_request_body' } };

test('a model the endpoint serves only through /responses runs a full tool loop there, and the route is remembered', async () => {
  const s = await fake((r, res) => {
    if (r.url === '/v1/chat/completions') return json(res, 400, CHAT_REFUSED);
    const body = JSON.parse(r.body);
    if (!body.input.some((i: any) => i.type === 'function_call_output'))
      return json(res, 200, { status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_A', name: 'x_tool', arguments: '{"a":1}' }] });
    json(res, 200, { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] });
  });
  try {
    const e = engine(`${s.url}/v1`, 'sk-test');
    const first = await e.complete({ model: 'gpt-6.1-sol', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }], tools: [tool] }, sig());
    expect(first).toEqual({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_A', type: 'function', function: { name: 'x_tool', arguments: '{"a":1}' } }] }, finishReason: 'tool_calls' });
    expect(s.seen.map((r) => r.url)).toEqual(['/v1/chat/completions', '/v1/responses']);
    expect(JSON.parse(s.seen[1].body)).toEqual({ model: 'gpt-6.1-sol', instructions: 'sys', input: [{ role: 'user', content: 'go' }], store: false, stream: false,
      tools: [{ type: 'function', name: 'x_tool', description: 'd', parameters: { type: 'object' }, strict: false }], tool_choice: 'auto' });
    expect(s.seen[1].headers.authorization).toBe('Bearer sk-test');

    const second = await e.complete({ model: 'gpt-6.1-sol', tools: [tool], messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: first.message.tool_calls }, { role: 'tool', tool_call_id: 'call_A', content: '{"ok":true}' }] }, sig());
    expect(second).toEqual({ message: { role: 'assistant', content: 'done' }, finishReason: 'stop' });
    // Remembered: the refused chat route is not asked again for this model.
    expect(s.seen.map((r) => r.url)).toEqual(['/v1/chat/completions', '/v1/responses', '/v1/responses']);
    expect(JSON.parse(s.seen[2].body).input).toEqual([{ role: 'user', content: 'go' },
      { type: 'function_call', call_id: 'call_A', name: 'x_tool', arguments: '{"a":1}' }, { type: 'function_call_output', call_id: 'call_A', output: '{"ok":true}' }]);
  } finally { await s.close(); }
});

test('an ordinary 400 from /chat/completions is reported, not retried through /responses', async () => {
  const s = await fake((_r, res) => json(res, 400, { error: { message: 'bad model', code: 'model_not_found' } }));
  try {
    await expect(engine(`${s.url}/v1`).complete({ ...none, messages: [{ role: 'user', content: 'x' }] }, sig())).rejects.toThrow(/HTTP 400: .*bad model/);
    expect(s.seen.map((r) => r.url)).toEqual(['/v1/chat/completions']);
  } finally { await s.close(); }
});

test('a failed /responses answer is an engine error that echoes no response values', async () => {
  const s = await fake((r, res) => r.url.endsWith('/chat/completions') ? json(res, 400, CHAT_REFUSED) : json(res, 200, { status: 'failed', error: { message: 'sk-secret leaked' } }));
  try {
    const err = await engine(`${s.url}/v1`, 'sk-secret').complete({ ...none, messages: [{ role: 'user', content: 'x' }] }, sig()).catch((e) => e);
    expect(err).toBeInstanceOf(HyperBotsEngineError);
    expect(err.message).toBe('The model endpoint could not complete the response.');
  } finally { await s.close(); }
});
