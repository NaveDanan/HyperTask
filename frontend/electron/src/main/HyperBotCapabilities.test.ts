import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, HyperBotsChannel, type HyperBotsConnections } from '@shared/HyperBots';
import { HyperBotFiles } from './HyperBotFiles';
import { HyperBotVault, hyperBotVaultCipher } from './HyperBotVault';
import { HyperBotWorkspace, hyperBotWebOrigins, hyperBotWorkspaceTools } from './HyperBotWorkspace';
import { HyperBotsTools } from './HyperBotsConnectors';
import { HyperBotsOpenAIEngine, type HyperBotsEngine } from './HyperBotsEngine';
import { createHyperBotsHost } from './HyperBotsHost';
import { HyperBotsHostClient } from './HyperBotsHostClient';
import { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperBotsStore } from './HyperBotsStore';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function directory() {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-bot-capabilities-'));
  folders.push(result);
  return result;
}
const completion = (content: string) => ({ message: { role: 'assistant' as const, content }, finishReason: 'stop' });
const request = { model: 'model', tools: [], messages: [{ role: 'user' as const, content: 'Hi' }] };

it('streams content, assembles tool calls, and discards an incomplete streamed tool call', async () => {
  const events = [
    { choices: [{ index: 0, delta: { content: 'Working 🌱' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'tool', arguments: '{"id":' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] },
  ];
  let interrupted = false;
  const engine = new HyperBotsOpenAIEngine({
    endpoint: async () => ({ apiKey: '', baseUrl: 'https://model.example.test/v1', defaultModel: 'model' }),
    fetch: async (_url, options) => {
      expect(JSON.parse(String(options?.body)).stream).toBe(true);
      const payload = events.map((event, index) => 'data: ' + JSON.stringify(!interrupted || index !== 2 ? event : {
        choices: [{ ...event.choices[0], finish_reason: 'length' }],
      }) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n';
      const bytes = new TextEncoder().encode(payload);
      return new Response(new ReadableStream({ start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3));
        controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const onText = vi.fn();
  const result = await engine.complete(request, new AbortController().signal, onText);
  expect(onText).toHaveBeenCalledWith('Working 🌱');
  expect(result.message.tool_calls).toEqual([{ id: 'call-1', type: 'function', function: { name: 'tool', arguments: '{"id":1}' } }]);
  interrupted = true;
  await expect(engine.complete(request, new AbortController().signal, onText)).rejects.toThrow('tool calls were interrupted');
});

it('keeps attachments downloadable and deduplicates retry IDs by file contents', async () => {
  const root = directory();
  const store = new HyperBotsStore(path.join(root, 'state.json'));
  const files = new HyperBotFiles(path.join(root, 'attachments'));
  const engine = { complete: vi.fn<HyperBotsEngine['complete']>().mockResolvedValue(completion('Read the attachment.')) };
  const runtime = new HyperBotsRuntime({ engine, store, files, tools: new HyperBotsTools([]), defaultModel: async () => 'model' });
  const roomId = runtime.settings().rooms[0]!.id;
  const data = new TextEncoder().encode('Quarterly figures');
  const input = { roomId, clientMessageId: randomUUID(), text: '', attachments: [{ name: 'figures.txt', type: 'text/plain' as const, data }] };
  const posted = await runtime.post(input);
  await runtime.idle();
  expect((await runtime.post(input)).created).toBe(false);
  const asset = posted.message.attachments![0]!;
  expect(Buffer.from(runtime.readAttachment(posted.message.id, asset.id)).toString()).toBe('Quarterly figures');
  expect(new HyperBotsStore(path.join(root, 'state.json')).getMessage(posted.message.id)?.attachments).toEqual([asset]);
  await expect(runtime.post({ ...input, attachments: [{ ...input.attachments[0]!, data: new TextEncoder().encode('Revised') }] })).rejects.toMatchObject({ code: 'conflict' });
  await runtime.stop();
});

it('learns quoted work preferences on opt-in and allows forgetting them', async () => {
  const store = new HyperBotsStore(null);
  const quote = 'I prefer meeting summaries in bullets.';
  const engine = { complete: vi.fn<HyperBotsEngine['complete']>().mockResolvedValueOnce(completion('Understood.'))
    .mockResolvedValueOnce(completion(JSON.stringify({ quote }))) };
  const runtime = new HyperBotsRuntime({ store, engine, tools: new HyperBotsTools([]), defaultModel: async () => 'model' });
  const settings = runtime.settings();
  const bot = settings.bots[0]!;
  const roomId = settings.rooms.find(room => room.kind === 'direct' && room.botIds[0] === bot.id)!.id;
  runtime.saveSettings({ ...settings, bots: settings.bots.map(row => row.id === bot.id ? { ...row, learn: true } : row) });
  await runtime.post({ roomId, text: quote, clientMessageId: randomUUID() });
  await runtime.idle();
  const note = runtime.snapshot(roomId).memory?.[0];
  expect(note?.text).toBe(quote);
  runtime.forget(roomId, note!.id);
  expect(runtime.snapshot(roomId).memory).toEqual([]);
  await runtime.stop();
});

it('encrypts vault contents and exposes only metadata in the list', () => {
  const filename = path.join(directory(), 'vault.enc');
  const cipher = hyperBotVaultCipher(randomBytes(32));
  const vault = new HyperBotVault(filename, () => cipher);
  const password = 'test-only-password';
  vault.add({ label: 'Example', username: 'owner', password });
  const [entry] = vault.list();
  expect(entry).toEqual({ id: expect.any(String), label: 'Example', username: 'owner' });
  expect(fs.readFileSync(filename).includes(Buffer.from(password))).toBe(false);
  expect(new HyperBotVault(filename, () => cipher).password(entry!.id)).toBe(password);
  vault.remove(entry!.id);
  expect(vault.list()).toEqual([]);
});

it('scopes workspace filenames and opens pages only on configured origins', async () => {
  const workspace = new HyperBotWorkspace(directory());
  workspace.create('notes.md', 'Workspace notes');
  expect(workspace.list()).toEqual([{ name: 'notes.md', size: 15 }]);
  expect(workspace.read('notes.md')).toBe('Workspace notes');
  expect(() => workspace.create('notes.md', 'Overwrite')).toThrow('already exists');
  expect(() => workspace.read('../private.txt')).toThrow();
  const fetcher = vi.fn<typeof fetch>(async () => new Response('<main>Hello<script>ignored</script></main>', { headers: { 'content-type': 'text/html' } }));
  const tools = hyperBotWorkspaceTools(workspace, hyperBotWebOrigins('https://docs.example.test'), fetcher);
  const web = tools.find(tool => tool.name === 'workspace_read_page')!;
  await expect(web.run({ url: 'https://other.example.test/' }, new AbortController().signal)).rejects.toThrow('outside');
  await expect(web.run({ url: 'https://docs.example.test/' }, new AbortController().signal)).resolves.toMatchObject({ text: 'Hello' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('runs a routine on a headless host before any desktop connects and authenticates RPC', async () => {
  const filename = path.join(directory(), 'state.json');
  const now = new Date('2026-11-18T06:30:00Z');
  const routine = { id: randomUUID(), prompt: 'Summarize the weekly priorities.', startAt: now.toISOString(), everyMinutes: 60 };
  const settings = { ...HYPER_BOTS_DEFAULT_SETTINGS, bots: HYPER_BOTS_DEFAULT_SETTINGS.bots.map((bot, index) => index ? bot : { ...bot, routines: [routine] }) };
  const engine = { complete: vi.fn<HyperBotsEngine['complete']>().mockResolvedValue(completion('Priorities summarized.')) };
  const deps = { engine, tools: new HyperBotsTools([]), defaultModel: async () => 'model', now: () => now };
  const runtime = new HyperBotsRuntime({ ...deps, store: new HyperBotsStore(filename) });
  runtime.saveSettings(settings);
  const roomId = runtime.settings().rooms.find(room => room.kind === 'direct' && room.botIds[0] === settings.bots[0]!.id)!.id;
  const offline = { ready: false as const, problem: 'Not configured' };
  const connections: HyperBotsConnections = { model: { ready: true, detail: 'test', defaultModel: 'model' }, outlook: offline, jira: offline };
  const key = randomBytes(32).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const host = createHyperBotsHost({ user: { key, userId: 'test' }, runtime }, token, {
    connections: async () => connections, models: async () => ['model'],
  });
  try {
    await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
    runtime.start();
    await vi.waitFor(() => expect(runtime.snapshot(roomId).messages.at(-1)?.text).toBe('Priorities summarized.'));
    const address = host.server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const origin = 'http://127.0.0.1:' + address.port;
    const unauthorized = await fetch(origin + '/events');
    expect(unauthorized.status).toBe(401);
    await unauthorized.body?.cancel();
    const client = new HyperBotsHostClient(origin, token, key);
    expect(() => client.assertOwner('wrong')).toThrow('does not own');
    const lease = new AbortController();
    expect(await client.call(HyperBotsChannel.Open, { roomId }, lease.signal)).toMatchObject({ messages: [
      { text: routine.prompt, scheduled: true }, { text: 'Priorities summarized.' },
    ] });
  } finally { await host.close(); }
  const resumed = new HyperBotsRuntime({ ...deps, store: new HyperBotsStore(filename) });
  resumed.start();
  await resumed.stop();
  expect(resumed.snapshot(roomId).messages).toHaveLength(2);
  expect(engine.complete).toHaveBeenCalledTimes(1);
});
