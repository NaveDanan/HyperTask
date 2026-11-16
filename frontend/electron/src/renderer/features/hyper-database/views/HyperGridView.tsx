"use no memo";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTable } from '@tanstack/react-table';
import type { ColumnPinningState, ColumnSizingState, ExpandedState, RowSelectionState, Row } from '@tanstack/react-table';
import { Plus, Table2, ChevronRight, Copy, Trash2 } from 'lucide-react';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/hyper-database2/position_entities_pb';
import { Frame, FrameHeader, FrameTitle, FrameDescription, FramePanel, FrameFooter } from '@/components/reui/frame';
import { Alert, AlertTitle, AlertDescription } from '@/components/reui/alert';
import { DataGrid, DataGridContainer, dataGridFeatures } from '@/components/reui/data-grid/data-grid';
import type { DataGridFeatures } from '@/components/reui/data-grid/data-grid';
import { DataGridScrollArea } from '@/components/reui/data-grid/data-grid-scroll-area';
import { DataGridTableDnd } from '@/components/reui/data-grid/data-grid-table-dnd';
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { viewExtra } from '@/features/view/view-ext';
import { showToast } from '@/ui/toast';
import { useHyperDatabaseScan } from '../useHyperDatabaseScan';
import type { HyperCell, HyperCellMutation, HyperDatabaseViewProps } from '../HyperDatabaseTypes';
import { HyperGridColumns } from './grid/HyperGridColumns';
import type { HyperGridRow } from './grid/HyperGridColumns';
import { HyperGridContext } from './grid/HyperGridContext';
import type { HyperGridAddress } from './grid/HyperGridContext';
import { HyperGridClearMutation, HyperGridError, HyperGridFilterRows, HyperGridVisibleFields, HyperGridOrderFields, HyperGridMoveField } from './grid/HyperGridModel';
import { HyperGridToolbar } from './grid/HyperGridToolbar';

/** Live Rust-backed database grid; all view-specific behavior stays in this folder. */
export function HyperGridView(
  {
    controller,
    state,
    view,
  }: HyperDatabaseViewProps,
) {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [option, setOption] = useState('');

  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 25,
  });

  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [editing, setEditing] = useState<HyperGridAddress | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, HyperCell>>({});
  const versions = useRef(new Map<string, number>());
  const [removing, setRemoving] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [contextRow, setContextRow] = useState<string | null>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selectAnchor = useRef<string | null>(null);

  const focused = useRef<{
    rowId: string;
    columnId: string;
  } | null>(null);

  const orderedFields = useMemo(() => HyperGridOrderFields(state.fields, viewExtra(state.view ?? view)?.hyper_grid_column_order), [state.fields, state.view, view]);
  const fields = useMemo(() => HyperGridVisibleFields(orderedFields), [orderedFields]);
  const primary = fields.find(field => field.isPrimary);

  const [pinning, setPinning] = useState<ColumnPinningState>({
    start: ['hyper-expand', 'hyper-select', ...(primary ? [primary.id] : [])],
    end: [],
  });

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (error) {
      showToast({
        type: 'error',
        message: HyperGridError(error),
      });

      return false;
    }
  }, []);

  const moveField = async (from: string, to: string) => {
    const next = HyperGridMoveField(orderedFields.map(field => field.id), from, to);
    await run(async () => { await controller.moveField(from, to); await controller.updateViewExtra({ hyper_grid_column_order: next }); });
  };

  const write = useCallback(async (rowId: string, fieldId: string, mutation: HyperCellMutation, value?: HyperCell) => {
    const key = `${rowId}:${fieldId}`;
    const version = (versions.current.get(key) ?? 0) + 1;
    versions.current.set(key, version);

    if (value) setOptimistic(old => ({
      ...old,
      [key]: value,
    }));

    await run(() => controller.updateCell(rowId, fieldId, mutation));

    if (versions.current.get(key) === version) setOptimistic(old => {
      const next = {
        ...old,
      };

      delete next[key];
      return next;
    });
  }, [controller, run]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);

      setPagination(old => ({
        ...old,
        pageIndex: 0,
      }));
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const firstSelect = orderedFields.find(field => field.type === FieldType.SingleSelect);

  const scan = useHyperDatabaseScan(controller, state, state.rowIds, search.trim() ? state.fields.map(f => f.id) : firstSelect ? [firstSelect.id] : [], Boolean(search.trim() || option));

  // Local search filters rowIds below; the header always counts the core's full loaded row list.
  const databaseRowCount = state.rowIds.length;

  const rowIds = useMemo(
    () => search.trim() || option ? HyperGridFilterRows({ ...state, cells: scan.cells }, search, firstSelect?.id, option) : state.rowIds,
    [
      state.rowIds,
      state.fields,
      scan.cells,
      search,
      option,
      firstSelect?.id,
    ],
  );

  const data = useMemo(() => rowIds.map(id => ({
    id,
  })), [rowIds]);

  const columnOrder = useMemo(
    () => ['hyper-expand', 'hyper-select', ...fields.map(field => field.id), 'hyper-add-field'],
    [fields],
  );

  const columnSizing = useMemo<ColumnSizingState>(
    () => Object.fromEntries(fields.map(field => [field.id, Math.max(field.isPrimary ? 240 : 80, field.settings.width || 160)])),
    [fields],
  );

  const fieldCreated = useCallback((id: string) => {
    requestAnimationFrame(() => root.current?.querySelector(`th[data-col-id="${CSS.escape(id)}"]`)?.scrollIntoView({
      block: 'nearest',
      inline: 'end',
    }));
  }, []);

  const selectRange = useCallback((row: Row<DataGridFeatures, HyperGridRow>, shift: boolean) => {
    if (shift && selectAnchor.current) {
      const start = rowIds.indexOf(selectAnchor.current);
      const end = rowIds.indexOf(row.id);
      const pageStart = pagination.pageIndex * pagination.pageSize;

      if (start >= 0 && end >= 0) {
        const checked = !row.getIsSelected();

        setSelection(old => {
          const next = {
            ...old,
          };

          for (const id of rowIds.slice(
            Math.max(pageStart, Math.min(start, end)),
            Math.min(pageStart + pagination.pageSize, Math.max(start, end) + 1),
          )) {
            if (checked)
              next[id] = true;
            else
              delete next[id];
          }

          return next;
        });
      }
    }

    selectAnchor.current = row.id;
  }, [rowIds, pagination]);

  const columns = useMemo(() => HyperGridColumns(fields, selectRange, fieldCreated, (rowId, fieldId) => controller.state.cells[rowId]?.[fieldId]?.display ?? ''), [fields, selectRange, fieldCreated, controller]);

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data,
    getRowId: row => row.id,
    getRowCanExpand: () => true,
    paginateExpandedRows: false,
    enableRowSelection: true,
    manualSorting: true,
    autoResetPageIndex: false,

    state: {
      pagination,
      expanded,
      rowSelection: selection,
      columnOrder,
      columnSizing,
      columnPinning: pinning,
    },

    onPaginationChange: setPagination,
    onExpandedChange: setExpanded,
    onRowSelectionChange: setSelection,
    onColumnPinningChange: setPinning,

    onColumnSizingChange: updater => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;

      void run(async () => {
        for (const field of fields) {
          const width = next[field.id];

          if (width !== undefined && width !== columnSizing[field.id]) await controller.updateFieldSettings(field.id, {
            width: Math.round(width),
          });
        }
      });
    },
  });

  const visibleRows = table.getRowModel().rows.map(row => row.id);
  const pageKey = visibleRows.join(',');
  const fieldKey = fields.map(field => field.id).join(',');

  useEffect(() => {
    if (state.status === 'ready')
      void run(() => controller.loadRows(visibleRows, fields.map(field => field.id)));
  }, [controller, state.status, pageKey, fieldKey, state.fields]);

  useEffect(() => {
    const last = Math.max(0, Math.ceil(rowIds.length / pagination.pageSize) - 1);

    if (pagination.pageIndex > last) setPagination(old => ({
      ...old,
      pageIndex: last,
    }));
  }, [rowIds.length, pagination.pageSize, pagination.pageIndex]);

  useEffect(() => {
    const ids = new Set(state.rowIds);

    setSelection(
      old => Object.keys(old).some(id => !ids.has(id)) ? Object.fromEntries(Object.entries(old).filter(([id]) => ids.has(id))) : old,
    );
  }, [state.rowIds]);

  useEffect(() => {
    if (primary && !pinning.start?.includes(primary.id)) setPinning(old => ({
      ...old,

      start: [
        'hyper-expand',
        'hyper-select',
        primary.id,
        ...(old.start ?? []).filter(id => fields.some(field => field.id === id) && id !== primary.id),
      ],
    }));
  }, [primary?.id]);

  const edit = (address: HyperGridAddress | null, direction = 0) => {
    const previous = editing;
    setEditing(address);

    if (address) {
      focused.current = {
        rowId: address.rowId,
        columnId: address.fieldId,
      };

      table.setFocusedCell(address.rowId, address.fieldId);
    } else if (previous) {
      let target = {
        rowId: previous.rowId,
        columnId: previous.fieldId,
      };

      if (direction) {
        const index = visibleRows.indexOf(previous.rowId) * fields.length + fields.findIndex(field => field.id === previous.fieldId) + direction;
        const rowId = visibleRows[Math.floor(index / fields.length)];
        const field = fields[(index % fields.length + fields.length) % fields.length];

        if (rowId && field) target = {
          rowId,
          columnId: field.id,
        };
      }

      focused.current = target;
      table.setFocusedCell(target.rowId, target.columnId);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-slot="data-grid-table-viewport"]')?.focus());
    }
  };

  const expand = (id: string) => setExpanded(old => old === true ? {
    [id]: true,
  } : {
    ...old,
    [id]: !old[id],
  });

  const createRow = async (after?: string) => {
    if (creating)
      return;

    setCreating(true);
    setQuery('');
    setSearch('');
    setOption('');

    await run(async () => {
      const row = await controller.createRow(after ? {
        rowPosition: {
          position: OrderObjectPositionTypePB.After,

          oneOfObjectId: {
            case: 'objectId',
            value: after,
          },
        },
      } : {});

      await controller.loadRows([row.id]);
      setPendingRow(row.id);
    });

    setCreating(false);
  };

  useEffect(() => {
    if (!pendingRow || !primary)
      return;

    const index = rowIds.indexOf(pendingRow);

    if (index < 0)
      return;

    const page = Math.floor(index / pagination.pageSize);

    if (pagination.pageIndex !== page) {
      setPagination(old => ({
        ...old,
        pageIndex: page,
      }));

      return;
    }

    edit({
      rowId: pendingRow,
      fieldId: primary.id,
    });

    setPendingRow(null);

    requestAnimationFrame(() => root.current?.querySelector(`[data-row-id="${CSS.escape(pendingRow)}"]`)?.scrollIntoView({
      block: 'nearest',
    }));
  }, [pendingRow, rowIds, primary?.id, pagination]);

  const selected = Object.keys(selection).filter(id => selection[id] && state.rowIds.includes(id));

  const clearFilters = () => {
    setQuery('');
    setSearch('');
    setOption('');

    setPagination(old => ({
      ...old,
      pageIndex: 0,
    }));
  };

  const empty = state.rowIds.length === 0 ? <Empty className='border-0 py-12'>
    <EmptyHeader>
      <EmptyMedia variant='icon'>
        <Table2 className='size-5' />
      </EmptyMedia>
      <EmptyTitle>No rows yet</EmptyTitle>
      <EmptyDescription>Add a row to start filling this database.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button onClick={() => void createRow()} disabled={creating}>
        <Plus className='size-4' />New row</Button>
    </EmptyContent>
  </Empty> : <div className='py-10 text-center text-sm text-muted-foreground'>
    <p>No rows match “{search || firstSelect?.options.find(item => item.id === option)?.name || query}”</p>
    <Button variant='ghost' className='mt-2' onClick={clearFilters}>Clear filters</Button>
  </div>;

  return (
    <HyperGridContext.Provider
      value={{
        controller,
        state,
        fields: orderedFields,
        moveField,
        view,
        editing,
        edit,
        write,
        run,
        expand,
        cell: (rowId, fieldId) => optimistic[`${rowId}:${fieldId}`] ?? state.cells[rowId]?.[fieldId],
        deleteRows: setRemoving,
      }}>
      <div
        ref={root}
        data-hyper-grid
        className='@container/hyper-grid flex h-full min-h-0 min-w-0 flex-col bg-background p-4'
        onKeyDownCapture={event => {
          if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a[href], [contenteditable=true], [role=checkbox], [role=switch], [role=combobox], [role=slider], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [data-slot=popover-content], [data-slot=dropdown-menu-content]'))
            return;

          const focus = table.getFocusedCell();

          const address = focus ? {
            rowId: focus.row.id,
            columnId: focus.column.id,
          } : focused.current;

          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            void createRow(address?.rowId);
            return;
          }

          if (!address || editing)
            return;

          if (address.columnId === 'hyper-expand' && [' ', 'ArrowRight', 'ArrowLeft'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();

            setExpanded(old => ({
              ...(old === true ? {} : old),
              [address.rowId]: event.key === 'ArrowRight' ? true : event.key === 'ArrowLeft' ? false : old === true ? false : !old[address.rowId],
            }));

            return;
          }

          const cell = state.cells[address.rowId]?.[address.columnId];

          if (cell?.kind === 'checkbox' && event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();

            void write(address.rowId, address.columnId, {
              kind: 'checkbox',
              checked: !cell.checked,
            }, {
              ...cell,
              checked: !cell.checked,
            });
          }

          if (cell && ['Delete', 'Backspace'].includes(event.key)) {
            const mutation = HyperGridClearMutation(cell);

            if (mutation) {
              event.preventDefault();
              event.stopPropagation();
              void write(address.rowId, address.columnId, mutation);
            }
          }
        }}>
        <Frame stacked dense className='w-full min-w-0 flex-1 min-h-0'>
          <FrameHeader className='gap-3 py-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <FrameTitle>{view.name}</FrameTitle>
                <FrameDescription className='text-xs'>{`${databaseRowCount} ${databaseRowCount === 1 ? 'row' : 'rows'} · ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`}</FrameDescription>
              </div>
              <Button className='h-8' disabled={creating || state.status !== 'ready'} onClick={() => void createRow()}>
                <Plus className='size-4' />New row</Button>
            </div>
            <HyperGridToolbar
              query={query}
              setQuery={setQuery}
              option={option}
              setOption={value => {
                setOption(value);

                setPagination(old => ({
                  ...old,
                  pageIndex: 0,
                }));
              }}
              selected={selected}
              clearSelection={() => setSelection({})} />
          </FrameHeader>{state.status === 'error' ? <FramePanel className='min-h-0 flex-1 p-4 shadow-none'>
            <Alert variant='destructive'>
              <AlertTitle>Unable to load this database</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
              <Button variant='outline' onClick={() => void run(() => controller.refresh())}>Retry</Button>
            </Alert>
          </FramePanel> : <DataGrid
            table={table}
            recordCount={rowIds.length}
            isLoading={state.status === 'loading' || state.status === 'idle'}
            loadingMode='skeleton'
            emptyMessage={empty}
            rowCreateLabel='New row'
            onRowCreate={databaseRowCount ? () => void createRow() : undefined}
            onCellSelectionChange={snapshot => {
              focused.current = snapshot.focused;
            }}
            onCellEditRequest={request => {
              const cell = state.cells[request.rowId]?.[request.columnId];

              if (cell && ['text', 'number', 'url', 'singleSelect', 'multiSelect', 'date'].includes(cell.kind)) edit({
                rowId: request.rowId,
                fieldId: request.columnId,
                initial: request.initialText,
              });
            }}
            tableLayout={{
              dense: false,
              headerSticky: true,
              headerBackground: true,
              rowBorder: true,
              cellBorder: true,
              width: 'fixed',
              columnsResizable: true,
              columnsResizeMode: 'onEnd',
              columnsPinnable: true,
              columnsDraggable: true,
              columnsVisibility: true,
              cellSelection: true,
              cellSelectionMode: 'single',
              cellFillHandle: false,
              cellEditMode: 'click',
            }}
            tableClassNames={{
              headerRow: 'h-10',
              bodyRow: 'h-10 has-[button[aria-expanded=true]]:bg-muted/40 has-[button[aria-expanded=true]]:[&>td]:bg-muted/40 has-[button[aria-expanded=true]]:[&>td[data-pinned]]:bg-[color-mix(in_oklab,var(--muted)_64%,var(--background))]!',
              body: '[&>tr>td:has([data-hyper-grid-expanded])]:bg-muted/20 [&>tr>td[data-cell-focused]]:ring-2 [&>tr>td[data-cell-focused]]:ring-inset [&>tr>td[data-cell-focused]]:ring-ring/50 [&>tr>td[data-cell-focused]]:before:hidden [&>tr>td[data-col-id]:has([data-hyper-grid-editor])]:relative [&>tr>td[data-col-id]:has([data-hyper-grid-editor])]:ring-ring [&>tr>td[data-col-id]:has([data-hyper-grid-editor])]:bg-background [&>tr>td:has([aria-invalid=true])]:ring-destructive',
              rowCreate: 'h-9',
            }}
            className='flex min-h-0 min-w-0 flex-1 flex-col'>
            <FramePanel className='min-h-0 flex-1 overflow-hidden p-0 shadow-none'>
              <ContextMenu>
                <ContextMenuTrigger
                  render={<div className='h-full min-h-0 min-w-0' />}
                  onContextMenu={event => {
                    const row = (event.target as Element).closest('tr[data-row-id]');
                    setContextRow(row?.getAttribute('data-row-id') ?? null);
                  }}>
                  <DataGridContainer className='h-full min-h-0 border-0 [&>div]:h-full'>
                    <DataGridScrollArea orientation='both' className='h-full'>
                      <DataGridTableDnd
                        footerContent={databaseRowCount ? <tr>
                          <td colSpan={fields.length + 4} className='h-9 p-0'>
                            <Button
                              variant='ghost'
                              className='h-9 w-full justify-start rounded-none px-3 font-normal text-muted-foreground'
                              onClick={() => void createRow()}
                              disabled={creating}>
                              <Plus className='size-4' />New row</Button>
                          </td>
                        </tr> : null}
                        handleDragEnd={event => {
                          const from = String(event.active.id);
                          const to = event.over ? String(event.over.id) : '';

                          if (from !== to && fields.some(field => field.id === from && !field.isPrimary) && fields.some(field => field.id === to && !field.isPrimary))
                            void moveField(from, to);
                        }} />
                    </DataGridScrollArea>
                  </DataGridContainer>
                </ContextMenuTrigger>
                <ContextMenuContent className='w-48'>{contextRow ? <>
                    <ContextMenuItem onClick={() => expand(contextRow)}>
                      <ChevronRight />Expand / collapse</ContextMenuItem>
                    <ContextMenuItem onClick={() => void run(() => controller.duplicateRow(contextRow))}>
                      <Copy />Duplicate</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant='destructive' onClick={() => setRemoving([contextRow])}>
                      <Trash2 />Delete</ContextMenuItem>
                  </> : <ContextMenuItem onClick={() => void createRow()}>
                    <Plus />New row</ContextMenuItem>}</ContextMenuContent>
              </ContextMenu>
            </FramePanel>{state.rowIds.length ? <FrameFooter className='py-1.5 pl-2.5 pr-12'>
              <DataGridPagination
                sizes={[10, 25, 50, 100]}
                info={rowIds.length ? '{from} - {to} of {count}' : `0 of ${state.rowIds.length}`} />
            </FrameFooter> : null}</DataGrid>}</Frame>
        <AlertDialog
          open={removing.length > 0}
          onOpenChange={open => {
            if (!open && !deleting)
              setRemoving([]);
          }}>
          <AlertDialogContent>
            <AlertDialogTitle>Delete {removing.length} {removing.length === 1 ? 'row' : 'rows'}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the selected rows from this database and its linked views.</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);

                  if (await run(() => controller.deleteRows(removing))) {
                    setRemoving([]);
                    setSelection({});
                  }

                  setDeleting(false);
                }}>Delete {removing.length === 1 ? 'row' : 'rows'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </HyperGridContext.Provider>
  );
}
