import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, hyperBotsWithDirectRooms, HyperBotsChannel as B, type HyperBotsConnections } from '@shared/HyperBots';
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => ipc.handlers.set(name, fn), removeHandler: (name: string) => ipc.handlers.delete(name) } }));
import { HyperBotsRuntime, HyperBotsRuntimeError } from './HyperBotsRuntime';
import { HyperBotsStore } from './HyperBotsStore';
import { HyperBotsHub, type HyperBotsUser } from './HyperBotsHub';
import { HyperBotsTools, hyperBotsJiraTool, hyperBotsReadJira } from './HyperBotsConnectors';
import type { HyperBotsEngine } from './HyperBotsEngine';
import { registerHyperBotsIpc, registerHyperBotsUnavailable } from './HyperBotsIpc';

const MESSAGE = '33333333-3333-4333-8333-333333333333';
const CONNECTIONS: HyperBotsConnections = { model: { ready: true, detail: 'm at x', defaultModel: 'm' }, outlook: { ready: false, problem: 'Classic Outlook' }, jira: { ready: false, problem: 'Jira tab' } };
const A: HyperBotsUser = { key: 'a'.repeat(64), userId: '1' };
const B2: HyperBotsUser = { key: 'b'.repeat(64), userId: '2' };
let dir = '';
beforeEach(() => { ipc.handlers.clear(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-bots-ipc-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Each account's Jira tab settings and token; a fake Jira records which account and project received a write.
const jiraPrefs: Record<string, unknown> = {
  'hypertask.jira.1.config': { baseUrl: 'https://a.example', projectKey: 'AAA', username: '' },
  'hypertask.jira.2.config': { baseUrl: 'https://b.example', projectKey: 'BBB', username: '' },
};
const jiraCredentials = { read: async (id: string) => ({ username: '', secret: 'tok-' + id.split('|')[0] }) };
// The model asks Scribe's Jira tool once, then answers.
const engine: HyperBotsEngine = {
  async complete(input) {
    return input.messages.some(m => m.role === 'tool')
      ? { message: { role: 'assistant', content: 'Filed.' }, finishReason: 'stop' }
      : { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'jira_create_issue', arguments: '{"summary":"Fix login"}' } }] }, finishReason: 'tool_calls' };
  },
};

function setup(onOutlookPresenceChange?: (listener: () => void) => () => void) {
  let who: HyperBotsUser | null = A;
  const jiraFetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ key: 'X-1' }), { status: 201 }));
  const runtimes: HyperBotsRuntime[] = [];
  const hub = new HyperBotsHub({
    directory: dir, identity: async () => who,
    create: (user, file) => {
      const runtime = new HyperBotsRuntime({ store: new HyperBotsStore(file), engine, defaultModel: async () => 'm',
        tools: new HyperBotsTools([hyperBotsJiraTool({ access: () => hyperBotsReadJira({ get: async k => jiraPrefs[k] }, jiraCredentials, user.userId), fetch: jiraFetch as never })]) });
      runtimes.push(runtime);
      return runtime;
    },
  });
  const contents = { mainFrame: {}, isDestroyed: vi.fn(() => false), send: vi.fn() };
  const owner = { webContents: contents, isDestroyed: () => false };
  const deps = { hub, onOutlookPresenceChange, connections: vi.fn(async (_user: HyperBotsUser) => CONNECTIONS), models: vi.fn(async () => ['m', 'n']) };
  const unregister = registerHyperBotsIpc(() => owner as never, deps);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const call = (channel: string, args?: unknown, from: object = event) => ipc.handlers.get(channel)!(from, args);
  return { hub, runtimes, contents, deps, unregister, event, call, jiraFetch, as: (user: HyperBotsUser | null) => { who = user; } };
}

it('opens the recent conversation while an Outlook probe is still pending', async () => {
  const h = setup();
  let release!: (value: HyperBotsConnections) => void;
  h.deps.connections.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  try {
    const result = await h.call(B.Open, { limit: 40 });
    expect(result).toMatchObject({ ok: true, value: { roomId: 'dm-scout', connections: { model: { checking: true } }, messages: [] } });
    release(CONNECTIONS);
    await vi.waitFor(() => expect(h.contents.send).toHaveBeenCalledWith(B.Event, { type: 'connections' }));
    expect(await h.call(B.Snapshot, { roomId: 'dm-scout', limit: 40 })).toMatchObject({ ok: true, value: { connections: CONNECTIONS } });
  } finally { release?.(CONNECTIONS); h.unregister(); await h.hub.stop(); }
});

it('discards a deferred connection result when the signed-in account changes', async () => {
  const h = setup();
  let release!: (value: HyperBotsConnections) => void;
  h.deps.connections.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  try {
    await h.call(B.Open, { limit: 16 });
    h.as(B2);
    await h.call(B.Open, { limit: 16 });
    await vi.waitFor(() => expect(h.contents.send).toHaveBeenCalledWith(B.Event, { type: 'connections' }));
    h.contents.send.mockClear();
    release({ ...CONNECTIONS, jira: { ready: true, detail: 'Old project' } });
    const result = await h.call(B.Snapshot, { roomId: 'ops', limit: 16 });
    expect(result.value.connections).toEqual(CONNECTIONS);
    expect(h.contents.send).not.toHaveBeenCalled();
  } finally { release?.(CONNECTIONS); h.unregister(); await h.hub.stop(); }
});

it('refuses untrusted senders and frames before any runtime work', async () => {
  const h = setup();
  const refused = { ok: false, kind: 'state', message: 'Untrusted HyperBots caller refused.' };
  for (const from of [{ sender: h.contents, senderFrame: {} }, { sender: { mainFrame: {} }, senderFrame: {} }]) {
    for (const channel of [B.Open, B.Snapshot, B.Post, B.Decide, B.SaveSettings, B.Models]) expect(await h.call(channel, { roomId: 'ops' }, from)).toEqual(refused);
  }
  expect(h.deps.models).not.toHaveBeenCalled();
  expect(h.runtimes).toHaveLength(0);
  await h.hub.stop();
});

it('validates every argument strictly and passes only parsed input', async () => {
  const h = setup();
  const base = { roomId: 'ops', clientMessageId: MESSAGE, text: 'Hi' };
  for (const args of [undefined, { ...base, clientMessageId: 'x' }, { ...base, text: '' }, { ...base, text: '   ' }, { ...base, text: 'x'.repeat(20001) }, { ...base, model: '' }, { ...base, model: 'm'.repeat(201) }, { ...base, extra: 1 }, { ...base, roomId: 'Ops!' }]) {
    expect(await h.call(B.Post, args)).toMatchObject({ ok: false, kind: 'format' });
  }
  // The renderer can no longer say who it is.
  for (const args of [{ userId: '2' }, { roomId: 'ops', userId: '2' }, { roomId: 'Ops!' }]) expect(await h.call(B.Open, args)).toMatchObject({ ok: false, kind: 'format' });
  for (const args of [{ approvalId: 'x', approved: true }, { approvalId: MESSAGE, approved: 'yes' }, { approvalId: MESSAGE, approved: true, delivery: 'later' }]) expect(await h.call(B.Decide, args)).toMatchObject({ ok: false, kind: 'format' });
  expect(await h.call(B.SaveSettings, { ...HYPER_BOTS_DEFAULT_SETTINGS, version: 2 })).toMatchObject({ ok: false, kind: 'format' });
  expect(h.runtimes).toHaveLength(0);
  const posted = await h.call(B.Post, { ...base, text: 'Hi @nobody', model: 'gpt-y' });
  expect(posted).toMatchObject({ ok: true, value: { created: true, message: { text: 'Hi @nobody', model: 'gpt-y' } } });
  expect(await h.call(B.Models)).toEqual({ ok: true, value: ['m', 'n'] });
  expect(await h.call(B.SaveSettings, HYPER_BOTS_DEFAULT_SETTINGS)).toEqual({ ok: true, value: hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS) });
  await h.hub.stop();
});

it('open returns the verified account\'s room with its connections; runtime refusals read clearly', async () => {
  const h = setup();
  const opened = await h.call(B.Open, {});
  expect(h.deps.connections).toHaveBeenCalledWith(A);
  expect(opened).toMatchObject({ ok: true, value: { roomId: 'ops', connections: CONNECTIONS, settings: hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS), messages: [] } });
  expect(await h.call(B.Snapshot, { roomId: 'nope' })).toEqual({ ok: false, kind: 'state', message: 'Unknown room: nope' });
  expect(await h.call(B.Decide, { approvalId: MESSAGE, approved: true })).toMatchObject({ ok: false, kind: 'state' });
  vi.spyOn(h.runtimes[0]!, 'saveSettings').mockImplementationOnce(() => { throw new HyperBotsRuntimeError('invalid', 'Bot ids must be unique.'); });
  expect(await h.call(B.SaveSettings, HYPER_BOTS_DEFAULT_SETTINGS)).toEqual({ ok: false, kind: 'format', message: 'Bot ids must be unique.' });
  h.as(null);
  for (const channel of [B.Open, B.Snapshot, B.Post, B.Decide, B.SaveSettings, B.Models]) expect(await h.call(channel, channel === B.Snapshot ? { roomId: 'ops' } : channel === B.Open ? {} : undefined)).toMatchObject({ ok: false });
  expect(await h.call(B.Open, {})).toEqual({ ok: false, kind: 'state', message: 'Sign in to HyperTask to use Bots.' });
  await h.hub.stop();
});

it('forwards events only from the active account\'s runtime until unregistered', async () => {
  const h = setup();
  await h.call(B.Open, {});
  const [first] = h.runtimes;
  first!.events.emit('event', { type: 'settings' });
  expect(h.contents.send).toHaveBeenCalledWith(B.Event, { type: 'settings' });
  h.contents.isDestroyed.mockReturnValue(true);
  first!.events.emit('event', { type: 'settings' });
  expect(h.contents.send).toHaveBeenCalledTimes(1);
  h.contents.isDestroyed.mockReturnValue(false);
  h.as(B2);
  await h.call(B.Open, {});
  first!.events.emit('event', { type: 'settings' });
  expect(h.contents.send).toHaveBeenCalledTimes(1);
  h.runtimes[1]!.events.emit('event', { type: 'settings' });
  expect(h.contents.send).toHaveBeenCalledTimes(2);
  h.unregister();
  h.runtimes[1]!.events.emit('event', { type: 'settings' });
  expect(h.contents.send).toHaveBeenCalledTimes(2);
  expect(ipc.handlers.size).toBe(0);
  await h.hub.stop();
});

it('event-driven snapshots share one connection probe per account for a while; open always probes again', async () => {
  const h = setup();
  await h.call(B.Open, {});
  for (let i = 0; i < 3; i++) expect(await h.call(B.Snapshot, { roomId: 'ops' })).toMatchObject({ ok: true, value: { connections: CONNECTIONS } });
  expect(h.deps.connections).toHaveBeenCalledTimes(1);
  await h.call(B.Open, {});
  expect(h.deps.connections).toHaveBeenCalledTimes(2);
  h.as(B2);
  await h.call(B.Snapshot, { roomId: 'ops' });
  expect(h.deps.connections.mock.calls.map(c => c[0].userId)).toEqual(['1', '1', '2']);
  await h.hub.stop();
});

it('a window that throws while receiving an event does not reach the runtime', async () => {
  const h = setup();
  await h.call(B.Open, {});
  h.contents.send.mockImplementation(() => { throw new Error('Render frame was disposed'); });
  expect(() => h.runtimes[0]!.events.emit('event', { type: 'settings' })).not.toThrow();
  await h.hub.stop();
});

// Audits #4 and #5: account B can neither see nor approve A's pending Jira write, and A's write goes to A's Jira only.
it('audit #4/#5: another signed-in account cannot read or approve the first account\'s work, and the write uses the proposer\'s Jira', async () => {
  const h = setup();
  await h.call(B.Open, {});
  expect(await h.call(B.Post, { roomId: 'ops', clientMessageId: MESSAGE, text: '@scribe file the login bug' })).toMatchObject({ ok: true });
  let approvalId = '';
  await vi.waitFor(async () => {
    const snap = await h.call(B.Snapshot, { roomId: 'ops' });
    expect(snap.value.approvals[0]).toMatchObject({ status: 'pending', tool: 'jira_create_issue', destination: 'Jira project AAA at https://a.example as token' });
    approvalId = snap.value.approvals[0].id;
  });
  // B signs in on the same Windows profile and opens Bots: an empty room, and A's approval does not exist for B.
  h.as(B2);
  const seen = await h.call(B.Open, {});
  expect(seen).toMatchObject({ ok: true, value: { messages: [], approvals: [], runs: [] } });
  expect(await h.call(B.Decide, { approvalId, approved: true })).toMatchObject({ ok: false, kind: 'state', message: expect.stringContaining('Unknown approval') });
  expect(h.jiraFetch).not.toHaveBeenCalled();
  // A signs back in; the pending request is still A's, and approving it writes to A's project with A's token.
  h.as(A);
  expect(await h.call(B.Open, {})).toMatchObject({ ok: true, value: { approvals: [{ id: approvalId, status: 'pending' }] } });
  expect(await h.call(B.Decide, { approvalId, approved: true })).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(h.jiraFetch).toHaveBeenCalledTimes(1));
  const [url, init] = h.jiraFetch.mock.calls[0]!;
  expect(url).toBe('https://a.example/rest/api/2/issue');
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  expect(JSON.parse(String(init.body)).fields.project).toEqual({ key: 'AAA' });
  await h.hub.stop();
});

it('when HyperBots cannot start, every channel answers with the reason', async () => {
  const unregister = registerHyperBotsUnavailable('EACCES: state.json');
  for (const channel of [B.Open, B.Snapshot, B.Post, B.Decide, B.SaveSettings, B.Models]) {
    expect(await ipc.handlers.get(channel)!({}, {})).toEqual({ ok: false, kind: 'state', message: 'HyperBots could not start. EACCES: state.json' });
  }
  unregister();
  expect(ipc.handlers.size).toBe(0);
});

it('invalidates cached Outlook connections on presence change and prompts an immediate renderer refresh', async () => {
  let changed!: () => void; const off = vi.fn();
  const h = setup(listener => { changed = listener; return off; });
  try {
    await h.call(B.Open, {}); await h.call(B.Snapshot, { roomId: 'ops' }); expect(h.deps.connections).toHaveBeenCalledOnce();
    changed(); expect(h.contents.send).toHaveBeenCalledWith(B.Event, { type: 'settings' });
    await h.call(B.Snapshot, { roomId: 'ops' }); expect(h.deps.connections).toHaveBeenCalledTimes(2);
    h.unregister(); expect(off).toHaveBeenCalledOnce();
  } finally { await h.hub.stop(); }
});
