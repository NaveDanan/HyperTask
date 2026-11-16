import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HyperOutlookEvent } from '@shared/api';
import type { EventCalendarRangeInfo } from '@/components/reui/event-calendar/event-calendar-types';
const hooks = vi.hoisted(() => ({ index: 0, values: [] as any[], effects: [] as any[], pending: [] as (() => void)[] }));
const client = vi.hoisted(() => ({ status: vi.fn(), list: vi.fn() }));
vi.mock('./hyper-outlook-client', () => ({ hyperOutlookClient: client }));
vi.mock('zustand', async () => ({ ...await vi.importActual('zustand/vanilla'), useStore: (store: any) => store.getState() }));
vi.mock('react', () => ({
  useState: (initial: any) => { const i = hooks.index++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (next: any) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
  useRef: (initial: any) => hooks.values[hooks.index++] ??= { current: initial }, useMemo: (run: () => unknown) => run(), useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, deps: unknown[]) => { const i = hooks.index++, old = hooks.effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) hooks.pending.push(() => { old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: effect() }; }); },
}));
import { useHyperOutlookEvents } from './useHyperOutlookEvents';
import { HyperOutlookFixture as item } from './test/HyperOutlookFixture';
const range = { range: { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') } } as EventCalendarRangeInfo;
let visible = true, enabled = true;
const isVisible = () => visible;
const render = () => { hooks.index = 0; const result = useHyperOutlookEvents('general', enabled, 'UTC', isVisible); for (const effect of hooks.pending.splice(0)) effect(); return result; };
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); hooks.index = 0; hooks.values = []; hooks.effects = []; hooks.pending = []; visible = true; enabled = true;
  const storage = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  client.status.mockResolvedValue({ available: true, userName: 'Me', email: 'me@example.invalid' }); client.list.mockResolvedValue([item]);
});
afterEach(() => { for (const effect of hooks.effects) effect?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('never accesses Outlook for other calendars and persists the per-view overlay toggle', async () => {
  enabled = false; render().onRangeChange(range); render(); await settle(); expect(client.status).not.toHaveBeenCalled();
  enabled = true; render(); await settle(); expect(render().events).toHaveLength(1);
  render().toggle(false); render(); await settle(); expect(render().events).toHaveLength(0); expect(localStorage.getItem('hyper.calendar.outlook.general')).toBe('false');
  client.list.mockClear(); render().refresh(); render(); await settle(); expect(client.list).not.toHaveBeenCalled();
});
it('keeps events and only the refresh button busy during background refresh, dropping stale ranges', async () => {
  render().onRangeChange(range); render(); await settle(); expect(render().events).toHaveLength(1); expect(render().lastSyncedAt).toBeInstanceOf(Date);
  let finish!: (items: HyperOutlookEvent[]) => void; client.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render().refresh(); render(); await settle(); expect(render().refreshing).toBe(true); expect(render().events[0].title).toBe('Planning');
  client.list.mockResolvedValueOnce([{ ...item, subject: 'New range' }]); render().onRangeChange({ ...range, range: { ...range.range, start: new Date('2026-11-02T00:00:00Z') } }); render(); await settle();
  finish([{ ...item, subject: 'Old range' }]); await settle(); expect(render().events[0].title).toBe('New range'); expect(render().refreshing).toBe(false);
});
it('refreshes manually, every minute while visible, and on focus; removes timers on unmount', async () => {
  render().onRangeChange(range); render(); await settle(); client.list.mockClear();
  await vi.advanceTimersByTimeAsync(60000); render(); await settle(); expect(client.list).toHaveBeenCalledTimes(1);
  visible = false; await vi.advanceTimersByTimeAsync(60000); render(); await settle(); expect(client.list).toHaveBeenCalledTimes(1);
  visible = true; Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); window.dispatchEvent(new Event('focus')); render(); await settle(); expect(client.list).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); window.dispatchEvent(new Event('focus')); render(); await settle(); expect(client.list).toHaveBeenCalledTimes(2);
  render().refresh(); render(); await settle(); expect(client.list).toHaveBeenCalledTimes(3);
  for (const effect of hooks.effects) effect?.cleanup?.(); hooks.effects = []; expect(vi.getTimerCount()).toBe(0);
});
it('surfaces unavailable and failed Outlook requests without throwing into the database calendar', async () => {
  client.status.mockResolvedValueOnce({ available: false, userName: '', email: '', reason: 'Classic Outlook required' }); render(); await settle(); expect(render()).toMatchObject({ error: 'Classic Outlook required', refreshing: false }); expect(client.list).not.toHaveBeenCalled();
  render().onRangeChange(range); client.list.mockRejectedValueOnce(new Error('COM unavailable')); render(); await settle(); expect(render()).toMatchObject({ error: 'COM unavailable', status: { available: false } });
});
