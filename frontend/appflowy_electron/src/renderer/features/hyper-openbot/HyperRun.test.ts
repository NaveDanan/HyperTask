import { expect, it, vi } from 'vitest';
import { hyperRunWithRecovery } from './HyperRun';
it('rejects a resolved SDK call when a run failure event was emitted', async () => {
  let events: any; const unsubscribe = vi.fn();
  const agent = { subscribe: (value: unknown) => { events = value; return { unsubscribe }; } };
  await expect(hyperRunWithRecovery(agent as never, async () => { events.onRunInitialized(); events.onRunFailed({ error: new Error('Gateway unavailable') }); }, () => false)).rejects.toThrow('Gateway unavailable');
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('keeps a draft retryable when the agent refused initialization', async () => {
  const unsubscribe = vi.fn();
  await expect(hyperRunWithRecovery({ subscribe: () => ({ unsubscribe }) } as never, async () => {}, () => false)).rejects.toThrow('did not start');
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('treats a deliberate Stop as completion and always releases its observer', async () => {
  let events: any; const unsubscribe = vi.fn();
  const agent = { subscribe: (value: unknown) => { events = value; return { unsubscribe }; } };
  await expect(hyperRunWithRecovery(agent as never, async () => { events.onRunFailed({ error: new Error('Aborted') }); }, () => true)).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
