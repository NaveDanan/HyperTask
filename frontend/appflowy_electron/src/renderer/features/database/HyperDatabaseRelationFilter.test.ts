import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { RelationFilterPBSchema } from '@shared/protobuf/flowy-database2/relation_filter_pb';
import { hyperDecodeDatabaseRelationFilter } from './HyperDatabaseRelationFilter';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { hyperDecodeDatabaseFilter, hyperEncodeDatabaseFilter } from './HyperDatabaseFilter';
describe('signed relation filter conditions', () => {
  it.each([-1n, 255n, 300n, -9223372036854775808n, 9223372036854775807n])('keeps %s exact and read-only without narrowing it to an enum or floating-point number', condition => {
    const bytes = toBinary(RelationFilterPBSchema, create(RelationFilterPBSchema, { condition })), before = bytes.slice(), decoded = hyperDecodeDatabaseRelationFilter(bytes);
    expect(decoded.condition).toBe(condition); expect(decoded.choice).toBe(-1); expect(decoded.editable).toBe(false); expect(bytes).toEqual(before);
    const value = hyperDecodeDatabaseFilter(FieldType.Relation, bytes); expect(value.editable).toBe(false); expect(hyperEncodeDatabaseFilter(FieldType.Relation, value.value, bytes)).toBe(bytes);
    expect(() => hyperEncodeDatabaseFilter(FieldType.Relation, { ...value.value, condition: 0 }, bytes)).toThrow('unsupported');
  });
  it('allows only the existing empty/not-empty choices, keeping future protobuf fields read-only', () => {
    for (const condition of [0n, 1n]) { const bytes = toBinary(RelationFilterPBSchema, create(RelationFilterPBSchema, { condition })); expect(hyperDecodeDatabaseRelationFilter(bytes)).toEqual({ condition, choice: Number(condition), editable: true }); expect(hyperDecodeDatabaseRelationFilter(new Uint8Array([...bytes, 0x98, 0x06, 0x01])).editable).toBe(false); }
  });
});
