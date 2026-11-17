import { TZDate } from '@date-fns/tz';
import { addDays, addHours, format } from 'date-fns';
import type { HyperOutlookEvent, HyperOutlookFields } from '@shared/api';
import { hyperOutlookColorOf, type HyperOutlookColorId } from '@shared/HyperOutlookColor';
import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types';
import { hyperCalendarDraft, hyperCalendarDraftDates, type HyperCalendarDraft, type HyperCalendarEventData } from '@/features/hyper-database/views/calendar/HyperCalendarData';
export interface HyperOutlookEventData { source: 'outlook'; item: HyperOutlookEvent }
export type HyperOutlookCalendarData = HyperCalendarEventData | HyperOutlookEventData;
export const hyperIsOutlook = (data?: HyperOutlookCalendarData): data is HyperOutlookEventData => Boolean(data && 'source' in data && data.source === 'outlook');
const HyperOutlookColorTokens: Record<HyperOutlookColorId, string> = {
  red: 'var(--color-red-500)', orange: 'var(--color-orange-500)', yellow: 'var(--color-yellow-500)', green: 'var(--color-green-500)',
  teal: 'var(--color-teal-500)', blue: 'var(--color-blue-500)', purple: 'var(--color-purple-500)', gray: 'var(--color-gray-500)',
};
/** Events without a HyperTask colour keep the Outlook-calendar default. */
export const hyperOutlookDefaultColor = 'var(--hyper-outlook-color, var(--color-sky-500))';
export function hyperOutlookColorToken(color: HyperOutlookColorId | null) { return color ? HyperOutlookColorTokens[color] : hyperOutlookDefaultColor; }
/** Chip emphasis: declined invites and "Canceled:" leftovers (plain appointments Outlook keeps) are struck through. */
export function hyperOutlookTone(item: HyperOutlookEvent | null) {
  if (!item) return '';
  if (item.responseStatus === 4 || /^cancell?ed:/i.test(item.subject)) return 'text-muted-foreground line-through opacity-60';
  return item.responseStatus === 2 ? 'opacity-65' : '';
}
export function hyperOutlookDate(value: string, allDay: boolean, timeZone: string) {
  if (!allDay) return new TZDate(value, timeZone);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new TZDate(year, month - 1, day, 0, 0, 0, 0, timeZone);
}
export function hyperOutlookMapEvents(items: HyperOutlookEvent[], timeZone: string): CalendarEvent<HyperOutlookCalendarData>[] {
  return items.filter(item => !item.isCancelled).map(item => ({
    id: `outlook:${item.id}`, title: item.isPrivate ? 'Private' : item.subject || 'Untitled', start: hyperOutlookDate(item.start, item.allDay, timeZone), end: hyperOutlookDate(item.end, item.allDay, timeZone),
    allDay: item.allDay, color: hyperOutlookColorToken(hyperOutlookColorOf(item.categories)), readOnly: !item.isOrganizer || item.recurrenceState === 1 || item.isPrivate,
    data: { source: 'outlook', item },
  }));
}
export function hyperOutlookDraft(item: HyperOutlookEvent, timeZone: string): HyperCalendarDraft {
  return { ...hyperCalendarDraft(hyperOutlookDate(item.start, item.allDay, timeZone), hyperOutlookDate(item.end, item.allDay, timeZone), item.allDay, timeZone), title: item.subject, isRange: true };
}
export function hyperOutlookFields(draft: HyperCalendarDraft, location: string, body: string, timeZone: string): HyperOutlookFields | null {
  const dates = hyperCalendarDraftDates(draft, timeZone);
  if (dates.error || !dates.start) return null;
  const end = draft.allDay ? addDays(dates.end ?? dates.start, 1) : dates.end ?? addHours(dates.start, 1);
  if (end <= dates.start) return null;
  return { subject: draft.title.trim() || 'Untitled', start: draft.allDay ? format(dates.start, 'yyyy-MM-dd') : new Date(dates.start.getTime()).toISOString(), end: draft.allDay ? format(end, 'yyyy-MM-dd') : new Date(end.getTime()).toISOString(), allDay: draft.allDay, location, body };
}
