#!/usr/bin/env node
// HyperTask native acceptance runner. Original OpenBot notices remain in the ported modules.
import { createRequire } from 'node:module';
import { open, readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eventFromFrame, proveStream, waitForHistoryPair } from './HyperOpenBotBaseline.mjs';

class HyperSmokeError extends Error {}
const fail = message => { throw new HyperSmokeError(message); };
const validId = value => typeof value === 'string' && /^[\w.:-]{1,256}$/.test(value);
const normalize = value => value.replace(/\s+/g, ' ').trim();
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function hyperNativeCdpUrl(value) {
  let url; try { url = new URL(value); } catch { fail('Invalid loopback CDP endpoint'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    fail('CDP must use an explicit HTTP loopback port without credentials, path or query');
  return url.origin;
}

/** A live run belongs to one IPC socket. Join replies and buffered histories prove nothing. */
export function hyperNativeStream(records, threadId, previousRunIds = []) {
  const decoded = records.map(record => ({ socketId: record.socketId, event: eventFromFrame(record.frame, record.delivery, record.at) }));
  const first = decoded.findIndex(row => row.event?.type === 'RUN_STARTED' && row.event.threadId === threadId && !previousRunIds.includes(row.event.runId));
  if (first < 0) fail('No matching new live run was observed');
  const socketId = decoded[first].socketId, runId = decoded[first].event.runId;
  if (!validId(socketId)) fail('Live IPC socket identity is missing');
  const events = [];
  for (const row of decoded.slice(first)) {
    if (row.socketId !== socketId || !row.event) continue;
    // Drop the routing topic before it can enter an artifact.
    const { channelTopic: _topic, ...event } = row.event;
    events.push(event);
    if (event.type === 'RUN_FINISHED' && event.threadId === threadId && event.runId === runId) break;
  }
  const proof = proveStream(events, threadId, runId);
  return { runId, ...proof, textDeliveries: events.filter(event => event.type === 'TEXT_MESSAGE_CONTENT').length, events };
}

export function hyperValidateNativeBefore(value) {
  if (value?.version !== 1 || value.phase !== 'before' || value.status !== 'passed' || !Number.isSafeInteger(value.appPid) || !Number.isSafeInteger(value.corePid) || !/^[a-f0-9]{64}$/.test(value.profileDigest ?? '') || ![value.nativeViewId, value.channelId, value.threadId, value.botId].every(validId) || !Array.isArray(value.turns) || value.turns.length !== 2)
    fail('Invalid native before-phase evidence');
  if (value.turns.some(turn => ![turn.runId, turn.messages?.user?.id, turn.messages?.assistant?.id].every(validId) || typeof turn.prompt !== 'string' || typeof turn.answer !== 'string' || turn.prompt.length > 4096 || turn.answer.length > 1024 * 1024 || turn.messages.user.text !== turn.prompt || turn.messages.assistant.text !== turn.answer))
    fail('Invalid native turn identities or text');
  if (typeof value.model?.model !== 'string' || !value.model.model || value.model.model.length > 256 || !(value.model.effort === null || typeof value.model.effort === 'string')) fail('Invalid saved model selection');
  for (const identifiers of [value.turns.map(turn => turn.runId), value.turns.map(turn => turn.messages.user.id), value.turns.map(turn => turn.messages.assistant.id)])
    if (new Set(identifiers).size !== 2) fail('Native evidence must contain two distinct turns');
  return {
    appPid: value.appPid, corePid: value.corePid, profileDigest: value.profileDigest,
    nativeViewId: value.nativeViewId, channelId: value.channelId, threadId: value.threadId, botId: value.botId,
    model: { model: value.model.model, effort: value.model.effort },
    turns: value.turns.map(turn => {
      const proof = proveStream(turn.events, value.threadId, turn.runId);
      if (proof.answer !== turn.answer || proof.messageId !== turn.messages.assistant.id) fail('Before evidence differs from its live stream proof');
      return { runId: turn.runId, messageId: proof.messageId, prompt: turn.prompt, answer: turn.answer, textDeliveries: turn.events.filter(event => event.type === 'TEXT_MESSAGE_CONTENT').length,
        messages: { user: { id: turn.messages.user.id, role: 'user', text: turn.prompt }, assistant: { id: proof.messageId, role: 'assistant', text: turn.answer } } };
    }),
  };
}

const HELP = `HyperTask native OpenBot smoke test

Requires an already running DISPOSABLE native HyperTask profile and installed Playwright.
Creates a new conversation and two real model turns in the before phase. Never accepts terms,
reads credentials, changes action policy, restarts services or closes the native app.

node scripts/HyperNativeOpenBotSmoke.mjs --phase before --status <owned-launch-status.json>
  --playwright-module <absolute-playwright-core-module> --agent "Personal Assistant"
  --output <new-private-evidence.json> --allow-test-data

Restart that owned app/core with its original profile, then run:
node scripts/HyperNativeOpenBotSmoke.mjs --phase after --status <updated-launch-status.json>
  --playwright-module <absolute-playwright-core-module> --before <before-evidence.json>
  --output <new-private-after.json> --allow-test-data

Optional before flags: --model <catalogue-id> --effort <supported-effort>.
Uses the existing selected/default model unless supplied; exercises a switch through another
available model first. Output files are exclusively created with mode 0600. The status file
must identify this checkout's Electron process, disposable profile, PID and debugPort.
Linux development connection only. No browser install or download is performed.`;

function argumentsOf(argv) {
  const allowed = new Set(['phase', 'status', 'playwright-module', 'agent', 'output', 'before', 'model', 'effort']);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (argv[i] === '--help' || argv[i] === '--allow-test-data') { result[name] = true; continue; }
    if (!argv[i].startsWith('--') || !allowed.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--') || result[name] !== undefined) fail('Unknown, duplicate or incomplete argument');
    result[name] = argv[++i];
  }
  if (result.help) return result;
  if (!['before', 'after'].includes(result.phase) || !result.status || !result.output || !result['playwright-module'] || !result['allow-test-data'] || (result.phase === 'before' && !result.agent) || (result.phase === 'after' && !result.before)) fail('Missing required native smoke arguments; use --help');
  return result;
}

async function ownedLaunch(file) {
  if (process.platform !== 'linux') fail('This native development runner currently supports Linux only');
  const status = JSON.parse(await readFile(file, 'utf8'));
  if (!Number.isSafeInteger(status.pid) || status.pid < 1 || !Number.isInteger(status.debugPort) || status.debugPort < 1 || status.debugPort > 65535 || typeof status.profile !== 'string' || !/^[a-f0-9]{40}$/.test(status.buildHead ?? '')) fail('Invalid owned launch status');
  const cmdline = (await readFile(`/proc/${status.pid}/cmdline`)).toString().split('\0');
  if (!cmdline.includes(appDirectory) || !cmdline.includes(`--user-data-dir=${resolve(status.profile, 'electron')}`) || !cmdline.includes(`--remote-debugging-port=${status.debugPort}`)) fail('Status does not identify this checkout and its owned profile');
  let children = [];
  const deadline = Date.now() + 30000;
  do {
    process.kill(status.pid, 0);
    children = [];
    for (const pid of await readdir('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const [comm, stat] = await Promise.all([readFile(`/proc/${pid}/comm`, 'utf8'), readFile(`/proc/${pid}/stat`, 'utf8')]);
        if (comm.trim() === 'appflowy_core' && Number(stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[1]) === status.pid) children.push(Number(pid));
      } catch { /* Other processes may exit during inventory. */ }
    }
    if (children.length) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  if (children.length !== 1) fail('Expected one existing native core owned by the test window');
  return { ...status, corePid: children[0], profileDigest: createHash('sha256').update(resolve(status.profile)).digest('hex') };
}

async function jsonFromNative(page, path) {
  return page.evaluate(async path => {
    const api = window.appflowy.hyperOpenBot, id = crypto.randomUUID(), chunks = [];
    let release, timer;
    const body = new Promise((resolve, reject) => {
      const stop = error => { release?.(); clearTimeout(timer); api.cancel(id); reject(new Error(error)); };
      timer = setTimeout(() => stop('Native history request timed out'), 30000);
      release = api.onChunk(event => {
        if (event.id !== id) return;
        if (event.error) { stop('Native history request failed'); return; }
        if (event.chunk) chunks.push(new Uint8Array(event.chunk));
        if (event.done) {
          release(); clearTimeout(timer);
          const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
          let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          try { resolve(JSON.parse(new TextDecoder().decode(bytes))); } catch { reject(new Error('Native history response was not JSON')); }
        }
      });
    });
    // Attach the rejection handler before the IPC invocation can fail or time out.
    void body.catch(() => {});
    try { const response = await api.start({ id, path, method: 'GET' }); return { status: response.status, value: await body }; }
    finally { release?.(); clearTimeout(timer); api.cancel(id); }
  }, path);
}

async function renderedTurn(page, messages) {
  for (const message of [messages.user, messages.assistant]) {
    await page.waitForFunction(({ id, text }) => {
      const row = document.querySelector(`[data-message-id="${id}"]`);
      return row && row.innerText.replace(/\s+/g, ' ').trim() === text.replace(/\s+/g, ' ').trim();
    }, { id: message.id, text: message.text }, { timeout: 30000 });
  }
}

async function waitModel(page, channelId, wanted) {
  const deadline = Date.now() + 30000;
  do {
    const saved = await jsonFromNative(page, `/api/channels/${encodeURIComponent(channelId)}/model`);
    if (saved.status === 200 && saved.value.model === wanted.model && saved.value.effort === wanted.effort) return saved.value;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  fail('Native model selection was not persisted');
}

async function waitReadiness(page) {
  const deadline = Date.now() + 120000;
  do {
    const state = await page.evaluate(() => window.appflowy.hyperOpenBot.service.state());
    if (state.ready && state.phase === 'idle') return;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  fail('Native AI readiness did not recover within the smoke deadline');
}

async function observeTurn(page, channel, prompt, previousRunIds) {
  await page.evaluate(() => {
    window.__hyperSmokeRelease?.();
    window.__hyperSmokeFrames = [];
    let delivery = 0;
    window.__hyperSmokeRelease = window.appflowy.hyperOpenBot.onSocket(event => {
      if (event.type !== 'message' || typeof event.data !== 'string') return;
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      if (!Array.isArray(frame) || frame.length !== 5 || frame[3] !== 'ag_ui_event' || !['RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END'].includes(frame[4]?.type)) return;
      if (window.__hyperSmokeFrames.length >= 10000) return;
      window.__hyperSmokeFrames.push({ socketId: event.id, frame: event.data, delivery: ++delivery, at: new Date().toISOString() });
    });
  });
  try {
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.waitForFunction(() => window.__hyperSmokeFrames.some(record => ['RUN_FINISHED', 'RUN_ERROR'].includes(JSON.parse(record.frame)[4].type)), null, { timeout: 120000 });
    const proof = hyperNativeStream(await page.evaluate(() => window.__hyperSmokeFrames), channel.threadId, previousRunIds);
    await page.getByRole('button', { name: 'Stop generating', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
    // No prior prompt ID exists for a newly submitted UI turn. The authoritative read establishes it.
    const history = await waitForHistoryPair(() => jsonFromNative(page, `/api/copilotkit/threads/${encodeURIComponent(channel.threadId)}/messages?agentId=${encodeURIComponent(channel.agentIds[0])}`), prompt, proof.answer);
    if (history.messages.assistant.id !== proof.messageId) fail('Saved reply differs from the live assistant identity');
    await renderedTurn(page, history.messages);
    return { ...proof, prompt, messages: history.messages };
  } finally { await page.evaluate(() => { window.__hyperSmokeRelease?.(); delete window.__hyperSmokeRelease; delete window.__hyperSmokeFrames; }).catch(() => {}); }
}

async function run(args) {
  const launch = await ownedLaunch(args.status);
  const endpoint = hyperNativeCdpUrl(`http://127.0.0.1:${launch.debugPort}`);
  const before = args.phase === 'after' ? hyperValidateNativeBefore(JSON.parse(await readFile(args.before, 'utf8'))) : undefined;
  if (before && (before.profileDigest !== launch.profileDigest || before.appPid === launch.pid || before.corePid === launch.corePid)) fail('After phase requires a real app/core restart with the same profile');
  const output = await open(resolve(args.output), 'wx', 0o600);
  const result = { version: 1, phase: args.phase, status: 'running', startedAt: new Date().toISOString(), buildRevision: launch.buildHead, appPid: launch.pid, corePid: launch.corePid, profileDigest: launch.profileDigest, actualElectronWindow: true, pageErrors: [] };
  let page;
  try {
    const modulePath = resolve(args['playwright-module']);
    const { chromium } = createRequire(pathToFileURL(modulePath))(modulePath);
    const browser = await chromium.connectOverCDP(endpoint);
    const pages = browser.contexts().flatMap(context => context.pages());
    page = pages.find(candidate => candidate.url() === pathToFileURL(resolve(appDirectory, 'out/renderer/index.html')).href);
    if (!page) fail('The owned native renderer was not found');
    page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', () => result.pageErrors.push('Renderer exception'));
    if (!await page.evaluate(() => navigator.userAgent.includes('Electron/') && typeof window.appflowy?.core?.request === 'function')) fail('Expected the native HyperTask app');
    if (!await page.getByRole('navigation', { name: 'OpenBot', exact: true }).isVisible()) await page.locator('button[aria-label="Chat"]').click();
    await waitReadiness(page);
    if (args.phase === 'before') {
      await page.getByRole('button', { name: 'Bots', exact: true }).click();
      const previous = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('hyper-openbot.channel.'))));
      const bot = page.locator('article').filter({ has: page.getByRole('button', { name: args.agent, exact: true }) });
      await bot.getByRole('button', { name: 'Chat', exact: true }).click();
      await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
      const selected = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('hyper-openbot.channel.')));
      const changed = selected.filter(([key, value]) => previous[key] !== value);
      if (changed.length !== 1) fail('Expected exactly one new conversation in one native view');
      result.nativeViewId = changed[0][0].slice('hyper-openbot.channel.'.length); result.channelId = changed[0][1];
    } else { result.nativeViewId = before.nativeViewId; result.channelId = before.channelId; }
    const selected = await page.evaluate(key => localStorage.getItem(key), `hyper-openbot.channel.${result.nativeViewId}`);
    if (selected !== result.channelId) fail('Native view lost its saved channel');
    const response = await jsonFromNative(page, `/api/channels/${encodeURIComponent(result.channelId)}`), channel = response.value.channel;
    if (response.status !== 200 || channel?.id !== result.channelId || !validId(channel.threadId) || !Array.isArray(channel.agentIds) || channel.agentIds.length !== 1 || !validId(channel.agentIds[0])) fail('Invalid authoritative native channel mapping');
    result.threadId = channel.threadId; result.botId = channel.agentIds[0];
    if (before && (before.threadId !== result.threadId || before.botId !== result.botId)) fail('Saved thread or agent changed after app restart');
    const modelControl = page.getByRole('combobox', { name: 'Model', exact: true }); await modelControl.waitFor();
    if (args.phase === 'before') {
      const catalogue = await jsonFromNative(page, '/api/models');
      const options = catalogue.value.models?.filter(model => !model.disabled);
      const initial = await jsonFromNative(page, `/api/channels/${encodeURIComponent(result.channelId)}/model`);
      const wanted = options?.find(model => model.id === (args.model || initial.value.model || catalogue.value.default));
      const alternate = options?.find(model => model.id !== wanted?.id);
      if (catalogue.status !== 200 || initial.status !== 200 || !wanted || !alternate) fail('Smoke selection requires the target and another available model');
      for (const choice of [alternate, wanted]) {
        await modelControl.click(); await page.getByRole('option', { name: choice.label, exact: true }).click();
        const deadline = Date.now() + 30000;
        let persisted = false;
        while (Date.now() < deadline) { const saved = await jsonFromNative(page, `/api/channels/${encodeURIComponent(result.channelId)}/model`); if (saved.status === 200 && saved.value.model === choice.id) { persisted = true; break; } await page.waitForTimeout(100); }
        if (!persisted) fail('An exercised model switch was not persisted');
        await modelControl.waitFor({ state: 'visible' });
      }
      const effort = args.effort ?? (wanted.efforts?.includes('low') ? 'low' : null);
      if (effort !== null) {
        if (!wanted.efforts?.includes(effort)) fail('Requested effort is not supported by the selected model');
        const label = ({ xhigh: 'Extra high', none: 'None', low: 'Low', medium: 'Medium', high: 'High', max: 'Max', minimal: 'Minimal' })[effort];
        if (!label) fail('Unsupported smoke effort label');
        await page.getByRole('combobox', { name: 'Thinking effort', exact: true }).click(); await page.getByRole('option', { name: label, exact: true }).click();
      }
      const saved = await jsonFromNative(page, `/api/channels/${encodeURIComponent(result.channelId)}/model`);
      result.model = await waitModel(page, result.channelId, { model: wanted.id, effort: effort ?? saved.value.effort });
      result.modelSwitchVerified = true;
      const marker = randomUUID(); result.turns = [];
      result.turns.push(await observeTurn(page, channel, `HyperTask native smoke ${marker}: Write four short plain-text paragraphs about organizing a reading list. Do not use tools.`, []));
      result.turns.push(await observeTurn(page, channel, `HyperTask follow-up ${marker}: Give two brief practical examples for that same reading list. Use plain text and no tools.`, result.turns.map(turn => turn.runId)));
    } else {
      result.model = await waitModel(page, result.channelId, before.model); result.turns = before.turns;
      for (const turn of before.turns) {
        const read = () => jsonFromNative(page, `/api/copilotkit/threads/${encodeURIComponent(result.threadId)}/messages?agentId=${encodeURIComponent(result.botId)}`);
        await waitForHistoryPair(read, turn.prompt, turn.answer, turn.messages); await renderedTurn(page, turn.messages);
      }
      result.sameNativeViewChannelThreadAndMessageIds = true; result.noReplacementPromptSent = true;
    }
    if (await page.getByRole('article', { name: 'System', exact: true }).count()) fail('Internal system instructions are visible in the transcript');
    if (result.pageErrors.length) fail('Native renderer reported an exception');
    result.status = 'passed'; result.finishedAt = new Date().toISOString();
    await output.writeFile(JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ phase: result.phase, status: result.status, buildRevision: result.buildRevision, textDeliveries: result.turns.map(turn => turn.textDeliveries), pageErrors: result.pageErrors.length }) + '\n');
  } catch (error) {
    await output.writeFile(JSON.stringify({ ...result, status: 'failed', error: error instanceof HyperSmokeError ? error.message : 'Native smoke operation failed; inspect the disposable app privately' }, null, 2) + '\n');
    throw error;
  } finally { await output.close(); }
  // Deliberately never browser.close(): the CDP connection belongs to the real native app.
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const args = argumentsOf(process.argv.slice(2)); if (args.help) process.stdout.write(HELP + '\n'); else await run(args); process.exit(0); }
  catch (error) { process.stderr.write((error instanceof HyperSmokeError ? error.message : 'Native smoke failed; inspect the disposable app and private evidence') + '\n'); process.exit(1); }
}
