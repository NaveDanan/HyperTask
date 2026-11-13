import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { DateFilterPBSchema } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { hyperDatabaseDateFilterConditions, type HyperDatabaseDateFilterValue } from './HyperDatabaseDateFilter';

export function hyperDecodeDatabaseDateFilter(bytes: Uint8Array) {
  const data = fromBinary(DateFilterPBSchema, bytes);
  const value: HyperDatabaseDateFilterValue = { condition: data.condition, timestamp: data.oneOfTimestamp.value, start: data.oneOfStart.value, end: data.oneOfEnd.value, useFieldTimezone: data.useFieldTimezone };
  return { value, editable: !data.$unknown?.length && hyperDatabaseDateFilterConditions.includes(data.condition) };
}
export function hyperEncodeDatabaseDateFilter(value: HyperDatabaseDateFilterValue, source?: Uint8Array) {
  if (source) {
    const decoded = hyperDecodeDatabaseDateFilter(source);
    if ((['condition', 'timestamp', 'start', 'end', 'useFieldTimezone'] as const).every(key => decoded.value[key] === value[key])) return source;
    if (!decoded.editable) throw new Error('unsupported');
  }
  if (!hyperDatabaseDateFilterConditions.includes(value.condition)) throw new Error('unsupported');
  return toBinary(DateFilterPBSchema, create(DateFilterPBSchema, {
    condition: value.condition, useFieldTimezone: value.useFieldTimezone,
    ...(value.timestamp !== undefined ? { oneOfTimestamp: { case: 'timestamp', value: value.timestamp } } : {}),
    ...(value.start !== undefined ? { oneOfStart: { case: 'start', value: value.start } } : {}),
    ...(value.end !== undefined ? { oneOfEnd: { case: 'end', value: value.end } } : {}),
  }));
}
