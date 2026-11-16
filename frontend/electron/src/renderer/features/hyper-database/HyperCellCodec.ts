import { create, fromBinary } from '@bufbuild/protobuf';
import { FieldType, type FieldPB } from '@shared/protobuf/hyper-database2/field_entities_pb';
import type { CellPB } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { CheckboxCellDataPBSchema } from '@shared/protobuf/hyper-database2/checkbox_entities_pb';
import { DateCellDataPBSchema, DateTypeOptionPBSchema, DateFormatPB, TimeFormatPB } from '@shared/protobuf/hyper-database2/date_entities_pb';
import { SelectOptionCellDataPBSchema, SingleSelectTypeOptionPBSchema } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import { ChecklistCellDataPBSchema } from '@shared/protobuf/hyper-database2/checklist_entities_pb';
import { TimestampCellDataPBSchema } from '@shared/protobuf/hyper-database2/timestamp_entities_pb';
import { RelationCellDataPBSchema, RelationTypeOptionPBSchema } from '@shared/protobuf/hyper-database2/relation_entities_pb';
import { TimeCellDataPBSchema } from '@shared/protobuf/hyper-database2/time_entities_pb';
import { URLCellDataPBSchema } from '@shared/protobuf/hyper-database2/url_entities_pb';
import { MediaCellDataPBSchema } from '@shared/protobuf/hyper-database2/media_entities_pb';
import type { HyperCell } from './HyperDatabaseTypes';

export function hyperFieldOptions(field: FieldPB) {
  if (field.fieldType !== FieldType.SingleSelect && field.fieldType !== FieldType.MultiSelect) return [];
  return fromBinary(SingleSelectTypeOptionPBSchema, field.typeOptionData).options;
}
function dateDisplay(timestamp: bigint | null, includeTime: boolean, field: FieldPB) {
  if (timestamp === null) return '';
  const options = field.fieldType === FieldType.DateTime ? fromBinary(DateTypeOptionPBSchema, field.typeOptionData) : create(DateTypeOptionPBSchema);
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const locale = options.dateFormat === DateFormatPB.US ? 'en-US' : options.dateFormat === DateFormatPB.DayMonthYear ? 'en-GB' : undefined;
  const datePart = options.dateFormat === DateFormatPB.ISO ? new Intl.DateTimeFormat('sv-SE', { timeZone: options.timezoneId || undefined }).format(date) : new Intl.DateTimeFormat(locale, { year: 'numeric', month: options.dateFormat === DateFormatPB.Friendly || options.dateFormat === DateFormatPB.FriendlyFull ? 'short' : '2-digit', day: '2-digit', timeZone: options.timezoneId || undefined }).format(date);
  return includeTime ? `${datePart} ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: options.timeFormat === TimeFormatPB.TwelveHour, timeZone: options.timezoneId || undefined }).format(date)}` : datePart;
}
/** The core uses UTF-8 for text/number/AI cells, protobuf for all other types. */
export function decodeHyperCell(cell: CellPB, field: FieldPB): HyperCell {
  try { return decode(cell, field); }
  catch (error) {
    const empty = decode(createCell(cell), { ...field, typeOptionData: new Uint8Array() });
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}
function createCell(cell: CellPB): CellPB { return { ...cell, data: new Uint8Array() }; }
function decode(cell: CellPB, field: FieldPB): HyperCell {
  const text = () => new TextDecoder().decode(cell.data);
  switch (field.fieldType) {
    case FieldType.RichText: return { kind: 'text', text: text(), display: text() };
    case FieldType.Summary: return { kind: 'summary', text: text(), display: text() };
    case FieldType.Translate: return { kind: 'translate', text: text(), display: text() };
    case FieldType.Number: {
      // Formatted strings (currency/percent) are already formatted by the core.
      const display = text(); const value = Number(display.replace(/[^\d.eE+\-]/g, ''));
      return { kind: 'number', value: display && Number.isFinite(value) ? value : null, display };
    }
    case FieldType.URL: { const { content } = fromBinary(URLCellDataPBSchema, cell.data); return { kind: 'url', url: content, display: content }; }
    case FieldType.Checkbox: { const { isChecked } = fromBinary(CheckboxCellDataPBSchema, cell.data); return { kind: 'checkbox', checked: isChecked, display: isChecked ? 'Checked' : '' }; }
    case FieldType.DateTime: {
      const data = fromBinary(DateCellDataPBSchema, cell.data);
      const timestamp = data.oneOfTimestamp.value ?? null; const endTimestamp = data.oneOfEndTimestamp.value ?? null;
      const display = dateDisplay(timestamp, data.includeTime, field);
      return { kind: 'date', timestamp, endTimestamp, isRange: data.isRange, includeTime: data.includeTime, reminderId: data.reminderId, display: data.isRange && endTimestamp !== null ? `${display} – ${dateDisplay(endTimestamp, data.includeTime, field)}` : display };
    }
    case FieldType.SingleSelect: case FieldType.MultiSelect: {
      const selected = fromBinary(SelectOptionCellDataPBSchema, cell.data).selectOptions;
      return { kind: field.fieldType === FieldType.SingleSelect ? 'singleSelect' : 'multiSelect', selected, options: hyperFieldOptions(field), display: selected.map(o => o.name).join(', ') };
    }
    case FieldType.Checklist: {
      const data = fromBinary(ChecklistCellDataPBSchema, cell.data); const completed = new Set(data.selectedOptions.map(o => o.id));
      return { kind: 'checklist', items: data.options.map(o => ({ ...o, completed: completed.has(o.id) })), progress: data.percentage, display: data.options.length ? `${completed.size}/${data.options.length}` : '' };
    }
    case FieldType.CreatedTime: case FieldType.LastEditedTime: {
      const data = fromBinary(TimestampCellDataPBSchema, cell.data); const timestamp = data.oneOfTimestamp.value ?? null;
      return { kind: field.fieldType === FieldType.CreatedTime ? 'createdTime' : 'lastEditedTime', timestamp, display: data.dateTime };
    }
    case FieldType.Relation: {
      const { rowIds } = fromBinary(RelationCellDataPBSchema, cell.data); const { databaseId } = fromBinary(RelationTypeOptionPBSchema, field.typeOptionData);
      return { kind: 'relation', rowIds, databaseId, display: rowIds.join(', ') };
    }
    case FieldType.Time: {
      const { time } = fromBinary(TimeCellDataPBSchema, cell.data);
      return { kind: 'time', seconds: cell.data.length ? time : null, display: cell.data.length ? `${String(time / 3600n).padStart(2, '0')}:${String(time % 3600n / 60n).padStart(2, '0')}` : '' };
    }
    case FieldType.Media: { const { files } = fromBinary(MediaCellDataPBSchema, cell.data); return { kind: 'media', files, display: files.map(f => f.name).join(', ') }; }
    default: throw new Error(`Unsupported field type ${field.fieldType}`);
  }
}
