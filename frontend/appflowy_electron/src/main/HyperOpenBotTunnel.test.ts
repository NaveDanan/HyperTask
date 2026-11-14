import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocks = vi.hoisted(() => ({ mkdtemp: vi.fn(), chmod: vi.fn(), rm: vi.fn(), stat: vi.fn(), spawn: vi.fn(), request: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: { ...mocks } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:http', () => ({ default: { request: mocks.request } }));
vi.mock('electron', () => ({ app: { once: () => {} }, session: { defaultSession: { cookies: { get: vi.fn() } } } }));
import { closeHyperOpenBotTunnel, hyperOpenBotSocketPath, hyperTunnelFetch } from './HyperOpenBotTunnel';
beforeEach(() => { closeHyperOpenBotTunnel(); vi.clearAllMocks(); mocks.rm.mockResolvedValue(undefined); mocks.chmod.mockResolvedValue(undefined); });
afterEach(closeHyperOpenBotTunnel);
it('does not spawn SSH after close cancels an outstanding directory allocation', async () => {
  let allocate: (path: string) => void = () => {};
  mocks.mkdtemp.mockImplementationOnce(() => new Promise(resolve => { allocate = resolve; }));
  const attempt = hyperOpenBotSocketPath();
  const rejected = expect(attempt).rejects.toThrow('cancelled');
  closeHyperOpenBotTunnel(); allocate('/private/cancelled');
  await rejected;
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledWith('/private/cancelled', { recursive: true, force: true });
});
it('cancels after chmod and does not clear a newer pending startup', async () => {
  let finishChmod: () => void = () => {};
  mocks.mkdtemp.mockResolvedValueOnce('/private/old').mockImplementationOnce(() => new Promise(() => {}));
  mocks.chmod.mockImplementationOnce(() => new Promise<void>(resolve => { finishChmod = resolve; }));
  const old = hyperOpenBotSocketPath(); const rejected = expect(old).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(mocks.chmod).toHaveBeenCalledOnce());
  closeHyperOpenBotTunnel(); const newer = hyperOpenBotSocketPath();
  finishChmod(); await rejected;
  expect(hyperOpenBotSocketPath()).toBe(newer);
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledWith('/private/old', { recursive: true, force: true });
  closeHyperOpenBotTunnel();
});
it.each([204, 205, 304])('releases the upstream response stream for null-body status %s', async status => {
  mocks.mkdtemp.mockResolvedValueOnce('/private/no-body');
  mocks.stat.mockResolvedValue({ isSocket: () => true });
  mocks.spawn.mockReturnValue(Object.assign(new EventEmitter(), { kill: vi.fn() }));
  const response = Object.assign(new PassThrough(), { statusCode: status, headers: {} });
  const resume = vi.spyOn(response, 'resume');
  mocks.request.mockImplementationOnce((_options, ready) => Object.assign(new EventEmitter(), {
    end: () => ready(response), destroy: vi.fn(),
  }));
  const lease = { assertCurrent() {}, signal: new AbortController().signal, withCookies: async (run: (cookies: unknown) => Promise<unknown>) => run({ get: async () => [], set: async () => {} }) };
  const result = await hyperTunnelFetch('/api/channels', { method: 'GET', signal: new AbortController().signal, lease: lease as never, headers: {} });
  expect(result.status).toBe(status); expect(result.body).toBeNull(); expect(resume).toHaveBeenCalledOnce();
  response.end();
});
