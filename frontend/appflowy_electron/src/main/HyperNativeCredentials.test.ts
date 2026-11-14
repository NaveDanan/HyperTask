import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handler: undefined as any, dialog: vi.fn(), fetch: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: (_: string, fn: any) => { mocks.handler = fn; } }, dialog: { showMessageBox: mocks.dialog } }));
vi.mock('./HyperOpenBotTunnel', () => ({ hyperTunnelFetch: mocks.fetch }));
import { registerHyperNativeCredentials } from './HyperNativeCredentials';
beforeEach(() => { vi.resetAllMocks(); });
function setup() {
  let stopped = false;
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const owner = { webContents: sender, isDestroyed: () => false };
  const lease = { assertCurrent() { if (stopped) throw new Error('synthetic secret'); }, signal: new AbortController().signal };
  let invalidate = () => {};
  const sessions = { acquire: vi.fn(async () => { lease.assertCurrent(); return lease; }), onInvalidate: (fn: any) => { invalidate = fn; return () => {}; } };
  registerHyperNativeCredentials(() => owner as any, sessions as any, () => true);
  return { event: { sender, senderFrame: sender.mainFrame }, sessions, stop() { stopped = true; invalidate(); } };
}
const input = { action: 'create', agentId: 'bot' };
it('refuses untrusted frames and malformed actions', async () => {
  const h = setup();
  expect(await mocks.handler({ ...h.event, senderFrame: {} }, input)).toEqual({ status: 'refused' });
  expect(await mocks.handler(h.event, { ...input, path: '/arbitrary' })).toEqual({ status: 'refused' });
  expect(mocks.dialog).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('refuses absent identity without exposing errors', async () => {
  const h = setup(); h.sessions.acquire.mockRejectedValue(new Error('synthetic secret'));
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'failed' }); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('cancellation performs no mutation', async () => {
  const h = setup(); mocks.dialog.mockResolvedValue({ response: 0 });
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'cancelled' }); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('signout during confirmation stops mutation', async () => {
  const h = setup(); mocks.dialog.mockImplementation(async () => { h.stop(); return { response: 1 }; });
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'failed' }); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('shows the key only in main and returns fixed metadata', async () => {
  const h = setup(); mocks.dialog.mockResolvedValue({ response: 1 });
  const token = 'obot_agt_' + 'x'.repeat(43);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ token }), { status: 201, headers: { authorization: token } }));
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'issued' });
  expect(mocks.dialog.mock.calls[1][1].detail).toBe(token);
  expect(mocks.fetch.mock.calls[0][0]).toBe('/api/agents/bot/callback-token');
});
it('signout during transport prevents key display', async () => {
  const h = setup(); mocks.dialog.mockResolvedValue({ response: 1 }); mocks.fetch.mockImplementation(async () => { h.stop(); return new Response('{"token":"synthetic-secret"}', { status: 201 }); });
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'failed' }); expect(mocks.dialog).toHaveBeenCalledTimes(1);
});
it('signout during key display returns only failure', async () => {
  const h = setup(); mocks.dialog.mockResolvedValueOnce({ response: 1 }).mockImplementationOnce(async () => { h.stop(); return { response: 0 }; });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ token: 'obot_agt_' + 'x'.repeat(43) }), { status: 201 }));
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'failed' });
});
it('renderer destruction during confirmation stops mutation', async () => {
  const h = setup(); mocks.dialog.mockImplementation(async () => { h.event.sender.emit('destroyed'); return { response: 1 }; });
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'failed' }); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('sanitizes transport errors', async () => {
  const h = setup(); mocks.dialog.mockResolvedValue({ response: 1 }); mocks.fetch.mockRejectedValue(new Error('synthetic-secret-cookie'));
  expect(await mocks.handler(h.event, input)).toEqual({ status: 'failed' });
});
it('revoke uses the protected native path', async () => {
  const h = setup(); mocks.dialog.mockResolvedValue({ response: 1 }); mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await mocks.handler(h.event, { ...input, action: 'revoke' })).toEqual({ status: 'revoked' });
  expect(mocks.fetch.mock.calls[0][1].method).toBe('DELETE');
});
