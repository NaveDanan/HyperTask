import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HyperOutlookPresence } from './HyperOutlookPresence';
import type { HyperOutlookProcessState } from './HyperOutlookPresenceWindows';
let presence: HyperOutlookPresence;
let processState: HyperOutlookProcessState;
let availability: (connected: boolean) => void;
const bridge = { request: vi.fn(), setRunning: vi.fn(), onAvailability: vi.fn() };
const deps = { detect: vi.fn(), launch: vi.fn(), hidden: vi.fn() };
const closed = { installed: true, running: false, identity: '' };
const running = { installed: true, running: true, identity: '123' };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.resetAllMocks(); processState = closed;
  deps.detect.mockImplementation(async () => processState); deps.hidden.mockReturnValue(false); deps.launch.mockResolvedValue(undefined);
  bridge.request.mockResolvedValue({ available: true });
  bridge.onAvailability.mockImplementation(listener => { availability = listener; return vi.fn(); });
  presence = new HyperOutlookPresence(bridge as never, deps);
});
afterEach(() => { presence.stop(); vi.useRealTimers(); });
it('stays silent without an installation and never probes COM while closed', async () => {
  processState = { installed: false, running: false, identity: '' }; presence.start(); await settle();
  await vi.advanceTimersByTimeAsync(12000);
  expect(presence.current()).toEqual({ installed: false, running: false, connected: false });
  expect(bridge.request).not.toHaveBeenCalled(); expect(deps.detect).toHaveBeenCalledTimes(4);
});
it('publishes startup closure, waits for profile readiness and reconnects after close/reopen', async () => {
  const changed = vi.fn(); presence.onChange(changed); presence.start(); await settle();
  expect(changed).toHaveBeenLastCalledWith({ installed: true, running: false, connected: false });
  processState = running; bridge.request.mockResolvedValueOnce({ available: false });
  await vi.advanceTimersByTimeAsync(4000); expect(presence.current()).toMatchObject({ running: true, connected: false });
  await vi.advanceTimersByTimeAsync(4000); expect(presence.current().connected).toBe(true);
  processState = closed; await vi.advanceTimersByTimeAsync(4000);
  expect(bridge.setRunning).toHaveBeenLastCalledWith(false); expect(presence.current().connected).toBe(false);
  processState = { ...running, identity: '456' }; await vi.advanceTimersByTimeAsync(4000);
  expect(presence.current().connected).toBe(true); expect(bridge.request).toHaveBeenCalledTimes(3);
});
it('skips overlapping detection and backs off hidden process checks', async () => {
  let finish!: (value: HyperOutlookProcessState) => void;
  deps.detect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  presence.start(); presence.start(); await vi.advanceTimersByTimeAsync(20000);
  expect(deps.detect).toHaveBeenCalledOnce(); deps.hidden.mockReturnValue(true); finish(closed); await settle();
  await vi.advanceTimersByTimeAsync(11999); expect(deps.detect).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(deps.detect).toHaveBeenCalledTimes(2);
});
it('does not mistake process-check errors for closure and remembers a process as installation evidence', async () => {
  processState = { ...running, installed: false }; presence.start(); await settle();
  expect(presence.current()).toEqual({ installed: true, running: true, connected: true });
  deps.detect.mockRejectedValueOnce(new Error('tasklist busy')); await vi.advanceTimersByTimeAsync(4000);
  expect(presence.current().connected).toBe(true);
  processState = { ...closed, installed: false }; await vi.advanceTimersByTimeAsync(4000);
  expect(presence.current()).toEqual({ installed: true, running: false, connected: false });
});
it('ignores a stale status response after exit and connects to the replacement process', async () => {
  let finish!: (value: { available: boolean }) => void;
  bridge.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  processState = running; presence.start(); await settle(); processState = closed;
  await vi.advanceTimersByTimeAsync(4000); finish({ available: true }); await settle();
  expect(presence.current().connected).toBe(false);
  processState = { ...running, identity: '456' }; await vi.advanceTimersByTimeAsync(4000);
  expect(presence.current().connected).toBe(true);
});
it('resets attachment when the PID changes between polls, even without observing a closed interval', async () => {
  processState = running; presence.start(); await settle(); bridge.setRunning.mockClear();
  processState = { ...running, identity: '456' }; await vi.advanceTimersByTimeAsync(4000);
  expect(bridge.setRunning.mock.calls).toEqual([[false], [true]]); expect(bridge.request).toHaveBeenCalledTimes(2);
});
it('bounds profile retries, then keeps checking slowly so a late manual reopen still connects', async () => {
  processState = running; bridge.request.mockResolvedValue({ available: false }); presence.start(); await settle();
  await vi.advanceTimersByTimeAsync(96000); const count = bridge.request.mock.calls.length;
  expect(count).toBeGreaterThan(4); expect(count).toBeLessThan(12);
  await vi.advanceTimersByTimeAsync(20000); expect(bridge.request.mock.calls.length).toBeLessThanOrEqual(count + 1);
  bridge.request.mockResolvedValue({ available: true }); await vi.advanceTimersByTimeAsync(40000);
  expect(presence.current().connected).toBe(true);
});
it('responds to a bridge disconnect, coalesces launch clicks, and removes timers on shutdown', async () => {
  processState = running; presence.start(); await settle(); availability(false);
  expect(presence.current().connected).toBe(false); await vi.advanceTimersByTimeAsync(4000); expect(presence.current().connected).toBe(true);
  let finish!: () => void; deps.launch.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const a = presence.launch(), b = presence.launch(); expect(a).toBe(b); expect(deps.launch).toHaveBeenCalledOnce(); finish(); await a;
  presence.stop(); expect(vi.getTimerCount()).toBe(0); availability(true);
  const count = deps.detect.mock.calls.length; await vi.advanceTimersByTimeAsync(60000); expect(deps.detect).toHaveBeenCalledTimes(count);
});
