import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  DatabaseEventGetDatabase, DatabaseEventGetFields, DatabaseEventGetDatabaseSetting, DatabaseEventGetCell,
  DatabaseEventUpdateCell, DatabaseEventUpdateDateCell, DatabaseEventUpdateSelectOptionCell,
  DatabaseEventCreateRow, DatabaseEventCreateField, DatabaseEventGetGroups, DatabaseEventMoveGroupRow,
  DatabaseEventGetAllCalendarEvents, DatabaseEventUpdateDatabaseSetting,
  DatabaseEventSetLayoutSetting, DatabaseEventGetAllFieldSettings, DatabaseEventUpdateFieldSettings,
  DatabaseEventCreateSelectOption, DatabaseEventInsertOrUpdateSelectOption, DatabaseEventSetGroupByField, DatabaseEventUpdateGroup,
  DatabaseEventGetAllCalculations, DatabaseEventUpdateCalculation, DatabaseEventRemoveCalculation,
  DatabaseEventUpdateChecklistCell, DatabaseEventUpdateRelationCell, DatabaseEventGetRelatedDatabaseRows,
  DatabaseEventGetRelatedRowDatas, DatabaseEventGetDatabases, DatabaseEventUpdateFieldTypeOption, DatabaseEventUpdateField,
  DatabaseEventUpdateMediaCell, DatabaseEventRenameMediaFile,
  DatabaseEventDuplicateRow, DatabaseEventGetRowMeta, DatabaseEventHyperUpdateRowActivity,
} from '@/backend/events/flowy-database2';
import { FolderEventGetView, FolderEventUpdateView } from '@/backend/events/flowy-folder';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { unwrap } from '@/backend/dispatch';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DatabaseLayoutPB, type DatabaseSettingChangesetPBSchema, type DatabaseViewSettingPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/flowy-database2/position_entities_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { hyperDatabaseDateChangeset, type HyperDatabaseDateMutation } from './HyperDatabaseDate';
import { hyperDateTimestamp } from './HyperDatabaseCells';
import { CalendarLayoutSettingPBSchema } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import type { CalculationType } from '@shared/protobuf/flowy-database2/calculation_entities_pb';
import type { SelectOptionPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { RelationTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/relation_entities_pb';
import { MediaFilePBSchema, MediaFileTypePB, type MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { FileUploadTypePB } from '@shared/protobuf/flowy-database2/file_entities_pb';
import type { HyperRowDuplicateRequest } from './HyperDatabaseRowDuplicateModel';
import type { HyperDatabaseRowActivityRequest } from './HyperDatabaseRowActivity';

export class HyperDatabaseRepository {
  async updateRowActivity(request: HyperDatabaseRowActivityRequest) {
    return unwrap(await DatabaseEventHyperUpdateRowActivity({ viewId: request.viewId, contextId: request.contextId, activityId: request.activityId, revision: request.revision, rowIds: request.rowIds, closeActivity: request.closeActivity }));
  }
  async rowMetadata(viewId: string, rowId: string) { return unwrap(await DatabaseEventGetRowMeta({ viewId, rowId })); }
  async duplicateRow({ viewId, rowId, operationId, groupId }: HyperRowDuplicateRequest) {
    return unwrap(await DatabaseEventDuplicateRow({ viewId, rowId, oneOfOperationId: { case: 'operationId', value: operationId }, ...(groupId ? { oneOfGroupId: { case: 'groupId', value: groupId } as const } : {}) }));
  }
  async load(viewId: string) {
    // GetDatabase opens the view controller. The other events need it to exist first.
    const database = unwrap(await DatabaseEventGetDatabase({ value: viewId }));
    const [fields, settings, fieldSettings, calculations] = await Promise.all([
      DatabaseEventGetFields({ viewId }), DatabaseEventGetDatabaseSetting({ value: viewId }), DatabaseEventGetAllFieldSettings({ value: viewId }), DatabaseEventGetAllCalculations({ value: viewId }),
    ]);
    return { database, fields: unwrap(fields).items, settings: unwrap(settings), fieldSettings: unwrap(fieldSettings).items, calculations: unwrap(calculations).items };
  }
  async cell(viewId: string, rowId: string, fieldId: string) { return unwrap(await DatabaseEventGetCell({ viewId, rowId, fieldId })); }
  async updateText(viewId: string, rowId: string, fieldId: string, text: string) { unwrap(await DatabaseEventUpdateCell({ viewId, rowId, fieldId, cellChangeset: text })); }
  async updateDate(viewId: string, rowId: string, fieldId: string, date: string) {
    unwrap(await DatabaseEventUpdateDateCell({ cellId: { viewId, rowId, fieldId }, ...(date ? { oneOfTimestamp: { case: 'timestamp', value: hyperDateTimestamp(date) } } : { oneOfClearFlag: { case: 'clearFlag', value: true } }) }));
  }
  async updateDateDetails(viewId: string, rowId: string, fieldId: string, changes: HyperDatabaseDateMutation) {
    unwrap(await DatabaseEventUpdateDateCell({ ...hyperDatabaseDateChangeset(changes), cellId: { viewId, rowId, fieldId } }));
  }
  async updateSelect(viewId: string, rowId: string, fieldId: string, previous: string[], next: string[]) {
    unwrap(await DatabaseEventUpdateSelectOptionCell({ cellIdentifier: { viewId, rowId, fieldId }, insertOptionIds: next.filter(id => !previous.includes(id)), deleteOptionIds: previous.filter(id => !next.includes(id)) }));
  }
  async createSelectOption(viewId: string, rowId: string, fieldId: string, name: string) {
    const option = unwrap(await DatabaseEventCreateSelectOption({ viewId, fieldId, optionName: name }));
    unwrap(await DatabaseEventInsertOrUpdateSelectOption({ viewId, rowId, fieldId, items: [option] }));
  }
  async checklist(viewId: string, rowId: string, fieldId: string, changes: { insertTask?: { name: string }[]; deleteTasks?: string[]; updateTasks?: SelectOptionPB[]; completedTasks?: string[]; reorder?: string }) {
    unwrap(await DatabaseEventUpdateChecklistCell({ ...changes, cellId: { viewId, rowId, fieldId } }));
  }
  async relation(viewId: string, rowId: string, fieldId: string, relatedRowId: string, selected: boolean) {
    unwrap(await DatabaseEventUpdateRelationCell({ viewId, cellId: { viewId, rowId, fieldId }, insertedRowIds: selected ? [relatedRowId] : [], removedRowIds: selected ? [] : [relatedRowId] }));
  }
  async relatedRows(databaseId: string, rowIds?: string[]) {
    return unwrap(await (rowIds ? DatabaseEventGetRelatedRowDatas({ databaseId, rowIds }) : DatabaseEventGetRelatedDatabaseRows({ value: databaseId }))).rows;
  }
  async databases() {
    const databases = unwrap(await DatabaseEventGetDatabases()).items;
    return Promise.all(databases.map(async database => {
      const result = await FolderEventGetView({ value: database.viewId });
      return { ...database, name: result.ok ? result.value.name || database.databaseId : database.databaseId };
    }));
  }
  async relationDatabase(viewId: string, fieldId: string, databaseId: string) {
    unwrap(await DatabaseEventUpdateFieldTypeOption({ viewId, fieldId, typeOptionData: toBinary(RelationTypeOptionPBSchema, create(RelationTypeOptionPBSchema, { databaseId })) }));
  }
  async renameField(viewId: string, fieldId: string, name: string) {
    unwrap(await DatabaseEventUpdateField({ viewId, fieldId, oneOfName: { case: 'name', value: name } }));
  }
  async layout(viewId: string, layout: DatabaseLayoutPB) {
    const target = layout === DatabaseLayoutPB.Board ? ViewLayoutPB.Board : layout === DatabaseLayoutPB.Calendar ? ViewLayoutPB.Calendar : ViewLayoutPB.Grid;
    // Folder UpdateView updates the navigation layout and the database controller together.
    unwrap(await FolderEventUpdateView({ viewId, oneOfLayout: { case: 'layout', value: target } }));
  }
  async attachMedia(viewId: string, rowId: string, fieldId: string, file: MediaFilePB) {
    await this.attachMediaFiles(viewId, rowId, fieldId, [file]);
  }
  async attachMediaFiles(viewId: string, rowId: string, fieldId: string, files: MediaFilePB[]) {
    unwrap(await DatabaseEventUpdateMediaCell({ viewId, cellId: { viewId, rowId, fieldId }, insertedFiles: files }));
  }
  async attachMediaLink(viewId: string, rowId: string, fieldId: string, url: string, name: string) {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Use an HTTP or HTTPS address');
    await this.attachMedia(viewId, rowId, fieldId, create(MediaFilePBSchema, { id: crypto.randomUUID(), name: name.trim() || target.pathname.split('/').filter(Boolean).at(-1) || target.hostname, url: target.href, uploadType: FileUploadTypePB.NetworkFile, fileType: MediaFileTypePB.Link }));
  }
  async removeMedia(viewId: string, rowId: string, fieldId: string, fileId: string) {
    unwrap(await DatabaseEventUpdateMediaCell({ viewId, cellId: { viewId, rowId, fieldId }, removedIds: [fileId] }));
  }
  async renameMedia(viewId: string, rowId: string, fieldId: string, fileId: string, name: string) {
    unwrap(await DatabaseEventRenameMediaFile({ viewId, cellId: { viewId, rowId, fieldId }, fileId, name }));
  }
  async createRow(viewId: string, groupId?: string) {
    return unwrap(await DatabaseEventCreateRow({ viewId, rowPosition: { position: OrderObjectPositionTypePB.End }, ...(groupId ? { oneOfGroupId: { case: 'groupId', value: groupId } } : {}) }));
  }
  async createField(viewId: string, name: string, fieldType: FieldType, relatedDatabaseId?: string) {
    return unwrap(await DatabaseEventCreateField({ viewId, fieldType, oneOfFieldName: { case: 'fieldName', value: name }, ...(fieldType === FieldType.Relation && relatedDatabaseId ? { oneOfTypeOptionData: { case: 'typeOptionData' as const, value: toBinary(RelationTypeOptionPBSchema, create(RelationTypeOptionPBSchema, { databaseId: relatedDatabaseId })) } } : {}) }));
  }
  async groups(viewId: string) { return unwrap(await DatabaseEventGetGroups({ value: viewId })).items; }
  async moveCard(viewId: string, rowId: string, fromGroupId: string, toGroupId: string) {
    unwrap(await DatabaseEventMoveGroupRow({ viewId, fromRowId: rowId, fromGroupId, toGroupId }));
  }
  async groupBy(viewId: string, fieldId: string) { unwrap(await DatabaseEventSetGroupByField({ viewId, fieldId })); }
  async showGroup(viewId: string, groupId: string, visible: boolean) { unwrap(await DatabaseEventUpdateGroup({ viewId, groupId, oneOfVisible: { case: 'visible', value: visible } })); }
  async calendar(viewId: string) {
    // This event already returns all visible rows, including rows without a timestamp.
    // Derive the undated list from the same snapshot rather than scanning the view twice.
    const events = unwrap(await DatabaseEventGetAllCalendarEvents({ viewId })).items;
    const undated = events.flatMap(event => event.oneOfTimestamp.case !== 'timestamp' && event.rowMeta ? [{ rowId: event.rowMeta.id, title: event.title }] : []);
    return { events, undated };
  }
  async setting(changes: MessageInitShape<typeof DatabaseSettingChangesetPBSchema>) {
    unwrap(await DatabaseEventUpdateDatabaseSetting(changes));
  }
  async calendarField(viewId: string, fieldId: string, current: DatabaseViewSettingPB) {
    const previous = current.layoutSetting?.oneOfCalendar;
    const calendar = previous?.case === 'calendar' ? previous.value : create(CalendarLayoutSettingPBSchema, { showWeekends: true });
    unwrap(await DatabaseEventSetLayoutSetting({ viewId, layoutType: DatabaseLayoutPB.Calendar, oneOfCalendar: { case: 'calendar', value: { ...calendar, fieldId } } }));
  }
  async fieldVisibility(viewId: string, fieldId: string, visible: boolean) {
    unwrap(await DatabaseEventUpdateFieldSettings({ viewId, fieldId, oneOfVisibility: { case: 'visibility', value: visible ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden } }));
  }
  async calculate(viewId: string, fieldId: string, calculationType: CalculationType, calculationId?: string) {
    unwrap(await DatabaseEventUpdateCalculation({ viewId, fieldId, calculationType, ...(calculationId ? { oneOfCalculationId: { case: 'calculationId', value: calculationId } } : {}) }));
  }
  async removeCalculation(viewId: string, fieldId: string, calculationId: string) { unwrap(await DatabaseEventRemoveCalculation({ viewId, fieldId, calculationId })); }
}
export type HyperDatabaseSnapshot = Awaited<ReturnType<HyperDatabaseRepository['load']>>;
