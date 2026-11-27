import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { FieldType } from './protobuf/hyper-database2/field_entities_pb';

export interface HyperGanttDateCell {
  kind: 'date';
  timestamp: bigint | null;
  endTimestamp: bigint | null;
  isRange: boolean;
  includeTime: boolean;
  reminderId: string;
}
export type HyperGanttDateMutation = {
  kind: 'date';
  timestamp?: bigint;
  endTimestamp?: bigint;
  includeTime?: boolean;
  isRange?: boolean;
  clear?: boolean;
  reminderId?: string;
};
export type HyperGanttDateCells = Record<string, HyperGanttDateCell | undefined>;
type HyperGanttField = { id: string; name: string; type: FieldType };
interface HyperGanttSchema {
  fields: readonly HyperGanttField[];
  rowIds: readonly string[];
  cells: Record<string, Record<string, { kind: string; isRange?: boolean } | undefined>>;
}

export const HyperGanttScales = ['week', 'month', 'quarter', 'year'] as const;

export interface HyperGanttConfig {
  start_field_id: string | null;
  end_field_id: string | null;
  color_field_id: string | null;
  progress_field_id: string | null;
  assignee_field_id: string | null;
  scale: typeof HyperGanttScales[number];
  list_width: number;
  zoom: number;
}
export const hyperGanttDate = (timestamp: bigint | null): Date | null => {
  if (timestamp === null) return null;
  const date = new Date(Number(timestamp) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
};
export const hyperGanttSeconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));
export function hyperGanttDateCell<T extends { kind: string }>(cell?: T): Extract<T, { kind: 'date' }> | undefined {
  return cell?.kind === 'date' ? cell as Extract<T, { kind: 'date' }> : undefined;
}

export function hyperGanttReadConfigFromExtra(raw: unknown, state: HyperGanttSchema): HyperGanttConfig {
  const stored = raw && typeof raw === 'object' ? raw as Partial<HyperGanttConfig> : {};
  const dates = state.fields.filter(f => f.type === FieldType.DateTime);
  const range = dates.find(f => state.rowIds.some(id => state.cells[id]?.[f.id]?.isRange));
  const start = range ?? dates.find(f => /start|begin/i.test(f.name)) ?? dates[0];
  const selects = state.fields.filter(f => f.type === FieldType.SingleSelect);
  const valid = (id: unknown, types: FieldType[]) => typeof id === 'string' && state.fields.some(f => f.id === id && types.includes(f.type));
  const optional = (key: 'end_field_id' | 'color_field_id' | 'progress_field_id' | 'assignee_field_id', types: FieldType[], fallback?: HyperGanttField) =>
    stored[key] === null ? null : valid(stored[key], types) ? stored[key]! : fallback?.id ?? null;
  const startId = valid(stored.start_field_id, [FieldType.DateTime]) ? stored.start_field_id! : start?.id ?? null;
  const isRange = state.rowIds.some(id => state.cells[id]?.[startId ?? '']?.isRange);
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
export interface HyperGanttDateWrite { fieldId: string; value: HyperGanttDateMutation }
export function hyperGanttDateWrites(config: HyperGanttConfig, cells: HyperGanttDateCells, start: Date, end: Date, move = false): HyperGanttDateWrite[] {
  if (!config.start_field_id) throw new Error('Choose a start date field');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error('End date must follow start date');
  const old = cells[config.start_field_id];
  const includeTime = old?.includeTime ?? false;
  const atDay = (day: Date, previous: bigint | null | undefined, timed: boolean) => {
    const result = startOfDay(day);
    const original = hyperGanttDate(previous ?? null);
    if (timed && original) result.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
    return result;
  };
  const first = atDay(start, old?.timestamp, includeTime);
  const oldEnd = config.end_field_id ? cells[config.end_field_id] : old;
  const oldStart = hyperGanttDate(old?.timestamp ?? null);
  const oldDue = hyperGanttDate((config.end_field_id ? oldEnd?.timestamp : old?.endTimestamp) ?? old?.timestamp ?? null);
  // ReUI snaps the proposed start to a day and shifts its end by elapsed time.
  // Restore both clocks on the original calendar-day offset for a move.
  const lastDay = move && includeTime && oldStart && oldDue
    ? addDays(first, differenceInCalendarDays(oldDue, oldStart))
    : includeTime ? end : addDays(startOfDay(end), -1);
  const last = end.getTime() === start.getTime() && !includeTime ? first : atDay(lastDay, config.end_field_id ? oldEnd?.timestamp : old?.endTimestamp ?? old?.timestamp, oldEnd?.includeTime ?? includeTime);
  if (last < first) throw new Error('End date must follow start date');
  const isRange = old?.isRange === true || last.getTime() !== first.getTime();
  const value: HyperGanttDateMutation = {
    kind: 'date', timestamp: hyperGanttSeconds(first), isRange, includeTime, reminderId: old?.reminderId,
    ...(isRange ? { endTimestamp: hyperGanttSeconds(last) } : {}),
  };
  if (!config.end_field_id || config.end_field_id === config.start_field_id) return [{ fieldId: config.start_field_id, value }];
  return [
    { fieldId: config.start_field_id, value: { kind: 'date', timestamp: hyperGanttSeconds(first), isRange: false, includeTime, reminderId: old?.reminderId } },
    { fieldId: config.end_field_id, value: { kind: 'date', timestamp: hyperGanttSeconds(last), isRange: false, includeTime: oldEnd?.includeTime ?? includeTime, reminderId: oldEnd?.reminderId } },
  ];
}
export function hyperGanttRestoreDate(date?: HyperGanttDateCell): HyperGanttDateMutation {
  if (!date || date.timestamp === null) return { kind: 'date', clear: true };
  return {
    kind: 'date', timestamp: date.timestamp, isRange: date.isRange, includeTime: date.includeTime, reminderId: date.reminderId,
    ...(date.isRange ? { endTimestamp: date.endTimestamp ?? date.timestamp } : {}),
  };
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

export function hyperGanttClearDateWrites(config: HyperGanttConfig): HyperGanttDateWrite[] {
  const fieldIds = [...new Set([config.start_field_id, config.end_field_id].filter((id): id is string => !!id))];
  return fieldIds.map(fieldId => ({ fieldId, value: { kind: 'date', clear: true } }));
}

/** The core writes each date field independently. Restore successful writes on a definite failure. */
export async function hyperGanttApplyDateWrites(
  write: (fieldId: string, value: HyperGanttDateMutation) => Promise<unknown>,
  writes: readonly HyperGanttDateWrite[],
  cells: HyperGanttDateCells,
  shouldRestore: (error: unknown) => boolean = () => true,
) {
  const completed: string[] = [];
  try {
    for (const { fieldId, value } of writes) {
      await write(fieldId, value);
      completed.push(fieldId);
    }
  } catch (error) {
    if (shouldRestore(error)) {
      for (const fieldId of completed.reverse()) {
        try { await write(fieldId, hyperGanttRestoreDate(cells[fieldId])); }
        catch { throw new Error("Couldn't update dates; check both date fields before retrying", { cause: error }); }
      }
    }
    throw error;
  }
}
