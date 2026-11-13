import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DateFilterPBSchema } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { hyperDecodeDatabaseDateFilter, hyperEncodeDatabaseDateFilter } from './HyperDatabaseDateFilterBinding';
describe('date filter binding compatibility', () => {
  it('keeps exact legacy bytes, including noncanonical ordering and unused dates, on unchanged Save', () => {
    const bytes = new Uint8Array([0x20, 0x00, 0x08, 0x00, 0x10, 0x01]);
    const decoded = hyperDecodeDatabaseDateFilter(bytes);
    expect(decoded.value.useFieldTimezone).toBe(false); expect(hyperEncodeDatabaseDateFilter(decoded.value, bytes)).toBe(bytes);
  });
  it('retains future fields on inspection and refuses edits that would discard them', () => {
    const known = toBinary(DateFilterPBSchema, create(DateFilterPBSchema, { oneOfTimestamp: { case: 'timestamp', value: 0n } }));
    const bytes = new Uint8Array([...known, 0x98, 0x06, 0x01]), decoded = hyperDecodeDatabaseDateFilter(bytes);
    expect(decoded.editable).toBe(false); expect(hyperEncodeDatabaseDateFilter(decoded.value, bytes)).toBe(bytes);
    expect(() => hyperEncodeDatabaseDateFilter({ ...decoded.value, useFieldTimezone: true }, bytes)).toThrow('unsupported');
  });
  it('round trips the opt-in without changing UTC logical criteria and protects unknown operators', () => {
    const value = { condition: 5, start: 1794355200n, end: 1794441600n, useFieldTimezone: true };
    expect(hyperDecodeDatabaseDateFilter(hyperEncodeDatabaseDateFilter(value)).value).toEqual({ ...value, timestamp: undefined });
    const bytes = new Uint8Array([0x08, 0x63]), decoded = hyperDecodeDatabaseDateFilter(bytes);
    expect(decoded.editable).toBe(false); expect(hyperEncodeDatabaseDateFilter(decoded.value, bytes)).toBe(bytes);
    expect(() => hyperEncodeDatabaseDateFilter({ ...decoded.value, condition: 0 }, bytes)).toThrow('unsupported');
  });
});
