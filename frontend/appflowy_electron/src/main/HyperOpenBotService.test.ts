import { expect, it, vi } from 'vitest';
import { HyperOpenBotService, HyperOpenBotServiceError } from './HyperOpenBotService';
import type { HyperOpenBotBackendReport, HyperOpenBotServiceAction } from '@shared/HyperOpenBotService';
const report = (ready = true): HyperOpenBotBackendReport => ({ version: 1, ready, problem: ready ? 'none' : 'services_stopped', checks: [] });
function setup() {
  const controller = new AbortController();
  const dependencies = { supported: true, authorize: vi.fn(async () => ({ signal: controller.signal, assertCurrent() { controller.signal.throwIfAborted(); } })), execute: vi.fn(async (_action: Exclude<HyperOpenBotServiceAction, 'ensure'>, _signal: AbortSignal) => report()), saveAutoStart: vi.fn(async (_value: boolean) => {}), disconnect: vi.fn() };
  return { dependencies, service: new HyperOpenBotService(dependencies, true), controller };
}
it('attaches idempotently and never starts a healthy backend', async () => {
  const { service, dependencies } = setup();
  await Promise.all([service.run('ensure'), service.run('ensure')]);
  expect(dependencies.execute).toHaveBeenCalledOnce(); expect(dependencies.execute.mock.calls[0][0]).toBe('check'); expect(service.snapshot().ready).toBe(true);
});
it('starts only an existing stopped deployment when configured, not missing prerequisites', async () => {
  const { service, dependencies } = setup(); dependencies.execute.mockResolvedValueOnce(report(false));
  await service.run('ensure'); expect(dependencies.execute.mock.calls.map(call => call[0])).toEqual(['check', 'start']);
  dependencies.execute.mockResolvedValueOnce({ ...report(false), problem: 'setup_required' });
  await service.run('ensure'); expect(dependencies.execute).toHaveBeenCalledTimes(3);
  await service.configure(false); dependencies.execute.mockResolvedValueOnce(report(false));
  await service.run('ensure'); expect(dependencies.execute.mock.calls.at(-1)?.[0]).toBe('check');
});
it('authentication invalidation aborts execution and suppresses late readiness', async () => {
  const { service, dependencies } = setup(); let finish!: (value: HyperOpenBotBackendReport) => void; let signal!: AbortSignal;
  dependencies.execute.mockImplementationOnce(async (_action, input) => { signal = input; return new Promise(resolve => { finish = resolve; }); });
  const pending = service.run('start'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  service.invalidate(); expect(signal.aborted).toBe(true); finish(report()); await pending;
  expect(service.snapshot()).toMatchObject({ ready: false, problem: 'signed_out' });
});
it('coalesces repeated operations and rejects an opposing operation while busy', async () => {
  const { service, dependencies } = setup(); let finish!: (value: HyperOpenBotBackendReport) => void;
  dependencies.execute.mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
  const one = service.run('start'), two = service.run('start');
  await expect(service.run('stop')).rejects.toThrow(HyperOpenBotServiceError);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); finish(report()); await Promise.all([one, two]);
  expect(dependencies.execute).toHaveBeenCalledOnce();
});
it('keeps an established conversation attached during a healthy readiness refresh', async () => {
  const { service, dependencies } = setup(); await service.run('check'); await service.run('check'); expect(dependencies.disconnect).not.toHaveBeenCalled();
  dependencies.execute.mockResolvedValueOnce({ ...report(false), problem: 'runtime_unavailable' }); await service.run('check'); expect(dependencies.disconnect).toHaveBeenCalledOnce();
});
it('reports unsupported platforms without executing or authorizing a backend command', async () => {
  const { dependencies } = setup(); dependencies.supported = false;
  const service = new HyperOpenBotService(dependencies, true); await service.run('ensure');
  expect(service.snapshot().problem).toBe('unsupported'); expect(dependencies.execute).not.toHaveBeenCalled(); expect(dependencies.authorize).not.toHaveBeenCalled();
});

it('serializes startup preference writes so the final user choice wins', async () => {
  const { service, dependencies } = setup(); let finish!: () => void;
  dependencies.saveAutoStart.mockImplementationOnce(async () => new Promise<void>(resolve => { finish = resolve; }));
  const first = service.configure(false), last = service.configure(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); expect(dependencies.saveAutoStart).toHaveBeenCalledOnce();
  finish(); await Promise.all([first, last]);
  expect(dependencies.saveAutoStart.mock.calls.map(call => call[0])).toEqual([false, true]); expect(service.snapshot().autoStart).toBe(true);
});
it('a destroyed status observer cannot turn a healthy check into a failed operation', async () => {
  const { service } = setup(); service.subscribe(() => { throw new Error('Renderer destroyed'); });
  await expect(service.run('check')).resolves.toMatchObject({ ready: true, problem: 'none' });
});
