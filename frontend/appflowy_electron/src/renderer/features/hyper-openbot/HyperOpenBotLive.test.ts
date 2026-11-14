import { writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { afterAll, expect, it, vi } from 'vitest';
import type { HyperOpenBotChunk, HyperOpenBotSocketEvent } from '@shared/api';
const bridge = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({ app: { once: () => {} }, session: { defaultSession: { cookies: { get: async () => [], set: async () => {} } } }, ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => bridge.handlers.set(name, fn), on: (name: string, fn: (...args: any[]) => any) => bridge.events.set(name, fn) } }));
import { hyperOpenBotRequest } from './transport';
import { acquireHyperOpenBotTransport } from './HyperSdkTransport';
import { CopilotKitCore } from '@copilotkit/core';
import { readThreadMessages } from './HyperThreadMessages';
let closeTunnel = () => {};
afterAll(() => { closeTunnel(); vi.unstubAllGlobals(); });
it.skipIf(process.env.HYPER_OPENBOT_LIVE_TEST !== '1')('streams a real Intelligence turn over the private SSH HTTP and Phoenix bridge', async () => {
  const mainPath = '../../../main/hyper-openbot';
  const tunnelPath = '../../../main/HyperOpenBotTunnel';
  const { registerHyperOpenBotIpc } = await import(/* @vite-ignore */ mainPath);
  const { closeHyperOpenBotTunnel, hyperOpenBotSocketPath } = await import(/* @vite-ignore */ tunnelPath);
  closeTunnel = closeHyperOpenBotTunnel;
  vi.stubGlobal('CloseEvent', class extends Event { code: number; reason: string; wasClean: boolean; constructor(type: string, init: CloseEventInit) { super(type); this.code = init.code ?? 1006; this.reason = init.reason ?? ''; this.wasClean = init.wasClean ?? false; } });
  vi.stubGlobal('location', { protocol: 'file:', host: '', href: 'file:///test/index.html' });
  let openedSockets = 0;
  const chunks = new Set<(value: HyperOpenBotChunk) => void>();
  const sockets = new Set<(value: HyperOpenBotSocketEvent) => void>();
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send: (channel: string, value: any) => { if (channel === 'hyper-openbot:chunk') chunks.forEach(fn => fn(value)); else { if (value.type === 'open') openedSockets++; sockets.forEach(fn => fn(value)); } } });
  const event = { sender, senderFrame: sender.mainFrame };
  registerHyperOpenBotIpc(() => ({ webContents: sender }));
  vi.stubGlobal('window', { appflowy: { hyperOpenBot: {
    start: (request: unknown) => bridge.handlers.get('hyper-openbot:start')!(event, request),
    cancel: (id: string) => bridge.events.get('hyper-openbot:cancel')!(event, id),
    onChunk: (fn: (value: HyperOpenBotChunk) => void) => { chunks.add(fn); return () => chunks.delete(fn); },
    socketOpen: (id: string, path: string, protocols: string[]) => bridge.handlers.get('hyper-openbot:socket-open')!(event, id, path, protocols),
    socketSend: (id: string, data: unknown) => bridge.events.get('hyper-openbot:socket-send')!(event, id, data),
    socketClose: (id: string, code: number, reason: string) => bridge.events.get('hyper-openbot:socket-close')!(event, id, code, reason),
    onSocket: (fn: (value: HyperOpenBotSocketEvent) => void) => { sockets.add(fn); return () => sockets.delete(fn); },
  } } });
  const release = acquireHyperOpenBotTransport();
  try {
    expect(await hyperOpenBotSocketPath()).toMatch(/gateway\.sock$/);
    const info = await hyperOpenBotRequest<{ mode: string }>('/api/copilotkit/info'); expect(info.mode).toBe('intelligence');
    const { channel } = await hyperOpenBotRequest<{ channel: { id: string; threadId: string } }>('/api/channels', 'POST', { agentIds: ['picked-harness'] });
    const core = new CopilotKitCore({ runtimeUrl: 'https://hyper-openbot.invalid/api/copilotkit', credentials: 'include', properties: { openbotTimeZone: 'Asia/Jerusalem' }, deferInitialConnection: true });
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Runtime discovery timed out')), 20000); core.subscribe({ onRuntimeConnectionStatusChanged: ({ status }) => { if (status === 'connected') { clearTimeout(timer); resolve(); } if (status === 'error') { clearTimeout(timer); reject(new Error('Runtime discovery failed')); } } }); core.connect(); });
    const agent = core.getAgent('picked-harness'); if (!agent) throw new Error('Test Bot unavailable');
    agent.threadId = channel.threadId;
    let deliveries = 0; let failure: string | undefined;
    const watch = agent.subscribe({ onTextMessageContentEvent: () => { deliveries++; }, onRunErrorEvent: ({ event }) => { failure = event.message; }, onRunFailed: ({ error }) => { failure = String(error); } });
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: 'Reply with exactly HYPER_NATIVE_BRIDGE_OK. Do not use any tools.' });
    await core.runAgent({ agent }); watch.unsubscribe();
    expect(failure).toBeUndefined(); expect(deliveries).toBeGreaterThan(0);
    const reply = agent.messages.findLast(message => message.role === 'assistant' && typeof message.content === 'string');
    expect(reply?.content).toContain('HYPER_NATIVE_BRIDGE_OK');
    let stored = await readThreadMessages(channel.threadId, 'picked-harness', { deadlineMs: 10000 });
    const deadline = Date.now() + 20000;
    while (!stored.messages.some(message => message.id === reply?.id && message.content === reply.content) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 400)); stored = await readThreadMessages(channel.threadId, 'picked-harness', { deadlineMs: 10000 }); }
    expect(stored.availability).toBe('ready');
    expect(stored.messages.some(message => message.id === reply?.id && message.content === reply.content)).toBe(true);
    expect(openedSockets).toBeGreaterThan(0);
    await writeFile('/tmp/hypertask-openbot-private-bridge.json', JSON.stringify({ at: new Date().toISOString(), channelId: channel.id, threadId: channel.threadId, openedSockets, textDeliveries: deliveries, liveMessages: agent.messages.length, storedMessages: stored.messages.length, savedReplyExact: true, actualElectronWindowTest: false }));
    // Persistence can lag a finished live stream; reopening uses merge, never this snapshot as replacement.
    console.info(`Private bridge live result: ${deliveries} text deliveries, ${agent.messages.length} live messages, ${stored.messages.length} initial stored messages`);
    agent.detachActiveRun();
  } finally { release(); closeHyperOpenBotTunnel(); }
}, 120000);
