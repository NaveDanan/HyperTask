import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperCell } from '../../HyperDatabaseTypes';
import { hyperGanttDateWrites, hyperGanttRestoreDate, type HyperGanttConfig } from './HyperGanttMapping';

/** Two independent date fields have no atomic core event. Restore the first if the second fails. */
export async function hyperGanttCommitDates(controller: Pick<HyperDatabaseController, 'updateCell'>, rowId: string, config: HyperGanttConfig, cells: Record<string, HyperCell>, start: Date, end: Date) {
  const writes = hyperGanttDateWrites(config, cells, start, end);
  const completed: string[] = [];
  try {
    for (const write of writes) {
      await controller.updateCell(rowId, write.fieldId, write.value);
      completed.push(write.fieldId);
    }
  } catch (error) {
    for (const fieldId of completed.reverse()) {
      try { await controller.updateCell(rowId, fieldId, hyperGanttRestoreDate(cells[fieldId])); }
      catch { throw new Error("Couldn't update dates; check both date fields before retrying"); }
    }
    throw error;
  }
}

export async function hyperGanttClearDates(controller: Pick<HyperDatabaseController, 'updateCell'>, rowId: string, config: HyperGanttConfig, cells: Record<string, HyperCell>) {
  const ids = [...new Set([config.start_field_id, config.end_field_id].filter((id): id is string => !!id))];
  const completed: string[] = [];
  try {
    for (const fieldId of ids) { await controller.updateCell(rowId, fieldId, { kind: 'date', clear: true }); completed.push(fieldId); }
  } catch (error) {
    for (const fieldId of completed.reverse()) {
      try { await controller.updateCell(rowId, fieldId, hyperGanttRestoreDate(cells[fieldId])); }
      catch { throw new Error("Couldn't clear dates; check both date fields before retrying"); }
    }
    throw error;
  }
}
