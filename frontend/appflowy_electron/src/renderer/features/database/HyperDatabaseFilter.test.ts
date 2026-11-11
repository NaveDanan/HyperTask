import { create, toBinary } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { TextFilterPBSchema } from '@shared/protobuf/flowy-database2/text_filter_pb';
import { SelectOptionFilterPBSchema } from '@shared/protobuf/flowy-database2/select_option_filter_pb';
import { hyperDatabaseFilterConditions, hyperDatabaseFilterFieldEditable, hyperDatabaseFilterNew, hyperDatabaseFilterValidate, hyperDecodeDatabaseFilter, hyperEncodeDatabaseFilter } from './HyperDatabaseFilter';
import { hyperDatabaseTimestampFilterEdit, hyperDatabaseTimestampFilterForm } from './HyperDatabaseTimestampFilter';
import { hyperDateTimestamp } from './HyperDatabaseCells';
import { hyperDatabaseDateParts } from './HyperDatabaseDate';
afterEach(() => vi.unstubAllEnvs());
describe('native typed filter model', () => {
  it.each([FieldType.RichText, FieldType.URL, FieldType.Summary, FieldType.Translate, FieldType.Number, FieldType.Time, FieldType.Checkbox, FieldType.Checklist, FieldType.SingleSelect, FieldType.MultiSelect, FieldType.CreatedTime, FieldType.LastEditedTime, FieldType.Media, FieldType.Relation])('round trips all canonical operators for field %s', type => {
    for (const condition of hyperDatabaseFilterConditions(type)) {
      const value = { ...hyperDatabaseFilterNew(type), condition, content: type === FieldType.Number ? '42.000000000000000000000001' : type === FieldType.Time ? '90' : 'MiXeD value', optionIds: ['a', 'b'] };
      if (value.date) value.date = { ...value.date, condition, timestamp: 1794355200n, start: 1794355200n, end: 1794441600n };
      const bytes = hyperEncodeDatabaseFilter(type, value), decoded = hyperDecodeDatabaseFilter(type, bytes);
      expect(decoded.editable).toBe(true); expect(decoded.value.condition).toBe(condition); expect(hyperEncodeDatabaseFilter(type, decoded.value, bytes)).toBe(bytes);
    }
  });
  it('keeps noncanonical legacy bytes and ignored content unchanged on no-op', () => {
    const bytes = new Uint8Array([0x12, 0x01, 0x78, 0x08, 0x06]);
    const value = hyperDecodeDatabaseFilter(FieldType.RichText, bytes).value;
    expect(value.content).toBe('x'); expect(hyperEncodeDatabaseFilter(FieldType.RichText, value, bytes)).toBe(bytes);
    const select = toBinary(SelectOptionFilterPBSchema, create(SelectOptionFilterPBSchema, { condition: 2, optionIds: ['missing', 'missing'] }));
    expect(hyperEncodeDatabaseFilter(FieldType.SingleSelect, hyperDecodeDatabaseFilter(FieldType.SingleSelect, select).value, select)).toBe(select);
    expect(hyperDatabaseFilterConditions(FieldType.SingleSelect)).toEqual([0, 1, 4, 5]); expect(hyperDatabaseFilterConditions(FieldType.MultiSelect)).toEqual([2, 3, 4, 5]);
  });
  it('blocks unknown schema fields/operators and keeps their exact bytes on inspection', () => {
    const base = toBinary(TextFilterPBSchema, create(TextFilterPBSchema, { condition: 2, content: 'kept' }));
    for (const bytes of [new Uint8Array([...base, 0x98, 0x06, 0x01]), new Uint8Array([0x08, 0x63])]) {
      const decoded = hyperDecodeDatabaseFilter(FieldType.RichText, bytes); expect(decoded.editable).toBe(false);
      expect(hyperEncodeDatabaseFilter(FieldType.RichText, decoded.value, bytes)).toBe(bytes);
      expect(() => hyperEncodeDatabaseFilter(FieldType.RichText, { ...decoded.value, content: 'changed' }, bytes)).toThrow('unsupported');
    }
  });
  it('validates decimal precision without JavaScript float coercion and prevents empty selection predicates', () => {
    const value = hyperDatabaseFilterNew(FieldType.Number);
    for (const content of ['0', '-.5', '+2.0000000000000000000000000001', '79228162514264337593543950335']) expect(() => hyperDatabaseFilterValidate(FieldType.Number, { ...value, content })).not.toThrow();
    for (const content of ['', 'NaN', '1e3', '79228162514264337593543950336', '0.12345678901234567890123456789']) expect(() => hyperDatabaseFilterValidate(FieldType.Number, { ...value, content })).toThrow('invalidNumber');
    expect(() => hyperDatabaseFilterValidate(FieldType.SingleSelect, hyperDatabaseFilterNew(FieldType.SingleSelect))).toThrow('selectValue');
    expect(() => hyperDatabaseFilterValidate(FieldType.SingleSelect, { ...hyperDatabaseFilterNew(FieldType.SingleSelect), condition: 4 })).not.toThrow();
  });
  it('keeps malformed or future select option metadata read-only', () => {
    for (const typeOptionData of [new Uint8Array([0x0a]), new Uint8Array([0x98, 0x06, 0x01])]) expect(hyperDatabaseFilterFieldEditable(create(FieldPBSchema, { id: 'field', fieldType: FieldType.MultiSelect, typeOptionData }))).toBe(false);
  });
  it('uses effective system days for timestamp criteria without opting into property zones or changing original bytes', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const original = { condition: 0, timestamp: hyperDateTimestamp('2026-11-11'), useFieldTimezone: false }, form = hyperDatabaseTimestampFilterForm(original);
    expect(form.day).toBe('2026-11-10'); expect(hyperDatabaseTimestampFilterEdit(original, form).value).toBe(original);
    const changed = hyperDatabaseTimestampFilterEdit(original, { ...form, day: '2026-11-11' });
    expect(changed.value.useFieldTimezone).toBe(false); expect(hyperDatabaseDateParts(changed.value.timestamp!, 'America/New_York').day).toBe('2026-11-11');
    expect(() => hyperDatabaseTimestampFilterEdit(original, { ...form, condition: 8 })).toThrow('unsupported');
    const dst = hyperDatabaseTimestampFilterEdit(original, { ...form, day: '2026-03-08' }); expect(hyperDatabaseDateParts(dst.value.timestamp!, 'America/New_York').day).toBe('2026-03-08');
  });
});
