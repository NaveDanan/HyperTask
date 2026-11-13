import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifact, eventFromFrame, historyPair, proveStream } from './HyperOpenBotBaseline.mjs';

const at = '2026-11-13T00:00:00.000Z';
const event = (type, delivery, extra = {}) => ({ type, delivery, at, ...extra });
const events = [
  event('RUN_STARTED', 1, { threadId: 'thread', runId: 'run' }),
  event('TEXT_MESSAGE_START', 2, { messageId: 'answer' }),
  event('TEXT_MESSAGE_CONTENT', 3, { messageId: 'answer', delta: 'Hello' }),
  event('TEXT_MESSAGE_CONTENT', 4, { messageId: 'answer', delta: ' world' }),
  event('TEXT_MESSAGE_END', 5, { messageId: 'answer' }),
  event('RUN_FINISHED', 6, { threadId: 'thread', runId: 'run' }),
];

test('direct events only, with an explicit field whitelist', () => {
  assert.deepEqual(eventFromFrame(JSON.stringify({ type: 'RUN_STARTED', threadId: 'thread', runId: 'run', input: { token: 'secret' }, cookie: 'secret' }), 1, at), events[0]);
  assert.equal(eventFromFrame(JSON.stringify({ events }), 1, at), null);
  assert.equal(eventFromFrame(JSON.stringify(events), 1, at), null);
  assert.equal(eventFromFrame(Buffer.from('binary'), 1, at), null);
});

test('decodes only single Phoenix AG-UI payloads and never join/history envelopes', () => {
  const frame = ['1', null, 'private-topic', 'ag_ui_event', { type: 'RUN_STARTED', threadId: 'thread', runId: 'run', token: 'secret' }];
  assert.deepEqual(eventFromFrame(JSON.stringify(frame), 1, at), { ...events[0], channelTopic: 'private-topic' });
  for (const payload of [{ events }, events]) {
    assert.equal(eventFromFrame(JSON.stringify(['1', null, 'topic', 'ag_ui_event', payload]), 1, at), null);
  }
  assert.equal(eventFromFrame(JSON.stringify(['1', null, 'topic', 'phx_reply', frame[4]]), 1, at), null);
  assert.equal(eventFromFrame(JSON.stringify(['1', null, 'topic', 'heartbeat', frame[4]]), 1, at), null);
});

test('requires distinct ordered deliveries, identities and completion', () => {
  assert.deepEqual(proveStream(events, 'thread', 'run'), { messageId: 'answer', answer: 'Hello world' });
  assert.throws(() => proveStream(events.map(e => ({ ...e, delivery: 1 })), 'thread', 'run'));
  assert.throws(() => proveStream([...events, event('TEXT_MESSAGE_CONTENT', 7, { messageId: 'answer', delta: 'late' })], 'thread', 'run'));
  assert.throws(() => proveStream(events.slice(0, -1), 'thread', 'run'));
  assert.throws(() => proveStream(events, 'other', 'run'));
  assert.throws(() => proveStream(events, 'thread', ''));
  assert.throws(() => proveStream(events.map(e => e.type === 'TEXT_MESSAGE_CONTENT' ? { ...e, runId: 'other' } : e), 'thread', 'run'));
});

test('history must be available, well formed and match both IDs', () => {
  const body = { messages: [{ id: 'user', role: 'user', content: 'prompt' }, { id: 'answer', role: 'assistant', content: 'Hello world' }] };
  const pair = historyPair(200, body, 'prompt', 'Hello world');
  assert.equal(pair.assistant.id, 'answer');
  for (const [status, data] of [[502, body], [200, {}], [200, { messages: [] }], [200, { messages: [null] }]]) assert.throws(() => historyPair(status, data, 'prompt', 'Hello world'));
  assert.throws(() => historyPair(200, body, 'prompt', 'Hello world', { ...pair, user: { id: 'changed' }, assistant: pair.assistant }));
});

test('artifact drops extra secret-bearing properties', () => {
  const data = { phase: 'before', observedAt: at, channelId: 'channel', threadId: 'thread', botId: 'bot', runId: 'run', prompt: 'prompt', answer: 'Hello world', messages: { user: { id: 'user', cookie: 'secret' }, assistant: { id: 'answer', token: 'secret' } }, statuses: { channel: 200, messages: 200, authorization: 'secret' }, events: events.map(e => ({ ...e, raw: 'secret', channelTopic: 'secret' })), token: 'secret' };
  assert.equal(JSON.stringify(artifact(data)).includes('secret'), false);
  assert.equal(artifact({ ...data, phase: 'after' }).limits.stream, 'copied_from_before');
  assert.equal(artifact(data).limits.providerAuthenticity, 'not_verified');
  assert.equal(artifact(data).limits.serviceRestart, 'not_verified');
});
