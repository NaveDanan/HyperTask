import { fromBinary } from '@bufbuild/protobuf';
import type { HyperHubAgendaItem, HyperHubReadScope } from '@shared/HyperTaskHub';
import { CalendarEventRequestPBSchema, RepeatedCalendarEventPBSchema } from '@shared/protobuf/hyper-database2/calendar_entities_pb';
import { CellIdPBSchema, CellPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { DateCellDataPBSchema, type DateCellDataPB } from '@shared/protobuf/hyper-database2/date_entities_pb';
import type { HyperBotsProjectRequest } from '../HyperBotsProjectCore';
import { hyperHubReadView } from './HyperHubProjectSource';
import { hyperHubCalendarInterval } from './HyperHubOutlookSource';
import { hyperHubHash, hyperHubInstant } from './HyperTaskHubStore';
import { HyperHubAccessLost, type HyperHubBatch } from './HyperTaskHubSync';

export function hyperHubNativeOccurrence(id: string, title: string, date: DateCellDataPB): HyperHubAgendaItem | undefined {
  if (date.oneOfTimestamp.case !== 'timestamp') return;
  const start = hyperHubInstant(Number(date.oneOfTimestamp.value) * 1000);
  const end = date.isRange && date.oneOfEndTimestamp.case === 'endTimestamp'
    ? hyperHubInstant(Number(date.oneOfEndTimestamp.value) * 1000) : start;
  const reserved = date.includeTime && end.iso > start.iso;
  return { id, title, interval: { start, end: end.iso > start.iso ? end : start }, allDay: !date.includeTime, isMeeting: false,
    sourceKind: 'hypertask', private: false, availability: reserved ? 'busy' : 'free' };
}

export class HyperHubCalendarSource {
  readonly kind = 'hypertask';
  readonly connectionId = 'hypertask';
  readonly label = 'HyperTask calendar';
  readonly availabilitySource = true;
  readonly queryId: string;
  constructor(private readonly request: HyperBotsProjectRequest, readonly databaseId: string, readonly viewId: string,
    private readonly zone: string, private readonly now = Date.now) { this.queryId = hyperHubHash('calendar', databaseId, viewId); }
  async check(): Promise<never> { throw new HyperHubAccessLost(); }
  async read(scope: HyperHubReadScope, signal: AbortSignal): Promise<HyperHubBatch> {
    const { core, db } = await hyperHubReadView(this.request, this.databaseId, this.viewId, true, scope, signal);
    const rows = await core.read('GetAllCalendarEvents', RepeatedCalendarEventPBSchema, CalendarEventRequestPBSchema, { viewId: this.viewId });
    const interval = hyperHubCalendarInterval(this.now(), this.zone);
    const agenda: HyperHubAgendaItem[] = [];
    // The Rust event reader can return an empty list on an incomplete view read.
    const expectedRows = new Set(db.rows.map(row => row.id));
    let complete = true;
    for (const row of rows.items) {
      const rowId = row.rowMeta?.id;
      if (!rowId || !expectedRows.delete(rowId) || !row.dateFieldId) { complete = false; continue; }
      const cell = await core.read('GetCell', CellPBSchema, CellIdPBSchema, { viewId: this.viewId, rowId, fieldId: row.dateFieldId });
      const item = hyperHubNativeOccurrence(hyperHubHash(scope.workspaceId, this.databaseId, rowId), row.title, fromBinary(DateCellDataPBSchema, cell.data));
      if (!item && row.oneOfTimestamp.case === 'timestamp') complete = false;
      if (item && item.interval.start.iso < interval.end.iso && item.interval.end.iso >= interval.start.iso) agenda.push(item);
    }
    await core.scope(scope.workspaceId);
    return { records: [], agenda, interval, cursor: null, completeness: complete && expectedRows.size === 0 ? 'complete' : 'partial' };
  }
}
