import { DateFilterConditionPB } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { hyperDateInput, hyperDateTimestamp } from './HyperDatabaseCells';
import { hyperDatabaseDateParts } from './HyperDatabaseDate';

/** Criteria are logical date tokens, not instants to convert into the property zone. */
export interface HyperDatabaseDateFilterValue { condition: DateFilterConditionPB; timestamp?: bigint; start?: bigint; end?: bigint; useFieldTimezone: boolean }
export interface HyperDatabaseDateFilterForm { condition: DateFilterConditionPB; day: string; start: string; end: string }
export const hyperDatabaseDateFilterConditions = Array.from({ length: 16 }, (_, index) => index as DateFilterConditionPB);
export const hyperDatabaseDateFilterRange = (condition: DateFilterConditionPB) => condition === DateFilterConditionPB.DateStartsBetween || condition === DateFilterConditionPB.DateEndsBetween;
export const hyperDatabaseDateFilterEmpty = (condition: DateFilterConditionPB) => [DateFilterConditionPB.DateStartIsEmpty, DateFilterConditionPB.DateStartIsNotEmpty, DateFilterConditionPB.DateEndIsEmpty, DateFilterConditionPB.DateEndIsNotEmpty].includes(condition);
export function hyperDatabaseDateFilterForm(value: HyperDatabaseDateFilterValue): HyperDatabaseDateFilterForm {
  const day = (timestamp?: bigint) => timestamp === undefined ? '' : hyperDateInput(timestamp);
  return { condition: value.condition, day: day(value.timestamp), start: day(value.start), end: day(value.end) };
}
export function hyperDatabaseDateFilterCriteria(form: HyperDatabaseDateFilterForm) {
  return hyperDatabaseDateFilterEmpty(form.condition) ? '' : hyperDatabaseDateFilterRange(form.condition) ? [form.start, form.end].join(' – ') : form.day;
}
export function hyperDatabaseDateFilterNew(timezoneId: string, now = BigInt(Math.floor(Date.now() / 1000))): HyperDatabaseDateFilterValue {
  return { condition: DateFilterConditionPB.DateStartsOn, timestamp: hyperDateTimestamp(hyperDatabaseDateParts(now, timezoneId).day), useFieldTimezone: true };
}
export function hyperDatabaseDateFilterChanged(original: HyperDatabaseDateFilterValue, form: HyperDatabaseDateFilterForm) {
  const before = hyperDatabaseDateFilterForm(original), range = hyperDatabaseDateFilterRange(form.condition), empty = hyperDatabaseDateFilterEmpty(form.condition);
  return form.condition !== before.condition || (!empty && (range ? form.start !== before.start || form.end !== before.end : form.day !== before.day));
}
export function hyperDatabaseDateFilterEdit(original: HyperDatabaseDateFilterValue, form: HyperDatabaseDateFilterForm, explicitlyOptIn = false): { value: HyperDatabaseDateFilterValue; changed: boolean } {
  if (!hyperDatabaseDateFilterConditions.includes(original.condition) || !hyperDatabaseDateFilterConditions.includes(form.condition)) throw new Error('unsupported');
  const range = hyperDatabaseDateFilterRange(form.condition), empty = hyperDatabaseDateFilterEmpty(form.condition);
  const changed = hyperDatabaseDateFilterChanged(original, form);
  // Keep exact legacy numbers and the absent/false policy on inspection or unchanged Save.
  if (!changed && (!explicitlyOptIn || original.useFieldTimezone)) return { value: original, changed: false };
  const value: HyperDatabaseDateFilterValue = { condition: form.condition, useFieldTimezone: true };
  if (!empty) {
    if (range) { value.start = hyperDateTimestamp(form.start); value.end = hyperDateTimestamp(form.end); if (value.end < value.start) throw new Error('endBeforeStart'); }
    else value.timestamp = hyperDateTimestamp(form.day);
  }
  return { value, changed: true };
}
