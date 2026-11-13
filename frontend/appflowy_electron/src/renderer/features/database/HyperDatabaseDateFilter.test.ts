import { describe, expect, it } from 'vitest';
import { DateFilterConditionPB as Condition } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { hyperDateTimestamp } from './HyperDatabaseCells';
import { hyperDatabaseDateFilterEdit, hyperDatabaseDateFilterForm, hyperDatabaseDateFilterNew, type HyperDatabaseDateFilterValue } from './HyperDatabaseDateFilter';

describe('opt-in date filter criteria', () => {
  it('creates logical UTC day tokens from the field-zone day, without shifting the criterion into that zone again', () => {
    const now = hyperDateTimestamp('2026-11-11') + 3600n;
    expect(hyperDatabaseDateFilterNew('America/New_York', now).timestamp).toBe(hyperDateTimestamp('2026-11-10'));
    expect(hyperDatabaseDateFilterNew('Asia/Kathmandu', now).timestamp).toBe(hyperDateTimestamp('2026-11-11'));
    const source = hyperDatabaseDateFilterNew('America/New_York', now), form = { ...hyperDatabaseDateFilterForm(source), day: '2026-11-11' };
    const result = hyperDatabaseDateFilterEdit(source, form); expect(result.value.timestamp).toBe(hyperDateTimestamp('2026-11-11')); expect(result.value.useFieldTimezone).toBe(true);
  });
  it('preserves the original legacy object and non-midnight criterion on unchanged Save', () => {
    const source: HyperDatabaseDateFilterValue = { condition: Condition.DateStartsOn, timestamp: hyperDateTimestamp('2026-11-11') + 12_345n, useFieldTimezone: false };
    const result = hyperDatabaseDateFilterEdit(source, hyperDatabaseDateFilterForm(source)); expect(result.value).toBe(source); expect(result.changed).toBe(false);
  });
  it('opts in only when a criterion/operator is deliberately edited or the policy action is selected', () => {
    const source: HyperDatabaseDateFilterValue = { condition: Condition.DateStartsOn, timestamp: hyperDateTimestamp('2026-11-11'), useFieldTimezone: false }, form = hyperDatabaseDateFilterForm(source);
    expect(hyperDatabaseDateFilterEdit(source, { ...form, condition: Condition.DateStartsAfter }).value.useFieldTimezone).toBe(true);
    expect(hyperDatabaseDateFilterEdit(source, form, true)).toMatchObject({ changed: true, value: { useFieldTimezone: true, timestamp: source.timestamp } });
    expect(source.useFieldTimezone).toBe(false);
  });
  it('does not upgrade an empty filter because an unused hidden criterion changed', () => {
    const source: HyperDatabaseDateFilterValue = { condition: Condition.DateStartIsEmpty, timestamp: 0n, useFieldTimezone: false };
    expect(hyperDatabaseDateFilterEdit(source, { ...hyperDatabaseDateFilterForm(source), day: '2026-11-11' }).changed).toBe(false);
  });
  it('validates range order, impossible days and unknown operators before serializing an edit', () => {
    const source: HyperDatabaseDateFilterValue = { condition: Condition.DateStartsOn, timestamp: 0n, useFieldTimezone: true }, form = hyperDatabaseDateFilterForm(source);
    expect(() => hyperDatabaseDateFilterEdit(source, { ...form, condition: Condition.DateStartsBetween, start: '2026-11-12', end: '2026-11-11' })).toThrow('endBeforeStart');
    expect(() => hyperDatabaseDateFilterEdit(source, { ...form, day: '2026-02-30' })).toThrow('Invalid date');
    expect(() => hyperDatabaseDateFilterEdit({ ...source, condition: 99 as Condition }, form)).toThrow('unsupported');
  });
});
