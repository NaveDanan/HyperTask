import { hyperMentionPeople, hyperMentionText } from '@/features/hyper-people/hyperMentions';
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import type { GanttEvent, GanttResource, GanttScale } from '@/components/reui/gantt/gantt-types';
import { viewExtra } from '@/features/view/view-ext';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { SelectOptionColorPB } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import type { ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import type { HyperCell, HyperCellMutation, HyperDatabaseState, HyperField } from '../../HyperDatabaseTypes';

export interface HyperGanttConfig {
  start_field_id: string | null;
  end_field_id: string | null;
  color_field_id: string | null;
  progress_field_id: string | null;
  assignee_field_id: string | null;
  scale: Exclude<GanttScale, 'day'>;
  list_width: number;
  zoom: number;
}
export interface HyperGanttTask {
  rowId: string;
  title: string;
  color: string;
  due: Date | null;
  assignees: string[];
  progress?: number;
  done: boolean;
  event?: GanttEvent;
}
export const HyperGanttNone = '__hyper_none__';
export const HyperGanttScales = ['week', 'month', 'quarter', 'year'] as const;
export const HyperGanttSelectColors: Record<SelectOptionColorPB, string> = {
  [SelectOptionColorPB.Purple]: 'var(--color-purple-500)',
  [SelectOptionColorPB.Pink]: 'var(--color-pink-500)',
  [SelectOptionColorPB.LightPink]: 'var(--color-rose-400)',
  [SelectOptionColorPB.Orange]: 'var(--color-orange-500)',
  [SelectOptionColorPB.Yellow]: 'var(--color-yellow-500)',
  [SelectOptionColorPB.Lime]: 'var(--color-lime-500)',
  [SelectOptionColorPB.Green]: 'var(--color-green-500)',
  [SelectOptionColorPB.Aqua]: 'var(--color-cyan-500)',
  [SelectOptionColorPB.Blue]: 'var(--color-blue-500)',
};
export const hyperGanttDate = (timestamp: bigint | null): Date | null => {
  if (timestamp === null) return null;
  const date = new Date(Number(timestamp) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
};
export const hyperGanttSeconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));
export function hyperGanttDateCell(cell?: HyperCell) { return cell?.kind === 'date' ? cell : undefined; }
export function hyperGanttAssignees(cell?: HyperCell): string[] {
  if (cell?.kind === 'singleSelect' || cell?.kind === 'multiSelect') return cell.selected.map(o => o.name);
  if (cell?.kind === 'text' && hyperMentionPeople(cell.text).length) return hyperMentionPeople(cell.text).map(person => person.name);
  return cell?.display.trim() ? [hyperMentionText(cell.display.trim())] : [];
}
export function hyperGanttFraction(state: HyperDatabaseState, fieldId: string | null) {
  const values = state.rowIds.flatMap(id => {
    const cell = fieldId ? state.cells[id]?.[fieldId] : undefined;
    return cell?.kind === 'number' && cell.value !== null ? [cell.value] : [];
  });
  return values.length > 0 && values.every(value => value >= 0 && value <= 1);
}
export function hyperGanttReadConfig(view: ViewPB, state: HyperDatabaseState): HyperGanttConfig {
  const raw = viewExtra(view)?.hyper_gantt;
  const stored = raw && typeof raw === 'object' ? raw as Partial<HyperGanttConfig> : {};
  const dates = state.fields.filter(f => f.type === FieldType.DateTime);
  const range = dates.find(f => state.rowIds.some(id => hyperGanttDateCell(state.cells[id]?.[f.id])?.isRange));
  const start = range ?? dates.find(f => /start|begin/i.test(f.name)) ?? dates[0];
  const selects = state.fields.filter(f => f.type === FieldType.SingleSelect);
  const valid = (id: unknown, types: FieldType[]) => typeof id === 'string' && state.fields.some(f => f.id === id && types.includes(f.type));
  const optional = (key: 'end_field_id' | 'color_field_id' | 'progress_field_id' | 'assignee_field_id', types: FieldType[], fallback?: HyperField) =>
    stored[key] === null ? null : valid(stored[key], types) ? stored[key]! : fallback?.id ?? null;
  const startId = valid(stored.start_field_id, [FieldType.DateTime]) ? stored.start_field_id! : start?.id ?? null;
  const isRange = state.rowIds.some(id => hyperGanttDateCell(state.cells[id]?.[startId ?? ''])?.isRange);
  const end = isRange ? undefined : dates.find(f => f.id !== startId && /end|due|finish/i.test(f.name));
  return {
    start_field_id: startId,
    end_field_id: optional('end_field_id', [FieldType.DateTime], end),
    color_field_id: optional('color_field_id', [FieldType.SingleSelect], selects.find(f => /status/i.test(f.name)) ?? selects[0]),
    progress_field_id: optional('progress_field_id', [FieldType.Number, FieldType.Checklist], state.fields.find(f => /progress/i.test(f.name) && f.type === FieldType.Number) ?? state.fields.find(f => f.type === FieldType.Checklist)),
    assignee_field_id: optional('assignee_field_id', [FieldType.SingleSelect, FieldType.MultiSelect, FieldType.RichText], state.fields.find(f => /assignee|owner/i.test(f.name) && [FieldType.SingleSelect, FieldType.MultiSelect, FieldType.RichText].includes(f.type))),
    scale: HyperGanttScales.includes(stored.scale!) ? stored.scale! : 'month',
    list_width: typeof stored.list_width === 'number' && Number.isFinite(stored.list_width) ? Math.max(180, Math.min(640, stored.list_width)) : 416,
    zoom: typeof stored.zoom === 'number' && Number.isFinite(stored.zoom) ? Math.max(0.5, Math.min(3, stored.zoom)) : 1,
  };
}
export function hyperGanttMap(state: HyperDatabaseState, config: HyperGanttConfig) {
  const primary = state.fields.find(f => f.isPrimary);
  const fraction = hyperGanttFraction(state, config.progress_field_id);
  const tasks = new Map<string, HyperGanttTask>();
  const events: GanttEvent[] = [];
  const resources: GanttResource[] = [];
  for (const rowId of state.rowIds) {
    const cells = state.cells[rowId] ?? {};
    const title = (primary && cells[primary.id]?.display.trim()) || 'Untitled';
    const date = hyperGanttDateCell(cells[config.start_field_id ?? '']);
    const start = hyperGanttDate(date?.timestamp ?? null);
    const endCell = config.end_field_id ? hyperGanttDateCell(cells[config.end_field_id]) : date;
    const due = hyperGanttDate(config.end_field_id ? endCell?.timestamp ?? null : date?.endTimestamp ?? date?.timestamp ?? null);
    const status = cells[config.color_field_id ?? ''];
    const option = status?.kind === 'singleSelect' ? status.selected[0] : undefined;
    const color = option ? HyperGanttSelectColors[option.color] : 'var(--muted-foreground)';
    const progressCell = cells[config.progress_field_id ?? ''];
    const rawProgress = progressCell?.kind === 'checklist' ? progressCell.progress * 100 : progressCell?.kind === 'number' && progressCell.value !== null ? progressCell.value * (fraction ? 100 : 1) : undefined;
    const progress = rawProgress === undefined ? undefined : Math.max(0, Math.min(100, rawProgress));
    const task: HyperGanttTask = { rowId, title, color, due, assignees: hyperGanttAssignees(cells[config.assignee_field_id ?? '']), progress, done: progress === 100 || /^(done|complete[ds]?|closed)$/i.test(option?.name ?? '') };
    if (start) {
      const last = due && due >= start ? due : start;
      // The database's end day is inclusive; ReUI's end is exclusive. Equal days stay milestones.
      const milestone = date?.includeTime ? last.getTime() === start.getTime() : startOfDay(last).getTime() === startOfDay(start).getTime();
      task.event = { id: rowId, resourceId: rowId, title: hyperMentionText(title), start, end: milestone ? start : date?.includeTime ? last : addDays(startOfDay(last), 1), allDay: !date?.includeTime, color, progress };
      events.push(task.event);
    }
    tasks.set(rowId, task);
    resources.push({ id: rowId, title: hyperMentionText(title), color });
  }
  return { tasks, events, resources, fraction };
}
export interface HyperGanttDateWrite { fieldId: string; value: HyperCellMutation }
export function hyperGanttDateWrites(config: HyperGanttConfig, cells: Record<string, HyperCell>, start: Date, end: Date, move = false): HyperGanttDateWrite[] {
  if (!config.start_field_id) throw new Error('Choose a start date field');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error('End date must follow start date');
  const old = hyperGanttDateCell(cells[config.start_field_id]);
  const includeTime = old?.includeTime ?? false;
  const atDay = (day: Date, previous: bigint | null | undefined, timed: boolean) => {
    const result = startOfDay(day);
    const original = hyperGanttDate(previous ?? null);
    if (timed && original) result.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
    return result;
  };
  const first = atDay(start, old?.timestamp, includeTime);
  const oldEnd = config.end_field_id ? hyperGanttDateCell(cells[config.end_field_id]) : old;
  const oldStart = hyperGanttDate(old?.timestamp ?? null);
  const oldDue = hyperGanttDate((config.end_field_id ? oldEnd?.timestamp : old?.endTimestamp) ?? old?.timestamp ?? null);
  // ReUI snaps the proposed start to a day and shifts its end by elapsed time.
  // Restore both clocks on the original calendar-day offset for a move.
  const lastDay = move && includeTime && oldStart && oldDue
    ? addDays(first, differenceInCalendarDays(oldDue, oldStart))
    : includeTime ? end : addDays(startOfDay(end), -1);
  const last = end.getTime() === start.getTime() && !includeTime ? first : atDay(lastDay, config.end_field_id ? oldEnd?.timestamp : old?.endTimestamp ?? old?.timestamp, oldEnd?.includeTime ?? includeTime);
  if (last < first) throw new Error('End date must follow start date');
  const value: HyperCellMutation = { kind: 'date', timestamp: hyperGanttSeconds(first), endTimestamp: hyperGanttSeconds(last), isRange: old?.isRange === true || last.getTime() !== first.getTime(), includeTime, reminderId: old?.reminderId };
  if (!config.end_field_id || config.end_field_id === config.start_field_id) return [{ fieldId: config.start_field_id, value }];
  return [
    { fieldId: config.start_field_id, value: { kind: 'date', timestamp: hyperGanttSeconds(first), isRange: false, includeTime, reminderId: old?.reminderId } },
    { fieldId: config.end_field_id, value: { kind: 'date', timestamp: hyperGanttSeconds(last), isRange: false, includeTime: oldEnd?.includeTime ?? includeTime, reminderId: oldEnd?.reminderId } },
  ];
}
export function hyperGanttRestoreDate(cell?: HyperCell): HyperCellMutation {
  const date = hyperGanttDateCell(cell);
  return date?.timestamp !== null && date?.timestamp !== undefined ? { kind: 'date', timestamp: date.timestamp, endTimestamp: date.endTimestamp ?? undefined, isRange: date.isRange, includeTime: date.includeTime, reminderId: date.reminderId } : { kind: 'date', clear: true };
}

/** Turn the proposed core mutations back into the same controlled ReUI shape used by row mapping. */
export function hyperGanttWrittenTiming(writes: HyperGanttDateWrite[]) {
  const first = writes[0]?.value;
  const last = writes[writes.length - 1]?.value;
  if (first?.kind !== 'date' || last?.kind !== 'date' || first.timestamp === undefined) throw new Error('Missing date write');
  const start = hyperGanttDate(first.timestamp)!;
  const due = hyperGanttDate((writes.length === 1 ? first.endTimestamp : last.timestamp) ?? first.timestamp)!;
  const allDay = !first.includeTime;
  const milestone = allDay ? startOfDay(start).getTime() === startOfDay(due).getTime() : start.getTime() === due.getTime();
  return { start, end: milestone ? start : allDay ? addDays(startOfDay(due), 1) : due, allDay };
}

export function hyperGanttWeekStartsOn(language: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const first = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
    if (first !== undefined) return (first % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  } catch { /* An invalid or older locale API falls back to the common regional convention. */ }
  return /^en-US|^en-CA|^he|^ar/i.test(language) ? 0 : 1;
}
