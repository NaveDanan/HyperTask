import { afterEach, expect, it, vi } from 'vitest';
import { hyperGatewayJoin } from './HyperGatewayJoin';
afterEach(() => vi.useRealTimers());
it('releasing a pending join prevents its stale deadline from detaching a later run', async () => {
  vi.useFakeTimers();
  const detach = vi.fn();
  const join = hyperGatewayJoin(() => new Promise(() => {}), detach);
  await Promise.resolve();
  join.cancel();
  await join.promise;
  await vi.advanceTimersByTimeAsync(6000);
  expect(detach).not.toHaveBeenCalled();
});
it('successful joins clear their deadline and an overdue active join invokes it once', async () => {
  vi.useFakeTimers();
  const detach = vi.fn();
  await hyperGatewayJoin(async () => {}, detach).promise;
  await vi.advanceTimersByTimeAsync(6000);
  expect(detach).not.toHaveBeenCalled();
  const overdue = hyperGatewayJoin(() => new Promise(() => {}), detach);
  await vi.advanceTimersByTimeAsync(5000);
  await overdue.promise;
  expect(detach).toHaveBeenCalledTimes(1);
});
