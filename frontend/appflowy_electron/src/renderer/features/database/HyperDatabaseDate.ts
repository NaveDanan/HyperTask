import { clone, fromBinary } from '@bufbuild/protobuf';
import { DateFormatPB, DateTypeOptionPBSchema, TimeFormatPB, type DateCellChangesetPB, type DateCellDataPB, type DateTypeOptionPB } from '@shared/protobuf/flowy-database2/date_entities_pb';

export interface HyperDatabaseDateMutation { timestamp?: bigint; endTimestamp?: bigint; includeTime?: boolean; isRange?: boolean; clearFlag?: boolean }
export interface HyperDatabaseDateParts { day: string; time: string }
export interface HyperDatabaseDateForm {
  start: string; startTime: string; end: string; endTime: string;
  includeTime: string; isRange: string; startChoice: string; endChoice: string;
}
export class HyperDatabaseDateError extends Error {
  constructor(public reason: 'invalidDate' | 'invalidTime' | 'invalidZone' | 'gap' | 'fold' | 'endBeforeStart' | 'unsupported' | 'reminder' | 'pending' | 'changed') { super(reason); }
}
export const hyperDatabaseDateFormats = [DateFormatPB.Local, DateFormatPB.US, DateFormatPB.ISO, DateFormatPB.Friendly, DateFormatPB.DayMonthYear, DateFormatPB.FriendlyFull];
export const hyperDatabaseTimeFormats = [TimeFormatPB.TwelveHour, TimeFormatPB.TwentyFourHour];
const zoneNames = new Map<string, string>();
export function hyperDatabaseDateZone(zone: string): string {
  const selected = zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (/^[+-]/.test(selected)) throw new HyperDatabaseDateError('invalidZone');
  if (zoneNames.has(selected)) return zoneNames.get(selected)!;
  try { const canonical = new Intl.DateTimeFormat('en', { timeZone: selected }).resolvedOptions().timeZone; zoneNames.set(selected, canonical); return canonical; }
  catch { throw new HyperDatabaseDateError('invalidZone'); }
}
const pad = (value: number) => String(value).padStart(2, '0');
function utcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0); return date;
}
function wall(day: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!dateMatch) throw new HyperDatabaseDateError('invalidDate');
  const [, y, m, d] = dateMatch, date = utcDate(Number(y), Number(m), Number(d));
  if (Number(y) < 1 || date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) throw new HyperDatabaseDateError('invalidDate');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59 || Number(timeMatch[3] ?? 0) > 59) throw new HyperDatabaseDateError('invalidTime');
  date.setUTCHours(Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3] ?? 0));
  return date.getTime();
}
const partFormatters = new Map<string, Intl.DateTimeFormat>();
function zonedParts(milliseconds: number, zone: string) {
  let formatter = partFormatters.get(zone);
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); partFormatters.set(zone, formatter); }
  return Object.fromEntries(formatter.formatToParts(milliseconds).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
export function hyperDatabaseDateParts(timestamp: bigint, timezoneId = ''): HyperDatabaseDateParts {
  const milliseconds = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) throw new HyperDatabaseDateError('invalidDate');
  const parts = zonedParts(milliseconds, hyperDatabaseDateZone(timezoneId));
  if (parts.era !== 'AD') throw new HyperDatabaseDateError('invalidDate');
  const day = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}:${parts.second}`;
  wall(day, time); return { day, time };
}
/** Resolve a wall clock without Date.parse's silent DST normalization. Every candidate is round-trip checked. */
export function hyperDatabaseDateCandidates(day: string, time: string, timezoneId = ''): bigint[] {
  const naive = wall(day, time), zone = hyperDatabaseDateZone(timezoneId), offsets = new Set<number>();
  // Sample both sides of nearby transitions, including half-hour changes and skipped dates.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = naive + hours * 3_600_000, parts = zonedParts(sample, zone);
    if (parts.era !== 'AD') continue;
    offsets.add(utcDate(Number(parts.year), Number(parts.month), Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)).getTime() - sample);
  }
  const expectedTime = time.length === 5 ? time + ':00' : time;
  return [...offsets].map(offset => BigInt((naive - offset) / 1000)).filter(timestamp => {
    try { const parts = hyperDatabaseDateParts(timestamp, zone); return parts.day === day && parts.time === expectedTime; } catch { return false; }
  }).filter((value, index, values) => values.indexOf(value) === index).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
export function hyperDatabaseDateOffset(timestamp: bigint, timezoneId = '') {
  const zone = hyperDatabaseDateZone(timezoneId), parts = hyperDatabaseDateParts(timestamp, zone);
  const offset = Math.round((wall(parts.day, parts.time) - Number(timestamp) * 1000) / 60_000), absolute = Math.abs(offset);
  return `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
export function hyperDatabaseDateOptions(bytes: Uint8Array): DateTypeOptionPB { return fromBinary(DateTypeOptionPBSchema, bytes); }
export function hyperDatabaseDateOptionsEditable(options: DateTypeOptionPB) {
  return !options.$unknown?.length && hyperDatabaseDateFormats.includes(options.dateFormat) && hyperDatabaseTimeFormats.includes(options.timeFormat);
}
export function hyperDatabaseDateEditable(data: DateCellDataPB, options: DateTypeOptionPB) {
  if (data.reminderId || data.$unknown?.length || !hyperDatabaseDateOptionsEditable(options)) return false;
  try {
    hyperDatabaseDateZone(options.timezoneId);
    for (const timestamp of [data.oneOfTimestamp, data.oneOfEndTimestamp]) if (timestamp.case) hyperDatabaseDateParts(timestamp.value, options.timezoneId);
    return true;
  } catch { return false; }
}
export function hyperDatabaseDateDisplay(data: DateCellDataPB, options: DateTypeOptionPB, locale?: string) {
  const format = (timestamp: bigint) => {
    let parts: HyperDatabaseDateParts;
    try { parts = hyperDatabaseDateParts(timestamp, options.timezoneId); } catch { return timestamp.toString(); }
    const [year, month, day] = parts.day.split('-'), [hours, minutes, seconds] = parts.time.split(':');
    let date: string;
    switch (options.dateFormat) {
      case DateFormatPB.Local: date = `${month}/${day}/${year}`; break;
      case DateFormatPB.US: date = `${year}/${month}/${day}`; break;
      case DateFormatPB.DayMonthYear: date = `${day}/${month}/${year}`; break;
      case DateFormatPB.Friendly: case DateFormatPB.FriendlyFull: {
        const monthName = new Intl.DateTimeFormat(locale, { month: options.dateFormat === DateFormatPB.Friendly ? 'short' : 'long', timeZone: 'UTC' }).format(utcDate(Number(year), Number(month), Number(day)));
        date = `${monthName} ${options.dateFormat === DateFormatPB.Friendly ? day : Number(day)}, ${year}`; break;
      }
      default: date = parts.day;
    }
    if (!data.includeTime) return date;
    const suffix = seconds === '00' ? '' : ':' + seconds;
    return date + ' ' + (options.timeFormat === TimeFormatPB.TwelveHour ? `${pad(Number(hours) % 12 || 12)}:${minutes}${suffix} ${Number(hours) < 12 ? 'AM' : 'PM'}` : `${hours}:${minutes}${suffix}`);
  };
  if (data.oneOfTimestamp.case !== 'timestamp') return '';
  const start = format(data.oneOfTimestamp.value), end = data.oneOfEndTimestamp.case === 'endTimestamp' ? data.oneOfEndTimestamp.value : data.oneOfTimestamp.value;
  return data.isRange ? `${start} → ${format(end)}` : start;
}
export function hyperDatabaseDateInitial(data: DateCellDataPB, options: DateTypeOptionPB): HyperDatabaseDateForm {
  const start = data.oneOfTimestamp.case === 'timestamp' ? hyperDatabaseDateParts(data.oneOfTimestamp.value, options.timezoneId) : { day: '', time: '00:00:00' };
  const end = data.oneOfEndTimestamp.case === 'endTimestamp' ? hyperDatabaseDateParts(data.oneOfEndTimestamp.value, options.timezoneId) : start;
  return { start: start.day, startTime: start.time, end: end.day, endTime: end.time, includeTime: data.includeTime ? '1' : '0', isRange: data.isRange ? '1' : '0', startChoice: data.oneOfTimestamp.case === 'timestamp' ? String(data.oneOfTimestamp.value) : '', endChoice: data.oneOfEndTimestamp.case === 'endTimestamp' ? String(data.oneOfEndTimestamp.value) : '' };
}
export function hyperDatabaseDateMutation(data: DateCellDataPB, options: DateTypeOptionPB, form: HyperDatabaseDateForm): HyperDatabaseDateMutation {
  if (data.reminderId) throw new HyperDatabaseDateError('reminder');
  if (!hyperDatabaseDateEditable(data, options)) throw new HyperDatabaseDateError('unsupported');
  const includeTime = form.includeTime === '1', isRange = form.isRange === '1';
  const resolve = (day: string, time: string, choice: string, previous: DateCellDataPB['oneOfTimestamp'] | DateCellDataPB['oneOfEndTimestamp']) => {
    // Toggling time visibility must preserve an existing hidden time and seconds.
    if (!includeTime && previous.case && hyperDatabaseDateParts(previous.value, options.timezoneId).day === day) return previous.value;
    const candidates = hyperDatabaseDateCandidates(day, includeTime ? time : previous.case ? hyperDatabaseDateParts(previous.value, options.timezoneId).time : '00:00:00', options.timezoneId);
    if (!candidates.length) throw new HyperDatabaseDateError('gap');
    if (candidates.length === 1) return candidates[0];
    const selected = candidates.find(timestamp => String(timestamp) === choice);
    if (selected === undefined) throw new HyperDatabaseDateError('fold');
    return selected;
  };
  const timestamp = resolve(form.start, form.startTime, form.startChoice, data.oneOfTimestamp);
  const endTimestamp = isRange ? resolve(form.end || form.start, form.endTime, form.endChoice, data.oneOfEndTimestamp.case ? data.oneOfEndTimestamp : data.oneOfTimestamp) : undefined;
  if (endTimestamp !== undefined && endTimestamp < timestamp) throw new HyperDatabaseDateError('endBeforeStart');
  return { timestamp, ...(isRange ? { endTimestamp } : {}), includeTime, isRange };
}
export function hyperDatabaseDateChangeset(changes: HyperDatabaseDateMutation): Partial<Pick<DateCellChangesetPB, 'oneOfTimestamp' | 'oneOfEndTimestamp' | 'oneOfIncludeTime' | 'oneOfIsRange' | 'oneOfClearFlag'>> {
  if (changes.timestamp !== undefined && typeof changes.timestamp !== 'bigint' || changes.endTimestamp !== undefined && typeof changes.endTimestamp !== 'bigint') throw new HyperDatabaseDateError('invalidDate');
  if (changes.clearFlag) return { oneOfClearFlag: { case: 'clearFlag', value: true } };
  if (changes.timestamp !== undefined && changes.isRange === undefined || changes.isRange === true && (changes.timestamp !== undefined) !== (changes.endTimestamp !== undefined) || changes.endTimestamp !== undefined && changes.isRange !== true) throw new HyperDatabaseDateError('invalidDate');
  if (changes.timestamp !== undefined && changes.endTimestamp !== undefined && changes.endTimestamp < changes.timestamp) throw new HyperDatabaseDateError('endBeforeStart');
  return {
    ...(changes.timestamp !== undefined ? { oneOfTimestamp: { case: 'timestamp' as const, value: changes.timestamp } } : {}),
    ...(changes.endTimestamp !== undefined ? { oneOfEndTimestamp: { case: 'endTimestamp' as const, value: changes.endTimestamp } } : {}),
    ...(changes.includeTime !== undefined ? { oneOfIncludeTime: { case: 'includeTime' as const, value: changes.includeTime } } : {}),
    ...(changes.isRange !== undefined ? { oneOfIsRange: { case: 'isRange' as const, value: changes.isRange } } : {}),
  };
}
export function hyperDatabaseDateCloneOptions(options: DateTypeOptionPB, changes: Partial<Pick<DateTypeOptionPB, 'dateFormat' | 'timeFormat' | 'timezoneId'>>) {
  if (!hyperDatabaseDateOptionsEditable(options)) throw new HyperDatabaseDateError('unsupported');
  const next = clone(DateTypeOptionPBSchema, options); Object.assign(next, changes);
  if (!hyperDatabaseDateOptionsEditable(next)) throw new HyperDatabaseDateError('unsupported');
  const zone = hyperDatabaseDateZone(next.timezoneId);
  if (next.timezoneId && next.timezoneId !== options.timezoneId) next.timezoneId = zone;
  return next;
}
