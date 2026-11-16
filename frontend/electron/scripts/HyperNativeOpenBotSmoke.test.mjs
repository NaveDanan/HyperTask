import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext, createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as smoke from './HyperNativeOpenBotSmoke.mjs';
import { hyperNativeCdpUrl, hyperNativeRenderedMessage, hyperNativeCompletion, hyperNativeStream, hyperValidateNativeBefore, hyperOwnsNativeCommand, hyperNativeModelId } from './HyperNativeOpenBotSmoke.mjs';

const at = '2026-11-14T00:00:00Z';
function events(runId = 'run-1', messageId = 'message-1') {
  return [
    { type: 'RUN_STARTED', threadId: 'thread-1', runId },
    { type: 'TEXT_MESSAGE_START', messageId },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'Hello ' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'world.' },
    { type: 'TEXT_MESSAGE_END', messageId },
    { type: 'RUN_FINISHED', threadId: 'thread-1', runId },
  ].map((event, i) => ({ ...event, delivery: i + 1, at }));
}
const records = (items = events(), socketId = 'socket-1') => items.map(event => ({ socketId, delivery: event.delivery, at, frame: JSON.stringify([null, null, 'private-routing-topic', 'ag_ui_event', event]) }));

test('wire null means the current default, while missing fields cannot prove a model selection', () => {
  assert.equal(hyperNativeModelId({ model: null }, 'default-model'), 'default-model');
  assert.equal(hyperNativeModelId({ model: 'another-model' }, 'default-model'), 'another-model');
  assert.throws(() => hyperNativeModelId({}, 'default-model'));
});

test('pipe process ownership requires the exact app, profile and session and rejects TCP flags', () => {
  const session = 'a'.repeat(32);
  const args = ['electron', '/checkout/app', '--user-data-dir=/private/smoke/electron', '--remote-debugging-pipe', `--hyper-native-smoke-session=${session}`];
  for (const form of [args, [args.join(' ')]]) {
    assert.ok(hyperOwnsNativeCommand(form, '/checkout/app', '/private/smoke', session));
    assert.ok(!hyperOwnsNativeCommand(form, '/checkout/ap', '/private/smoke', session));
    assert.ok(!hyperOwnsNativeCommand(form, '/checkout/app', '/private/real-user', session));
    assert.ok(!hyperOwnsNativeCommand(form, '/checkout/app', '/private/smoke', 'b'.repeat(32)));
  }
  assert.ok(!hyperOwnsNativeCommand([...args, '--remote-debugging-port=9222'], '/checkout/app', '/private/smoke', session));
});
test('CDP requires a private smoke Unix socket and rejects all TCP endpoints and path escapes', () => {
  assert.equal(hyperNativeCdpUrl('/tmp/hyper-native-smoke-abc/cdp.sock'), 'ws+unix:///tmp/hyper-native-smoke-abc/cdp.sock:/cdp');
  for (const value of ['http://127.0.0.1:9222', 'ws://127.0.0.1:9222/cdp', '/tmp/other/cdp.sock', '/tmp/hyper-native-smoke-abc/../cdp.sock', '/tmp/hyper-native-smoke-abc/cdp.sock:/other']) assert.throws(() => hyperNativeCdpUrl(value));
});
test('live proof ignores other IPC sockets and strips routing metadata', () => {
  const own = records();
  const other = records(events('other-run', 'other-message'), 'socket-2');
  other[0].frame = JSON.stringify([null, null, 'unrelated', 'ag_ui_event', { type: 'RUN_STARTED', threadId: 'other-thread', runId: 'other-run' }]);
  const proof = hyperNativeStream([other[0], own[0], ...other.slice(1), ...own.slice(1)], 'thread-1');
  assert.equal(proof.answer, 'Hello world.'); assert.equal(proof.textDeliveries, 2);
  assert.ok(!JSON.stringify(proof).includes('private-routing-topic'));
});
test('replayed joins, buffered histories and reused runs cannot substitute for new live text', () => {
  assert.throws(() => hyperNativeStream(records(), 'thread-1', ['run-1']));
  assert.throws(() => hyperNativeStream([{ socketId: 'a', delivery: 1, at, frame: JSON.stringify([null, null, 'topic', 'phx_reply', { response: events() }]) }], 'thread-1'));
  assert.throws(() => hyperNativeStream(records(events().filter(event => event.type !== 'TEXT_MESSAGE_CONTENT')), 'thread-1'));
  assert.throws(() => hyperNativeStream(records(events(), undefined).map(record => ({ ...record, socketId: undefined })), 'thread-1'));
});
function before() {
  return { version: 1, phase: 'before', status: 'passed', appPid: 10, corePid: 11, profileDigest: 'a'.repeat(64), nativeViewId: 'view', channelId: 'channel', threadId: 'thread-1', botId: 'bot', model: { model: 'model', effort: 'low' },
    turns: [1, 2].map(n => ({ runId: `run-${n}`, prompt: `prompt-${n}`, answer: 'Hello world.', events: events(`run-${n}`, `message-${n}`), messages: { user: { id: `user-${n}`, text: `prompt-${n}` }, assistant: { id: `message-${n}`, text: 'Hello world.' } } })) };
}
test('restart input requires distinct turns consistent with their stream and discards unknown fields', () => {
  const value = before(); value.secret = 'not-a-real-secret'; value.turns[0].secret = 'not-a-real-secret';
  assert.equal(hyperValidateNativeBefore(value).turns.length, 2);
  assert.ok(!JSON.stringify(hyperValidateNativeBefore(value)).includes('secret'));
  const reused = before(); reused.turns[1] = reused.turns[0]; assert.throws(() => hyperValidateNativeBefore(reused));
  const altered = before(); altered.turns[0].answer = altered.turns[0].messages.assistant.text = 'Changed text'; assert.throws(() => hyperValidateNativeBefore(altered));
  const wrong = before(); wrong.turns[0].messages.user.id = '../escape'; assert.throws(() => hyperValidateNativeBefore(wrong));
});
test('completion waits for the selected new run on its own socket and thread', () => {
  const pending = records(events().slice(0, -1), 'a');
  const terminal = (socketId, runId, threadId = 'thread-1', type = 'RUN_FINISHED') => ({ socketId, delivery: 20, at, frame: JSON.stringify([null, null, 'private-routing-topic', 'ag_ui_event', { type, runId, threadId }]) });
  const interleaved = [...pending, terminal('another-socket', 'run-1'), terminal('a', 'another-run'), terminal('a', 'run-1', 'another-thread')];
  assert.equal(hyperNativeCompletion({ records: interleaved, threadId: 'thread-1', previousRunIds: [] }), false);
  assert.throws(() => hyperNativeStream(interleaved, 'thread-1'));
  assert.equal(hyperNativeCompletion({ records: [...interleaved, terminal('a', 'run-1')], threadId: 'thread-1', previousRunIds: [] }), true);
  assert.equal(hyperNativeCompletion({ records: [...pending, terminal('a', 'run-1', 'thread-1', 'RUN_ERROR')], threadId: 'thread-1', previousRunIds: [] }), true);
  assert.equal(hyperNativeCompletion({ records: [...pending, terminal('a', 'run-1')], threadId: 'thread-1', previousRunIds: ['run-1'] }), false);
});
test('rendered proof requires exact text or the same numbered list structure and item text', () => {
  const text = '1. First example.\n\n2. Second example.';
  const rendered = { text: 'First example.\n\nSecond example.', lists: [{ start: 1, items: ['First example.', 'Second example.'] }] };
  assert.equal(hyperNativeRenderedMessage({ text, rendered }), true);
  assert.equal(hyperNativeRenderedMessage({ text, rendered: { ...rendered, lists: [] } }), false);
  assert.equal(hyperNativeRenderedMessage({ text, rendered: { ...rendered, lists: [{ ...rendered.lists[0], start: 2 }] } }), false);
  assert.equal(hyperNativeRenderedMessage({ text, rendered: { text: 'First example.', lists: [{ start: 1, items: ['First example.'] }] } }), false);
  assert.equal(hyperNativeRenderedMessage({ text: 'Plain paragraph.', rendered: { text: 'Plain paragraph.', lists: [] } }), true);
  const consecutive = '1. First example.\n2. Second example.';
  assert.equal(hyperNativeRenderedMessage({ text: consecutive, rendered }), true);
  assert.equal(hyperNativeRenderedMessage({ text: consecutive, rendered: { text: 'First example.', lists: [{ start: 1, items: ['First example.'] }] } }), false);
});

// Execute the actual runner, observer and model waiter with an in-memory UI/IPC
// fixture. No Electron, private profile, service or vendor operation is performed.
async function hyperSmokeFixture({ saved, extraSelection, channelMapping, restoredBefore } = {}) {
  const source = await readFile(new URL('./HyperNativeOpenBotSmoke.mjs', import.meta.url), 'utf8');
  const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const models = [{ id: 'grok-4.3', label: 'Grok 4.3', efforts: ['low', 'high'], defaultEffort: 'low' }, { id: 'alternate', label: 'Alternate', efforts: ['high'], defaultEffort: 'high' }];
  const storage = new Map([['hyper-openbot.channel.native-view', 'old-channel']]);
  const state = { model: models[0], effort: null, sent: [], sendClicks: 0, writes: [], modelWrites: [], frameListener: undefined, channelCreated: !!restoredBefore, now: 0 };
  if (restoredBefore) {
    storage.set('hyper-openbot.channel.native-view', 'new-channel');
    state.sent = restoredBefore.turns.map(turn => ({ prompt: turn.prompt, answer: turn.answer, runId: turn.runId, userId: turn.messages.user.id, assistantId: turn.messages.assistant.id }));
  }
  const localStorage = { getItem: key => storage.get(key) ?? null };
  const syncStorage = () => { for (const key of Object.keys(localStorage)) if (key.startsWith('hyper-openbot.channel.')) delete localStorage[key]; Object.assign(localStorage, Object.fromEntries(storage)); };
  syncStorage();
  const browser = {
    localStorage, navigator: { userAgent: 'HyperTask Electron/42' }, crypto: { randomUUID: () => 'test-request-id' },
    document: { querySelector: () => ({ innerText: state.model.label }) },
    hypertask: { core: { request() {} }, hyperOpenBot: { service: { state: async () => ({ ready: true, phase: 'idle' }) }, onSocket: listener => { state.frameListener = listener; return () => { state.frameListener = undefined; }; } } },
  };
  browser.window = browser;
  const browserContext = createContext(browser);
  const evaluate = (fn, argument) => { browserContext.__argument = argument; return runInContext(`(${fn.toString()})(__argument)`, browserContext); };
  const locator = (role, name) => ({
    async waitFor() {}, async isVisible() { return true; }, async count() { return role === 'article' && name === 'System' ? 0 : 1; },
    filter() { return this; }, getByRole(nextRole, options) { return locator(nextRole, options?.name); },
    async fill(text) { state.prompt = text; },
    async click() {
      if (role === 'option') {
        const model = models.find(model => model.label === name);
        if (model) { state.model = model; if (!model.efforts.includes(state.effort)) state.effort = null; }
        else { const effort = { Low: 'low', High: 'high', 'Default thinking': null }[name]; assert.notEqual(effort, undefined); state.effort = effort; }
        if (state.channelCreated) state.modelWrites.push({ model: state.model.id, effort: state.effort === state.model.defaultEffort ? null : state.effort });
      }
      if (role !== 'button' || name !== 'Send message') return;
      assert.equal(typeof state.frameListener, 'function', 'Observe IPC before the first composition submits');
      state.sendClicks++;
      state.channelCreated = true; storage.set('hyper-openbot.channel.native-view', 'new-channel'); syncStorage();
      if (extraSelection) { storage.set('hyper-openbot.channel.other-view', 'other-channel'); syncStorage(); }
      const n = state.sent.length + 1;
      const turn = { prompt: state.prompt, answer: 'Hello world.', runId: `run-${n}`, userId: `user-${n}`, assistantId: `message-${n}`, model: state.model.id, effort: state.effort === state.model.defaultEffort ? null : state.effort };
      state.sent.push(turn);
      for (const record of records(events(turn.runId, turn.assistantId), 'socket-1')) state.frameListener({ id: record.socketId, type: 'message', data: record.frame });
    },
  });
  const page = {
    url: () => pathToFileURL('/virtual-app/out/renderer/index.html').href,
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
    getByRole: (role, options) => locator(role, options?.name), locator: () => locator('article'),
    evaluate: async (fn, argument) => evaluate(fn, argument),
    async waitForFunction(fn, argument) { assert.ok(await evaluate(fn, argument), 'The actual browser predicate must match'); },
    async waitForTimeout() { state.now += 10000; },
  };
  const jsonFromNative = async (_page, path) => {
    if (path === '/api/models') return { status: 200, value: { models, default: models[0].id, choosable: true } };
    if (path.endsWith('/model')) return { status: 200, value: saved ?? { model: state.model.id === models[0].id ? null : state.model.id, effort: state.effort === state.model.defaultEffort ? null : state.effort } };
    assert.equal(path, '/api/channels/new-channel'); assert.ok(state.channelCreated);
    return { status: 200, value: { channel: channelMapping ?? { id: 'new-channel', threadId: 'thread-1', agentIds: ['bot-1'] } } };
  };
  const context = {
    ...smoke, resolve, pathToFileURL, appDirectory: '/virtual-app', randomUUID: () => 'test-marker', jsonFromNative,
    ownedLaunch: async () => ({ debugSocket: '/tmp/hyper-native-smoke-fixture/cdp.sock', buildHead: 'a'.repeat(40), pid: restoredBefore ? 20 : 10, corePid: restoredBefore ? 21 : 11, profileDigest: 'b'.repeat(64) }),
    readFile: async path => { assert.equal(path, '/virtual-before'); return JSON.stringify(restoredBefore); },
    open: async () => ({ writeFile: async content => state.writes.push(JSON.parse(content)), close: async () => {} }),
    createRequire: () => () => ({ chromium: { connectOverCDP: async () => ({ contexts: () => [{ pages: () => [page] }] }) } }),
    waitForHistoryPair: async (_read, prompt, answer) => { const turn = state.sent.find(turn => turn.prompt === prompt); assert.equal(answer, turn.answer); return { messages: { user: { id: turn.userId, text: prompt }, assistant: { id: turn.assistantId, text: answer } } }; },
    renderedTurn: async () => {}, process: { stdout: { write() {} } },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } },
  };
  runInNewContext([
    slice('class HyperSmokeError', 'const appDirectory'),
    slice('async function waitModel(', 'async function waitReadiness('),
    slice('async function waitReadiness(', 'async function observeTurn('),
    slice('async function observeTurn(', 'async function run(args)'),
    slice('async function run(args)', 'if (process.argv[1]'),
    'globalThis.runSmoke = run; globalThis.waitSmokeModel = waitModel;',
  ].join('\n'), context);
  return { state, page, context, models };
}

test('before smoke observes the first submission before resolving its newly created native channel', async () => {
  const fixture = await hyperSmokeFixture();
  await fixture.context.runSmoke({ phase: 'before', status: '/virtual-status', output: '/virtual-evidence', agent: 'Personal Assistant', 'playwright-module': '/virtual-playwright' });
  const result = fixture.state.writes.at(-1);
  assert.equal(result.status, 'passed'); assert.equal(result.channelId, 'new-channel'); assert.equal(result.nativeViewId, 'native-view');
  assert.equal(fixture.state.sent.length, 2); assert.equal(result.turns.length, 2);
  assert.deepEqual(result.turns.map(turn => turn.runId), ['run-1', 'run-2']);
  assert.deepEqual(result.turns.map(turn => turn.messageId), ['message-1', 'message-2']);
  assert.deepEqual(result.turns.map(turn => turn.textDeliveries), [2, 2]);
  assert.equal(result.model.model, 'grok-4.3'); assert.equal(result.model.effort, null);
  assert.ok(fixture.state.modelWrites.some(pick => pick.model === 'alternate'));
  assert.equal(fixture.state.frameListener, undefined);
});

test('model persistence compares a requested default effort with its null wire projection', async () => {
  const fixture = await hyperSmokeFixture({ saved: { model: null, effort: null } });
  const selected = await fixture.context.waitSmokeModel(fixture.page, 'new-channel', { model: 'grok-4.3', effort: 'low' }, 'grok-4.3', fixture.models[0]);
  assert.equal(selected.model, 'grok-4.3'); assert.equal(selected.effort, null);
});

test('nondefault effort remains an exact persisted literal rather than accepting null', async () => {
  const fixture = await hyperSmokeFixture({ saved: { model: null, effort: 'high' } });
  const wanted = { model: 'grok-4.3', effort: 'high' };
  const selected = await fixture.context.waitSmokeModel(fixture.page, 'new-channel', wanted, 'grok-4.3', fixture.models[0]);
  assert.equal(selected.effort, 'high');
  const wrong = await hyperSmokeFixture({ saved: { model: null, effort: null } });
  await assert.rejects(wrong.context.waitSmokeModel(wrong.page, 'new-channel', wanted, 'grok-4.3', wrong.models[0]), /not persisted/);
});

test('default-effort projection still refuses a missing effort or a pinned default literal', async () => {
  for (const saved of [{ model: null }, { model: null, effort: 'low' }]) {
    const fixture = await hyperSmokeFixture({ saved });
    await assert.rejects(fixture.context.waitSmokeModel(fixture.page, 'new-channel', { model: 'grok-4.3', effort: 'low' }, 'grok-4.3', fixture.models[0]), /not persisted/);
  }
});

test('restart model checks retain exact recorded wire effort without reprojecting defaults', async () => {
  const fixture = await hyperSmokeFixture({ saved: { model: null, effort: null } });
  await assert.rejects(fixture.context.waitSmokeModel(fixture.page, 'new-channel', { model: 'grok-4.3', effort: 'low' }, 'grok-4.3'), /not persisted/);
  const selected = await fixture.context.waitSmokeModel(fixture.page, 'new-channel', { model: 'grok-4.3', effort: null }, 'grok-4.3');
  assert.equal(selected.effort, null);
});

test('model expectation rejects unsupported efforts and another model option', () => {
  const wanted = { model: 'grok-4.3', effort: 'low' };
  assert.throws(() => smoke.hyperNativeModelExpectation(wanted, { id: 'other', efforts: ['low'], defaultEffort: 'low' }), /not supported/);
  assert.throws(() => smoke.hyperNativeModelExpectation({ ...wanted, effort: 'unknown' }, { id: wanted.model, efforts: ['low'] }), /not supported/);
  assert.deepEqual(smoke.hyperNativeModelExpectation(wanted, { id: wanted.model, efforts: ['low'] }), wanted);
});

test('first composition uses an explicitly selected model and its default effort before either turn', async () => {
  const fixture = await hyperSmokeFixture();
  await fixture.context.runSmoke({ phase: 'before', status: '/virtual-status', output: '/virtual-evidence', agent: 'Personal Assistant', model: 'alternate', effort: 'high', 'playwright-module': '/virtual-playwright' });
  assert.equal(fixture.state.sendClicks, 2);
  assert.ok(fixture.state.sent.every(turn => turn.model === 'alternate' && turn.effort === null));
  const result = fixture.state.writes.at(-1);
  assert.equal(result.model.model, 'alternate'); assert.equal(result.model.effort, null);
});

test('initial submission refuses multiple changed native views and releases its observer', async () => {
  const fixture = await hyperSmokeFixture({ extraSelection: true });
  await assert.rejects(fixture.context.runSmoke({ phase: 'before', status: '/virtual-status', output: '/virtual-evidence', agent: 'Personal Assistant', 'playwright-module': '/virtual-playwright' }), /exactly one new conversation/);
  assert.equal(fixture.state.sendClicks, 1); assert.equal(fixture.state.frameListener, undefined);
  assert.equal(fixture.state.writes.at(-1).status, 'failed');
});

test('initial submission still requires an authoritative single-Bot channel mapping', async () => {
  const fixture = await hyperSmokeFixture({ channelMapping: { id: 'new-channel', threadId: 'thread-1', agentIds: ['bot-1', 'bot-2'] } });
  await assert.rejects(fixture.context.runSmoke({ phase: 'before', status: '/virtual-status', output: '/virtual-evidence', agent: 'Personal Assistant', 'playwright-module': '/virtual-playwright' }), /authoritative native channel mapping/);
  assert.equal(fixture.state.sendClicks, 1); assert.equal(fixture.state.frameListener, undefined);
});

test('after-phase runner verifies saved turns and never sends a replacement composition', async () => {
  const restoredBefore = before();
  Object.assign(restoredBefore, { nativeViewId: 'native-view', channelId: 'new-channel', botId: 'bot-1', profileDigest: 'b'.repeat(64), model: { model: 'grok-4.3', effort: null } });
  const fixture = await hyperSmokeFixture({ restoredBefore });
  await fixture.context.runSmoke({ phase: 'after', status: '/virtual-status', output: '/virtual-evidence', before: '/virtual-before', 'playwright-module': '/virtual-playwright' });
  const result = fixture.state.writes.at(-1);
  assert.equal(result.status, 'passed'); assert.equal(result.noReplacementPromptSent, true);
  assert.equal(result.sameNativeViewChannelThreadAndMessageIds, true);
  assert.equal(fixture.state.sendClicks, 0); assert.equal(fixture.state.modelWrites.length, 0);
});
