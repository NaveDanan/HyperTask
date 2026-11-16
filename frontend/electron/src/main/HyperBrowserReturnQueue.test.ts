import { expect, it, vi } from 'vitest';
import { HyperBrowserReturnQueue } from './HyperBrowserReturnQueue';
it('retains a credential-free intent until readiness permits native processing', async () => {
  let ready = false; const handle = vi.fn(async () => {}), queue = new HyperBrowserReturnQueue(() => ready, handle);
  queue.request(); await queue.flush(); expect(handle).not.toHaveBeenCalled();
  ready = true; await queue.flush(); expect(handle).toHaveBeenCalledOnce(); await queue.flush(); expect(handle).toHaveBeenCalledOnce();
});
it('serializes returns requested while native confirmation is busy', async () => {
  let finish!: () => void;
  const handle = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const queue = new HyperBrowserReturnQueue(() => true, handle); queue.request(); queue.request(); queue.request();
  expect(handle).toHaveBeenCalledOnce(); finish(); await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
});
it('retains an unexpected failure without spinning or exposing the error', async () => {
  const handle = vi.fn().mockRejectedValueOnce(new Error('synthetic-private-error')).mockResolvedValue(undefined), queue = new HyperBrowserReturnQueue(() => true, handle);
  queue.request(); await Promise.resolve(); await Promise.resolve(); expect(handle).toHaveBeenCalledOnce();
  await queue.flush(); expect(handle).toHaveBeenCalledTimes(2);
});
