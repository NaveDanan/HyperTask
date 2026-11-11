import { CalendarLayoutPB, type CalendarLayoutSettingPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { DatabaseLayoutPB, type DatabaseViewSettingPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabaseEventGetDatabase, DatabaseEventGetDatabaseSetting, DatabaseEventSetLayoutSetting } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperReadDatabaseWriteView } from './HyperDatabaseDraftBackend';
import { HyperCalendarPeriodError, hyperCalendarPeriodSetting, hyperCalendarPeriodSettingsEditable, hyperCalendarWeekStartSetting } from './HyperCalendarPeriodModel';

export interface HyperCalendarPeriodSettingsBackend {
  database(viewId: string): Promise<{ id: string; layoutType: DatabaseLayoutPB }>;
  settings(viewId: string): Promise<DatabaseViewSettingPB>;
  writable(viewId: string, owner: HyperDocumentOwner): Promise<{ layout: ViewLayoutPB }>;
  write(viewId: string, setting: CalendarLayoutSettingPB): Promise<void>;
}
const backend: HyperCalendarPeriodSettingsBackend = {
  database: async value => unwrap(await DatabaseEventGetDatabase({ value })),
  settings: async value => unwrap(await DatabaseEventGetDatabaseSetting({ value })),
  writable: hyperReadDatabaseWriteView,
  async write(viewId, value) { unwrap(await DatabaseEventSetLayoutSetting({ viewId, layoutType: DatabaseLayoutPB.Calendar, oneOfCalendar: { case: 'calendar', value } })); },
};
/** Fresh reads merge unrelated settings. Native has no compare-and-set; a write
 * with an uncertain acknowledgement is followed by an explicit read, never replayed. */
async function updateCalendarSetting(viewId: string, databaseId: string, source: CalendarLayoutSettingPB, owner: HyperDocumentOwner, current: () => boolean, service: HyperCalendarPeriodSettingsBackend, prepare: (fresh: CalendarLayoutSettingPB) => CalendarLayoutSettingPB) {
  const captured = hyperCaptureDuplicateOwner(owner);
  const check = () => { if (!captured?.isCurrent() || !current()) throw new HyperCalendarPeriodError('unavailable'); };
  const read = async <T,>(operation: () => Promise<T>) => { check(); let value: T; try { value = await operation(); } catch (error) { check(); if (error instanceof HyperCalendarPeriodError) throw error; throw new HyperCalendarPeriodError('unavailable'); } check(); return value; };
  check(); prepare(source);
  const database = await read(() => service.database(viewId));
  const view = await read(() => service.writable(viewId, captured!));
  // Settings must be read after permission awaits: a period may have become Day
  // while the permission check was in flight.
  const settings = await read(() => service.settings(viewId));
  const calendar = settings.layoutSetting?.oneOfCalendar;
  if (database.id !== databaseId || database.layoutType !== DatabaseLayoutPB.Calendar || settings.layoutType !== DatabaseLayoutPB.Calendar || settings.layoutSetting?.layoutType !== DatabaseLayoutPB.Calendar || view.layout !== ViewLayoutPB.Calendar || calendar?.case !== 'calendar' || calendar.value.fieldId !== source.fieldId) throw new HyperCalendarPeriodError('changed');
  const fresh = calendar.value;
  if (!hyperCalendarPeriodSettingsEditable(fresh)) throw new HyperCalendarPeriodError('unsupported');
  const next = prepare(fresh);
  if (next === fresh) return fresh;
  check();
  try { await service.write(viewId, next); }
  catch { if (!captured?.isCurrent() || !current()) throw new HyperCalendarPeriodError('unavailable'); throw new HyperCalendarPeriodError('uncertain'); }
  check(); return next;
}
export async function hyperUpdateCalendarPeriod(viewId: string, databaseId: string, source: CalendarLayoutSettingPB, layoutTy: CalendarLayoutPB, owner: HyperDocumentOwner, current: () => boolean, service: HyperCalendarPeriodSettingsBackend = backend) {
  return updateCalendarSetting(viewId, databaseId, source, owner, current, service, fresh => {
    if (fresh.layoutTy !== source.layoutTy && fresh.layoutTy !== layoutTy) throw new HyperCalendarPeriodError('changed');
    return hyperCalendarPeriodSetting(fresh, layoutTy);
  });
}
export async function hyperUpdateCalendarWeekStart(viewId: string, databaseId: string, source: CalendarLayoutSettingPB, firstDayOfWeek: number, owner: HyperDocumentOwner, current: () => boolean, service: HyperCalendarPeriodSettingsBackend = backend) {
  return updateCalendarSetting(viewId, databaseId, source, owner, current, service, fresh => {
    if (fresh.firstDayOfWeek !== source.firstDayOfWeek && fresh.firstDayOfWeek !== firstDayOfWeek) throw new HyperCalendarPeriodError('changed');
    return hyperCalendarWeekStartSetting(fresh, firstDayOfWeek);
  });
}
