import { create } from '@bufbuild/protobuf';
import { expect, it, vi } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import type { HyperField } from '../../HyperDatabaseTypes';
import { HyperGridColumns } from './HyperGridColumns';
vi.mock('@/ui', () => ({ showToast: vi.fn() }));
vi.mock('@/ui/toast', () => ({ showToast: vi.fn() }));
it('formats copied cell values instead of internal row identifiers, including readonly fields', () => {
  const types = [FieldType.RichText, FieldType.Number, FieldType.DateTime, FieldType.SingleSelect, FieldType.Checkbox];
  const values = ['Launch task', '42.50', 'Nov 15, 2026', 'In progress', 'Checked'];
  const fields: HyperField[] = types.map((type, i) => ({ id: String(i), name: String(i), type, isPrimary: i === 0, options: [], settings: create(FieldSettingsPBSchema), proto: create(FieldPBSchema, { id: String(i), fieldType: type }) }));
  const columns = HyperGridColumns(fields, vi.fn(), vi.fn(), (_rowId, fieldId) => values[Number(fieldId)]);
  for (const field of fields) {
    expect(columns.find(column => column.id === field.id)?.meta?.cellEdit?.format?.('internal-row-id', { id: 'internal-row-id' })).toBe(values[Number(field.id)]);
  }
});

vi.mock('./HyperGridCell', () => ({ HyperGridCell: () => null }));
vi.mock('./HyperGridExpanded', () => ({ HyperGridExpanded: () => null }));
vi.mock('./HyperGridFieldMenu', () => ({ HyperGridFieldMenu: () => null, HyperGridAddField: () => null }));
