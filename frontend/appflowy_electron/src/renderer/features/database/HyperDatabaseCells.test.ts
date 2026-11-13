import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { CheckboxCellDataPBSchema } from '@shared/protobuf/flowy-database2/checkbox_entities_pb';
import { DateCellDataPBSchema, DateFormatPB, DateTypeOptionPBSchema, TimeFormatPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { SelectOptionCellDataPBSchema, SingleSelectTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { MediaCellDataPBSchema } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { URLCellDataPBSchema } from '@shared/protobuf/flowy-database2/url_entities_pb';
import { hyperCalendarDays, hyperDateInput, hyperDateTimestamp, hyperDecodeCell, hyperSelectOptions } from './HyperDatabaseCells';

const field = (fieldType: FieldType) => create(FieldPBSchema, { id: 'field', name: 'Property', fieldType, ...(fieldType === FieldType.DateTime ? { typeOptionData: toBinary(DateTypeOptionPBSchema, create(DateTypeOptionPBSchema, { timezoneId: 'UTC', dateFormat: DateFormatPB.ISO, timeFormat: TimeFormatPB.TwentyFourHour })) } : {}) });
const cell = (data: Uint8Array) => create(CellPBSchema, { rowId: 'row', fieldId: 'field', data });
describe('Hyper database cell codecs', () => {
  it('decodes text and number cells as UTF-8 without interpreting them as protobuf', () => {
    expect(hyperDecodeCell(field(FieldType.RichText), cell(new TextEncoder().encode('Hello 🌎')))).toEqual({ text: 'Hello 🌎', editable: true });
    expect(hyperDecodeCell(field(FieldType.Number), cell(new TextEncoder().encode('42.50')))).toEqual({ text: '42.50', editable: true });
  });
  it('decodes protobuf checkbox and selection values', () => {
    expect(hyperDecodeCell(field(FieldType.Checkbox), cell(toBinary(CheckboxCellDataPBSchema, create(CheckboxCellDataPBSchema, { isChecked: true })))).checked).toBe(true);
    const choice = create(SelectOptionCellDataPBSchema, { selectOptions: [{ id: 'a', name: 'Ready' }] });
    expect(hyperDecodeCell(field(FieldType.SingleSelect), cell(toBinary(SelectOptionCellDataPBSchema, choice))).selected?.[0].name).toBe('Ready');
  });
  it('exposes complete date data for range/time editing while keeping reminders read-only', () => {
    const simple = create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: 1794268800n } });
    expect(hyperDecodeCell(field(FieldType.DateTime), cell(toBinary(DateCellDataPBSchema, simple)))).toMatchObject({ text: '2026-11-10', date: '2026-11-10', dateData: simple, editable: true });
    for (const complex of [{ includeTime: true }, { isRange: true }]) {
      expect(hyperDecodeCell(field(FieldType.DateTime), cell(toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { ...simple, ...complex })))).editable).toBe(true);
    }
    expect(hyperDecodeCell(field(FieldType.DateTime), cell(toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { ...simple, reminderId: 'reminder' })))).editable).toBe(false);
  });
  it('keeps attachment names readable without converting unsupported fields to text', () => {
    const media = create(MediaCellDataPBSchema, { files: [{ id: 'asset', name: 'Research.pdf', url: '/real/user/file.pdf' }] });
    expect(hyperDecodeCell(field(FieldType.Media), cell(toBinary(MediaCellDataPBSchema, media)))).toMatchObject({ text: 'Research.pdf', editable: true, files: [{ id: 'asset', url: '/real/user/file.pdf' }] });
    expect(hyperDecodeCell(field(99 as FieldType), cell(new Uint8Array())).editable).toBe(false);
    expect(hyperDecodeCell(field(FieldType.URL), cell(toBinary(URLCellDataPBSchema, create(URLCellDataPBSchema, { content: 'https://example.org' })))).text).toBe('https://example.org');
  });
  it('extracts option definitions from the field type options rather than guessing from row values', () => {
    const select = field(FieldType.SingleSelect);
    select.typeOptionData = toBinary(SingleSelectTypeOptionPBSchema, create(SingleSelectTypeOptionPBSchema, { options: [{ id: 'a', name: 'Ready' }, { id: 'b', name: 'Done' }] }));
    expect(hyperSelectOptions(select).map(option => option.name)).toEqual(['Ready', 'Done']);
  });
  it('round-trips date-only values and rejects impossible dates', () => {
    for (const date of ['1970-01-01', '2024-02-29', '2026-11-10']) expect(hyperDateInput(hyperDateTimestamp(date))).toBe(date);
    for (const date of ['2026-02-30', '2026-13-01', '2026-1-1', 'bad']) expect(() => hyperDateTimestamp(date)).toThrow('Invalid date');
  });
  it('builds a full six-week month crossing year boundaries with the configured first weekday', () => {
    const sunday = hyperCalendarDays(2026, 0), monday = hyperCalendarDays(2026, 0, 1);
    expect(sunday).toHaveLength(42); expect(sunday[0]).toBe('2025-12-28'); expect(sunday.at(-1)).toBe('2026-02-07');
    expect(monday[0]).toBe('2025-12-29'); expect(new Set(monday).size).toBe(42);
  });
});
