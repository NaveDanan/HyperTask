import { create, fromBinary, toBinary, type DescMessage } from '@bufbuild/protobuf';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { SingleSelectTypeOptionPBSchema, MultiSelectTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { TextFilterPBSchema } from '@shared/protobuf/flowy-database2/text_filter_pb';
import { NumberFilterPBSchema } from '@shared/protobuf/flowy-database2/number_filter_pb';
import { TimeFilterPBSchema } from '@shared/protobuf/flowy-database2/time_filter_pb';
import { CheckboxFilterPBSchema } from '@shared/protobuf/flowy-database2/checkbox_filter_pb';
import { ChecklistFilterPBSchema } from '@shared/protobuf/flowy-database2/checklist_filter_pb';
import { SelectOptionFilterPBSchema } from '@shared/protobuf/flowy-database2/select_option_filter_pb';
import { MediaFilterPBSchema } from '@shared/protobuf/flowy-database2/media_filter_pb';
import { DateFilterPBSchema } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { RelationFilterPBSchema } from '@shared/protobuf/flowy-database2/relation_filter_pb';
import { hyperDecodeDatabaseDateFilter, hyperEncodeDatabaseDateFilter } from './HyperDatabaseDateFilterBinding';
import type { HyperDatabaseDateFilterValue } from './HyperDatabaseDateFilter';
import { hyperDecodeDatabaseRelationFilter } from './HyperDatabaseRelationFilter';
import { hyperDatabaseTimeFilterEditable, hyperDatabaseTimeFilterValidate } from './HyperDatabaseTimeFilter';
export type HyperDatabaseFilterKind = 'text' | 'number' | 'time' | 'checkbox' | 'checklist' | 'select' | 'media' | 'relation' | 'timestamp';
export interface HyperDatabaseFilterValue { condition: number; content: string; optionIds: string[]; date?: HyperDatabaseDateFilterValue }
export function hyperDatabaseFilterKind(type: FieldType): HyperDatabaseFilterKind | null {
  switch (type) {
    case FieldType.RichText: case FieldType.URL: case FieldType.Summary: case FieldType.Translate: return 'text';
    case FieldType.Number: return 'number';
    case FieldType.Time: return 'time';
    case FieldType.Checkbox: return 'checkbox';
    case FieldType.Checklist: return 'checklist';
    case FieldType.SingleSelect: case FieldType.MultiSelect: return 'select';
    case FieldType.CreatedTime: case FieldType.LastEditedTime: return 'timestamp';
    case FieldType.Media: return 'media';
    case FieldType.Relation: return 'relation';
    default: return null;
  }
}
const schemas = { text: TextFilterPBSchema, number: NumberFilterPBSchema, time: TimeFilterPBSchema, checkbox: CheckboxFilterPBSchema, checklist: ChecklistFilterPBSchema, select: SelectOptionFilterPBSchema, media: MediaFilterPBSchema, relation: RelationFilterPBSchema, timestamp: DateFilterPBSchema } as const satisfies Record<HyperDatabaseFilterKind, DescMessage>;
export function hyperDatabaseFilterFieldEditable(field: FieldPB) {
  const kind = hyperDatabaseFilterKind(field.fieldType); if (!kind) return false;
  if (kind !== 'select') return true;
  try { const options = fromBinary(field.fieldType === FieldType.SingleSelect ? SingleSelectTypeOptionPBSchema : MultiSelectTypeOptionPBSchema, field.typeOptionData); return !options.$unknown?.length && !options.options.some(option => option.$unknown?.length); } catch { return false; }
}
export function hyperDatabaseFilterConditions(type: FieldType) {
  const kind = hyperDatabaseFilterKind(type);
  if (kind === 'select') return type === FieldType.SingleSelect ? [0, 1, 4, 5] : [2, 3, 4, 5];
  return kind === 'text' || kind === 'number' || kind === 'time' || kind === 'timestamp' ? [0, 1, 2, 3, 4, 5, 6, 7] : kind ? [0, 1] : [];
}
export function hyperDecodeDatabaseFilter(type: FieldType, bytes: Uint8Array) {
  const kind = hyperDatabaseFilterKind(type); if (!kind) throw Error('unsupported');
  if (kind === 'timestamp') {
    const decoded = hyperDecodeDatabaseDateFilter(bytes);
    return { value: { condition: decoded.value.condition, content: '', optionIds: [], date: decoded.value } as HyperDatabaseFilterValue, editable: decoded.editable && decoded.value.condition < 8 };
  }
  if (kind === 'relation') {
    const decoded = hyperDecodeDatabaseRelationFilter(bytes);
    return { value: { condition: decoded.choice, content: '', optionIds: [] } as HyperDatabaseFilterValue, editable: decoded.editable };
  }
  const data = fromBinary(schemas[kind], bytes);
  const value: HyperDatabaseFilterValue = { condition: Number(data.condition), content: 'content' in data ? data.content : '', optionIds: 'optionIds' in data ? data.optionIds : [] };
  const known = kind === 'select' ? value.condition >= 0 && value.condition <= 5 : hyperDatabaseFilterConditions(type).includes(value.condition);
  return { value, editable: !data.$unknown?.length && known && (kind !== 'time' || hyperDatabaseTimeFilterEditable(value.condition, value.content)) };
}
export function hyperDatabaseFilterSame(left: HyperDatabaseFilterValue, right: HyperDatabaseFilterValue) {
  return left.condition === right.condition && left.content === right.content && left.optionIds.length === right.optionIds.length && left.optionIds.every((id, index) => right.optionIds[index] === id) && (!left.date && !right.date || left.date && right.date && (['condition', 'timestamp', 'start', 'end', 'useFieldTimezone'] as const).every(key => left.date![key] === right.date![key]));
}
export function hyperDatabaseFilterNeedsValue(type: FieldType, condition: number) {
  const kind = hyperDatabaseFilterKind(type);
  return kind === 'text' || kind === 'number' || kind === 'time' ? condition < 6 : kind === 'select' ? condition < 4 : false;
}
export function hyperDatabaseFilterValidate(type: FieldType, value: HyperDatabaseFilterValue) {
  const kind = hyperDatabaseFilterKind(type); if (!kind || !(kind === 'select' ? value.condition >= 0 && value.condition <= 5 : hyperDatabaseFilterConditions(type).includes(value.condition))) throw Error('unsupported');
  if (kind === 'timestamp' && (!value.date || value.date.condition !== value.condition)) throw Error('unsupported');
  if (kind === 'time') hyperDatabaseTimeFilterValidate(value.condition, value.content);
  if (kind === 'number' && value.condition < 6) {
    const match = /^[+-]?(\d*)(?:\.(\d*))?$/.exec(value.content);
    if (!match || !(match[1] || match[2]) || (match[2]?.length ?? 0) > 28 || BigInt((match[1] + (match[2] ?? '')).replace(/^0+/, '') || '0') > 79228162514264337593543950335n) throw Error('invalidNumber');
  }
  if (kind === 'select' && value.condition < 4 && !value.optionIds.length) throw Error('selectValue');
}
export function hyperEncodeDatabaseFilter(type: FieldType, value: HyperDatabaseFilterValue, source?: Uint8Array) {
  if (source) { const decoded = hyperDecodeDatabaseFilter(type, source); if (hyperDatabaseFilterSame(decoded.value, value)) return source; if (!decoded.editable) throw Error('unsupported'); }
  hyperDatabaseFilterValidate(type, value);
  const kind = hyperDatabaseFilterKind(type)!;
  if (kind === 'timestamp') { if (!value.date) throw Error('unsupported'); return hyperEncodeDatabaseDateFilter(value.date, source); }
  if (kind === 'relation') return toBinary(RelationFilterPBSchema, create(RelationFilterPBSchema, { condition: BigInt(value.condition) }));
  const data = kind === 'select' ? { condition: value.condition, optionIds: value.condition < 4 ? value.optionIds : [] } : kind === 'text' || kind === 'number' || kind === 'time' || kind === 'media' ? { condition: value.condition, content: hyperDatabaseFilterNeedsValue(type, value.condition) ? value.content : '' } : { condition: value.condition };
  return toBinary(schemas[kind], create(schemas[kind], data));
}
export function hyperDatabaseFilterNew(type: FieldType): HyperDatabaseFilterValue {
  const kind = hyperDatabaseFilterKind(type); if (!kind) throw Error('unsupported');
  return { condition: kind === 'text' ? 2 : kind === 'select' ? type === FieldType.SingleSelect ? 0 : 2 : 0, content: '', optionIds: [], ...(kind === 'timestamp' ? { date: { condition: 0, timestamp: BigInt(Math.floor(Date.now() / 1000)), useFieldTimezone: false } } : {}) };
}
