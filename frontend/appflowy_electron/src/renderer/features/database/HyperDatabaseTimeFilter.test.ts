import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { NumberFilterConditionPB as Condition } from '@shared/protobuf/flowy-database2/number_filter_pb';
import { TimeFilterPBSchema } from '@shared/protobuf/flowy-database2/time_filter_pb';
import { hyperDatabaseFilterConditions, hyperDatabaseFilterNew, hyperDecodeDatabaseFilter, hyperEncodeDatabaseFilter } from './HyperDatabaseFilter';
import { hyperDatabaseTimeFilterMinutes, hyperDatabaseTimeFilterValidate } from './HyperDatabaseTimeFilter';

const minimum = '-9223372036854775808', maximum = '9223372036854775807';
const value = (condition: number, content = '') => ({ ...hyperDatabaseFilterNew(FieldType.Time), condition, content });
const raw = (condition: number, content: string) => toBinary(TimeFilterPBSchema, create(TimeFilterPBSchema, { condition, content }));

describe('exact integer-minute Time property filters', () => {
  it.each(['0', '-0', '-30', '+00090', '9007199254740993', minimum, maximum])('preserves exact minutes and wire spelling for %s', content => {
    const bytes = hyperEncodeDatabaseFilter(FieldType.Time, value(Condition.Equal, content));
    expect(fromBinary(TimeFilterPBSchema, bytes).content).toBe(content);
    const decoded = hyperDecodeDatabaseFilter(FieldType.Time, bytes);
    expect(decoded.editable).toBe(true);
    expect(hyperDatabaseTimeFilterMinutes(decoded.value.content)).toBe(BigInt(content));
    expect(hyperEncodeDatabaseFilter(FieldType.Time, decoded.value, bytes)).toBe(bytes);
  });

  it.each(['', '1.5', '1e3', 'NaN', 'Infinity', '1h 30m', '01:30', ' 90', '90 ', '9223372036854775808', '-9223372036854775809', '0'.repeat(65)])('rejects invalid or unbounded changed criteria %j', content => {
    expect(() => hyperEncodeDatabaseFilter(FieldType.Time, value(Condition.Equal, content))).toThrow('invalidTime');
  });

  it('uses all eight native operators and clears draft values only for explicitly chosen presence conditions', () => {
    expect(hyperDatabaseFilterConditions(FieldType.Time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const condition of hyperDatabaseFilterConditions(FieldType.Time)) {
      const bytes = hyperEncodeDatabaseFilter(FieldType.Time, value(condition, '90'));
      const decoded = fromBinary(TimeFilterPBSchema, bytes);
      expect(decoded.condition).toBe(condition);
      expect(decoded.content).toBe(condition < 6 ? '90' : '');
      expect(hyperDecodeDatabaseFilter(FieldType.Time, bytes).editable).toBe(true);
    }
  });

  it('blocks native prefill overflow while accepting inclusive/equality endpoints and adjacent safe strict values', () => {
    expect(() => hyperDatabaseTimeFilterValidate(Condition.GreaterThan, maximum)).toThrow('invalidTime');
    expect(() => hyperDatabaseTimeFilterValidate(Condition.LessThan, minimum)).toThrow('invalidTime');
    for (const condition of [Condition.Equal, Condition.NotEqual, Condition.GreaterThanOrEqualTo, Condition.LessThanOrEqualTo]) {
      for (const content of [minimum, maximum]) expect(() => hyperDatabaseTimeFilterValidate(condition, content)).not.toThrow();
    }
    expect(() => hyperDatabaseTimeFilterValidate(Condition.GreaterThan, '9223372036854775806')).not.toThrow();
    expect(() => hyperDatabaseTimeFilterValidate(Condition.LessThan, '-9223372036854775807')).not.toThrow();
  });

  it.each([
    raw(Condition.Equal, 'not minutes'), raw(Condition.Equal, ''),
    raw(Condition.NumberIsEmpty, '90'), raw(Condition.NumberIsNotEmpty, '90'),
    raw(Condition.GreaterThan, maximum), raw(Condition.LessThan, minimum),
    raw(99, '90'), new Uint8Array([...raw(Condition.Equal, '90'), 0x98, 0x06, 0x01]),
  ])('keeps unsupported or legacy semantics inspect-only without rewriting exact bytes', bytes => {
    const decoded = hyperDecodeDatabaseFilter(FieldType.Time, bytes);
    expect(decoded.editable).toBe(false);
    expect(hyperEncodeDatabaseFilter(FieldType.Time, decoded.value, bytes)).toBe(bytes);
    expect(() => hyperEncodeDatabaseFilter(FieldType.Time, { ...decoded.value, content: '60' }, bytes)).toThrow('unsupported');
  });
});
