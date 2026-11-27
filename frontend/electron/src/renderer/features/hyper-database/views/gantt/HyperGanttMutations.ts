import { hyperGanttApplyDateWrites, hyperGanttClearDateWrites } from '@shared/HyperGanttSchedule';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperCell } from '../../HyperDatabaseTypes';
import { hyperGanttDateCells, hyperGanttDateWrites, type HyperGanttConfig } from './HyperGanttMapping';

export async function hyperGanttCommitDates(controller: Pick<HyperDatabaseController, 'updateCell'>, rowId: string, config: HyperGanttConfig, cells: Record<string, HyperCell>, start: Date, end: Date, move = false) {
  const writes = hyperGanttDateWrites(config, cells, start, end, move);
  await hyperGanttApplyDateWrites((fieldId, value) => controller.updateCell(rowId, fieldId, value), writes, hyperGanttDateCells(cells));
}

export async function hyperGanttClearDates(controller: Pick<HyperDatabaseController, 'updateCell'>, rowId: string, config: HyperGanttConfig, cells: Record<string, HyperCell>) {
  await hyperGanttApplyDateWrites((fieldId, value) => controller.updateCell(rowId, fieldId, value), hyperGanttClearDateWrites(config), hyperGanttDateCells(cells));
}

/** Checklist completion writes toggle IDs, so change only enough items to reach the target. */
export async function hyperGanttSetChecklistProgress(controller: Pick<HyperDatabaseController, 'loadCell' | 'updateCell'>, rowId: string, fieldId: string, percentage: number) {
  const cell = await controller.loadCell(rowId, fieldId);
  if (cell?.kind !== 'checklist' || cell.error) throw new Error('Checklist could not be loaded');
  const count = Math.round(cell.items.length * Math.max(0, Math.min(100, percentage)) / 100);
  const delta = count - cell.items.filter(item => item.completed).length;
  const ids = cell.items.filter(item => item.completed === (delta < 0)).slice(0, Math.abs(delta)).map(item => item.id);
  if (ids.length) await controller.updateCell(rowId, fieldId, { kind: 'checklist', completedIds: ids });
  return cell.items.length ? count / cell.items.length * 100 : 0;
}
