// Generated from rust-lib/flowy-database2/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { EMPTY, request, type FlowyResult } from '../dispatch';
import { RemoveCalculationChangesetPBSchema, UpdateCalculationChangesetPBSchema } from '@shared/protobuf/flowy-database2/calculation_changeset_pb';
import { RepeatedCalculationsPBSchema, type RepeatedCalculationsPB } from '@shared/protobuf/flowy-database2/calculation_entities_pb';
import { CalendarEventPBSchema, CalendarEventRequestPBSchema, MoveCalendarEventPBSchema, RepeatedCalendarEventPBSchema, RepeatedNoDateCalendarEventPBSchema, type CalendarEventPB, type RepeatedCalendarEventPB, type RepeatedNoDateCalendarEventPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { CellChangesetPBSchema, CellIdPBSchema, CellPBSchema, CreateSelectOptionPayloadPBSchema, type CellPB } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { ChecklistCellDataChangesetPBSchema } from '@shared/protobuf/flowy-database2/checklist_entities_pb';
import { CreateDatabaseViewPayloadPBSchema, CustomPromptDatabaseConfigPBSchema, DatabaseGroupIdPBSchema, DatabaseIdPBSchema, DatabaseLayoutMetaPBSchema, DatabasePBSchema, DatabaseViewIdPBSchema, MoveFieldPayloadPBSchema, MoveGroupRowPayloadPBSchema, MoveRowPayloadPBSchema, RemoveCoverPayloadPBSchema, RepeatedCustomPromptPBSchema, RepeatedDatabaseDescriptionPBSchema, RepeatedDatabaseIdPBSchema, RepeatedDatabaseSnapshotPBSchema, type CustomPromptDatabaseConfigPB, type DatabaseIdPB, type DatabasePB, type DatabaseViewIdPB, type RepeatedCustomPromptPB, type RepeatedDatabaseDescriptionPB, type RepeatedDatabaseIdPB, type RepeatedDatabaseSnapshotPB } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DateCellChangesetPBSchema } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { ClearFieldPayloadPBSchema, CreateFieldPayloadPBSchema, DeleteFieldPayloadPBSchema, DuplicateFieldPayloadPBSchema, FieldChangesetPBSchema, FieldPBSchema, GetFieldPayloadPBSchema, RepeatedFieldPBSchema, TypeOptionChangesetPBSchema, UpdateFieldTypePayloadPBSchema, type FieldPB, type RepeatedFieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldIdsPBSchema, FieldSettingsChangesetPBSchema, RepeatedFieldSettingsPBSchema, type RepeatedFieldSettingsPB } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { MoveGroupPayloadPBSchema } from '@shared/protobuf/flowy-database2/group_changeset_pb';
import { CreateGroupPayloadPBSchema, DeleteGroupPayloadPBSchema, GroupByFieldPayloadPBSchema, GroupPBSchema, RepeatedGroupPBSchema, UpdateGroupPBSchema, type GroupPB, type RepeatedGroupPB } from '@shared/protobuf/flowy-database2/group_pb';
import { MediaCellChangesetPBSchema, RenameMediaChangesetPBSchema } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { GetRelatedRowDataPBSchema, RelationCellChangesetPBSchema, RepeatedRelatedRowDataPBSchema, type RepeatedRelatedRowDataPB } from '@shared/protobuf/flowy-database2/relation_entities_pb';
import { CreateRowPayloadPBSchema, DatabaseViewRowIdPBSchema, OptionalRowPBSchema, RepeatedRowIdPBSchema, RepeatedRowMetaPBSchema, RowMetaPBSchema, SummaryRowPBSchema, TranslateRowPBSchema, UpdateRowMetaChangesetPBSchema, type OptionalRowPB, type RepeatedRowMetaPB, type RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { RepeatedSelectOptionPayloadSchema, SelectOptionCellChangesetPBSchema, SelectOptionPBSchema, type SelectOptionPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { DatabaseLayoutSettingPBSchema, DatabaseSettingChangesetPBSchema, DatabaseViewSettingPBSchema, LayoutSettingChangesetPBSchema, type DatabaseLayoutSettingPB, type DatabaseViewSettingPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { DatabaseExportDataPBSchema, type DatabaseExportDataPB } from '@shared/protobuf/flowy-database2/share_entities_pb';
import { RepeatedSortPBSchema, type RepeatedSortPB } from '@shared/protobuf/flowy-database2/sort_entities_pb';
import { RepeatedFilterPBSchema, type RepeatedFilterPB } from '@shared/protobuf/flowy-database2/util_pb';

export function DatabaseEventGetDatabase(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<DatabasePB>> {
  return request('GetDatabase', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), DatabasePBSchema);
}

export function DatabaseEventGetDatabaseId(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<DatabaseIdPB>> {
  return request('GetDatabaseId', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), DatabaseIdPBSchema);
}

export function DatabaseEventGetDatabaseSetting(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<DatabaseViewSettingPB>> {
  return request('GetDatabaseSetting', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), DatabaseViewSettingPBSchema);
}

export function DatabaseEventUpdateDatabaseSetting(payload: MessageInitShape<typeof DatabaseSettingChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateDatabaseSetting', toBinary(DatabaseSettingChangesetPBSchema, create(DatabaseSettingChangesetPBSchema, payload)));
}

export function DatabaseEventGetAllFilters(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedFilterPB>> {
  return request('GetAllFilters', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedFilterPBSchema);
}

export function DatabaseEventGetAllSorts(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedSortPB>> {
  return request('GetAllSorts', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedSortPBSchema);
}

export function DatabaseEventDeleteAllSorts(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<void>> {
  return request('DeleteAllSorts', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)));
}

export function DatabaseEventGetDatabaseData(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<void>> {
  return request('GetDatabaseData', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)));
}

export function DatabaseEventGetFields(payload: MessageInitShape<typeof GetFieldPayloadPBSchema>): Promise<FlowyResult<RepeatedFieldPB>> {
  return request('GetFields', toBinary(GetFieldPayloadPBSchema, create(GetFieldPayloadPBSchema, payload)), RepeatedFieldPBSchema);
}

export function DatabaseEventUpdateField(payload: MessageInitShape<typeof FieldChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateField', toBinary(FieldChangesetPBSchema, create(FieldChangesetPBSchema, payload)));
}

export function DatabaseEventUpdateFieldTypeOption(payload: MessageInitShape<typeof TypeOptionChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateFieldTypeOption', toBinary(TypeOptionChangesetPBSchema, create(TypeOptionChangesetPBSchema, payload)));
}

export function DatabaseEventDeleteField(payload: MessageInitShape<typeof DeleteFieldPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('DeleteField', toBinary(DeleteFieldPayloadPBSchema, create(DeleteFieldPayloadPBSchema, payload)));
}

export function DatabaseEventClearField(payload: MessageInitShape<typeof ClearFieldPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('ClearField', toBinary(ClearFieldPayloadPBSchema, create(ClearFieldPayloadPBSchema, payload)));
}

export function DatabaseEventUpdateFieldType(payload: MessageInitShape<typeof UpdateFieldTypePayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateFieldType', toBinary(UpdateFieldTypePayloadPBSchema, create(UpdateFieldTypePayloadPBSchema, payload)));
}

export function DatabaseEventDuplicateField(payload: MessageInitShape<typeof DuplicateFieldPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('DuplicateField', toBinary(DuplicateFieldPayloadPBSchema, create(DuplicateFieldPayloadPBSchema, payload)));
}

export function DatabaseEventMoveField(payload: MessageInitShape<typeof MoveFieldPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('MoveField', toBinary(MoveFieldPayloadPBSchema, create(MoveFieldPayloadPBSchema, payload)));
}

export function DatabaseEventCreateField(payload: MessageInitShape<typeof CreateFieldPayloadPBSchema>): Promise<FlowyResult<FieldPB>> {
  return request('CreateField', toBinary(CreateFieldPayloadPBSchema, create(CreateFieldPayloadPBSchema, payload)), FieldPBSchema);
}

export function DatabaseEventGetPrimaryField(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<FieldPB>> {
  return request('GetPrimaryField', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), FieldPBSchema);
}

export function DatabaseEventCreateSelectOption(payload: MessageInitShape<typeof CreateSelectOptionPayloadPBSchema>): Promise<FlowyResult<SelectOptionPB>> {
  return request('CreateSelectOption', toBinary(CreateSelectOptionPayloadPBSchema, create(CreateSelectOptionPayloadPBSchema, payload)), SelectOptionPBSchema);
}

export function DatabaseEventInsertOrUpdateSelectOption(payload: MessageInitShape<typeof RepeatedSelectOptionPayloadSchema>): Promise<FlowyResult<void>> {
  return request('InsertOrUpdateSelectOption', toBinary(RepeatedSelectOptionPayloadSchema, create(RepeatedSelectOptionPayloadSchema, payload)));
}

export function DatabaseEventDeleteSelectOption(payload: MessageInitShape<typeof RepeatedSelectOptionPayloadSchema>): Promise<FlowyResult<void>> {
  return request('DeleteSelectOption', toBinary(RepeatedSelectOptionPayloadSchema, create(RepeatedSelectOptionPayloadSchema, payload)));
}

export function DatabaseEventCreateRow(payload: MessageInitShape<typeof CreateRowPayloadPBSchema>): Promise<FlowyResult<RowMetaPB>> {
  return request('CreateRow', toBinary(CreateRowPayloadPBSchema, create(CreateRowPayloadPBSchema, payload)), RowMetaPBSchema);
}

export function DatabaseEventGetRow(payload: MessageInitShape<typeof DatabaseViewRowIdPBSchema>): Promise<FlowyResult<OptionalRowPB>> {
  return request('GetRow', toBinary(DatabaseViewRowIdPBSchema, create(DatabaseViewRowIdPBSchema, payload)), OptionalRowPBSchema);
}

export function DatabaseEventDeleteRows(payload: MessageInitShape<typeof RepeatedRowIdPBSchema>): Promise<FlowyResult<void>> {
  return request('DeleteRows', toBinary(RepeatedRowIdPBSchema, create(RepeatedRowIdPBSchema, payload)));
}

export function DatabaseEventDuplicateRow(payload: MessageInitShape<typeof DatabaseViewRowIdPBSchema>): Promise<FlowyResult<void>> {
  return request('DuplicateRow', toBinary(DatabaseViewRowIdPBSchema, create(DatabaseViewRowIdPBSchema, payload)));
}

export function DatabaseEventMoveRow(payload: MessageInitShape<typeof MoveRowPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('MoveRow', toBinary(MoveRowPayloadPBSchema, create(MoveRowPayloadPBSchema, payload)));
}

export function DatabaseEventGetRowMeta(payload: MessageInitShape<typeof DatabaseViewRowIdPBSchema>): Promise<FlowyResult<RowMetaPB>> {
  return request('GetRowMeta', toBinary(DatabaseViewRowIdPBSchema, create(DatabaseViewRowIdPBSchema, payload)), RowMetaPBSchema);
}

export function DatabaseEventUpdateRowMeta(payload: MessageInitShape<typeof UpdateRowMetaChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateRowMeta', toBinary(UpdateRowMetaChangesetPBSchema, create(UpdateRowMetaChangesetPBSchema, payload)));
}

export function DatabaseEventRemoveCover(payload: MessageInitShape<typeof RemoveCoverPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('RemoveCover', toBinary(RemoveCoverPayloadPBSchema, create(RemoveCoverPayloadPBSchema, payload)));
}

export function DatabaseEventGetCell(payload: MessageInitShape<typeof CellIdPBSchema>): Promise<FlowyResult<CellPB>> {
  return request('GetCell', toBinary(CellIdPBSchema, create(CellIdPBSchema, payload)), CellPBSchema);
}

export function DatabaseEventUpdateCell(payload: MessageInitShape<typeof CellChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateCell', toBinary(CellChangesetPBSchema, create(CellChangesetPBSchema, payload)));
}

export function DatabaseEventUpdateSelectOptionCell(payload: MessageInitShape<typeof SelectOptionCellChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateSelectOptionCell', toBinary(SelectOptionCellChangesetPBSchema, create(SelectOptionCellChangesetPBSchema, payload)));
}

export function DatabaseEventUpdateChecklistCell(payload: MessageInitShape<typeof ChecklistCellDataChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateChecklistCell', toBinary(ChecklistCellDataChangesetPBSchema, create(ChecklistCellDataChangesetPBSchema, payload)));
}

export function DatabaseEventUpdateDateCell(payload: MessageInitShape<typeof DateCellChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateDateCell', toBinary(DateCellChangesetPBSchema, create(DateCellChangesetPBSchema, payload)));
}

export function DatabaseEventSetGroupByField(payload: MessageInitShape<typeof GroupByFieldPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('SetGroupByField', toBinary(GroupByFieldPayloadPBSchema, create(GroupByFieldPayloadPBSchema, payload)));
}

export function DatabaseEventGetGroups(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedGroupPB>> {
  return request('GetGroups', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedGroupPBSchema);
}

export function DatabaseEventGetGroup(payload: MessageInitShape<typeof DatabaseGroupIdPBSchema>): Promise<FlowyResult<GroupPB>> {
  return request('GetGroup', toBinary(DatabaseGroupIdPBSchema, create(DatabaseGroupIdPBSchema, payload)), GroupPBSchema);
}

export function DatabaseEventMoveGroup(payload: MessageInitShape<typeof MoveGroupPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('MoveGroup', toBinary(MoveGroupPayloadPBSchema, create(MoveGroupPayloadPBSchema, payload)));
}

export function DatabaseEventMoveGroupRow(payload: MessageInitShape<typeof MoveGroupRowPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('MoveGroupRow', toBinary(MoveGroupRowPayloadPBSchema, create(MoveGroupRowPayloadPBSchema, payload)));
}

export function DatabaseEventUpdateGroup(payload: MessageInitShape<typeof UpdateGroupPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateGroup', toBinary(UpdateGroupPBSchema, create(UpdateGroupPBSchema, payload)));
}

export function DatabaseEventCreateGroup(payload: MessageInitShape<typeof CreateGroupPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('CreateGroup', toBinary(CreateGroupPayloadPBSchema, create(CreateGroupPayloadPBSchema, payload)));
}

export function DatabaseEventDeleteGroup(payload: MessageInitShape<typeof DeleteGroupPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('DeleteGroup', toBinary(DeleteGroupPayloadPBSchema, create(DeleteGroupPayloadPBSchema, payload)));
}

export function DatabaseEventGetDefaultDatabaseViewId(payload: MessageInitShape<typeof DatabaseIdPBSchema>): Promise<FlowyResult<DatabaseViewIdPB>> {
  return request('GetDefaultDatabaseViewId', toBinary(DatabaseIdPBSchema, create(DatabaseIdPBSchema, payload)), DatabaseViewIdPBSchema);
}

export function DatabaseEventGetDatabases(): Promise<FlowyResult<RepeatedDatabaseDescriptionPB>> {
  return request('GetDatabases', EMPTY, RepeatedDatabaseDescriptionPBSchema);
}

export function DatabaseEventSetLayoutSetting(payload: MessageInitShape<typeof LayoutSettingChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('SetLayoutSetting', toBinary(LayoutSettingChangesetPBSchema, create(LayoutSettingChangesetPBSchema, payload)));
}

export function DatabaseEventGetLayoutSetting(payload: MessageInitShape<typeof DatabaseLayoutMetaPBSchema>): Promise<FlowyResult<DatabaseLayoutSettingPB>> {
  return request('GetLayoutSetting', toBinary(DatabaseLayoutMetaPBSchema, create(DatabaseLayoutMetaPBSchema, payload)), DatabaseLayoutSettingPBSchema);
}

export function DatabaseEventGetAllCalendarEvents(payload: MessageInitShape<typeof CalendarEventRequestPBSchema>): Promise<FlowyResult<RepeatedCalendarEventPB>> {
  return request('GetAllCalendarEvents', toBinary(CalendarEventRequestPBSchema, create(CalendarEventRequestPBSchema, payload)), RepeatedCalendarEventPBSchema);
}

export function DatabaseEventGetNoDateCalendarEvents(payload: MessageInitShape<typeof CalendarEventRequestPBSchema>): Promise<FlowyResult<RepeatedNoDateCalendarEventPB>> {
  return request('GetNoDateCalendarEvents', toBinary(CalendarEventRequestPBSchema, create(CalendarEventRequestPBSchema, payload)), RepeatedNoDateCalendarEventPBSchema);
}

export function DatabaseEventGetCalendarEvent(payload: MessageInitShape<typeof DatabaseViewRowIdPBSchema>): Promise<FlowyResult<CalendarEventPB>> {
  return request('GetCalendarEvent', toBinary(DatabaseViewRowIdPBSchema, create(DatabaseViewRowIdPBSchema, payload)), CalendarEventPBSchema);
}

export function DatabaseEventMoveCalendarEvent(payload: MessageInitShape<typeof MoveCalendarEventPBSchema>): Promise<FlowyResult<void>> {
  return request('MoveCalendarEvent', toBinary(MoveCalendarEventPBSchema, create(MoveCalendarEventPBSchema, payload)));
}

export function DatabaseEventCreateDatabaseView(payload: MessageInitShape<typeof CreateDatabaseViewPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('CreateDatabaseView', toBinary(CreateDatabaseViewPayloadPBSchema, create(CreateDatabaseViewPayloadPBSchema, payload)));
}

export function DatabaseEventExportCSV(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<DatabaseExportDataPB>> {
  return request('ExportCSV', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), DatabaseExportDataPBSchema);
}

export function DatabaseEventGetDatabaseSnapshots(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedDatabaseSnapshotPB>> {
  return request('GetDatabaseSnapshots', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedDatabaseSnapshotPBSchema);
}

export function DatabaseEventGetFieldSettings(payload: MessageInitShape<typeof FieldIdsPBSchema>): Promise<FlowyResult<RepeatedFieldSettingsPB>> {
  return request('GetFieldSettings', toBinary(FieldIdsPBSchema, create(FieldIdsPBSchema, payload)), RepeatedFieldSettingsPBSchema);
}

export function DatabaseEventGetAllFieldSettings(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedFieldSettingsPB>> {
  return request('GetAllFieldSettings', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedFieldSettingsPBSchema);
}

export function DatabaseEventUpdateFieldSettings(payload: MessageInitShape<typeof FieldSettingsChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateFieldSettings', toBinary(FieldSettingsChangesetPBSchema, create(FieldSettingsChangesetPBSchema, payload)));
}

export function DatabaseEventGetAllCalculations(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedCalculationsPB>> {
  return request('GetAllCalculations', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedCalculationsPBSchema);
}

export function DatabaseEventUpdateCalculation(payload: MessageInitShape<typeof UpdateCalculationChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateCalculation', toBinary(UpdateCalculationChangesetPBSchema, create(UpdateCalculationChangesetPBSchema, payload)));
}

export function DatabaseEventRemoveCalculation(payload: MessageInitShape<typeof RemoveCalculationChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('RemoveCalculation', toBinary(RemoveCalculationChangesetPBSchema, create(RemoveCalculationChangesetPBSchema, payload)));
}

export function DatabaseEventGetRelatedDatabaseIds(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedDatabaseIdPB>> {
  return request('GetRelatedDatabaseIds', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedDatabaseIdPBSchema);
}

export function DatabaseEventUpdateRelationCell(payload: MessageInitShape<typeof RelationCellChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateRelationCell', toBinary(RelationCellChangesetPBSchema, create(RelationCellChangesetPBSchema, payload)));
}

export function DatabaseEventGetRelatedRowDatas(payload: MessageInitShape<typeof GetRelatedRowDataPBSchema>): Promise<FlowyResult<RepeatedRelatedRowDataPB>> {
  return request('GetRelatedRowDatas', toBinary(GetRelatedRowDataPBSchema, create(GetRelatedRowDataPBSchema, payload)), RepeatedRelatedRowDataPBSchema);
}

export function DatabaseEventGetRelatedDatabaseRows(payload: MessageInitShape<typeof DatabaseIdPBSchema>): Promise<FlowyResult<RepeatedRelatedRowDataPB>> {
  return request('GetRelatedDatabaseRows', toBinary(DatabaseIdPBSchema, create(DatabaseIdPBSchema, payload)), RepeatedRelatedRowDataPBSchema);
}

export function DatabaseEventSummarizeRow(payload: MessageInitShape<typeof SummaryRowPBSchema>): Promise<FlowyResult<void>> {
  return request('SummarizeRow', toBinary(SummaryRowPBSchema, create(SummaryRowPBSchema, payload)));
}

export function DatabaseEventTranslateRow(payload: MessageInitShape<typeof TranslateRowPBSchema>): Promise<FlowyResult<void>> {
  return request('TranslateRow', toBinary(TranslateRowPBSchema, create(TranslateRowPBSchema, payload)));
}

export function DatabaseEventInitRow(payload: MessageInitShape<typeof DatabaseViewRowIdPBSchema>): Promise<FlowyResult<void>> {
  return request('InitRow', toBinary(DatabaseViewRowIdPBSchema, create(DatabaseViewRowIdPBSchema, payload)));
}

export function DatabaseEventGetAllRows(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<RepeatedRowMetaPB>> {
  return request('GetAllRows', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), RepeatedRowMetaPBSchema);
}

export function DatabaseEventExportRawDatabaseData(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<DatabaseExportDataPB>> {
  return request('ExportRawDatabaseData', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), DatabaseExportDataPBSchema);
}

export function DatabaseEventUpdateMediaCell(payload: MessageInitShape<typeof MediaCellChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateMediaCell', toBinary(MediaCellChangesetPBSchema, create(MediaCellChangesetPBSchema, payload)));
}

export function DatabaseEventRenameMediaFile(payload: MessageInitShape<typeof RenameMediaChangesetPBSchema>): Promise<FlowyResult<void>> {
  return request('RenameMediaFile', toBinary(RenameMediaChangesetPBSchema, create(RenameMediaChangesetPBSchema, payload)));
}

export function DatabaseEventGetDatabaseCustomPrompts(payload: MessageInitShape<typeof CustomPromptDatabaseConfigPBSchema>): Promise<FlowyResult<RepeatedCustomPromptPB>> {
  return request('GetDatabaseCustomPrompts', toBinary(CustomPromptDatabaseConfigPBSchema, create(CustomPromptDatabaseConfigPBSchema, payload)), RepeatedCustomPromptPBSchema);
}

export function DatabaseEventTestCustomPromptDatabaseConfiguration(payload: MessageInitShape<typeof DatabaseViewIdPBSchema>): Promise<FlowyResult<CustomPromptDatabaseConfigPB>> {
  return request('TestCustomPromptDatabaseConfiguration', toBinary(DatabaseViewIdPBSchema, create(DatabaseViewIdPBSchema, payload)), CustomPromptDatabaseConfigPBSchema);
}
