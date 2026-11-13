import { clone } from '@bufbuild/protobuf';
import { CalendarLayoutPB, CalendarLayoutSettingPBSchema, type CalendarLayoutSettingPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { hyperDatabaseDateParts, hyperDatabaseDateZone } from './HyperDatabaseDate';

export const hyperCalendarPeriodLayouts = [CalendarLayoutPB.DayLayout, CalendarLayoutPB.WeekLayout, CalendarLayoutPB.MonthLayout] as const;
export type HyperCalendarPeriodKind = 'day' | 'week' | 'month';
export type HyperCalendarPeriodReason = 'unsupported' | 'invalidDate' | 'changed' | 'unavailable' | 'uncertain';
export class HyperCalendarPeriodError extends Error {
  constructor(readonly reason: HyperCalendarPeriodReason) { super(reason); this.name = 'HyperCalendarPeriodError'; }
}
export interface HyperCalendarPeriodFrame {
  kind: HyperCalendarPeriodKind;
  layoutTy: CalendarLayoutPB;
  anchorDay: string;
  firstDayOfWeek: number;
  startDay: string;
  endDay: string;
  days: readonly string[];
  columns: 1 | 7;
  currentMonth: number;
}
export function hyperCalendarPeriodKind(value: number): HyperCalendarPeriodKind | null {
  return value === CalendarLayoutPB.DayLayout ? 'day' : value === CalendarLayoutPB.WeekLayout ? 'week' : value === CalendarLayoutPB.MonthLayout ? 'month' : null;
}
function civil(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  if (!match) throw new HyperCalendarPeriodError('invalidDate');
  const [year, month, date] = match.slice(1).map(Number), value = new Date(0);
  value.setUTCFullYear(year, month - 1, date); value.setUTCHours(0, 0, 0, 0);
  if (year < 1 || year > 9999 || value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== date) throw new HyperCalendarPeriodError('invalidDate');
  return value;
}
function dayOf(value: Date): string {
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) throw new HyperCalendarPeriodError('invalidDate');
  return value.toISOString().slice(0, 10);
}
function plusDays(value: Date, days: number) { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; }
/** Navigation uses civil dates, so DST gaps/folds never add or repeat a grid day. */
export function hyperCalendarPeriodFrame(anchorDay: string, layoutTy: number, firstDayOfWeek = 0): HyperCalendarPeriodFrame {
  const kind = hyperCalendarPeriodKind(layoutTy);
  if (!kind || !Number.isInteger(firstDayOfWeek) || firstDayOfWeek < 0 || firstDayOfWeek > 6) throw new HyperCalendarPeriodError('unsupported');
  const anchor = civil(anchorDay), currentMonth = anchor.getUTCMonth() + 1;
  let start = new Date(anchor), end = new Date(anchor), grid = new Date(anchor), length = 1;
  if (kind === 'week') {
    start = plusDays(anchor, -((anchor.getUTCDay() - firstDayOfWeek + 7) % 7));
    end = plusDays(start, 6); grid = start; length = 7;
  } else if (kind === 'month') {
    start.setUTCDate(1); end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1, 0);
    grid = plusDays(start, -((start.getUTCDay() - firstDayOfWeek + 7) % 7)); length = 42;
  }
  return { kind, layoutTy, anchorDay, firstDayOfWeek, startDay: dayOf(start), endDay: dayOf(end), days: Array.from({ length }, (_, index) => dayOf(plusDays(grid, index))), columns: kind === 'day' ? 1 : 7, currentMonth };
}
export function hyperCalendarPeriodToday(timezoneId: string, timestamp = BigInt(Math.floor(Date.now() / 1000))): string {
  return hyperDatabaseDateParts(timestamp, hyperDatabaseDateZone(timezoneId)).day;
}
export function hyperCalendarPeriodMove(frame: HyperCalendarPeriodFrame, direction: -1 | 1): string {
  if (direction !== -1 && direction !== 1) throw new HyperCalendarPeriodError('invalidDate');
  const value = civil(frame.anchorDay);
  if (frame.kind === 'month') value.setUTCMonth(value.getUTCMonth() + direction, 1);
  else value.setUTCDate(value.getUTCDate() + direction * (frame.kind === 'week' ? 7 : 1));
  const next = dayOf(value);
  hyperCalendarPeriodFrame(next, frame.layoutTy, frame.firstDayOfWeek);
  return next;
}
export function hyperCalendarPeriodLabel(frame: HyperCalendarPeriodFrame, locale?: string): string {
  const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', calendar: 'gregory', year: 'numeric', month: frame.kind === 'month' ? 'long' : 'short', ...(frame.kind === 'month' ? {} : { day: 'numeric' }), ...(frame.kind === 'day' ? { weekday: 'long' } : {}) };
  const format = new Intl.DateTimeFormat(locale, options);
  return frame.kind === 'week' ? format.formatRange(civil(frame.startDay), civil(frame.endDay)) : format.format(civil(frame.startDay));
}
export function hyperCalendarPeriodSettingsEditable(setting: CalendarLayoutSettingPB | null | undefined): setting is CalendarLayoutSettingPB {
  return !!setting && !setting.$unknown?.length && hyperCalendarPeriodKind(setting.layoutTy) !== null && Number.isInteger(setting.firstDayOfWeek) && setting.firstDayOfWeek >= 0 && setting.firstDayOfWeek <= 6;
}
/** Only the native period changes. Other settings, including explicit false, stay intact. */
export function hyperCalendarPeriodSetting(setting: CalendarLayoutSettingPB, layoutTy: CalendarLayoutPB): CalendarLayoutSettingPB {
  if (!hyperCalendarPeriodSettingsEditable(setting) || !hyperCalendarPeriodKind(layoutTy)) throw new HyperCalendarPeriodError('unsupported');
  if (layoutTy === setting.layoutTy) return setting;
  const next = clone(CalendarLayoutSettingPBSchema, setting); next.layoutTy = layoutTy; return next;
}
/** Match AppFlowy's picker while keeping other saved native weekdays intact. */
export const hyperCalendarWeekStartChoices = [0, 1] as const;
export function hyperCalendarWeekdayLabel(day: number, locale?: string): string {
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new HyperCalendarPeriodError('unsupported');
  return new Intl.DateTimeFormat(locale, { weekday: 'long', calendar: 'gregory', timeZone: 'UTC' }).format(new Date(Date.UTC(2017, 0, 1 + day)));
}
export function hyperCalendarWeekStartSetting(setting: CalendarLayoutSettingPB, firstDayOfWeek: number): CalendarLayoutSettingPB {
  if (!hyperCalendarPeriodSettingsEditable(setting) || !hyperCalendarWeekStartChoices.some(day => day === firstDayOfWeek)) throw new HyperCalendarPeriodError('unsupported');
  if (setting.layoutTy === CalendarLayoutPB.DayLayout) throw new HyperCalendarPeriodError('changed');
  if (firstDayOfWeek === setting.firstDayOfWeek) return setting;
  const next = clone(CalendarLayoutSettingPBSchema, setting); next.firstDayOfWeek = firstDayOfWeek; return next;
}
