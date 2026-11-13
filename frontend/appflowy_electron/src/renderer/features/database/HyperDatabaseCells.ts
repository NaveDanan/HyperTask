import { fromBinary } from '@bufbuild/protobuf';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { CellPB } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { CheckboxCellDataPBSchema } from '@shared/protobuf/flowy-database2/checkbox_entities_pb';
import { DateCellDataPBSchema, type DateCellDataPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { SelectOptionCellDataPBSchema, SingleSelectTypeOptionPBSchema, MultiSelectTypeOptionPBSchema, type SelectOptionPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { URLCellDataPBSchema } from '@shared/protobuf/flowy-database2/url_entities_pb';
import { TimestampCellDataPBSchema } from '@shared/protobuf/flowy-database2/timestamp_entities_pb';
import { ChecklistCellDataPBSchema } from '@shared/protobuf/flowy-database2/checklist_entities_pb';
import { RelationCellDataPBSchema, RelationTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/relation_entities_pb';
import { MediaCellDataPBSchema, type MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { TimeCellDataPBSchema } from '@shared/protobuf/flowy-database2/time_entities_pb';

import { hyperDatabaseDateDisplay, hyperDatabaseDateEditable, hyperDatabaseDateOptions, hyperDatabaseDateParts } from './HyperDatabaseDate';

export interface HyperCellValue {
  text: string;
  checked?: boolean;
  selected?: SelectOptionPB[];
  checklist?: { options: SelectOptionPB[]; completed: string[] };
  rowIds?: string[];
  files?: MediaFilePB[];
  date?: string;
  dateData?: DateCellDataPB;
  editable: boolean;
}
export const hyperCellKey = (rowId: string, fieldId: string) => `${rowId}:${fieldId}`;
export function hyperDateInput(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
export function hyperDateTimestamp(date: string): bigint {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
  return BigInt(time / 1000);
}
/** CellPB.data is type-dependent protobuf, except for text/number cells which use UTF-8. */
export function hyperDecodeCell(field: FieldPB, cell: CellPB): HyperCellValue {
  const bytes = cell.data;
  switch (field.fieldType) {
    case FieldType.RichText: case FieldType.Number:
      return { text: new TextDecoder().decode(bytes), editable: true };
    case FieldType.Summary: case FieldType.Translate:
      return { text: new TextDecoder().decode(bytes), editable: false };
    case FieldType.Checkbox: {
      const checked = fromBinary(CheckboxCellDataPBSchema, bytes).isChecked;
      return { text: checked ? 'Yes' : 'No', checked, editable: true };
    }
    case FieldType.DateTime: {
      const data = fromBinary(DateCellDataPBSchema, bytes);
      const options = hyperDatabaseDateOptions(field.typeOptionData);
      let date = '';
      try { if (data.oneOfTimestamp.case === 'timestamp') date = hyperDatabaseDateParts(data.oneOfTimestamp.value, options.timezoneId).day; } catch { /* Keep unsupported values readable and unchanged. */ }
      return { text: hyperDatabaseDateDisplay(data, options), date, dateData: data, editable: hyperDatabaseDateEditable(data, options) };
    }
    case FieldType.SingleSelect: case FieldType.MultiSelect: {
      const selected = fromBinary(SelectOptionCellDataPBSchema, bytes).selectOptions;
      return { text: selected.map(option => option.name).join(', '), selected, editable: true };
    }
    case FieldType.URL:
      return { text: fromBinary(URLCellDataPBSchema, bytes).content, editable: true };
    case FieldType.CreatedTime: case FieldType.LastEditedTime:
      return { text: fromBinary(TimestampCellDataPBSchema, bytes).dateTime, editable: false };
    case FieldType.Checklist: {
      const data = fromBinary(ChecklistCellDataPBSchema, bytes);
      return { text: `${data.selectedOptions.length}/${data.options.length} · ${data.options.map(option => option.name).join(', ')}`, checklist: { options: data.options, completed: data.selectedOptions.map(option => option.id) }, editable: true };
    }
    case FieldType.Relation: {
      const rowIds = fromBinary(RelationCellDataPBSchema, bytes).rowIds;
      return { text: rowIds.join(', '), rowIds, editable: true };
    }
    case FieldType.Media: {
      const files = fromBinary(MediaCellDataPBSchema, bytes).files;
      return { text: files.map(file => file.name).join(', '), files, editable: true };
    }
    case FieldType.Time:
      return { text: String(fromBinary(TimeCellDataPBSchema, bytes).time), editable: false };
    default: return { text: `Field type ${field.fieldType}`, editable: false };
  }
}
export function hyperRelationDatabase(field: FieldPB): string {
  return fromBinary(RelationTypeOptionPBSchema, field.typeOptionData).databaseId;
}
export function hyperSelectOptions(field: FieldPB): SelectOptionPB[] {
  if (field.fieldType === FieldType.SingleSelect) return fromBinary(SingleSelectTypeOptionPBSchema, field.typeOptionData).options;
  if (field.fieldType === FieldType.MultiSelect) return fromBinary(MultiSelectTypeOptionPBSchema, field.typeOptionData).options;
  return [];
}
export function hyperCalendarDays(year: number, month: number, firstDayOfWeek = 0): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() - firstDayOfWeek + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(year, month, i - offset + 1)).toISOString().slice(0, 10));
}
