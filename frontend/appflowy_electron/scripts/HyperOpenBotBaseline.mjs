#!/usr/bin/env node
import { createRequire } from 'node:module';
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TYPES = new Set(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED', 'RUN_ERROR']);
const id = x => typeof x === 'string' && x.length > 0 && x.length <= 256 && /^[\w.:-]+$/.test(x);
class BaselineError extends Error {}
class HistoryPendingError extends BaselineError {}
const fail = message => { throw new BaselineError(message); };

// CopilotKit core 1.85.0 observes Phoenix's "ag_ui_event" payloads. Decode only that
// single-event envelope or a direct event, never join replies or compacted histories.
// channelTopic is used in memory for routing; artifact() never persists it.
export function eventFromFrame(frame, delivery, at) {
  if (typeof frame !== 'string') return null;
  let e; try { e = JSON.parse(frame); } catch { return null; }
  let channelTopic;
  if (Array.isArray(e)) {
    if (e.length !== 5 || !e.slice(0, 2).every(ref => ref === null || typeof ref === 'string') || typeof e[2] !== 'string' || !e[2] || e[2].length > 1024 || e[3] !== 'ag_ui_event') return null;
    channelTopic = e[2];
    e = e[4];
  }
  if (!e || Array.isArray(e) || typeof e !== 'object' || !TYPES.has(e.type)) return null;
  const out = { type: e.type, delivery, at };
  if (channelTopic !== undefined) out.channelTopic = channelTopic;
  for (const key of ['threadId', 'runId', 'messageId']) if (id(e[key])) out[key] = e[key];
  if (e.type === 'TEXT_MESSAGE_CONTENT' && typeof e.delta === 'string' && e.delta.length) out.delta = e.delta;
  return out;
}

export function proveStream(events, threadId, runId) {
  if (!id(threadId) || !id(runId) || !Array.isArray(events)) fail('Missing run or thread identity');
  let state = 'new', messageId, answer = '', deliveries = new Set(), previousDelivery = 0;
  for (const e of events) {
    if (!e || !TYPES.has(e.type) || !Number.isSafeInteger(e.delivery) || e.delivery < 1 || !Number.isFinite(Date.parse(e.at))) fail('Malformed live observation');
    if (e.delivery <= previousDelivery) fail('Malformed live observation order');
    previousDelivery = e.delivery;
    if ((e.threadId !== undefined && e.threadId !== threadId) || (e.runId !== undefined && e.runId !== runId)) fail('Live event belongs to another run or thread');
    if (state === 'finished') fail('Events after run finish');
    if (e.type === 'RUN_ERROR') fail('Run reported an error');
    if (e.type === 'RUN_STARTED') {
      if (state !== 'new' || e.threadId !== threadId || e.runId !== runId) fail('Wrong or duplicate run start');
      state = 'started';
    } else if (e.type === 'TEXT_MESSAGE_START') {
      if (state !== 'started' || !id(e.messageId)) fail('Invalid message start');
      messageId = e.messageId; state = 'text';
    } else if (e.type === 'TEXT_MESSAGE_CONTENT') {
      if (state !== 'text' || e.messageId !== messageId || typeof e.delta !== 'string' || !e.delta.length) fail('Invalid message delta');
      answer += e.delta; deliveries.add(e.delivery);
    } else if (e.type === 'TEXT_MESSAGE_END') {
      if (state !== 'text' || e.messageId !== messageId) fail('Invalid message end');
      state = 'ended';
    } else if (e.type === 'RUN_FINISHED') {
      if (state !== 'ended' || e.threadId !== threadId || e.runId !== runId) fail('Invalid run finish');
      state = 'finished';
    }
  }
  if (state !== 'finished' || deliveries.size < 2 || !answer.trim()) fail('Streaming proof unavailable: need a completed answer across at least two distinct live deliveries');
  return { messageId, answer };
}

export function historyPair(status, body, prompt, answer, expected) {
  if (status < 200 || status >= 300 || !body || !Array.isArray(body.messages) || !body.messages.length) fail('Authoritative history unavailable or malformed');
  if (body.messages.some(m => !m || !id(m.id) || typeof m.role !== 'string')) fail('Malformed history message');
  const users = body.messages.filter(m => m.role === 'user' && m.content === prompt);
  const assistants = body.messages.filter(m => m.role === 'assistant' && m.content === answer);
  if (users.length !== 1 || assistants.length !== 1) throw new HistoryPendingError('History does not contain the exact prompt and answer');
  const user = { id: users[0].id, role: 'user', text: prompt };
  const assistant = { id: assistants[0].id, role: 'assistant', text: answer };
  if (expected && (expected.user.id !== user.id || expected.assistant.id !== assistant.id)) fail('History message IDs changed');
  return { user, assistant };
}

// RUN_FINISHED precedes Intelligence's final history write. Wait for that write,
// retaining exact text/identity checks and a deadline for every HTTP request.
export async function waitForHistoryPair(read, prompt, answer, expected, timeout = 30000) {
  const started = Date.now(), deadline = started + timeout;
  let attempts = 0;
  while (Date.now() < deadline) {
    const response = await read(Math.max(1, deadline - Date.now()));
    attempts++;
    try {
      const messages = historyPair(response.status, response.value, prompt, answer, expected);
      if (Date.now() >= deadline) break;
      return { status: response.status, messages, attempts, elapsedMs: Date.now() - started };
    } catch (error) {
      if (!(error instanceof HistoryPendingError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
  fail('Authoritative history did not settle to the exact prompt, answer and message IDs before the deadline');
}

// The original transcript identifies each row by its saved message ID. Markdown
// paragraphs live in separate elements, so getByText cannot match a whole reply.
export async function waitForTranscriptMessage(log, messageId, text, timeout = 30000) {
  if (!id(messageId) || typeof text !== 'string' || !text.trim()) fail('Invalid transcript message');
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  const row = log.locator(`[data-message-id="${messageId}"]`);
  const deadline = Date.now() + timeout;
  await row.waitFor({ state: 'visible', timeout });
  while (Date.now() < deadline) {
    const actual = await row.innerText({ timeout: Math.max(1, deadline - Date.now()) });
    if (normalize(actual) === normalize(text) && await row.isVisible()) return;
    await log.page().waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  fail('Original transcript message does not display the expected text');
}

export function artifact(data) {
  return { version: 1, phase: data.phase, observedAt: data.observedAt, limits: { stream: data.phase === 'before' ? 'live_observation' : 'copied_from_before', providerAuthenticity: 'not_verified', serviceRestart: 'not_verified' }, channelId: data.channelId, threadId: data.threadId, botId: data.botId, runId: data.runId, prompt: data.prompt, answer: data.answer, messages: { user: { id: data.messages.user.id, role: 'user', text: data.prompt }, assistant: { id: data.messages.assistant.id, role: 'assistant', text: data.answer } }, statuses: { channel: data.statuses.channel, messages: data.statuses.messages }, events: data.events.map(e => { const o = { type: e.type, delivery: e.delivery, at: e.at }; for (const k of ['threadId', 'runId', 'messageId', 'delta']) if (e[k] !== undefined) o[k] = e[k]; return o; }) };
}

const HELP = `HyperOpenBotBaseline: narrow original-client observations, not issue #4 acceptance.
Usage:
  node HyperOpenBotBaseline.mjs before --url URL --client-root PATH --bot-id ID --output PATH [--storage-state PATH]
  node HyperOpenBotBaseline.mjs after --url URL --client-root PATH --before PATH --output PATH [--storage-state PATH]
URL must be a loopback HTTP(S) origin. Output is exclusive-created. Install the upstream
Playwright package and its Chromium browser separately in client-root. The same session is required.
The operator must independently verify the real provider, lifecycle, both restarts and preserved stores.
Supports direct AG-UI frames and Phoenix v2 ag_ui_event frames; batches and other transports fail closed.`;

function argsOf(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const phase = argv.shift(); if (!['before', 'after'].includes(phase)) fail('Choose before or after; use --help');
  const options = {}; const allowed = new Set(['url', 'client-root', 'bot-id', 'output', 'storage-state', 'before']);
  while (argv.length) { const k = argv.shift(); if (!k.startsWith('--') || !allowed.has(k.slice(2)) || !argv.length || options[k.slice(2)] !== undefined) fail('Invalid or repeated argument; use --help'); options[k.slice(2)] = argv.shift(); }
  for (const k of ['url', 'client-root', 'output', phase === 'before' ? 'bot-id' : 'before']) if (!options[k]) fail(`Missing --${k}`);
  if ((phase === 'before' && options.before) || (phase === 'after' && options['bot-id'])) fail('Argument is not valid for this phase');
  let u; try { u = new URL(options.url); } catch { fail('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) fail('URL must be a loopback HTTP(S) origin without credentials or path');
  if (phase === 'before' && !id(options['bot-id'])) fail('Invalid bot ID');
  return { phase, options, origin: u.origin };
}

function validateBefore(b) {
  if (!b || b.version !== 1 || b.phase !== 'before' || b.statuses?.channel !== 200 || b.statuses?.messages !== 200 || !id(b.channelId) || !id(b.threadId) || !id(b.botId) || !id(b.runId) || typeof b.prompt !== 'string' || !b.prompt.startsWith('HyperTask baseline ') || typeof b.answer !== 'string' || !b.messages || !b.messages.user || !b.messages.assistant) fail('Invalid before artifact');
  const proof = proveStream(b.events, b.threadId, b.runId);
  if (proof.answer !== b.answer || proof.messageId !== b.messages.assistant.id || b.messages.user.text !== b.prompt || b.messages.assistant.text !== b.answer || !id(b.messages.user.id) || b.messages.user.role !== 'user' || b.messages.assistant.role !== 'assistant') fail('Before artifact is inconsistent');
  return b;
}

async function run({ phase, options, origin }) {
  let before;
  if (phase === 'after') { try { before = validateBefore(JSON.parse(await readFile(options.before, 'utf8'))); } catch { fail('Before artifact unavailable or invalid'); } }
  const req = createRequire(resolve(options['client-root'], 'package.json'));
  let chromium; try { ({ chromium } = req('playwright-core')); } catch { try { ({ chromium } = req('@playwright/test')); } catch { fail('Prerequisite missing: install upstream playwright-core or @playwright/test in --client-root, with Chromium'); } }
  // Reserve the explicitly requested output before making any changes to the deployment.
  const output = await open(options.output, 'wx', 0o600);
  let browser;
  try {
    try { browser = await chromium.launch(); } catch { fail('Prerequisite missing: Playwright Chromium is unavailable'); }
    const context = await browser.newContext(options['storage-state'] ? { storageState: options['storage-state'] } : {});
    context.setDefaultTimeout(30_000);
    context.setDefaultNavigationTimeout(30_000);
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).origin !== origin) fail('App redirected away from the loopback origin');
    const botId = before?.botId ?? options['bot-id'];
    let channelId = before?.channelId, threadId = before?.threadId;
    async function json(method, path, body, timeout = 30000) {
      const response = await context.request[method](origin + path, { ...(body ? { data: body } : {}), maxRedirects: 0, timeout });
      let value; try { value = await response.json(); } catch { fail('API returned malformed JSON'); }
      return { status: response.status(), value };
    }
    if (phase === 'before') {
      const created = await json('post', '/api/channels', { agentIds: [botId] });
      const c = created.value?.channel;
      if (created.status !== 201 || !id(c?.id) || !id(c?.threadId) || !Array.isArray(c.agentIds) || c.agentIds.length !== 1 || c.agentIds[0] !== botId) fail('Channel creation failed or returned an invalid mapping');
      channelId = c.id; threadId = c.threadId;
    }
    let runId, userMessageId, prompt = before?.prompt, answer = before?.answer, events = [], delivery = 0, active = false, socketId = 0, chosenSocket, chosenTopic, unsupported = false;
    page.on('request', request => {
      if (!active || request.method() !== 'POST') return;
      let u; try { u = new URL(request.url()); } catch { return; }
      if (u.origin !== origin || u.pathname !== `/api/copilotkit/agent/${encodeURIComponent(botId)}/run`) return;
      try { const input = request.postDataJSON(); const user = Array.isArray(input.messages) && input.messages.find(m => m.role === 'user' && m.content === prompt); if (input.threadId === threadId && id(input.runId) && user && id(user.id)) { if (runId) unsupported = true; else { runId = input.runId; userMessageId = user.id; } } } catch { unsupported = true; }
    });
    page.on('websocket', ws => { const currentSocket = ++socketId; ws.on('framereceived', ({ payload }) => {
      if (!active) return;
      const e = eventFromFrame(payload, ++delivery, new Date().toISOString());
      if (!e) return;
      if (e.type === 'RUN_STARTED' && runId && e.threadId === threadId && e.runId === runId && chosenSocket === undefined) { chosenSocket = currentSocket; chosenTopic = e.channelTopic; }
      if (chosenSocket === currentSocket && chosenTopic === e.channelTopic) events.push(e);
    }); });
    await page.goto(`${origin}/channel/${encodeURIComponent(channelId)}`, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).origin !== origin || new URL(page.url()).pathname !== `/channel/${encodeURIComponent(channelId)}`) fail('Channel navigation failed');
    const log = page.getByRole('region', { name: 'Messages' }).getByRole('log');
    if (phase === 'before') {
      prompt = `HyperTask baseline ${randomUUID()}: Write four short paragraphs in plain text about organizing a reading list. Do not use tools.`;
      await page.getByRole('textbox', { name: 'Message' }).fill(prompt);
      active = true;
      await page.getByRole('button', { name: 'Send message' }).click();
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline && !events.some(e => e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR')) await page.waitForTimeout(200);
      if (unsupported || !runId || chosenSocket === undefined) fail('Streaming proof unsupported: no matching original run and supported gateway event frames');
      const proof = proveStream(events, threadId, runId); answer = proof.answer;
      await page.getByRole('button', { name: 'Stop the Bot' }).waitFor({ state: 'hidden', timeout: 120000 });
    } else { runId = before.runId; events = before.events; }
    await waitForTranscriptMessage(log, before?.messages.user.id ?? userMessageId, prompt);
    await waitForTranscriptMessage(log, proveStream(events, threadId, runId).messageId, answer);
    const channel = await json('get', `/api/channels/${encodeURIComponent(channelId)}`);
    const c = channel.value?.channel;
    if (channel.status !== 200 || c?.id !== channelId || c?.threadId !== threadId || !Array.isArray(c.agentIds) || c.agentIds.length !== 1 || c.agentIds[0] !== botId) fail('Channel mapping unavailable or changed');
    const expected = before?.messages ?? { user: { id: userMessageId }, assistant: { id: proveStream(events, threadId, runId).messageId } };
    const history = await waitForHistoryPair(timeout => json('get', `/api/copilotkit/threads/${encodeURIComponent(threadId)}/messages?agentId=${encodeURIComponent(botId)}`, undefined, timeout), prompt, answer, expected);
    const messages = history.messages;
    if (phase === 'before' && messages.user.id !== userMessageId) fail('History user ID differs from submitted run');
    if (messages.assistant.id !== proveStream(events, threadId, runId).messageId) fail('Stream and saved assistant IDs differ');
    const result = artifact({ phase, observedAt: new Date().toISOString(), channelId, threadId, botId, runId, prompt, answer, messages, statuses: { channel: channel.status, messages: history.status }, events });
    await output.writeFile(JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(`${phase}: narrow client observations recorded. Real-provider and lifecycle/restart evidence remain required.\n`);
  } finally { await browser?.close(); await output.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const args = argsOf(process.argv.slice(2)); if (args.help) process.stdout.write(HELP + '\n'); else await run(args); }
  catch (e) { process.stderr.write(`Baseline observation failed: ${e instanceof BaselineError ? e.message : 'operation failed; check local prerequisites and session privately'}\n`); process.exitCode = 1; }
}
