import { TZDate } from '@date-fns/tz';
import { fromBinary } from '@bufbuild/protobuf';
import { addDays, format, isValid, parseISO, startOfDay } from 'date-fns';
import {
  hyperGanttApplyDateWrites, hyperGanttClearDateWrites, hyperGanttDate, hyperGanttDateWrites, hyperGanttReadConfigFromExtra,
  type HyperGanttConfig, type HyperGanttDateCell, type HyperGanttDateCells, type HyperGanttDateWrite,
} from '@shared/HyperGanttSchedule';
import { hyperTaskViewExtra } from '@shared/HyperTaskView';
import { CellIdPBSchema, CellPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { DateCellChangesetPBSchema, DateCellDataPBSchema } from '@shared/protobuf/hyper-database2/date_entities_pb';
import { CreateFieldPayloadPBSchema, FieldPBSchema, FieldType, type FieldPB } from '@shared/protobuf/hyper-database2/field_entities_pb';
import type { ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import type { HyperBotsProjectCore } from './HyperBotsProjectCore';
import { HyperBotsToolError } from './HyperBotsRuntime';

export type HyperBotsGanttScheduleInput = { startDate?: string; endDate?: string; clearSchedule?: boolean };

function localDate(value: string): Date {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new HyperBotsToolError('args', 'Use YYYY-MM-DD for task dates.');
  const date = parseISO(value);
  if (!isValid(date) || format(date, 'yyyy-MM-dd') !== value) throw new HyperBotsToolError('args', `Invalid task date: ${value}.`);
  return date;
}

export class HyperBotsGanttTasks {
  private resolved?: Promise<HyperGanttConfig>;
  private readonly stored: Partial<HyperGanttConfig>;

  constructor(
    private readonly core: Pick<HyperBotsProjectCore, 'read' | 'write' | 'writeVoid'>,
    private readonly view: ViewPB,
    private readonly fields: readonly FieldPB[],
    private readonly rowIds: readonly string[],
  ) {
    const stored = hyperTaskViewExtra(view)?.hyper_gantt;
    this.stored = stored && typeof stored === 'object' ? stored as Partial<HyperGanttConfig> : {};
  }

  config(): Promise<HyperGanttConfig> {
    return this.resolved ??= this.resolveConfig();
  }

  async dates(rowId: string): Promise<{ startDate: string | null; endDate: string | null }> {
    const config = await this.config();
    const { start, end } = this.readRange(config, await this.loadCells(rowId, config));
    return { startDate: start && format(start, 'yyyy-MM-dd'), endDate: end && format(end, 'yyyy-MM-dd') };
  }

  async sourceSchedule(rowId: string, zone: string) {
    const config = await this.config();
    const cells = await this.loadCells(rowId, config);
    const first = config.start_field_id ? cells[config.start_field_id] : undefined;
    const last = config.end_field_id ? cells[config.end_field_id] : first;
    const start = hyperGanttDate(first?.timestamp ?? null);
    const end = hyperGanttDate((config.end_field_id ? last?.timestamp : first?.isRange ? first.endTimestamp : null) ?? null);
    const marker = (d: Date | null, timed?: boolean) => d ? timed ? { kind: 'instant' as const, iso: d.toISOString() } :
      { kind: 'civil-date' as const, date: format(d, 'yyyy-MM-dd'), zone } : undefined;
    const paired = config.end_field_id ? config.start_field_id === this.stored.start_field_id &&
      config.end_field_id === this.stored.end_field_id && config.start_field_id !== config.end_field_id : first?.isRange;
    const midnight = (d: Date, offset: number) => +new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + offset, zone);
    const a = start && (first?.includeTime ? +start : midnight(start, 0));
    const b = end && (last?.includeTime ? +end : midnight(end, 1));
    return { planned: marker(start, first?.includeTime), due: marker(end, last?.includeTime),
      interval: paired && a !== null && b !== null && b > a ? { start: a, end: b } : undefined };
  }

  async prepareSchedule(input: HyperBotsGanttScheduleInput, rowId?: string): Promise<(targetRowId: string) => Promise<void>> {
    const startDate = input.startDate === undefined ? undefined : localDate(input.startDate);
    const endDate = input.endDate === undefined ? undefined : localDate(input.endDate);
    if (input.clearSchedule && (startDate || endDate)) throw new HyperBotsToolError('args', 'Clearing a task schedule cannot include new dates.');
    const config = await this.config();
    if (!input.clearSchedule && !startDate && !endDate) {
      return async () => {
        // Gantt displays unscheduled rows only once the database has a date field.
        if (!rowId && !config.start_field_id) await this.addDateField(config);
      };
    }
    const cells = rowId ? await this.loadCells(rowId, config) : {};
    if (input.clearSchedule) return targetRowId => this.apply(targetRowId, hyperGanttClearDateWrites(config), cells);

    const previous = this.readRange(config, cells);
    const start = startDate ?? (previous.start && startOfDay(previous.start)) ?? endDate!;
    const previousEnd = previous.start?.getTime() === previous.end?.getTime() ? null : previous.end;
    const end = endDate ?? (previousEnd && startOfDay(previousEnd)) ?? start;
    if (end < start) throw new HyperBotsToolError('args', 'End date must follow start date.');
    const includeTime = config.start_field_id ? cells[config.start_field_id]?.includeTime : false;
    // The UI uses an exclusive end for all-day ranges and an inclusive end for milestones.
    const viewEnd = includeTime || start.getTime() === end.getTime() ? end : addDays(end, 1);
    if (config.start_field_id) {
      let writes: HyperGanttDateWrite[];
      try { writes = hyperGanttDateWrites(config, cells, start, viewEnd); }
      catch (error) { throw new HyperBotsToolError('args', error instanceof Error ? error.message : String(error)); }
      return targetRowId => this.apply(targetRowId, writes, cells);
    }
    return async targetRowId => {
      const next = await this.addDateField(config);
      await this.apply(targetRowId, hyperGanttDateWrites(next, cells, start, viewEnd), cells);
    };
  }

  private async addDateField(config: HyperGanttConfig): Promise<HyperGanttConfig> {
    const field = await this.core.write('CreateField', FieldPBSchema, CreateFieldPayloadPBSchema, {
      viewId: this.view.id, fieldType: FieldType.DateTime, oneOfFieldName: { case: 'fieldName', value: 'Dates' },
    });
    const next = { ...config, start_field_id: field.id, end_field_id: null };
    this.resolved = Promise.resolve(next);
    return next;
  }

  private async resolveConfig(): Promise<HyperGanttConfig> {
    const fields = this.fields.map(field => ({ id: field.id, name: field.name, type: field.fieldType }));
    const dates = fields.filter(field => field.type === FieldType.DateTime);
    const cells: Record<string, HyperGanttDateCells> = {};
    // Match the view's existing inference for unconfigured schemas with several date fields.
    if (dates.length > 1) {
      const fixedStart = dates.find(field => field.id === this.stored.start_field_id);
      const endSet = this.stored.end_field_id === null || dates.some(field => field.id === this.stored.end_field_id);
      const scan = !fixedStart ? dates : endSet ? [] : [fixedStart];
      for (const { id } of scan) {
        let found = false;
        for (let index = 0; index < this.rowIds.length && !found; index += 16) {
          const rows = this.rowIds.slice(index, index + 16);
          const values = await Promise.all(rows.map(rowId => this.loadDate(rowId, id)));
          const range = values.findIndex(value => value.isRange);
          if (range >= 0) {
            cells[rows[range]] = { [id]: values[range] };
            found = true;
          }
        }
        if (found) break;
      }
    }
    return hyperGanttReadConfigFromExtra(this.stored, { fields, rowIds: this.rowIds, cells });
  }

  private async loadCells(rowId: string, config: HyperGanttConfig): Promise<HyperGanttDateCells> {
    const ids = [...new Set([config.start_field_id, config.end_field_id].filter((id): id is string => !!id))];
    return Object.fromEntries(await Promise.all(ids.map(async fieldId => [fieldId, await this.loadDate(rowId, fieldId)])));
  }

  private async loadDate(rowId: string, fieldId: string): Promise<HyperGanttDateCell> {
    const cell = await this.core.read('GetCell', CellPBSchema, CellIdPBSchema, { viewId: this.view.id, rowId, fieldId });
    const data = fromBinary(DateCellDataPBSchema, cell.data);
    return {
      kind: 'date', timestamp: data.oneOfTimestamp.value ?? null, endTimestamp: data.oneOfEndTimestamp.value ?? null,
      isRange: data.isRange, includeTime: data.includeTime, reminderId: data.reminderId,
    };
  }

  private readRange(config: HyperGanttConfig, cells: HyperGanttDateCells) {
    const start = config.start_field_id ? cells[config.start_field_id] : undefined;
    const end = config.end_field_id ? cells[config.end_field_id]?.timestamp : start?.endTimestamp ?? start?.timestamp;
    return { start: hyperGanttDate(start?.timestamp ?? null), end: hyperGanttDate(end ?? null) };
  }

  private async apply(rowId: string, writes: HyperGanttDateWrite[], cells: HyperGanttDateCells) {
    try {
      await hyperGanttApplyDateWrites((fieldId, value) => this.core.writeVoid('UpdateDateCell', DateCellChangesetPBSchema, {
        cellId: { viewId: this.view.id, rowId, fieldId },
        oneOfTimestamp: value.timestamp === undefined ? undefined : { case: 'timestamp', value: value.timestamp },
        oneOfEndTimestamp: value.endTimestamp === undefined ? undefined : { case: 'endTimestamp', value: value.endTimestamp },
        oneOfIncludeTime: value.includeTime === undefined ? undefined : { case: 'includeTime', value: value.includeTime },
        oneOfIsRange: value.isRange === undefined ? undefined : { case: 'isRange', value: value.isRange },
        oneOfClearFlag: value.clear === undefined ? undefined : { case: 'clearFlag', value: value.clear },
        oneOfReminderId: value.reminderId === undefined ? undefined : { case: 'reminderId', value: value.reminderId },
      }), writes, cells, error => error instanceof HyperBotsToolError && error.kind === 'refused');
    } catch (error) {
      if (error instanceof Error && error.cause) throw new HyperBotsToolError('transport', error.message);
      throw error;
    }
  }
}
