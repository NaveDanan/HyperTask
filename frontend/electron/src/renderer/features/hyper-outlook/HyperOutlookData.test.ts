import { expect, it } from 'vitest';
import { format } from 'date-fns';
import { hyperIsOutlook, hyperOutlookColorToken, hyperOutlookDraft, hyperOutlookFields, hyperOutlookMapEvents } from './HyperOutlookData';
import { HyperOutlookFixture as item } from './test/HyperOutlookFixture';
it('maps timed instants, Outlook ids and the source while preserving the database id namespace', () => {
  const [event] = hyperOutlookMapEvents([item], 'America/New_York');
  expect(event.id).toBe('outlook:ABCD'); expect(new Date(event.start.getTime()).toISOString()).toBe(item.start.replace('Z', '.000Z')); expect(event.readOnly).toBe(false); expect(hyperIsOutlook(event.data)).toBe(true);
  expect(hyperIsOutlook({ rowId: 'row', dateFieldId: 'date' })).toBe(false);
});
it('anchors all-day exclusive boundaries to midnight in the display zone across DST', () => {
  const [event] = hyperOutlookMapEvents([{ ...item, start: '2026-11-01', end: '2026-11-03', allDay: true }], 'America/New_York');
  expect(format(event.start, 'yyyy-MM-dd HH:mm')).toBe('2026-11-01 00:00'); expect(format(event.end, 'yyyy-MM-dd HH:mm')).toBe('2026-11-03 00:00');
  expect(event.end.getTime() - event.start.getTime()).toBe(49 * 3600000);
});
it('keeps recurring occurrences independent, rejects master/invite/private drag and filters cancelled events', () => {
  const occurrence = { ...item, id: 'ABCD|2026-11-16T08:00:00.0000000Z', isRecurring: true, recurrenceState: 2 };
  const events = hyperOutlookMapEvents([occurrence, { ...item, isOrganizer: false }, { ...item, recurrenceState: 1 }, { ...item, isPrivate: true }, { ...item, isCancelled: true }], 'UTC');
  expect(events).toHaveLength(4); expect(events[0].id).toBe(`outlook:${occurrence.id}`); expect(events.map(event => event.readOnly)).toEqual([false, true, true, true]); expect(events[3].title).toBe('Private');
});
it('round trips inclusive all-day editor dates and validates timed durations', () => {
  const allDay = { ...item, allDay: true, start: '2026-11-16', end: '2026-11-18' }, draft = hyperOutlookDraft(allDay, 'Asia/Jerusalem');
  expect(draft.endDate).toBe('2026-11-17'); expect(hyperOutlookFields(draft, '', '', 'Asia/Jerusalem')).toMatchObject({ start: allDay.start, end: allDay.end, allDay: true });
  const timed = hyperOutlookDraft(item, 'UTC'); expect(hyperOutlookFields({ ...timed, endTime: timed.startTime }, '', '', 'UTC')).toBeNull();
  expect(hyperOutlookFields(timed, item.location, item.body, 'UTC')).toMatchObject({ subject: 'Planning', start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T09:00:00.000Z' });
});
it('paints each event with its HyperTask colour token, and the Outlook default when it has none', () => {
  const [plain] = hyperOutlookMapEvents([item], 'UTC'), [blue] = hyperOutlookMapEvents([{ ...item, categories: ['Work', 'HyperTask Blue'] }], 'UTC');
  expect(plain.color).toBe('var(--hyper-outlook-color, var(--color-sky-500))'); expect(blue.color).toBe('var(--color-blue-500)');
  expect(hyperOutlookColorToken('gray')).toBe('var(--color-gray-500)'); expect(hyperOutlookColorToken(null)).toBe(plain.color);
});
