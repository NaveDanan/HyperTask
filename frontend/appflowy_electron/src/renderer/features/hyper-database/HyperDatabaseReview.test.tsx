import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { DateCellDataPBSchema } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { SelectOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDatabaseController } from './HyperDatabaseController';
import { hyperDatabaseBackend } from './HyperDatabaseBackend';
import type { HyperCell, HyperField } from './HyperDatabaseTypes';
import { useHyperDatabaseScan } from './useHyperDatabaseScan';
import { useHyperGanttData } from './views/gantt/useHyperGanttData';
import { hyperGanttSetChecklistProgress } from './views/gantt/HyperGanttMutations';
import { HyperGanttRowDetail } from './views/gantt/HyperGanttRowDetail';
import { HyperBoardCardDetail } from './views/board/HyperBoardCardDetail';
import { hyperBoardMatches } from './views/board/hyperBoardModel';
import { HyperGridFilterRows } from './views/grid/HyperGridModel';
import { HyperGridCell } from './views/grid/HyperGridCell';
import { HyperGridToolbar } from './views/grid/HyperGridToolbar';
import { HyperGridView } from './views/HyperGridView';
import { HyperCalendarView } from './views/HyperCalendarView';
import { HyperCalendarNoDatePopover } from './views/calendar/HyperCalendarNoDatePopover';
import { HyperCalendarEventDialog } from './views/calendar/HyperCalendarEventDialog';

// Execute real adapter effects and handlers with a stable React hook dispatcher.
// Native I/O is mocked, and vendor widgets are never rendered or modified.
const hooks = vi.hoisted(() => ({ index: 0, values: [] as any[], effects: [] as any[], pending: [] as (() => void)[], grid: null as any, table: null as any, tableOptions: null as any, calendar: null as any }));
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const i = hooks.index++, old = hooks.values[i];
    if (!old || deps.length !== old.deps.length || deps.some((value, j) => !Object.is(value, old.deps[j]))) hooks.values[i] = { value: factory(), deps };
    return hooks.values[i].value;
  };
  return { ...react,
    useState: (initial: any) => { const i = hooks.index++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (next: any) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
    useId: () => 'hyper-review-id',
    useRef: (initial: any) => hooks.values[hooks.index++] ??= { current: initial },
    useMemo: memo, useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => unknown, deps: unknown[]) => { const i = hooks.index++, old = hooks.effects[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) hooks.pending.push(() => { old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: effect() }; }); },
  };
});
vi.mock('./views/grid/HyperGridContext', async importOriginal => ({ ...await importOriginal<typeof import('./views/grid/HyperGridContext')>(), useHyperGrid: () => hooks.grid }));
vi.mock('@tanstack/react-table', async importOriginal => ({ ...await importOriginal<typeof import('@tanstack/react-table')>(), useTable: (options: any) => { hooks.tableOptions = options; return hooks.table; } }));
vi.mock('./views/calendar/useHyperCalendarEvents', () => ({ useHyperCalendarEvents: () => hooks.calendar }));
vi.mock('@/ui', () => ({ showToast: vi.fn() }));
vi.mock('@/ui/toast', () => ({ showToast: vi.fn() }));

let controller: HyperDatabaseController;
const field = (id: string, type: FieldType, isPrimary = false): HyperField => ({ id, name: id, type, isPrimary, options: [], settings: create(FieldSettingsPBSchema), proto: create(FieldPBSchema, { id, name: id, fieldType: type, isPrimary }) });
function setup(count = 25) {
  const fields = [field('title', FieldType.RichText, true), field('date', FieldType.DateTime), field('progress', FieldType.Number)];
  const getCell = vi.fn(async ({ rowId, fieldId }: { rowId?: string; fieldId?: string }) => ({ ok: true as const, value: create(CellPBSchema, { rowId, fieldId, data: fieldId === 'date' ? toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: 1794787200n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 1794873600n }, isRange: true })) : new TextEncoder().encode(fieldId === 'progress' ? rowId === 'row-24' ? '50' : '0.5' : rowId === 'row-0' ? 'unique early match' : 'Other task') }) }));
  controller = new HyperDatabaseController('v', { ...hyperDatabaseBackend, DatabaseEventGetCell: getCell }, { batchSize: 10, concurrency: 2, maxCachedCells: 2 });
  const rowIds = Array.from({ length: count }, (_, i) => 'row-' + i);
  const rows = Object.fromEntries(rowIds.map(id => [id, { id, meta: create(RowMetaPBSchema, { id }), icon: null, cover: null, documentId: null, isDocumentEmpty: true }]));
  const view = create(ViewPBSchema, { id: 'v', oneOfExtra: { case: 'extra', value: JSON.stringify({ hyper_layout: 'gantt', hyper_gantt: { start_field_id: 'date', end_field_id: null, progress_field_id: 'progress', zoom: 1 } }) } });
  controller.store.setState({ status: 'ready', view, rowIds, rows, fields });
  return { getCell, fields, view };
}
function render<T>(work: () => T): T { hooks.index = 0; const result = work(); for (const effect of hooks.pending.splice(0)) effect(); return result; }
async function settle() { for (let i=0;i<80;i++) await Promise.resolve(); }
async function flush<T>(work: () => T) { let result = render(work); for (let i=0;i<15;i++) { await settle(); result = render(work); } return result; }
function find(tree: any, predicate: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, predicate); if (result) return result; } return null; }
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
beforeEach(() => { hooks.index = 0; hooks.values = []; hooks.effects = []; hooks.pending = []; hooks.grid = null; hooks.table = { getRowModel: () => ({ rows: [] }), getFocusedCell: () => ({ row: { id: 'row-0' }, column: { id: 'check' } }) }; });
afterEach(() => { for (const effect of hooks.effects) effect?.cleanup?.(); controller?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('finishes a bounded scan once and preserves early grid and board matches', async () => {
  const { getCell } = setup();
  const work = () => useHyperDatabaseScan(controller, controller.state, controller.state.rowIds, ['title']);
  const result = await flush(work);
  expect(result.loading).toBe(false); expect(getCell).toHaveBeenCalledTimes(25);
  expect(controller.state.cells['row-0']?.title).toBeUndefined();
  expect(HyperGridFilterRows({ ...controller.state, cells: result.cells }, 'unique')).toEqual(['row-0']);
  expect(hyperBoardMatches({ ...controller.state, cells: result.cells }, 'row-0', 'unique')).toBe(true);
  controller.store.setState({ revision: controller.state.revision + 1 }); await flush(work);
  expect(getCell).toHaveBeenCalledTimes(25);
});
it('retains all Gantt dates and complete numeric scaling, then reloads schema changes', async () => {
  const { fields, getCell, view } = setup();
  const work = () => useHyperGanttData({ controller, state: controller.state, view });
  const first = await flush(work); expect(first.events).toHaveLength(25); expect(first.fraction).toBe(false);
  expect(first.tasks.get('row-0')).toMatchObject({ title: 'unique early match', progress: 0.5 });
  const before = getCell.mock.calls.length;
  controller.store.setState({ fields: fields.map(f => f.id === 'progress' ? { ...f, proto: { ...f.proto, typeOptionData: new Uint8Array([8, 1]) } } : f), cells: {} });
  const next = await flush(work); expect(next.events).toHaveLength(25); expect(next.fraction).toBe(false);
  expect(getCell.mock.calls.length).toBeGreaterThan(before);
  expect(next.tasks.get('row-0')?.progress).toBe(0.5);
});
it('rolls queued failed Gantt settings back to the persisted configuration and rebases later patches', async () => {
  const { view } = setup(1); const work = () => useHyperGanttData({ controller, state: controller.state, view });
  let data = await flush(work);
  const save = vi.spyOn(controller, 'updateViewExtra').mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  await Promise.allSettled([data.saveConfig({ zoom: 1.25 }), data.saveConfig({ zoom: 1.5 })]);
  data = render(work); expect(data.config.zoom).toBe(1);
  await data.saveConfig({ scale: 'week' });
  expect(save.mock.calls[2][0]).toMatchObject({ hyper_gantt: { zoom: 1, scale: 'week' } });
});
it.each([75, 25])('changes checklist progress to %s%% while preserving unrelated completion choices', async percentage => {
  setup(1);
  const items = [false, false, true, true].map((completed, i) => ({ ...create(SelectOptionPBSchema, { id: String(i), name: String(i) }), completed }));
  const loadCell = vi.fn(async (): Promise<HyperCell> => ({ kind: 'checklist', items, progress: 0.5, display: '2/4' }));
  const updateCell = vi.fn(async (_row: string, _field: string, mutation: any) => { for (const id of mutation.completedIds) items[Number(id)].completed = !items[Number(id)].completed; });
  await hyperGanttSetChecklistProgress({ loadCell, updateCell }, 'row', 'checklist', percentage);
  expect(items.map(item => item.completed)).toEqual(percentage === 75 ? [true, false, true, true] : [false, false, false, true]);
  expect(updateCell).toHaveBeenCalledTimes(1);
});
it.each([false, true])('honors a detail close during title blur-save (failure=%s)', async failure => {
  setup(1); let finish!: () => void;
  const save = vi.spyOn(controller, 'updateCell').mockImplementation(() => new Promise((resolve, reject) => { finish = () => failure ? reject(new Error('offline')) : resolve(); }));
  const close = vi.fn(); const work = () => HyperGanttRowDetail({ rowId: 'row-0', controller, state: controller.state, config: { start_field_id: 'date', end_field_id: null, progress_field_id: null, color_field_id: null, assignee_field_id: null, zoom: 1, list_width: 416, scale: 'month' }, task: { rowId: 'row-0', title: 'Before', color: '', due: null, assignees: [], done: false }, fraction: false, close, setDates: vi.fn(), remove: vi.fn() });
  let tree = render(work); find(tree, e => e.props?.id === 'hyper-gantt-task-title').props.onChange({ target: { value: 'After' } });
  tree = render(work); find(tree, e => e.props?.id === 'hyper-gantt-task-title').props.onBlur(); tree.props.onOpenChange(false);
  await settle(); expect(save).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled(); finish(); await settle(); render(work);
  expect(close).toHaveBeenCalledTimes(failure ? 0 : 1);
});
it('disables the board title while its submitted draft is saving', async () => {
  setup(1); let finish!: () => void; vi.spyOn(controller, 'loadRows').mockResolvedValue(undefined);
  vi.spyOn(controller, 'updateCell').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const work = () => HyperBoardCardDetail({ controller, state: controller.state, rowId: 'row-0', returnFocus: null, onClose: vi.fn() });
  let tree = render(work); find(tree, e => e.props?.['aria-label'] === 'Card title').props.onChange({ target: { value: 'Edited' } });
  tree = render(work); find(tree, e => e.props?.['aria-label'] === 'Card title').props.onBlur(); tree = render(work);
  expect(find(tree, e => e.props?.['aria-label'] === 'Card title').props.disabled).toBe(true); finish(); await settle();
});
it.each(['date', 'singleSelect', 'createSelect'])('never closes editor B when editor A finishes %s saving', async kind => {
  setup(1); const f = field('edit', kind === 'date' ? FieldType.DateTime : FieldType.SingleSelect);
  f.options = [create(SelectOptionPBSchema, { id: 'option', name: 'Option' })];
  const cell: HyperCell = kind === 'date' ? { kind: 'date', timestamp: 1794787200n, endTimestamp: null, isRange: false, includeTime: false, reminderId: '', display: 'Date' } : { kind: 'singleSelect', selected: [], options: f.options, display: '' };
  let finish!: () => void;
  hooks.grid = { editing: { rowId: 'row-0', fieldId: 'edit', initial: kind === 'createSelect' ? 'New' : '' }, cell: () => cell, edit: (address: any) => { hooks.grid.editing = address; }, write: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), controller: { createSelectOption: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) }, run: async (action: () => Promise<unknown>) => { await action(); return true; } };
  const editor = render(() => HyperGridCell({ rowId: 'row-0', field: f }));
  const tree = render(() => (editor.type as any)(editor.props));
  const action = kind === 'date' ? find(tree, e => e.props?.children === 'Apply') : find(tree, e => e.props?.value === (kind === 'createSelect' ? 'Create New' : 'Option'));
  if (kind === 'date') action.props.onClick(); else void action.props.onSelect();
  hooks.grid.editing = { rowId: 'row-1', fieldId: 'edit' }; finish(); await settle();
  expect(hooks.grid.editing?.rowId).toBe('row-1');
});
it('ignores grid navigation shortcuts while an expanded checkbox control owns focus', () => {
  const { view } = setup(1); const write = vi.spyOn(controller, 'updateCell').mockResolvedValue(undefined);
  controller.store.setState({ cells: { 'row-0': { check: { kind: 'checkbox', checked: false, display: 'No' } } } });
  class HyperFocusedControl { closest(selector: string) { return selector.includes('button') || selector.includes('[role=checkbox]') ? this : null; } }
  vi.stubGlobal('Element', HyperFocusedControl);
  const tree = render(() => HyperGridView({ controller, state: controller.state, view }));
  const surface = find(tree, e => e.props?.['data-hyper-grid'] !== undefined);
  const preventDefault = vi.fn();
  surface.props.onKeyDownCapture({ target: new HyperFocusedControl(), key: ' ', preventDefault, stopPropagation: vi.fn() });
  surface.props.onKeyDownCapture({ target: new HyperFocusedControl(), key: 'Delete', preventDefault, stopPropagation: vi.fn() });
  expect(write).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled();
});
it('filters the same saved-order select field that the grid toolbar offers', () => {
  const { view, fields } = setup(1); const first = field('first', FieldType.SingleSelect), second = field('second', FieldType.SingleSelect);
  const option = create(SelectOptionPBSchema, { id: 'second-option', name: 'Second' }); second.options = [option];
  view.oneOfExtra = { case: 'extra', value: JSON.stringify({ hyper_grid_column_order: ['title', 'second', 'first'] }) };
  controller.store.setState({ fields: [fields[0], first, second], cells: { 'row-0': { first: { kind: 'singleSelect', display: '', options: [], selected: [] }, second: { kind: 'singleSelect', display: 'Second', options: [option], selected: [option] } } } });
  const work = () => HyperGridView({ controller, state: controller.state, view });
  const tree = render(work); find(tree, e => e.type === HyperGridToolbar).props.setOption('second-option'); render(work);
  expect(hooks.tableOptions.data).toEqual([{ id: 'row-0' }]);
});


it('reloads the current grid page after a schema change with unchanged field IDs', () => {
  const { view, fields } = setup(75); const load = vi.spyOn(controller, 'loadRows').mockResolvedValue(undefined);
  hooks.table.getRowModel = () => ({ rows: [{ id: 'row-60' }] });
  const work = () => HyperGridView({ controller, state: controller.state, view });
  render(work); expect(load).toHaveBeenCalledTimes(1);
  controller.store.setState({ fields: fields.map(f => f.id === 'progress' ? { ...f, type: FieldType.RichText } : f) }); render(work);
  expect(load).toHaveBeenCalledTimes(2); expect(load.mock.calls[1][0]).toEqual(['row-60']);
});
it('opens an undated row with a failed title read as read-only and never writes Untitled', async () => {
  const { fields, view } = setup(1);
  hooks.calendar = { dateField: fields[1], dateFields: [fields[1]], primaryField: fields[0], colorField: undefined, colorFields: [], events: [], noDateRows: [{ rowId: 'row-0', title: 'Untitled' }], refetch: vi.fn(), loading: false, error: null, setting: null };
  vi.spyOn(controller, 'scanRows').mockResolvedValue({ 'row-0': { date: { kind: 'date', timestamp: null, endTimestamp: null, isRange: false, includeTime: false, reminderId: '', display: '' }, title: { kind: 'text', text: '', display: '', error: 'Read failed' } } });
  const write = vi.spyOn(controller, 'updateCell').mockResolvedValue(undefined);
  const wrapper = HyperCalendarView({ controller, state: controller.state, view });
  const work = () => (wrapper.type as any)({ controller, state: controller.state, view });
  let tree = render(work); const toolbar = find(tree, e => e.props?.noDate);
  expect(toolbar.props.noDate.type).toBe(HyperCalendarNoDatePopover); toolbar.props.noDate.props.onSchedule('row-0'); await settle(); tree = render(work);
  const dialog = find(tree, e => e.type === HyperCalendarEventDialog); expect(dialog.props.initial.readOnly).toBe(true);
  // Execute the save handler itself: readOnly must prevent the title/date writes.
  hooks.values = []; hooks.effects = []; hooks.pending = [];
  const content = render(() => HyperCalendarEventDialog(dialog.props));
  find(content, e => e.type === 'form').props.onSubmit({ preventDefault: vi.fn() }); await settle();
  expect(write).not.toHaveBeenCalled();
});


it('updates the actual detail checklist slider without reopening completed items', async () => {
  setup(1); const checklist = field('checklist', FieldType.Checklist);
  const items = [false, false, true, true].map((completed, i) => ({ ...create(SelectOptionPBSchema, { id: String(i), name: String(i) }), completed }));
  const cell: HyperCell = { kind: 'checklist', items, display: '2/4', progress: 0.5 };
  controller.store.setState({ fields: [...controller.state.fields, checklist], cells: { 'row-0': { checklist: cell } } });
  vi.spyOn(controller, 'loadCell').mockResolvedValue(cell);
  const write = vi.spyOn(controller, 'updateCell').mockImplementation(async (_row, _field, mutation) => { if (mutation.kind === 'checklist') for (const id of mutation.completedIds ?? []) items[Number(id)].completed = !items[Number(id)].completed; });
  const tree = render(() => HyperGanttRowDetail({ rowId: 'row-0', controller, state: controller.state, config: { start_field_id: 'date', end_field_id: null, progress_field_id: 'checklist', color_field_id: null, assignee_field_id: null, zoom: 1, list_width: 416, scale: 'month' }, task: { rowId: 'row-0', title: 'Before', color: '', due: null, assignees: [], done: false, progress: 50 }, fraction: false, close: vi.fn(), setDates: vi.fn(), remove: vi.fn() }));
  find(tree, e => e.props?.id === 'hyper-gantt-task-progress').props.onValueCommitted([75]); await settle();
  expect(items.map(item => item.completed)).toEqual([true, false, true, true]); expect(write).toHaveBeenCalledTimes(1);
});
