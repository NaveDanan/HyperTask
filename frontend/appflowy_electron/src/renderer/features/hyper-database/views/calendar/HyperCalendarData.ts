import { TZDate } from '@date-fns/tz';
import { addDays, addHours, format, startOfDay } from 'date-fns';
import { SelectOptionColorPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import type { CalendarEvent, EventCalendarDragState, EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import type { HyperCalendarEvent, HyperCell, HyperCellMutation } from '../../HyperDatabaseTypes';
import type { HyperDatabaseController } from '../../HyperDatabaseController';

export interface HyperCalendarEventData { rowId: string; dateFieldId: string }
export type HyperCalendarItem = CalendarEvent<HyperCalendarEventData>;
export interface HyperCalendarDraft {
  rowId?: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  isRange: boolean;
  endDate: string;
  endTime: string;
  optionId: string;
  readOnly?: boolean;
}
const HyperCalendarColors: Record<SelectOptionColorPB, string> = {
  [SelectOptionColorPB.Purple]: 'var(--color-violet-500)',
  [SelectOptionColorPB.Pink]: 'var(--color-pink-500)',
  [SelectOptionColorPB.LightPink]: 'var(--color-rose-500)',
  [SelectOptionColorPB.Orange]: 'var(--color-orange-500)',
  [SelectOptionColorPB.Yellow]: 'var(--color-amber-500)',
  [SelectOptionColorPB.Lime]: 'var(--color-lime-500)',
  [SelectOptionColorPB.Green]: 'var(--color-emerald-500)',
  [SelectOptionColorPB.Aqua]: 'var(--color-cyan-500)',
  [SelectOptionColorPB.Blue]: 'var(--color-blue-500)',
};
export function hyperCalendarColor(color?: SelectOptionColorPB) {
  return color === undefined ? 'var(--color-primary)' : HyperCalendarColors[color];
}
export function hyperCalendarSeconds(date: Date) { return BigInt(Math.floor(date.getTime() / 1000)); }
export function hyperCalendarDate(timestamp: bigint, timeZone: string) { return new TZDate(Number(timestamp) * 1000, timeZone); }
export function hyperCalendarMapEvent(event: HyperCalendarEvent, dateCell: HyperCell | undefined, colorCell: HyperCell | undefined, timeZone: string): HyperCalendarItem {
  const start = hyperCalendarDate(event.timestamp, timeZone);
  const allDay = !event.includeTime;
  const end = event.endTimestamp === null ? null : hyperCalendarDate(event.endTimestamp, timeZone);
  return {
    id: event.rowId, title: event.title.trim() || 'Untitled',
    start: allDay ? startOfDay(start) : start,
    end: allDay ? addDays(startOfDay(end ?? start), 1) : end && end > start ? end : addHours(start, 1),
    allDay, readOnly: Boolean(dateCell?.error),
    color: hyperCalendarColor(colorCell?.kind === 'singleSelect' ? colorCell.selected[0]?.color : undefined),
    data: { rowId: event.rowId, dateFieldId: event.dateFieldId },
  };
}
export function hyperCalendarDraft(start: Date, end: Date | undefined, allDay: boolean, timeZone: string): HyperCalendarDraft {
  const from = new TZDate(start, timeZone);
  const to = end ? new TZDate(end, timeZone) : addHours(from, 1);
  const inclusiveEnd = allDay && end ? addDays(to, -1) : to;
  return { title: '', allDay, startDate: format(from, 'yyyy-MM-dd'), startTime: allDay ? '09:00' : format(from, 'HH:mm'),
    isRange: allDay ? Boolean(end && inclusiveEnd > startOfDay(from)) : Boolean(end && to.getTime() - from.getTime() > 3600000),
    endDate: format(inclusiveEnd, 'yyyy-MM-dd'), endTime: allDay ? '10:00' : format(to, 'HH:mm'), optionId: '' };
}
function hyperCalendarInputDate(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const value = new TZDate(year, month - 1, day, hour, minute, 0, 0, timeZone);
  return Number.isFinite(value.getTime()) && format(value, 'yyyy-MM-dd') === date && format(value, 'HH:mm') === time ? value : null;
}
export function hyperCalendarDraftDates(draft: HyperCalendarDraft, timeZone: string) {
  const start = hyperCalendarInputDate(draft.startDate, draft.allDay ? '00:00' : draft.startTime, timeZone);
  const end = hyperCalendarInputDate(draft.endDate, draft.allDay ? '00:00' : draft.endTime, timeZone);
  if (!start || (draft.isRange && !end)) return { error: 'Choose a valid date and time.' } as const;
  if (draft.isRange && end && end < start) return { error: 'End must be after start' } as const;
  return { start, end: draft.isRange ? end : null } as const;
}
export function hyperCalendarUpdateMutation(update: EventCalendarProposedUpdate<HyperCalendarEventData>, previous: HyperCell | undefined): HyperCellMutation {
  const resizing = update.source === 'resize-start' || update.source === 'resize-end';
  const isRange = resizing || (previous?.kind === 'date' && previous.isRange);
  return { kind: 'date', timestamp: hyperCalendarSeconds(update.start), includeTime: !update.allDay, isRange,
    ...(isRange ? { endTimestamp: hyperCalendarSeconds(update.allDay ? addDays(startOfDay(update.end), -1) : update.end) } : {}) };
}
export async function hyperCalendarWriteUpdate(controller: Pick<HyperDatabaseController, 'moveCalendarEvent' | 'updateCell'>, update: EventCalendarProposedUpdate<HyperCalendarEventData>, previous: HyperCell | undefined) {
  const fieldId = update.event.data?.dateFieldId;
  if (!fieldId || update.event.readOnly || previous?.error) throw new Error('This event cannot be changed.');
  if (update.source === 'drag' && update.allDay === Boolean(update.event.allDay)) {
    await controller.moveCalendarEvent(update.event.id, fieldId, hyperCalendarSeconds(update.start));
  } else await controller.updateCell(update.event.id, fieldId, hyperCalendarUpdateMutation(update, previous));
}
export function hyperCalendarError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'msg' in error) return String(error.msg);
  return 'The calendar could not be updated. Please try again.';
}

export function hyperCalendarTypeOnlyUpdate(drag: EventCalendarDragState<HyperCalendarEventData> | null): EventCalendarProposedUpdate<HyperCalendarEventData> | null {
  if (!drag || !drag.valid || drag.kind !== 'move' || drag.occurrence.event.readOnly || drag.proposedAllDay === drag.occurrence.allDay) return null;
  if (drag.proposedStart.getTime() !== drag.occurrence.start.getTime() || drag.proposedEnd.getTime() !== drag.occurrence.end.getTime()) return null;
  return { event: drag.occurrence.event, occurrence: drag.occurrence, start: drag.proposedStart, end: drag.proposedEnd, allDay: drag.proposedAllDay, source: 'drag' };
}
