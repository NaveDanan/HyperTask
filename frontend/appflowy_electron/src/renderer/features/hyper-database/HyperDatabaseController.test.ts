import { afterEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { HyperDatabaseController, hyperLayout } from './HyperDatabaseController';
import { decodeHyperCell } from './HyperCellCodec';
import { hyperDatabaseBackend } from './HyperDatabaseBackend';
import { FieldPBSchema, FieldType, RepeatedFieldPBSchema } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { DateCellDataPBSchema } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { CheckboxCellDataPBSchema } from '@shared/protobuf/flowy-database2/checkbox_entities_pb';
import { SelectOptionCellDataPBSchema, SingleSelectTypeOptionPBSchema, SelectOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { ChecklistCellDataPBSchema } from '@shared/protobuf/flowy-database2/checklist_entities_pb';
import { TimestampCellDataPBSchema } from '@shared/protobuf/flowy-database2/timestamp_entities_pb';
import { RelationCellDataPBSchema } from '@shared/protobuf/flowy-database2/relation_entities_pb';
import { TimeCellDataPBSchema } from '@shared/protobuf/flowy-database2/time_entities_pb';
import { URLCellDataPBSchema } from '@shared/protobuf/flowy-database2/url_entities_pb';
import { MediaCellDataPBSchema } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { DatabasePBSchema, DatabaseIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { DatabaseViewSettingPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { RepeatedGroupPBSchema } from '@shared/protobuf/flowy-database2/group_pb';
import { RowsChangePBSchema } from '@shared/protobuf/flowy-database2/view_entities_pb';
import { ReorderAllRowsPBSchema, ReorderSingleRowPBSchema } from '@shared/protobuf/flowy-database2/sort_entities_pb';
import { DatabaseNotification as N } from '@shared/protobuf/flowy-database2/notification_pb';
import { SubscribeObjectSchema } from '@shared/protobuf/flowy-notification/subject_pb';
import { RepeatedViewPBSchema, ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
const ok = <T,>(value: T) => ({ ok: true as const, value });
const field = (type = FieldType.RichText) => create(FieldPBSchema, { id: 'f', name: 'Task', fieldType: type });
const cell = (data: Uint8Array) => create(CellPBSchema, { fieldId: 'f', rowId: 'r', data });
const utf8 = (text: string) => new TextEncoder().encode(text);
const disposals: Array<() => void> = [];
afterEach(() => { disposals.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
function fixture(rows = ['r', 's']) {
  const f = field(); const view = create(ViewPBSchema, { id: 'v', name: 'Tasks', layout: ViewLayoutPB.Grid });
  const database = create(DatabasePBSchema, { id: 'db', fields: [{ fieldId: f.id }], rows: rows.map(id => create(RowMetaPBSchema, { id })) });
  const backend = { ...hyperDatabaseBackend,
    subscribe: vi.fn(() => vi.fn()),
    DatabaseEventGetDatabase: vi.fn(async () => ok(database)),
    DatabaseEventGetDatabaseId: vi.fn(async () => ok(create(DatabaseIdPBSchema, { value: 'db' }))),
    DatabaseEventGetFields: vi.fn(async () => ok(create(RepeatedFieldPBSchema, { items: [f] }))),
    DatabaseEventGetDatabaseSetting: vi.fn(async () => ok(create(DatabaseViewSettingPBSchema))),
    DatabaseEventGetGroups: vi.fn(async () => ok(create(RepeatedGroupPBSchema))),
    DatabaseEventGetCell: vi.fn(async ({ rowId, fieldId }: { rowId?: string; fieldId?: string }) => ok(create(CellPBSchema, { rowId, fieldId, data: utf8('A task') }))),
    allViews: vi.fn(async () => ok(create(RepeatedViewPBSchema, { items: [view] }))),
    views: { ...hyperDatabaseBackend.views, getView: vi.fn(async () => ok(view)), createView: vi.fn(async () => ok(create(ViewPBSchema, { id: 'new', name: 'Timeline', layout: ViewLayoutPB.Grid, oneOfExtra: { case: 'extra', value: '{"font":"Geist"}' } }))), updateView: vi.fn(async () => ok(view)) },
    DatabaseEventUpdateCell: vi.fn(async () => ok(undefined)), DatabaseEventUpdateDateCell: vi.fn(async (_payload: Parameters<typeof hyperDatabaseBackend.DatabaseEventUpdateDateCell>[0]) => ok(undefined)),
    DatabaseEventUpdateChecklistCell: vi.fn(async () => ok(undefined)), DatabaseEventUpdateSelectOptionCell: vi.fn(async () => ok(undefined)),
    DatabaseEventMoveGroupRow: vi.fn(async () => ok(undefined)), DatabaseEventMoveCalendarEvent: vi.fn(async () => ok(undefined)),
    DatabaseEventDeleteRows: vi.fn(async () => ok(undefined)), DatabaseEventUpdateFieldSettings: vi.fn(async () => ok(undefined)),
  };
  const controller = new HyperDatabaseController('v', backend, { batchSize: 10, concurrency: 2, maxCachedCells: 10 });
  // Start with no rows so tests control the lazy fetch explicitly.
  const open = async () => { const saved = database.rows; database.rows = []; await controller.open(); database.rows = saved; controller.store.setState({ rowIds: rows, rows: Object.fromEntries(saved.map(meta => [meta.id, { id: meta.id, meta, icon: null, cover: null, documentId: null, isDocumentEmpty: true }])) }); };
  disposals.push(() => controller.dispose()); return { controller, backend, database, f, view, open };
}
function notify(controller: HyperDatabaseController, ty: N, data = new Uint8Array(), id = 'v') {
  controller.onNotification(create(SubscribeObjectSchema, { source: 'Database', id, ty, oneOfPayload: { case: 'payload', value: data } }));
}
describe('Hyper cell codec', () => {
  it('decodes every FieldType into a typed cell with a display string', () => {
    const option = create(SelectOptionPBSchema, { id: 'o', name: 'In progress', color: 8 });
    const cases: Array<[FieldType, Uint8Array, string]> = [
      [FieldType.RichText, utf8('Task'), 'text'], [FieldType.Number, utf8('$42.50'), 'number'],
      [FieldType.URL, toBinary(URLCellDataPBSchema, create(URLCellDataPBSchema, { content: 'https://example.com' })), 'url'],
      [FieldType.Checkbox, toBinary(CheckboxCellDataPBSchema, create(CheckboxCellDataPBSchema, { isChecked: true })), 'checkbox'],
      [FieldType.DateTime, toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: 1800000000n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 1800086400n }, includeTime: true, isRange: true })), 'date'],
      [FieldType.SingleSelect, toBinary(SelectOptionCellDataPBSchema, create(SelectOptionCellDataPBSchema, { selectOptions: [option] })), 'singleSelect'],
      [FieldType.MultiSelect, toBinary(SelectOptionCellDataPBSchema, create(SelectOptionCellDataPBSchema, { selectOptions: [option] })), 'multiSelect'],
      [FieldType.Checklist, toBinary(ChecklistCellDataPBSchema, create(ChecklistCellDataPBSchema, { options: [option], selectedOptions: [option], percentage: 1 })), 'checklist'],
      [FieldType.CreatedTime, toBinary(TimestampCellDataPBSchema, create(TimestampCellDataPBSchema, { dateTime: 'May 1', oneOfTimestamp: { case: 'timestamp', value: 1800000000n } })), 'createdTime'],
      [FieldType.LastEditedTime, toBinary(TimestampCellDataPBSchema, create(TimestampCellDataPBSchema, { dateTime: 'May 2' })), 'lastEditedTime'],
      [FieldType.Relation, toBinary(RelationCellDataPBSchema, create(RelationCellDataPBSchema, { rowIds: ['row'] })), 'relation'],
      [FieldType.Summary, utf8('Summary'), 'summary'], [FieldType.Translate, utf8('Bonjour'), 'translate'],
      [FieldType.Time, toBinary(TimeCellDataPBSchema, create(TimeCellDataPBSchema, { time: 3660n })), 'time'],
      [FieldType.Media, toBinary(MediaCellDataPBSchema, create(MediaCellDataPBSchema, { files: [{ id: 'm', name: 'brief.pdf', url: 'https://example.com/brief.pdf' }] })), 'media'],
    ];
    for (const [type, data, kind] of cases) {
      const f = field(type); if (kind === 'singleSelect' || kind === 'multiSelect') f.typeOptionData = toBinary(SingleSelectTypeOptionPBSchema, create(SingleSelectTypeOptionPBSchema, { options: [option] }));
      const decoded = decodeHyperCell(cell(data), f); expect(decoded.kind).toBe(kind); expect(typeof decoded.display).toBe('string'); expect(decoded.error).toBeUndefined();
      if (decoded.kind === 'date') expect(decoded).toMatchObject({ timestamp: 1800000000n, endTimestamp: 1800086400n, isRange: true, includeTime: true });
      if (decoded.kind === 'singleSelect') expect(decoded.options[0].color).toBe(8);
      if (decoded.kind === 'checklist') expect(decoded.items[0].completed).toBe(true);
      if (decoded.kind === 'number') expect(decoded.value).toBe(42.5);
    }
    expect(cases).toHaveLength(15);
  });
  it('retains an error for corrupt protobuf and distinguishes an unset date from epoch zero', () => {
    expect(decodeHyperCell(cell(new Uint8Array([255])), field(FieldType.DateTime)).error).toBeTruthy();
    expect(decodeHyperCell(cell(new Uint8Array()), field(FieldType.DateTime))).toMatchObject({ timestamp: null });
    expect(decodeHyperCell(cell(toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: 0n } }))), field(FieldType.DateTime))).toMatchObject({ timestamp: 0n });
  });
});
describe('Hyper database controller', () => {
  it('patches insert/delete/reorder notifications without waiting for a full reload', async () => {
    vi.useFakeTimers(); const { controller, open } = fixture(); await open();
    notify(controller, N.DidUpdateRow, toBinary(RowsChangePBSchema, create(RowsChangePBSchema, { deletedRows: ['s'], insertedRows: [{ rowMeta: { id: 'new' }, oneOfIndex: { case: 'index', value: 0 } }] })));
    expect(controller.state.rowIds).toEqual(['new', 'r']); expect(controller.state.rows.s).toBeUndefined();
    notify(controller, N.DidReorderRows, toBinary(ReorderAllRowsPBSchema, create(ReorderAllRowsPBSchema, { rowOrders: ['r', 'new'] }))); expect(controller.state.rowIds).toEqual(['r', 'new']);
    notify(controller, N.DidReorderSingleRow, toBinary(ReorderSingleRowPBSchema, create(ReorderSingleRowPBSchema, { rowId: 'new', oldIndex: 1, newIndex: 0 }))); expect(controller.state.rowIds).toEqual(['new', 'r']);
  });
  it('deduplicates lazy requests and reloads empty-payload cell notifications scoped by row:field', async () => {
    const { controller, backend, open } = fixture(); await open();
    await Promise.all([controller.loadCell('r', 'f'), controller.loadCell('r', 'f')]); expect(backend.DatabaseEventGetCell).toHaveBeenCalledTimes(1);
    backend.DatabaseEventGetCell.mockImplementation(async () => ok(cell(utf8('Edited'))));
    notify(controller, N.DidUpdateCell, new Uint8Array(), 'r:f');
    await vi.waitFor(() => expect(controller.state.cells.r.f.display).toBe('Edited'));
    notify(controller, N.DidUpdateCell, new Uint8Array(), 'other:f'); expect(backend.DatabaseEventGetCell).toHaveBeenCalledTimes(2);
  });
  it('rejects stale cells after dispose and can reopen after an interrupted StrictMode mount', async () => {
    const { controller, backend, open } = fixture(); await open();
    let resolve!: (result: ReturnType<typeof ok<ReturnType<typeof cell>>>) => void;
    backend.DatabaseEventGetCell.mockImplementation(() => new Promise(r => { resolve = r; }));
    const loaded = controller.loadCell('r', 'f'); controller.dispose(); resolve(ok(cell(utf8('Late')))); await loaded;
    expect(controller.state.cells.r).toBeUndefined();
    backend.DatabaseEventGetCell.mockImplementation(async () => ok(cell(utf8('Fresh'))));
    await controller.open(); expect(controller.state.status).toBe('ready');
  });
  it('sends typed dates, select and checklist changes, validates type, and forwards board moves', async () => {
    const { controller, backend, f, open } = fixture(); await open();
    await expect(controller.updateCell('r', 'f', { kind: 'checkbox', checked: true })).rejects.toThrow('Cannot write');
    f.fieldType = FieldType.DateTime; controller.store.setState({ fields: [{ ...controller.state.fields[0], type: f.fieldType }] });
    await controller.updateCell('r', 'f', { kind: 'date', timestamp: 100n, endTimestamp: 200n, isRange: true, includeTime: false });
    expect(backend.DatabaseEventUpdateDateCell).toHaveBeenCalledWith(expect.objectContaining({ oneOfTimestamp: { case: 'timestamp', value: 100n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 200n } }));
    f.fieldType = FieldType.SingleSelect; controller.store.setState({ fields: [{ ...controller.state.fields[0], type: f.fieldType }] });
    await controller.updateCell('r', 'f', { kind: 'singleSelect', insertOptionIds: ['done'], deleteOptionIds: ['todo'] });
    expect(backend.DatabaseEventUpdateSelectOptionCell).toHaveBeenCalledWith(expect.objectContaining({ insertOptionIds: ['done'], deleteOptionIds: ['todo'] }));
    f.fieldType = FieldType.Checklist; controller.store.setState({ fields: [{ ...controller.state.fields[0], type: f.fieldType }] });
    await controller.updateCell('r', 'f', { kind: 'checklist', insert: [{ name: 'Review', index: 0 }], completedIds: ['task'] });
    expect(backend.DatabaseEventUpdateChecklistCell).toHaveBeenCalledWith(expect.objectContaining({ insertTask: [{ name: 'Review', oneOfIndex: { case: 'index', value: 0 } }], completedTasks: ['task'] }));
    await controller.moveRowBetweenGroups('r', 'todo', 'done', 's'); expect(backend.DatabaseEventMoveGroupRow).toHaveBeenCalledWith({ viewId: 'v', fromRowId: 'r', fromGroupId: 'todo', toGroupId: 'done', oneOfToRowId: { case: 'toRowId', value: 's' } });
    await controller.updateFieldSettings('f', { width: 240, wrapCellContent: true }); expect(backend.DatabaseEventUpdateFieldSettings).toHaveBeenCalledWith(expect.objectContaining({ oneOfWidth: { case: 'width', value: 240 } }));
  });
  it('refetches a cell invalidated while an older request is in flight', async () => {
    const { controller, backend, open } = fixture(); await open();
    let resolve!: (value: ReturnType<typeof ok<ReturnType<typeof cell>>>) => void;
    backend.DatabaseEventGetCell.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    backend.DatabaseEventGetCell.mockImplementation(async () => ok(cell(utf8('Current'))));
    const old = controller.loadCell('r', 'f'); const forced = controller.loadCell('r', 'f', true);
    resolve(ok(cell(utf8('Stale')))); await Promise.all([old, forced]);
    expect(controller.state.cells.r.f.display).toBe('Current'); expect(backend.DatabaseEventGetCell).toHaveBeenCalledTimes(2);
  });
  it('keeps request concurrency and cached cell count bounded across larger batches', async () => {
    const { controller, backend, open } = fixture(Array.from({ length: 25 }, (_, i) => `row-${i}`)); await open();
    let active = 0; let peak = 0;
    backend.DatabaseEventGetCell.mockImplementation(async ({ rowId, fieldId }) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return ok(create(CellPBSchema, { rowId, fieldId, data: utf8('Task') })); });
    await controller.loadRows(controller.state.rowIds);
    expect(peak).toBeLessThanOrEqual(2); expect(Object.values(controller.state.cells).reduce((count, cells) => count + Object.keys(cells).length, 0)).toBeLessThanOrEqual(10);
    expect(backend.DatabaseEventGetCell).toHaveBeenCalledTimes(25);
  });
  it('opens thousands of row metadata entries while fetching only the initial viewport batch', async () => {
    const { controller, backend, open } = fixture(Array.from({ length: 2500 }, (_, index) => `task-${index}`)); await open();
    await controller.refresh(); await controller.loadRows(controller.state.rowIds.slice(0, 10));
    expect(controller.state.rowIds).toHaveLength(2500); expect(backend.DatabaseEventGetCell).toHaveBeenCalledTimes(10);
  });
  it('coalesces fields, settings, filters, sorts and group notifications into a metadata reload', async () => {
    vi.useFakeTimers(); const { controller, backend, f, open } = fixture(); await open();
    f.name = 'Renamed task'; const before = backend.DatabaseEventGetDatabase.mock.calls.length;
    for (const type of [N.DidUpdateFields, N.DidUpdateFieldSettings, N.DidUpdateFilter, N.DidUpdateSort, N.DidGroupByField, N.DidUpdateLayoutSettings]) notify(controller, type);
    await vi.advanceTimersByTimeAsync(25);
    expect(controller.state.fields[0].name).toBe('Renamed task'); expect(backend.DatabaseEventGetDatabase).toHaveBeenCalledTimes(before + 1);
  });
  it('exposes a transport failure on the cell while keeping the database usable', async () => {
    const { controller, backend, open } = fixture(); await open();
    backend.DatabaseEventGetCell.mockRejectedValueOnce(new Error('Core disconnected'));
    await controller.loadCell('r', 'f');
    expect(controller.state.cells.r.f.error).toBe('Core disconnected'); expect(controller.state.status).toBe('ready');
    await controller.loadCell('r', 'f'); expect(controller.state.cells.r.f.error).toBeUndefined();
  });
  it('moves a calendar range and fills both endpoints for partial range edits', async () => {
    const { controller, backend, f, open } = fixture(); await open();
    f.fieldType = FieldType.DateTime; controller.store.setState({ fields: [{ ...controller.state.fields[0], type: f.fieldType }] });
    let start = 100n; let end = 200n;
    backend.DatabaseEventGetCell.mockImplementation(async () => ok(cell(toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: start }, oneOfEndTimestamp: { case: 'endTimestamp', value: end }, isRange: true })))));
    backend.DatabaseEventUpdateDateCell.mockImplementation(async payload => {
      if (payload.oneOfTimestamp?.case !== 'timestamp' || payload.oneOfEndTimestamp?.case !== 'endTimestamp') throw new Error('Range requires both endpoints');
      start = payload.oneOfTimestamp.value; end = payload.oneOfEndTimestamp.value; return ok(undefined);
    });
    await controller.moveCalendarEvent('r', 'f', 300n);
    expect(backend.DatabaseEventMoveCalendarEvent).not.toHaveBeenCalled();
    expect(controller.state.cells.r.f).toMatchObject({ timestamp: 300n, endTimestamp: 400n });
    await controller.updateCell('r', 'f', { kind: 'date', endTimestamp: 500n });
    expect(controller.state.cells.r.f).toMatchObject({ timestamp: 300n, endTimestamp: 500n });
  });
  it('creates Gantt as a linked Grid view and merges extra keys', async () => {
    const { controller, backend, open } = fixture(); await open();
    const view = await controller.addView('gantt', 'Timeline');
    expect(backend.views.createView).toHaveBeenCalledWith(expect.objectContaining({ ext: { database_id: 'db' }, layoutType: ViewLayoutPB.Grid }));
    expect(hyperLayout(view)).toBe('gantt'); expect(JSON.parse(view.oneOfExtra.value!)).toEqual({ font: 'Geist', hyper_layout: 'gantt' });
  });
});
