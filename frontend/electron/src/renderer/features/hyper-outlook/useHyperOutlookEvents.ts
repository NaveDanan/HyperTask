import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStore, useStore } from 'zustand';
import type { HyperOutlookEvent, HyperOutlookStatus } from '@shared/api';
import type { EventCalendarRangeInfo } from '@/components/reui/event-calendar/event-calendar-types';
import { hyperCalendarError } from '@/features/hyper-database/views/calendar/HyperCalendarData';
import { hyperOutlookClient } from './hyper-outlook-client';
import { hyperOutlookMapEvents } from './HyperOutlookData';
interface HyperOutlookState { items: HyperOutlookEvent[]; status: HyperOutlookStatus | null; error: string | null; refreshing: boolean; lastSyncedAt: Date | null }
const hyperOutlookVisible = () => true;
export function useHyperOutlookEvents(viewId: string, enabled: boolean, timeZone: string, visible = hyperOutlookVisible) {
  const [store] = useState(() => createStore<HyperOutlookState>(() => ({ items: [], status: null, error: null, refreshing: false, lastSyncedAt: null })));
  const state = useStore(store);
  const [shown, setShown] = useState(() => { try { return localStorage.getItem(`hyper.calendar.outlook.${viewId}`) !== 'false'; } catch { return true; } });
  const [range, setRange] = useState<EventCalendarRangeInfo | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const toggle = useCallback((value: boolean) => { setShown(value); try { localStorage.setItem(`hyper.calendar.outlook.${viewId}`, String(value)); } catch { /* Session toggle still works. */ } }, [viewId]);
  const onRangeChange = useCallback((info: EventCalendarRangeInfo) => setRange(previous => previous?.range.start.getTime() === info.range.start.getTime() && previous.range.end.getTime() === info.range.end.getTime() ? previous : info), []);
  useEffect(() => {
    if (!enabled) return;
    const version = ++request.current;
    store.setState({ refreshing: true });
    void (async () => {
      const status = await hyperOutlookClient.status();
      if (request.current !== version) return;
      store.setState({ status });
      if (!status.available) { store.setState({ error: status.reason ?? 'Outlook unavailable', items: [] }); return; }
      if (shown && range) {
        const items = await hyperOutlookClient.list({ start: range.range.start.toISOString(), end: range.range.end.toISOString() });
        if (request.current !== version) return;
        store.setState({ items, lastSyncedAt: new Date() });
      }
      if (request.current === version) store.setState({ error: null });
    })().catch(error => { if (request.current === version) store.setState({ error: hyperCalendarError(error), status: { available: false, userName: '', email: '', reason: hyperCalendarError(error) } }); })
      .finally(() => { if (request.current === version) store.setState({ refreshing: false }); });
    return () => { if (request.current === version) request.current++; };
  }, [enabled, range, shown, revision, store]);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (document.visibilityState === 'visible' && visible() && !store.getState().refreshing) refresh(); };
    const timer = setInterval(tick, 60000);
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [enabled, refresh, visible, store]);
  const events = useMemo(() => enabled && shown ? hyperOutlookMapEvents(state.items, timeZone) : [], [enabled, shown, state.items, timeZone]);
  return { ...state, events, shown, toggle, refresh, onRangeChange };
}
