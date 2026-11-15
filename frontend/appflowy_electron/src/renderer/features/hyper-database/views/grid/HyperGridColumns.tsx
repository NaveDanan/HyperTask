"use no memo";
import { ChevronRight, Plus } from 'lucide-react';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { ColumnDef, Row, HeaderContext } from '@tanstack/react-table';
import type { DataGridFeatures } from '@/components/reui/data-grid/data-grid';
import { DataGridTableRowExpand, DataGridTableRowSelect, DataGridTableRowSelectAll } from '@/components/reui/data-grid/data-grid-table';
import { Skeleton } from '@/components/ui/skeleton';
import type { HyperField } from '../../HyperDatabaseTypes';
import { HyperGridCell } from './HyperGridCell';
import { HyperGridExpanded } from './HyperGridExpanded';
import { HyperGridAddField, HyperGridFieldMenu } from './HyperGridFieldMenu';
import { useHyperGrid } from './HyperGridContext';

export interface HyperGridRow {
  id: string;
}

// ReUI's DnD header reads this consumer flag for fixed utility columns.
type HyperGridColumn = ColumnDef<DataGridFeatures, HyperGridRow> & { enableColumnOrdering?: boolean };

function HyperGridPrimaryCell(
  {
    rowId,
    field,
  }: {
    rowId: string;
    field: HyperField;
  },
) {
  const grid = useHyperGrid();

  return (
    <span className='flex min-w-0 items-center'>{grid.state.rows[rowId]?.icon ? <span className='ml-3 shrink-0'>{grid.state.rows[rowId].icon}</span> : null}<span className='min-w-0 flex-1'>
        <HyperGridCell rowId={rowId} field={field} />
      </span>
    </span>
  );
}

export function HyperGridColumns(
  fields: HyperField[],
  selectRange: (row: Row<DataGridFeatures, HyperGridRow>, shift: boolean) => void,
  fieldCreated: (id: string) => void,
  cellDisplay: (rowId: string, fieldId: string) => string = () => '',
): HyperGridColumn[] {
  return [{
    id: 'hyper-expand',
    size: 36,
    minSize: 36,
    maxSize: 36,
    enableResizing: false,
    enableHiding: false,
    enableSorting: false,
    header: () => <span className='sr-only'>Expand row</span>,

    cell: (
      {
        row,
      },
    ) => <DataGridTableRowExpand row={row}>
      <ChevronRight
        className='size-4 transition-transform in-aria-[expanded=true]:rotate-90 motion-reduce:transition-none' />
    </DataGridTableRowExpand>,

    meta: {
      cellClassName: 'p-0 text-center',
      headerClassName: 'px-1',
      expandedContent: row => <HyperGridExpanded rowId={row.id} />,
    },
  }, {
    id: 'hyper-select',
    size: 36,
    minSize: 36,
    maxSize: 36,
    enableResizing: false,
    enableHiding: false,
    enableSorting: false,
    header: () => <DataGridTableRowSelectAll />,

    cell: (
      {
        row,
      },
    ) => <span
      onClickCapture={event => {
        selectRange(row, event.shiftKey);

        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}>
      <DataGridTableRowSelect row={row} />
    </span>,

    meta: {
      cellClassName: 'px-1 text-center',
      headerClassName: 'px-1 text-center',
    },
  }, ...fields.map(field => ({
    id: field.id,
    accessorFn: (row: HyperGridRow) => row.id,
    size: Math.max(field.isPrimary ? 240 : 80, field.settings.width || 160),
    minSize: field.isPrimary ? 240 : 80,
    enableHiding: !field.isPrimary,

    header: (
      {
        column,
      }: HeaderContext<DataGridFeatures, HyperGridRow, unknown>,
    ) => <HyperGridFieldMenu field={field} pinned={column.getIsPinned()} pin={position => column.pin(position)} />,

    cell: (
      {
        row,
      }: {
        row: Row<DataGridFeatures, HyperGridRow>;
      },
    ) => field.isPrimary ? <HyperGridPrimaryCell rowId={row.id} field={field} /> : <HyperGridCell rowId={row.id} field={field} />,

    meta: {
      headerTitle: field.name,
      headerClassName: 'h-10 px-3 text-xs font-medium text-muted-foreground',
      cellClassName: 'p-0',
      skeleton: <Skeleton className='mx-3 h-4 w-24' />,
      fillWidth: field.isPrimary,

      cellEdit: {
        editable: [FieldType.RichText, FieldType.Number, FieldType.DateTime, FieldType.SingleSelect, FieldType.MultiSelect, FieldType.URL].includes(field.type),
        format: (_value: unknown, row: HyperGridRow) => cellDisplay(row.id, field.id),
      },
    },
  })), {
    id: 'hyper-add-field',
    enableColumnOrdering: false,
    size: 40,
    minSize: 40,
    maxSize: 40,
    enableResizing: false,
    enableHiding: false,
    enableSorting: false,

    header: () => <HyperGridAddField onCreated={fieldCreated}>
      <Plus className='size-3.5' />
    </HyperGridAddField>,

    cell: () => null,

    meta: {
      headerClassName: 'px-2',
      cellClassName: 'p-0',
    },
  }];
}
