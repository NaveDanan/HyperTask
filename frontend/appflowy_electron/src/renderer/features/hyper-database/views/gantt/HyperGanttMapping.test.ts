import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { addDays, startOfDay } from 'date-fns';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { SelectOptionPBSchema, SelectOptionColorPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import type { HyperCell, HyperDatabaseState, HyperField } from '../../HyperDatabaseTypes';
import { hyperGanttDate, hyperGanttWeekStartsOn, hyperGanttWrittenTiming, hyperGanttDateWrites, hyperGanttMap, hyperGanttReadConfig, hyperGanttSeconds, type HyperGanttConfig } from './HyperGanttMapping';
import { hyperGanttClearDates, hyperGanttCommitDates } from './HyperGanttMutations';

const field = (id: string, name: string, type: FieldType, isPrimary = false): HyperField => ({ id, name, type, isPrimary, settings: create(FieldSettingsPBSchema), options: [], proto: create(FieldPBSchema, { id, name, fieldType: type, isPrimary }) });
const day = (offset = 0) => addDays(startOfDay(new Date(2026, 10, 15)), offset);
const dateCell = (start: Date | null, end: Date | null = start, includeTime = false): Extract<HyperCell, { kind: 'date' }> => ({ kind: 'date', timestamp: start ? hyperGanttSeconds(start) : null, endTimestamp: end ? hyperGanttSeconds(end) : null, isRange: true, includeTime, reminderId: 'reminder', display: '' });
const view = create(ViewPBSchema, { id: 'gantt', oneOfExtra: { case: 'extra', value: '{"hyper_layout":"gantt","other":"keep"}' } });
function fixture(): HyperDatabaseState {
  return { status: 'ready', error: null, databaseId: 'db', viewId: view.id, view, views: [view], settings: null, groups: [], revision: 1, dataRevision: 0, rows: {}, rowIds: ['b', 'a', 'c'], fields: [field('title', 'Name', FieldType.RichText, true), field('schedule', 'Schedule', FieldType.DateTime), field('status', 'Status', FieldType.SingleSelect), field('progress', 'Progress', FieldType.Number), field('assignee', 'Assignee', FieldType.MultiSelect)], cells: {
    a: { title: { kind: 'text', text: 'Build', display: 'Build' }, schedule: dateCell(day(), day(2)), progress: { kind: 'number', value: 0.5, display: '0.5' } },
    b: { title: { kind: 'text', text: '', display: '' }, schedule: dateCell(day(), day()) },
    c: { schedule: dateCell(null) },
  } };
}
function config(state = fixture()): HyperGanttConfig { return hyperGanttReadConfig(view, state); }

describe('HyperGantt live row mapping', () => {
  it('uses the locale first day of the week', () => {
    expect(hyperGanttWeekStartsOn('en-US')).toBe(0);
    expect(hyperGanttWeekStartsOn('en-GB')).toBe(1);
    expect(hyperGanttWeekStartsOn('ar-EG')).toBe(6);
  });
  it('keeps the core filtered/sorted order and unscheduled resources', () => {
    const state = fixture(); const result = hyperGanttMap(state, config(state));
    expect(result.resources.map(r => r.id)).toEqual(['b', 'a', 'c']);
    expect(result.events.map(e => e.id)).toEqual(['b', 'a']);
    expect(result.tasks.get('b')?.title).toBe('Untitled');
    expect(result.tasks.get('c')?.due).toBeNull();
  });
  it('converts seconds, including epoch zero, without turning empty cells into 1970', () => {
    expect(hyperGanttDate(0n)?.getTime()).toBe(0);
    expect(hyperGanttDate(null)).toBeNull();
    expect(hyperGanttDate(999999999999999999n)).toBeNull();
  });
  it('uses inclusive database end days and ReUI exclusive ends', () => {
    const state = fixture(); const result = hyperGanttMap(state, config(state));
    expect(result.tasks.get('a')?.event?.end).toEqual(day(3));
    expect(result.tasks.get('a')?.due).toEqual(day(2));
    expect(result.tasks.get('b')?.event?.end).toEqual(day());
  });
  it('preserves timed event instants and includeTime', () => {
    const state = fixture(); state.cells.a.schedule = dateCell(new Date(2026, 10, 15, 9), new Date(2026, 10, 17, 17), true);
    const event = hyperGanttMap(state, config(state)).tasks.get('a')?.event;
    expect(event?.allDay).toBe(false); expect(event?.end.getHours()).toBe(17);
  });
  it('uses single-select colour, named done status, and assignee labels', () => {
    const state = fixture(); const option = create(SelectOptionPBSchema, { id: 'done', name: 'Done', color: SelectOptionColorPB.Green });
    state.cells.a.status = { kind: 'singleSelect', selected: [option], options: [option], display: 'Done' };
    state.cells.a.assignee = { kind: 'multiSelect', selected: [create(SelectOptionPBSchema, { name: 'Maya' })], options: [], display: 'Maya' };
    const task = hyperGanttMap(state, config(state)).tasks.get('a');
    expect(task?.color).toBe('var(--color-green-500)'); expect(task?.done).toBe(true); expect(task?.assignees).toEqual(['Maya']);
  });
  it('treats all number values <= 1 as fractions and clamps percentage values', () => {
    const state = fixture(); expect(hyperGanttMap(state, config(state)).tasks.get('a')?.progress).toBe(50);
    state.cells.b.progress = { kind: 'number', value: 150, display: '150' };
    const result = hyperGanttMap(state, config(state));
    expect(result.tasks.get('a')?.progress).toBe(0.5); expect(result.tasks.get('b')?.progress).toBe(100);
  });
  it('uses checklist core fractions', () => {
    const state = fixture(); state.fields.push(field('check', 'Checklist', FieldType.Checklist));
    state.cells.a.check = { kind: 'checklist', items: [], progress: 2 / 3, display: '2/3' };
    expect(hyperGanttMap(state, { ...config(state), progress_field_id: 'check' }).tasks.get('a')?.progress).toBeCloseTo(66.667, 2);
  });
  it('auto-picks a range field before a named start, otherwise start/end names', () => {
    const state = fixture(); state.fields.unshift(field('start', 'Start', FieldType.DateTime)); state.fields.push(field('due', 'Due', FieldType.DateTime));
    expect(config(state).start_field_id).toBe('schedule'); expect(config(state).end_field_id).toBeNull();
    state.cells = {}; expect(config(state).start_field_id).toBe('start'); expect(config(state).end_field_id).toBe('due');
  });
  it('keeps intentional None choices, validates removed fields, and clamps settings', () => {
    const state = fixture(); const custom = create(ViewPBSchema, { oneOfExtra: { case: 'extra', value: JSON.stringify({ hyper_layout: 'gantt', hyper_gantt: { start_field_id: 'deleted', color_field_id: null, progress_field_id: null, assignee_field_id: null, scale: 'quarter', list_width: 800, zoom: 9 } }) } });
    const result = hyperGanttReadConfig(custom, state);
    expect(result.start_field_id).toBe('schedule'); expect(result.color_field_id).toBeNull(); expect(result.progress_field_id).toBeNull(); expect(result.scale).toBe('quarter'); expect(result.list_width).toBe(640); expect(result.zoom).toBe(3);
  });
  it('requires a date field for a no-date schema', () => {
    const state = fixture(); state.fields = state.fields.filter(f => f.type !== FieldType.DateTime);
    expect(config(state).start_field_id).toBeNull();
  });
});

describe('HyperGantt date write boundary', () => {
  it('snaps both ends to days and round-trips an inclusive range through one mutation', () => {
    const state = fixture(); const writes = hyperGanttDateWrites(config(state), state.cells.a, day(1), day(4));
    expect(writes).toEqual([{ fieldId: 'schedule', value: { kind: 'date', timestamp: hyperGanttSeconds(day(1)), endTimestamp: hyperGanttSeconds(day(3)), isRange: true, includeTime: false, reminderId: 'reminder' } }]);
  });
  it('retains milestones and the include-time flag', () => {
    const state = fixture(); state.cells.a.schedule = dateCell(day(), day(2), true);
    const writes = hyperGanttDateWrites(config(state), state.cells.a, new Date(2026, 10, 16, 9), new Date(2026, 10, 16, 9));
    expect(writes[0].value).toMatchObject({ timestamp: hyperGanttSeconds(day(1)), endTimestamp: hyperGanttSeconds(day(1)), includeTime: true });
  });
  it('keeps clock times on whole-day moves of timed tasks', () => {
    const state = fixture();
    state.cells.a.schedule = dateCell(new Date(2026, 10, 15, 9, 30), new Date(2026, 10, 17, 17, 15), true);
    const writes = hyperGanttDateWrites(config(state), state.cells.a, day(1), day(3));
    const timing = hyperGanttWrittenTiming(writes);
    expect(timing.start).toEqual(new Date(2026, 10, 16, 9, 30));
    expect(timing.end).toEqual(new Date(2026, 10, 18, 17, 15));
    expect(timing.allDay).toBe(false);
  });
  it('does not shift an inclusive end on each repeated drag', () => {
    const state = fixture(); const cfg = config(state);
    const first = hyperGanttWrittenTiming(hyperGanttDateWrites(cfg, state.cells.a, day(1), day(4)));
    state.cells.a.schedule = dateCell(first.start, addDays(first.end, -1));
    const second = hyperGanttDateWrites(cfg, state.cells.a, addDays(first.start, 1), addDays(first.end, 1));
    expect(second[0].value).toMatchObject({ timestamp: hyperGanttSeconds(day(2)), endTimestamp: hyperGanttSeconds(day(4)) });
  });
  it('rejects reverse/invalid ranges before writing', () => {
    expect(() => hyperGanttDateWrites(config(), {}, day(2), day())).toThrow('End date');
    expect(() => hyperGanttDateWrites(config(), {}, new Date(NaN), day())).toThrow('End date');
  });
  it('writes separate start/end fields while retaining each includeTime setting', () => {
    const state = fixture(); const cfg = { ...config(state), end_field_id: 'due' };
    state.cells.a.due = dateCell(day(2), null, true);
    const writes = hyperGanttDateWrites(cfg, state.cells.a, day(), day(3));
    expect(writes.map(w => w.fieldId)).toEqual(['schedule', 'due']);
    expect(writes[0].value).toMatchObject({ isRange: false, timestamp: hyperGanttSeconds(day()), includeTime: false });
    expect(writes[1].value).toMatchObject({ isRange: false, timestamp: hyperGanttSeconds(day(2)), includeTime: true });
  });
  it('restores the first field if the second core mutation fails', async () => {
    const state = fixture(); const updateCell = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Core unavailable')).mockResolvedValueOnce(undefined);
    await expect(hyperGanttCommitDates({ updateCell }, 'a', { ...config(state), end_field_id: 'due' }, state.cells.a, day(1), day(4))).rejects.toThrow('Core unavailable');
    expect(updateCell.mock.calls[2]).toEqual(['a', 'schedule', { kind: 'date', timestamp: hyperGanttSeconds(day()), endTimestamp: hyperGanttSeconds(day(2)), isRange: true, includeTime: false, reminderId: 'reminder' }]);
  });
  it('clears a range through the same field once', async () => {
    const updateCell = vi.fn().mockResolvedValue(undefined);
    await hyperGanttClearDates({ updateCell }, 'a', config(), fixture().cells.a);
    expect(updateCell).toHaveBeenCalledExactlyOnceWith('a', 'schedule', { kind: 'date', clear: true });
  });
  it('restores a cleared start if clearing the end fails', async () => {
    const updateCell = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await expect(hyperGanttClearDates({ updateCell }, 'a', { ...config(), end_field_id: 'due' }, fixture().cells.a)).rejects.toThrow('offline');
    expect(updateCell.mock.calls[2][2]).toMatchObject({ kind: 'date', timestamp: hyperGanttSeconds(day()), endTimestamp: hyperGanttSeconds(day(2)) });
  });
  it('reports an unsuccessful rollback rather than claiming the pair is restored', async () => {
    const updateCell = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('offline'));
    await expect(hyperGanttCommitDates({ updateCell }, 'a', { ...config(), end_field_id: 'due' }, {}, day(), day(3))).rejects.toThrow('check both date fields');
  });
});


describe('Hyper Gantt timed move regressions', () => {
  it('keeps same-day timed tasks as ranges in mapping and round-trips', () => {
    const state = fixture(); const start = new Date(2026, 10, 15, 9); const end = new Date(2026, 10, 15, 17);
    state.cells.a.schedule = dateCell(start, end, true);
    const event = hyperGanttMap(state, config(state)).tasks.get('a')!.event!;
    expect(event.end).toEqual(end);
    const writes = hyperGanttDateWrites(config(state), state.cells.a, addDays(event.start, 1), addDays(event.end, 1));
    expect(hyperGanttWrittenTiming(writes)).toMatchObject({ start: addDays(start, 1), end: addDays(end, 1), allDay: false });
  });
  it.each([false, true])('moves day-snapped timed ranges by their original calendar-day span (separate=%s)', separate => {
    const state = fixture(); const start = new Date(2026, 10, 15, 17); const end = new Date(2026, 10, 18, 9);
    state.cells.a.schedule = dateCell(start, end, true);
    state.cells.a.due = dateCell(end, null, true);
    const cfg = { ...config(state), end_field_id: separate ? 'due' : null };
    const proposedStart = day(1); const proposedEnd = new Date(proposedStart.getTime() + end.getTime() - start.getTime());
    const writes = hyperGanttDateWrites(cfg, state.cells.a, proposedStart, proposedEnd, true);
    expect(hyperGanttWrittenTiming(writes)).toMatchObject({ start: addDays(start, 1), end: addDays(end, 1) });
  });
});
it.each([false, true])('moves a timed single-date milestone without an end (drag=%s)', drag => {
  const state = fixture(); const start = new Date(2026, 10, 15, 9);
  state.cells.a.schedule = { ...dateCell(start, null, true), isRange: false };
  const proposed = drag ? day(1) : addDays(start, 1);
  const writes = hyperGanttDateWrites(config(state), state.cells.a, proposed, proposed, drag);
  expect(writes[0].value).toMatchObject({ timestamp: hyperGanttSeconds(addDays(start, 1)), endTimestamp: hyperGanttSeconds(addDays(start, 1)), includeTime: true, isRange: false });
  expect(hyperGanttWrittenTiming(writes)).toMatchObject({ start: addDays(start, 1), end: addDays(start, 1), allDay: false });
});
