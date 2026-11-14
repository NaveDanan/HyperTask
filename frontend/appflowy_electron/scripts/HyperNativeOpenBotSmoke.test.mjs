import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hyperNativeCdpUrl, hyperNativeCompletion, hyperNativeStream, hyperValidateNativeBefore, hyperOwnsNativeCommand, hyperNativeModelId } from './HyperNativeOpenBotSmoke.mjs';

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

test('both argv and rewritten Electron titles require the exact owned app, profile and port', () => {
  const args = ['electron', '/checkout/app', '--user-data-dir=/private/smoke/electron', '--remote-debugging-port=9222'];
  for (const form of [args, [args.join(' ')]]) {
    assert.ok(hyperOwnsNativeCommand(form, '/checkout/app', '/private/smoke', 9222));
    assert.ok(!hyperOwnsNativeCommand(form, '/checkout/ap', '/private/smoke', 9222));
    assert.ok(!hyperOwnsNativeCommand(form, '/checkout/app', '/private/smoke', 922));
    assert.ok(!hyperOwnsNativeCommand(form, '/checkout/app', '/private/real-user', 9222));
  }
});

test('CDP can attach only to an explicit credential-free HTTP loopback endpoint', () => {
  assert.equal(hyperNativeCdpUrl('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
  assert.equal(hyperNativeCdpUrl('http://[::1]:9222'), 'http://[::1]:9222');
  for (const value of ['https://example.com:9222', 'http://localhost:9222', 'http://0.0.0.0:9222', 'http://127.0.0.1', 'http://name:secret@127.0.0.1:9222', 'http://127.0.0.1:9222/path', 'http://127.0.0.1:9222/?token=x', 'http://127.0.0.1:9222/#x'])
    assert.throws(() => hyperNativeCdpUrl(value));
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
