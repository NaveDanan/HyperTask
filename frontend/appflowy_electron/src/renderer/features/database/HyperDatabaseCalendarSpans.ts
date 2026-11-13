import { hyperDatabaseDateParts, hyperDatabaseDateZone } from './HyperDatabaseDate';
import { hyperDatabaseWindowSizes, type HyperDatabaseWindowData } from './HyperDatabaseWindowModel';

export interface HyperDatabaseCalendarSpan { start?: bigint; end?: bigint; includeTime?: boolean }
interface HyperDatabaseCalendarIndexedEvent<T> { event: T; first: number; last: number }
/** One entry per event, at most 42 day counters, and ten selected cards per day. */
export class HyperDatabaseCalendarSpanIndex<T> {
  readonly days: readonly string[];
  readonly counts: readonly number[];
  private entries: HyperDatabaseCalendarIndexedEvent<T>[] = [];
  constructor(events: readonly T[], span: (event: T) => HyperDatabaseCalendarSpan, days: readonly string[], timezoneId: string) {
    this.days = days.slice(0, 42);
    const zone = hyperDatabaseDateZone(timezoneId), changes = new Array<number>(this.days.length + 1).fill(0);
    const lower = (day: string, inclusive: boolean) => {
      let left = 0, right = this.days.length;
      while (left < right) { const middle = (left + right) >>> 1; if (this.days[middle] < day || inclusive && this.days[middle] === day) left = middle + 1; else right = middle; }
      return left;
    };
    for (const event of events) {
      const range = span(event); if (range.start === undefined) continue;
      try {
        const firstDay = hyperDatabaseDateParts(range.start, zone).day;
        let end = range.end !== undefined && range.end >= range.start ? range.end : range.start;
        if (range.includeTime && end > range.start && hyperDatabaseDateParts(end, zone).time === '00:00:00') end -= 1n;
        const lastDay = hyperDatabaseDateParts(end, zone).day;
        const first = lower(firstDay, false), last = lower(lastDay, true) - 1;
        if (first > last || first >= this.days.length || last < 0) continue;
        this.entries.push({ event, first, last }); changes[first]++; changes[last + 1]--;
      } catch { /* Unsupported instants remain untouched; row details can still inspect their data. */ }
    }
    let total = 0;
    this.counts = this.days.map((_day, index) => total += changes[index]);
  }
  window(day: string, requestedPage: number): HyperDatabaseWindowData<T> {
    const index = this.days.indexOf(day), total = this.counts[index] ?? 0, size = hyperDatabaseWindowSizes.dayEvents;
    const pageCount = Math.max(1, Math.ceil(total / size)), page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0));
    const offset = page * size, items: T[] = []; let matched = 0;
    for (const entry of this.entries) {
      if (index < entry.first || index > entry.last) continue;
      if (matched++ >= offset) items.push(entry.event);
      if (items.length === size) break;
    }
    return { items, total, page, pageCount, start: total ? offset + 1 : 0, end: Math.min(total, offset + size) };
  }
}
