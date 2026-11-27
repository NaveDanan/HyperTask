import { hyperMentionPeople, hyperMentionText } from '@/features/hyper-people/hyperMentions';
import { addDays, startOfDay } from 'date-fns';
import type { GanttEvent, GanttResource } from '@/components/reui/gantt/gantt-types';
import { viewExtra } from '@/features/view/view-ext';
import { SelectOptionColorPB } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import type { ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import type { HyperCell, HyperDatabaseState } from '../../HyperDatabaseTypes';

import {
  hyperGanttDate, hyperGanttDateCell, hyperGanttDateWrites as dateWrites, hyperGanttReadConfigFromExtra,
  type HyperGanttConfig, type HyperGanttDateCells,
} from '@shared/HyperGanttSchedule';

export { HyperGanttScales, hyperGanttDate, hyperGanttDateCell, hyperGanttSeconds, hyperGanttWrittenTiming } from '@shared/HyperGanttSchedule';
export type { HyperGanttConfig } from '@shared/HyperGanttSchedule';

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
  return hyperGanttReadConfigFromExtra(viewExtra(view)?.hyper_gantt, state);
}
export function hyperGanttDateCells(cells: Record<string, HyperCell>): HyperGanttDateCells {
  return Object.fromEntries(Object.entries(cells).map(([id, cell]) => [id, hyperGanttDateCell(cell)]));
}
export function hyperGanttDateWrites(config: HyperGanttConfig, cells: Record<string, HyperCell>, start: Date, end: Date, move = false) {
  return dateWrites(config, hyperGanttDateCells(cells), start, end, move);
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
export function hyperGanttWeekStartsOn(language: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const first = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
    if (first !== undefined) return (first % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  } catch { /* An invalid or older locale API falls back to the common regional convention. */ }
  return /^en-US|^en-CA|^he|^ar/i.test(language) ? 0 : 1;
}
