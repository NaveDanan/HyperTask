import { afterEach, describe, expect, it, vi } from 'vitest';
import { hyperJiraStartupDelay, hyperJiraSyncInterval, startHyperJiraScheduler, type HyperJiraSchedulerSource } from './HyperJiraScheduler';

function scheduler() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  const focus = new EventTarget();
  const state: HyperJiraSchedulerSource = { load: vi.fn(async () => {}), canSync: true, snapshot: { lastSuccessAt: null }, sync: vi.fn(async () => { state.snapshot.lastSuccessAt = new Date(); }) };
  const stop = startHyperJiraScheduler(() => state, focus);
  return { state, focus, stop };
}
afterEach(() => vi.useRealTimers());
describe('Hyper Jira background scheduler', () => {
  it('loads without syncing, waits for shell startup, then syncs every five minutes', async () => {
    const { state, stop } = scheduler();
    expect(state.load).toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(hyperJiraStartupDelay - 1); expect(state.sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(state.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(hyperJiraSyncInterval - 1); expect(state.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(state.sync).toHaveBeenCalledTimes(2);
    stop();
  });
  it('checks freshness on focus and coalesces focus/interval attempts during a pending sync', async () => {
    const { state, focus, stop } = scheduler();
    await vi.advanceTimersByTimeAsync(hyperJiraStartupDelay);
    focus.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); expect(state.sync).toHaveBeenCalledTimes(1);
    let release!: () => void;
    state.sync = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    state.snapshot.lastSuccessAt = new Date(Date.now() - hyperJiraSyncInterval);
    focus.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
    focus.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(hyperJiraSyncInterval);
    expect(state.sync).toHaveBeenCalledTimes(1);
    release(); await vi.advanceTimersByTimeAsync(0);
    focus.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); expect(state.sync).toHaveBeenCalledTimes(2);
    release(); stop();
  });
  it('skips disconnected/manual-busy stores and stops all timers/listeners', async () => {
    const { state, focus, stop } = scheduler(); state.canSync = false;
    await vi.advanceTimersByTimeAsync(hyperJiraStartupDelay + hyperJiraSyncInterval); expect(state.sync).not.toHaveBeenCalled();
    state.canSync = true; stop();
    focus.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(2 * hyperJiraSyncInterval); expect(state.sync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not sync after sign-out while initial settings are still loading', async () => {
    vi.useFakeTimers(); let release!: () => void;
    const sync = vi.fn(), load = () => new Promise<void>(resolve => { release = resolve; });
    const stop = startHyperJiraScheduler(() => ({ load, sync, canSync: true, snapshot: { lastSuccessAt: null } }), new EventTarget());
    await vi.advanceTimersByTimeAsync(hyperJiraStartupDelay); stop(); release();
    await vi.advanceTimersByTimeAsync(0); expect(sync).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('silently retries after a background failure', async () => {
    const { state, stop } = scheduler(); state.sync = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(hyperJiraStartupDelay + hyperJiraSyncInterval);
    expect(state.sync).toHaveBeenCalledTimes(2); stop();
  });
});

it('waits through startup focus events and keeps the five-minute cadence after a manual sync', async () => {
  const { state, focus, stop } = scheduler();
  focus.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); expect(state.sync).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(hyperJiraStartupDelay);
  await vi.advanceTimersByTimeAsync(hyperJiraSyncInterval - 1); state.snapshot.lastSuccessAt = new Date();
  await vi.advanceTimersByTimeAsync(1); expect(state.sync).toHaveBeenCalledTimes(2); stop();
});
