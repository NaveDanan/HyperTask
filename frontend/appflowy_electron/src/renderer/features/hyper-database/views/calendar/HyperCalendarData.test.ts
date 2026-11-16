import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { SelectOptionColorPB, SelectOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import type { EventCalendarDragState, EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import type { HyperCalendarEvent, HyperCell } from '../../HyperDatabaseTypes';
import { hyperCalendarDraft, hyperCalendarDraftDates, hyperCalendarMapEvent, hyperCalendarSeconds, hyperCalendarTypeOnlyUpdate, hyperCalendarWriteUpdate, type HyperCalendarEventData } from './HyperCalendarData';

const HyperCalendarSource: HyperCalendarEvent = { rowId: 'row', title: '  Planning  ', dateFieldId: 'date', timestamp: 0n, endTimestamp: null, includeTime: false, meta: create(RowMetaPBSchema, { id: 'row' }) };
const HyperCalendarDateCell: HyperCell = { kind: 'date', timestamp: 0n, endTimestamp: null, isRange: false, includeTime: false, reminderId: '', display: '' };
function hyperCalendarUpdate(patch: Partial<EventCalendarProposedUpdate<HyperCalendarEventData>> = {}): EventCalendarProposedUpdate<HyperCalendarEventData> {
  return { event: hyperCalendarMapEvent(HyperCalendarSource, HyperCalendarDateCell, undefined, 'UTC'), occurrence: null,
    start: new Date('2026-11-16T00:00:00Z'), end: new Date('2026-11-17T00:00:00Z'), allDay: true, source: 'drag', ...patch };
}
describe('HyperCalendar live row dates', () => {
  it('keeps epoch zero and translates inclusive all-day range ends to exclusive calendar ends', () => {
    const event = hyperCalendarMapEvent({ ...HyperCalendarSource, endTimestamp: 86400n }, HyperCalendarDateCell, undefined, 'UTC');
    expect(event.start.getTime()).toBe(0); expect(event.end.getTime()).toBe(172800000); expect(event.title).toBe('Planning');
  });
  it('uses a visual hour for timed rows without writing an invented range', async () => {
    const event = hyperCalendarMapEvent({ ...HyperCalendarSource, includeTime: true }, HyperCalendarDateCell, undefined, 'UTC');
    expect(event.end.getTime() - event.start.getTime()).toBe(3600000);
    const controller = { moveCalendarEvent: vi.fn(async () => {}), updateCell: vi.fn(async () => {}) };
    await hyperCalendarWriteUpdate(controller, hyperCalendarUpdate({ event, allDay: false }), HyperCalendarDateCell);
    expect(controller.moveCalendarEvent).toHaveBeenCalledWith('row', 'date', hyperCalendarSeconds(new Date('2026-11-16T00:00:00Z')));
    expect(controller.updateCell).not.toHaveBeenCalled();
  });
  it('uses select option colours, a neutral fallback and read-only cells', () => {
    const color: HyperCell = { kind: 'singleSelect', display: 'Work', options: [], selected: [create(SelectOptionPBSchema, { id: 'work', color: SelectOptionColorPB.Blue })] };
    expect(hyperCalendarMapEvent(HyperCalendarSource, { ...HyperCalendarDateCell, error: 'Decode failed' }, color, 'UTC')).toMatchObject({ color: 'var(--color-blue-500)', readOnly: true });
    expect(hyperCalendarMapEvent({ ...HyperCalendarSource, title: ' ' }, undefined, undefined, 'UTC')).toMatchObject({ title: 'Untitled', color: 'var(--color-primary)' });
  });
  it('normalizes all-day boundaries in the display zone across daylight-saving changes', () => {
    const event = hyperCalendarMapEvent({ ...HyperCalendarSource, timestamp: 1793505600n, endTimestamp: 1793595600n }, undefined, undefined, 'America/New_York');
    expect(event.start.getHours()).toBe(0); expect(event.end.getHours()).toBe(0);
    expect(event.end.getTime() - event.start.getTime()).toBe(49 * 3600000);
  });
  it('persists resize-end with an inclusive all-day endpoint and marks the cell a range', async () => {
    const controller = { moveCalendarEvent: vi.fn(async () => {}), updateCell: vi.fn(async () => {}) };
    await hyperCalendarWriteUpdate(controller, hyperCalendarUpdate({ source: 'resize-end', end: new Date('2026-11-19T00:00:00Z') }), HyperCalendarDateCell);
    expect(controller.updateCell).toHaveBeenCalledWith('row', 'date', { kind: 'date', timestamp: 1794787200n, endTimestamp: 1794960000n, includeTime: false, isRange: true });
  });
  it('persists the start endpoint on a resize-start and toggles includeTime across the all-day lane', async () => {
    const controller = { moveCalendarEvent: vi.fn(async () => {}), updateCell: vi.fn(async () => {}) };
    const start = new Date('2026-11-16T09:00:00Z'); const end = new Date('2026-11-16T11:00:00Z');
    await hyperCalendarWriteUpdate(controller, hyperCalendarUpdate({ source: 'resize-start', start, end, allDay: false }), HyperCalendarDateCell);
    expect(controller.updateCell).toHaveBeenLastCalledWith('row', 'date', { kind: 'date', timestamp: hyperCalendarSeconds(start), endTimestamp: hyperCalendarSeconds(end), includeTime: true, isRange: true });
    await hyperCalendarWriteUpdate(controller, hyperCalendarUpdate({ start, end, allDay: false }), HyperCalendarDateCell);
    expect(controller.updateCell).toHaveBeenLastCalledWith('row', 'date', { kind: 'date', timestamp: hyperCalendarSeconds(start), includeTime: true, isRange: false });
  });
  it('propagates rejected core writes and blocks cells with errors', async () => {
    const controller = { moveCalendarEvent: vi.fn(async () => { throw new Error('Core unavailable'); }), updateCell: vi.fn(async () => { throw new Error('Core unavailable'); }) };
    await expect(hyperCalendarWriteUpdate(controller, hyperCalendarUpdate(), HyperCalendarDateCell)).rejects.toThrow('Core unavailable');
    await expect(hyperCalendarWriteUpdate(controller, hyperCalendarUpdate(), { ...HyperCalendarDateCell, error: 'Decode failed' })).rejects.toThrow('cannot be changed');
  });
  it('prefills selected slots, validates endpoints and writes seconds in the selected zone', () => {
    const draft = hyperCalendarDraft(new Date('2026-11-16T09:00:00Z'), new Date('2026-11-16T11:00:00Z'), false, 'UTC');
    expect(draft).toMatchObject({ startDate: '2026-11-16', startTime: '09:00', endTime: '11:00', isRange: true });
    expect(hyperCalendarDraftDates({ ...draft, endTime: '08:00' }, 'UTC').error).toBe('End must be after start');
    const dates = hyperCalendarDraftDates(draft, 'America/New_York');
    expect(dates.start?.getTime()).toBe(new Date('2026-11-16T14:00:00.000Z').getTime());
    expect(hyperCalendarDraftDates({ ...draft, startDate: '2026-02-30' }, 'UTC').error).toBe('Choose a valid date and time.');
    expect(hyperCalendarDraftDates({ ...draft, startDate: '2026-03-08', startTime: '02:30' }, 'America/New_York').error).toBe('Choose a valid date and time.');
  });
});

function hyperCalendarFlagDrag(): EventCalendarDragState<HyperCalendarEventData> {
  const event = hyperCalendarMapEvent(HyperCalendarSource, HyperCalendarDateCell, undefined, 'UTC');
  return { kind: 'move', occurrence: { key: 'row::epoch', eventId: 'row', event, start: event.start, end: event.end, allDay: true, isRecurring: false }, proposedStart: event.start, proposedEnd: event.end, proposedAllDay: false, proposedDayGranular: false, valid: true };
}
describe('HyperCalendar all-day conversion bridge', () => {
  it('writes a conversion when the vendor skips unchanged timestamps', async () => {
    const update = hyperCalendarTypeOnlyUpdate(hyperCalendarFlagDrag());
    expect(update).toMatchObject({ allDay: false, source: 'drag' });
    const controller = { moveCalendarEvent: vi.fn(async () => {}), updateCell: vi.fn(async () => {}) };
    if (!update) throw new Error('Expected the all-day conversion');
    await hyperCalendarWriteUpdate(controller, update, HyperCalendarDateCell);
    expect(controller.updateCell).toHaveBeenCalledWith('row', 'date', { kind: 'date', timestamp: 0n, includeTime: true, isRange: false });
  });
  it('does not duplicate ordinary vendor commits or accept invalid drops', () => {
    const drag = hyperCalendarFlagDrag();
    expect(hyperCalendarTypeOnlyUpdate({ ...drag, valid: false })).toBeNull();
    expect(hyperCalendarTypeOnlyUpdate({ ...drag, kind: 'resize-end' })).toBeNull();
    expect(hyperCalendarTypeOnlyUpdate({ ...drag, proposedStart: new Date(86400000) })).toBeNull();
    expect(hyperCalendarTypeOnlyUpdate({ ...drag, proposedAllDay: true })).toBeNull();
  });
});


it.each([15, 30, 60])('preserves an explicit %s-minute timed selection through save and mapping', minutes => {
  const start = new Date('2026-11-15T09:00:00Z'); const end = new Date(start.getTime() + minutes * 60000);
  const draft = hyperCalendarDraft(start, end, false, 'UTC'); const dates = hyperCalendarDraftDates(draft, 'UTC');
  expect(draft.isRange).toBe(true); expect(dates.end?.getTime()).toBe(end.getTime());
  const event = hyperCalendarMapEvent({ ...HyperCalendarSource, timestamp: hyperCalendarSeconds(start), endTimestamp: hyperCalendarSeconds(dates.end!), includeTime: true }, HyperCalendarDateCell, undefined, 'UTC');
  expect(event.end.getTime() - event.start.getTime()).toBe(minutes * 60000);
});
it('moves a two-day all-day range off a DST transition without losing a day', async () => {
  const start = new TZDate(2026, 2, 8, 0, 0, 0, 'America/New_York'); const due = addDays(start, 1);
  const previous = { ...HyperCalendarDateCell, timestamp: hyperCalendarSeconds(start), endTimestamp: hyperCalendarSeconds(due), isRange: true };
  const event = hyperCalendarMapEvent({ ...HyperCalendarSource, timestamp: previous.timestamp, endTimestamp: previous.endTimestamp }, previous, undefined, 'America/New_York');
  const next = addDays(start, 2); const controller = { moveCalendarEvent: vi.fn(), updateCell: vi.fn(async () => {}) };
  await hyperCalendarWriteUpdate(controller, { event, occurrence: null, start: new Date(next), end: new Date(addDays(next, 2)), allDay: true, source: 'drag' }, previous);
  expect(controller.moveCalendarEvent).not.toHaveBeenCalled();
  expect(controller.updateCell).toHaveBeenCalledWith('row', 'date', expect.objectContaining({ timestamp: hyperCalendarSeconds(next), endTimestamp: hyperCalendarSeconds(addDays(next, 1)), isRange: true }));
});
