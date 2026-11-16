import { afterEach, expect, it, vi } from 'vitest';
import net from 'node:net';
import type { Cookies } from 'electron';
import type { HyperOpenBotSessionLease } from './HyperOpenBotSession';
import WebSocket from 'ws';
import { hyperRunBackend } from './HyperOpenBotBackend';
import { closeHyperOpenBotTunnel, hyperOpenBotSocketPath, hyperTunnelFetch } from './HyperOpenBotTunnel';
vi.mock('electron', () => ({ app: { once() {} } }));
afterEach(() => closeHyperOpenBotTunnel());
it.skipIf(process.env.HYPER_OPENBOT_VM_IT !== '1' || process.platform !== 'win32')('checks the existing VM and connects HTTP and WebSocket over the Windows private pipe', async () => {
  const controller = new AbortController();
  const report = await hyperRunBackend('check', controller.signal);
  expect(report.ready).toBe(true);
  expect(report.checks.every(check => check.state === 'ready')).toBe(true);
  const lease: HyperOpenBotSessionLease = { signal: controller.signal, assertCurrent() { controller.signal.throwIfAborted(); }, async withCookies<T>(action: (cookies: Cookies) => Promise<T>) { return action({ get: async () => [], set: async () => {} } as unknown as Cookies); } };
  const response = await hyperTunnelFetch('/health', { method: 'GET', signal: controller.signal, lease, headers: {} });
  expect(response.status).toBe(200);
  await response.text();
  const pipe = await hyperOpenBotSocketPath();
  const socket = new WebSocket('ws://127.0.0.1:3010/api/channels/events', { origin: 'http://127.0.0.1:3010', createConnection: () => net.createConnection({ path: pipe }), handshakeTimeout: 10000 });
  try { await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }); }
  finally { socket.terminate(); }
}, 60000);
