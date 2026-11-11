import { hyperDatabaseDateCandidates, hyperDatabaseDateParts, hyperDatabaseDateZone } from './HyperDatabaseDate';
import { hyperDatabaseDateFilterEmpty, hyperDatabaseDateFilterRange, type HyperDatabaseDateFilterForm, type HyperDatabaseDateFilterValue } from './HyperDatabaseDateFilter';
export function hyperDatabaseTimestampFilterForm(value: HyperDatabaseDateFilterValue): HyperDatabaseDateFilterForm {
  const day = (value?: bigint) => { try { return value === undefined ? '' : hyperDatabaseDateParts(value, '').day; } catch { return ''; } };
  return { condition: value.condition, day: day(value.timestamp), start: day(value.start), end: day(value.end) };
}
export function hyperDatabaseTimestampFilterEdit(original: HyperDatabaseDateFilterValue, form: HyperDatabaseDateFilterForm) {
  if (original.condition < 0 || original.condition > 7 || form.condition < 0 || form.condition > 7) throw Error('unsupported');
  const before = hyperDatabaseTimestampFilterForm(original), range = hyperDatabaseDateFilterRange(form.condition), empty = hyperDatabaseDateFilterEmpty(form.condition);
  const changed = before.condition !== form.condition || !empty && (range ? before.start !== form.start || before.end !== form.end : before.day !== form.day);
  if (!changed) return { value: original, changed: false };
  const instant = (day: string) => {
    const zone = hyperDatabaseDateZone('');
    // A filter selects a day rather than a clock occurrence. Do not normalize a skipped day.
    for (const hour of [12, ...Array.from({ length: 24 }, (_, hour) => hour)]) { const candidate = hyperDatabaseDateCandidates(day, `${String(hour).padStart(2, '0')}:00:00`, zone)[0]; if (candidate !== undefined) return candidate; }
    throw Error('invalidDate');
  };
  const value: HyperDatabaseDateFilterValue = { condition: form.condition, useFieldTimezone: original.useFieldTimezone };
  if (!empty) {
    if (range) { if (form.end < form.start) throw Error('endBeforeStart'); value.start = instant(form.start); value.end = instant(form.end); }
    else value.timestamp = instant(form.day);
  }
  return { value, changed: true };
}
