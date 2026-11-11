import { describe, expect, it } from 'vitest';
import { HyperDatabaseCalendarSpanIndex, type HyperDatabaseCalendarSpan } from './HyperDatabaseCalendarSpans';
import { hyperCalendarDays } from './HyperDatabaseCells';
import { hyperDatabaseDateCandidates } from './HyperDatabaseDate';
const instant = (day: string, time = '00:00:00', zone = 'UTC') => hyperDatabaseDateCandidates(day, time, zone)[0];
describe('bounded calendar spans', () => {
  it('clips long spans to the visible month without allocating every covered date', () => {
    const events = [{ id: 'old', start: instant('1900-01-01'), end: instant('9999-12-31') }, { id: 'outside', start: instant('2020-01-01'), end: instant('2020-12-31') }];
    const index = new HyperDatabaseCalendarSpanIndex(events, event => event, hyperCalendarDays(2026, 10), 'UTC');
    expect(index.days).toHaveLength(42); expect(index.counts).toEqual(new Array(42).fill(1)); expect(index.window('2026-11-11', 0).items.map(event => event.id)).toEqual(['old']);
  });
  it('includes date-only ends and excludes timed midnight ends while retaining zero-duration events', () => {
    const events = [{ id: 'all-day', start: instant('2026-11-10'), end: instant('2026-11-12'), includeTime: false }, { id: 'timed', start: instant('2026-11-10', '12:00:00'), end: instant('2026-11-12'), includeTime: true }, { id: 'point', start: instant('2026-11-12'), end: instant('2026-11-12'), includeTime: true }];
    const index = new HyperDatabaseCalendarSpanIndex(events, event => event, hyperCalendarDays(2026, 10), 'UTC');
    expect(index.window('2026-11-11', 0).items.map(event => event.id)).toEqual(['all-day', 'timed']);
    expect(index.window('2026-11-12', 0).items.map(event => event.id)).toEqual(['all-day', 'point']);
  });
  it('uses calendar dates in the field zone across DST and month boundaries', () => {
    const zone = 'America/New_York', event = { start: instant('2026-10-31', '23:30:00', zone), end: instant('2026-11-02', '00:00:00', zone), includeTime: true };
    const index = new HyperDatabaseCalendarSpanIndex([event], item => item, hyperCalendarDays(2026, 9), zone);
    expect(index.window('2026-10-31', 0).total).toBe(1); expect(index.window('2026-11-01', 0).total).toBe(1); expect(index.window('2026-11-02', 0).total).toBe(0);
  });
  it('retains native event order and limits each requested day page to ten cards for large spans', () => {
    const start = instant('2026-10-01'), end = instant('2026-12-31');
    const events = Array.from({ length: 10_000 }, (_, index) => ({ id: 'event-' + (9_999 - index), start, end }));
    const index = new HyperDatabaseCalendarSpanIndex(events, event => event, hyperCalendarDays(2026, 10), 'UTC');
    expect(index.counts.every(count => count === 10_000)).toBe(true);
    expect(index.window('2026-11-11', 1).items.map(event => event.id)).toEqual(events.slice(10, 20).map(event => event.id));
    expect(index.window('2026-11-11', Infinity).items).toHaveLength(10); expect(index.window('2026-11-11', 999_999).page).toBe(999);
    const shrink = new HyperDatabaseCalendarSpanIndex(events.slice(0, 1), event => event, index.days, 'UTC'); expect(shrink.window('2026-11-11', 999).page).toBe(0);
  });
  it('keeps older start-only payloads and malformed ranges reachable without fabricating end dates', () => {
    const events: HyperDatabaseCalendarSpan[] = [{ start: instant('2026-11-11') }, { start: instant('2026-11-11'), end: instant('2026-11-10') }, {}, { start: 9223372036854775807n }];
    const index = new HyperDatabaseCalendarSpanIndex(events, event => event, hyperCalendarDays(2026, 10), 'UTC');
    expect(index.window('2026-11-11', 0).total).toBe(2); expect(index.window('2026-11-12', 0).total).toBe(0); expect(index.window('outside', 0).items).toEqual([]);
  });
});
