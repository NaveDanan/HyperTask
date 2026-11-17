import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HyperNodEvent } from '@shared/HyperNod';
import { HyperNodClient } from './HyperNodClient';
import { HyperNodError } from './HyperNodAccess';
const TOKEN = 'a'.repeat(64);
const THREAD = '11111111-1111-4111-8111-111111111111';
const TURN = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
let server: http.Server;
let endpoint: string;
let seen: Seen[];
let respond: (seen: Seen, response: http.ServerResponse) => void;
const json = (response: http.ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
const state = { threadId: THREAD, hasEarlierMessages: true, configuration: {}, tasks: [], turns: [{ id: TURN, status: 'running', source: 'user', createdAt: '2026-11-16T10:00:00.000Z' }],
  messages: [{ id: MESSAGE, role: 'user', text: 'raw', displayText: 'Shown', turnId: TURN, createdAt: '2026-11-16T10:00:00.123Z', attachments: [{ id: TURN, name: 'a.png', mimeType: 'image/png', size: 4, url: '/api/artifacts/x' }], reaction: null }] };
beforeEach(async () => {
  seen = [];
  respond = (_, response) => json(response, 404, { error: 'Not found.' });
  endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\hypertask-nod-test-${randomUUID()}` : path.join(os.tmpdir(), `hypertask-nod-test-${randomUUID()}.sock`);
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => { const value = { method: request.method!, url: request.url!, headers: request.headers, body: Buffer.concat(chunks).toString() }; seen.push(value); respond(value, response); });
  });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const client = (readAccess = vi.fn(async () => TOKEN), limits?: { deadlineMs: number; idleMs: number }) => ({ readAccess, nod: new HyperNodClient({ socketPath: async () => endpoint, readAccess }, limits) });
const signal = () => new AbortController().signal;
it('sends the main-owned token and fixed host without a browser origin, and drops unknown fields', async () => {
  respond = (_, response) => json(response, 200, state);
  const { nod } = client();
  const value = await nod.state(signal());
  expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/state' });
  expect(seen[0].headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:4311', accept: 'application/json' });
  expect(seen[0].headers.origin).toBeUndefined();
  expect(value).toEqual({ threadId: THREAD, hasEarlierMessages: true, activity: [], hiddenMessageIds: [], hiddenMessageCount: 0, pendingQuestionIds: null, turns: [{ id: TURN, status: 'running', createdAt: '2026-11-16T10:00:00.000Z', finishedAt: null, error: null }],
    messages: [{ id: MESSAGE, role: 'user', text: 'Shown', turnId: TURN, createdAt: '2026-11-16T10:00:00.123Z', streamId: null, attachments: [{ id: TURN, name: 'a.png', mimeType: 'image/png', size: 4 }], choicesPending: false }] });
});
it('builds exact Nod message bodies for text, choices, written answers and approvals', async () => {
  respond = (_, response) => json(response, 200, { threadId: THREAD, turnId: TURN, messageId: MESSAGE, extra: true });
  const { nod } = client();
  const base = { text: 'Yes', threadId: THREAD, clientMessageId: MESSAGE };
  expect(await nod.send(base, signal())).toEqual({ threadId: THREAD, turnId: TURN, messageId: MESSAGE });
  await nod.send({ ...base, replyToMessageId: TURN, answer: { kind: 'choices', choiceIds: [THREAD], custom: true } }, signal());
  await nod.send({ ...base, replyToMessageId: TURN, answer: { kind: 'written' } }, signal());
  await nod.send({ ...base, replyToMessageId: TURN, answer: { kind: 'approval', approvalId: THREAD, approved: false } }, signal());
  expect(seen.map(row => [row.method, row.url, row.headers['content-type'], JSON.parse(row.body)])).toEqual([
    ['POST', '/api/messages', 'application/json', { ...base, attachmentIds: [] }],
    ['POST', '/api/messages', 'application/json', { ...base, attachmentIds: [], replyToMessageId: TURN, questionAnswer: { choiceIds: [THREAD], custom: true } }],
    ['POST', '/api/messages', 'application/json', { ...base, attachmentIds: [], replyToMessageId: TURN, questionAnswer: { custom: true } }],
    ['POST', '/api/messages', 'application/json', { ...base, attachmentIds: [], replyToMessageId: TURN, approvalAnswer: { approvalId: THREAD, approved: false } }],
  ]);
});
it('pages history with the exact cursor and keeps the server reason on failures', async () => {
  respond = (request, response) => request.url.startsWith('/api/messages?') ? json(response, 409, { error: 'This conversation has been reset. Reload it before continuing.' }) : json(response, 200, {});
  const { nod } = client();
  const failure = await nod.history({ threadId: THREAD, before: '2026-11-16T10:00:00.123+00:00', beforeId: MESSAGE }, signal()).catch(error => error);
  expect(seen[0].url).toBe(`/api/messages?threadId=${THREAD}&before=2026-11-16T10%3A00%3A00.123%2B00%3A00&beforeId=${MESSAGE}`);
  expect(failure).toBeInstanceOf(HyperNodError);
  expect(failure).toMatchObject({ problem: 'operation_failed', status: 409, detail: 'Nod returned 409 for GET /api/messages: This conversation has been reset. Reload it before continuing.' });
});
it('maps refused tokens, refused hosts, missing models and unexpected bodies to specific problems', async () => {
  const { nod, readAccess } = client();
  respond = (_, response) => json(response, 401, { error: 'Enter your server authentication token.' });
  await expect(nod.state(signal())).rejects.toMatchObject({ problem: 'unauthorized', detail: 'Enter your server authentication token.' });
  await expect(nod.state(signal())).rejects.toMatchObject({ problem: 'unauthorized' });
  expect(readAccess).toHaveBeenCalledTimes(2);
  respond = (_, response) => json(response, 403, { error: 'This host is not permitted.' });
  await expect(nod.stop(signal())).rejects.toMatchObject({ problem: 'unsafe_deployment', detail: 'Nod refused POST /api/thread/stop: This host is not permitted.' });
  respond = (_, response) => json(response, 503, { error: 'Configure an agent provider before starting a conversation.' });
  await expect(nod.send({ text: 'x', threadId: THREAD, clientMessageId: MESSAGE }, signal())).rejects.toMatchObject({ problem: 'model_required' });
  respond = (_, response) => json(response, 200, { threadId: 'nope', messages: [], turns: [] });
  await expect(nod.state(signal())).rejects.toMatchObject({ problem: 'operation_failed', detail: expect.stringContaining('unexpected response for GET /api/state') });
  respond = (_, response) => { response.writeHead(302, { location: 'http://example.com/' }); response.end(); };
  await expect(nod.state(signal())).rejects.toMatchObject({ problem: 'unsafe_deployment' });
});
it('reports readiness from health and configuration, including a missing model', async () => {
  let configuration: object = { provider: 'openai', model: 'gpt-x', llmReady: false, modelReconnect: true, modelIssue: { reason: 'Sign in to ChatGPT again.' }, integrationsReady: false, conversationResetEnabled: false };
  respond = (request, response) => json(response, 200, request.url === '/api/health' ? { ok: true } : configuration);
  const { nod } = client();
  expect(await nod.status(signal())).toEqual({ ready: false, problem: 'model_required', provider: 'openai', model: 'gpt-x', detail: 'Sign in to ChatGPT again.' });
  configuration = { ...configuration, llmReady: true };
  expect(await nod.status(signal())).toEqual({ ready: true, problem: 'none', provider: 'openai', model: 'gpt-x' });
  const { nod: unreachable } = client(vi.fn(async () => { throw new HyperNodError('setup_required', 'The Nod self-host .env is missing.'); }));
  expect(await unreachable.status(signal())).toEqual({ ready: false, problem: 'setup_required', detail: 'The Nod self-host .env is missing.' });
});
it('streams validated events with the token and ends when Nod closes the stream', async () => {
  respond = (_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"type":"refresh"}\n\n: keepalive\n\n');
    response.write(`data: {"type":"delta","threadId":"${THREAD}","turnId":"${TURN}","text":"Hel`);
    setTimeout(() => response.end(`lo","streamId":"s1"}\n\n`), 20);
  };
  const { nod } = client();
  const events: HyperNodEvent[] = [];
  await nod.events(signal(), event => events.push(event));
  expect(seen[0]).toMatchObject({ url: '/api/events', headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' } });
  expect(events).toEqual([{ type: 'connected' }, { type: 'refresh' }, { type: 'delta', threadId: THREAD, turnId: TURN, text: 'Hello', streamId: 's1', done: false }]);
});
it('stops an event stream on abort and refuses a non-stream response', async () => {
  respond = (_, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': open\n\n'); };
  const { nod } = client();
  const controller = new AbortController();
  const ended = nod.events(controller.signal, () => {});
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  controller.abort(new Error('closed by test'));
  await expect(ended).rejects.toThrow('closed by test');
  respond = (_, response) => json(response, 200, { ok: true });
  await expect(nod.events(signal(), () => {})).rejects.toMatchObject({ problem: 'operation_failed', status: 200 });
});
it('keeps approval details, hidden message IDs and Nod\'s pending question list', async () => {
  const approval = { id: THREAD, state: 'pending', title: 'Send email', app: 'Gmail', slug: 'gmail', fields: [{ label: 'To', value: 'anna@example.com' }], body: 'Hello Anna', bodyCut: true };
  respond = (_, response) => json(response, 200, { ...state, hiddenMessageIds: [TURN], pendingAnswerChoiceMessageIds: [MESSAGE], messages: [{ ...state.messages[0], role: 'assistant', approval }] });
  const value = await client().nod.state(signal());
  expect(value).toMatchObject({ hiddenMessageIds: [TURN], pendingQuestionIds: [MESSAGE] });
  expect(value.messages[0].approval).toEqual({ id: THREAD, state: 'pending', title: 'Send email', app: 'Gmail', fields: [{ label: 'To', value: 'anna@example.com' }], body: 'Hello Anna', bodyCut: true });
});
it('gives up on an event stream that never opens, and on one that goes silent', async () => {
  respond = () => {};
  await expect(client(undefined, { deadlineMs: 100, idleMs: 200 }).nod.events(signal(), () => {})).rejects.toMatchObject({ problem: 'unreachable', detail: expect.stringContaining('no event stream within 0.1 seconds') });
  respond = (_, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': open\n\n'); };
  const events: HyperNodEvent[] = [];
  await expect(client(undefined, { deadlineMs: 100, idleMs: 200 }).nod.events(signal(), event => events.push(event))).rejects.toMatchObject({ problem: 'unreachable', detail: expect.stringContaining('Nod stopped sending keepalives.') });
  expect(events).toEqual([{ type: 'connected' }]);
});
it('bounds reading a refused event-stream response whose body never finishes', async () => {
  respond = (_, response) => { response.writeHead(503, { 'content-type': 'application/json' }); response.write('{"error":"Nod is start'); };
  await expect(client(undefined, { deadlineMs: 100, idleMs: 200 }).nod.events(signal(), () => {})).rejects.toMatchObject({ problem: 'unreachable' });
});
it('reports an answer Nod no longer waits for, but keeps other conflicts specific', async () => {
  respond = (_, response) => json(response, 409, { error: 'This approval is no longer waiting for an answer.' });
  const { nod } = client();
  const base = { text: 'Send', threadId: THREAD, clientMessageId: MESSAGE, replyToMessageId: TURN };
  await expect(nod.send({ ...base, answer: { kind: 'approval', approvalId: THREAD, approved: true } }, signal())).rejects.toMatchObject({ problem: 'request_unavailable', status: 409, detail: 'Nod returned 409 for POST /api/messages: This approval is no longer waiting for an answer.' });
  await expect(nod.send({ text: 'x', threadId: THREAD, clientMessageId: MESSAGE }, signal())).rejects.toMatchObject({ problem: 'operation_failed', status: 409 });
});
