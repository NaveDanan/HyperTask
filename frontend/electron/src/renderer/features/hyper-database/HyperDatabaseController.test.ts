import { afterEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { HyperDatabaseController, hyperLayout } from './HyperDatabaseController';
import { decodeHyperCell } from './HyperCellCodec';
import { hyperDatabaseBackend } from './HyperDatabaseBackend';
import { FieldPBSchema, FieldType, RepeatedFieldPBSchema } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { CellPBSchema } from '@shared/protobuf/hyper-database2/cell_entities_pb';
import { DateCellDataPBSchema } from '@shared/protobuf/hyper-database2/date_entities_pb';
import { CheckboxCellDataPBSchema } from '@shared/protobuf/hyper-database2/checkbox_entities_pb';
import { SelectOptionCellDataPBSchema, SingleSelectTypeOptionPBSchema, SelectOptionPBSchema } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import { ChecklistCellDataPBSchema } from '@shared/protobuf/hyper-database2/checklist_entities_pb';
import { TimestampCellDataPBSchema } from '@shared/protobuf/hyper-database2/timestamp_entities_pb';
import { RelationCellDataPBSchema } from '@shared/protobuf/hyper-database2/relation_entities_pb';
import { TimeCellDataPBSchema } from '@shared/protobuf/hyper-database2/time_entities_pb';
import { URLCellDataPBSchema } from '@shared/protobuf/hyper-database2/url_entities_pb';
import { MediaCellDataPBSchema } from '@shared/protobuf/hyper-database2/media_entities_pb';
import { CalendarEventPBSchema, RepeatedCalendarEventPBSchema } from '@shared/protobuf/hyper-database2/calendar_entities_pb';
import { DatabasePBSchema, DatabaseIdPBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { RowMetaPBSchema } from '@shared/protobuf/hyper-database2/row_entities_pb';
import { DatabaseViewSettingPBSchema } from '@shared/protobuf/hyper-database2/setting_entities_pb';
import { GroupPBSchema, RepeatedGroupPBSchema } from '@shared/protobuf/hyper-database2/group_pb';
import { RowsVisibilityChangePBSchema, RowsChangePBSchema } from '@shared/protobuf/hyper-database2/view_entities_pb';
import { ReorderAllRowsPBSchema, ReorderSingleRowPBSchema } from '@shared/protobuf/hyper-database2/sort_entities_pb';
import { DatabaseNotification as N } from '@shared/protobuf/hyper-database2/notification_pb';
import { SubscribeObjectSchema } from '@shared/protobuf/hyper-notification/subject_pb';
import { RepeatedViewPBSchema, ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/hyper-folder/view_pb';
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
    updateView: vi.fn(async (_payload: Parameters<typeof hyperDatabaseBackend.updateView>[0]) => ok(undefined)),
    views: { ...hyperDatabaseBackend.views, getView: vi.fn(async () => ok(view)), createView: vi.fn(async () => ok(create(ViewPBSchema, { id: 'new', name: 'Timeline', layout: ViewLayoutPB.Grid, oneOfExtra: { case: 'extra', value: '{"font":"Geist"}' } }))), updateView: vi.fn(async (_payload: Parameters<typeof hyperDatabaseBackend.views.updateView>[0]) => ok(view)) },
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
  it('opens the native database before metadata can initialize competing editors', async () => {
    const { controller, backend, database } = fixture();
    let release!: () => void;
    const opened = new Promise<void>(resolve => { release = resolve; });
    backend.DatabaseEventGetDatabase.mockImplementation(async () => { await opened; return ok(database); });
    const opening = controller.open();
    await Promise.resolve();
    const earlyReads = [backend.DatabaseEventGetFields.mock.calls.length, backend.DatabaseEventGetDatabaseSetting.mock.calls.length, backend.DatabaseEventGetGroups.mock.calls.length];
    release(); await opening;
    expect(earlyReads).toEqual([0, 0, 0]);
    expect(controller.state.status).toBe('ready');
    expect(backend.DatabaseEventGetFields).toHaveBeenCalledOnce();
  });
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


describe('Hyper review regressions', () => {
  it('applies visibility notifications without reopening the notifying database', async () => {
    vi.useFakeTimers(); const { controller, backend, open } = fixture(); await open();
    const before = backend.DatabaseEventGetDatabase.mock.calls.length;
    backend.DatabaseEventGetDatabase.mockImplementation(async () => {
      notify(controller, N.DidUpdateViewRowsVisibility, toBinary(RowsVisibilityChangePBSchema, create(RowsVisibilityChangePBSchema, { invisibleRows: ['s'] })));
      return ok(create(DatabasePBSchema, { id: 'db', rows: [{ id: 'r' }, { id: 's' }] }));
    });
    notify(controller, N.DidUpdateViewRowsVisibility, toBinary(RowsVisibilityChangePBSchema, create(RowsVisibilityChangePBSchema, { invisibleRows: ['s'] })));
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.state.rowIds).toEqual(['r']);
    expect(backend.DatabaseEventGetDatabase).toHaveBeenCalledTimes(before);
  });
  it('retains hydrated metadata through ID-only refreshes but accepts full clears', async () => {
    const { controller, open } = fixture(); await open();
    const full = create(RowMetaPBSchema, { id: 'r', oneOfIcon: { case: 'icon', value: 'icon' }, oneOfDocumentId: { case: 'documentId', value: 'document' }, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false }, oneOfCover: { case: 'cover', value: { data: 'cover' } } });
    notify(controller, N.DidUpdateRowMeta, toBinary(RowMetaPBSchema, full), 'r'); await controller.refresh();
    expect(controller.state.rows.r).toMatchObject({ icon: 'icon', documentId: 'document', isDocumentEmpty: false, cover: { data: 'cover' } });
    notify(controller, N.DidUpdateRowMeta, toBinary(RowMetaPBSchema, create(RowMetaPBSchema, { id: 'r', oneOfDocumentId: { case: 'documentId', value: 'document' }, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: true } })), 'r');
    await controller.refresh(); expect(controller.state.rows.r).toMatchObject({ icon: null, cover: null, isDocumentEmpty: true });
  });
  it.each([N.DidReorderRows, N.DidReorderSingleRow])('keeps a live reorder over an older pending snapshot (%s)', async type => {
    const { controller, backend, database, open } = fixture(); await open();
    let finish!: (value: ReturnType<typeof ok<typeof database>>) => void;
    backend.DatabaseEventGetDatabase.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = controller.refresh();
    notify(controller, type, type === N.DidReorderRows ? toBinary(ReorderAllRowsPBSchema, create(ReorderAllRowsPBSchema, { rowOrders: ['s', 'r'] })) : toBinary(ReorderSingleRowPBSchema, create(ReorderSingleRowPBSchema, { rowId: 's', newIndex: 0 })));
    finish(ok(database)); await refreshing; expect(controller.state.rowIds).toEqual(['s', 'r']);
  });
  it('serializes extra patches and ignores a snapshot predating their writes', async () => {
    const { controller, backend, view, open } = fixture(); await open();
    let finish!: (value: ReturnType<typeof ok<typeof view>>) => void;
    backend.views.getView.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = controller.refresh();
    backend.updateView.mockImplementation(async () => ok(undefined));
    await Promise.all([controller.updateViewExtra({ a: 1 }), controller.updateViewExtra({ b: 2 })]);
    finish(ok(view)); await refreshing;
    expect(JSON.parse(controller.state.view!.oneOfExtra.value!)).toMatchObject({ a: 1, b: 2 });
    await controller.updateViewExtra({ c: 3 });
    expect(JSON.parse(controller.state.view!.oneOfExtra.value!)).toMatchObject({ a: 1, b: 2, c: 3 });
  });
  it('retains scan values even when a batch and result exceed the display cache', async () => {
    const { controller, backend, open } = fixture(Array.from({ length: 25 }, (_, i) => 'row-' + i)); await open();
    const values = await controller.scanRows(controller.state.rowIds, ['f']);
    expect(Object.keys(values)).toHaveLength(25); expect(values['row-0'].f.display).toBe('A task');
    expect(Object.values(controller.state.cells).reduce((n, row) => n + Object.keys(row).length, 0)).toBeLessThanOrEqual(10);
    expect(backend.DatabaseEventGetCell).toHaveBeenCalledTimes(25);
  });
});


it('keeps calendar overlap/end flags when events exceed cache capacity inside one batch', async () => {
  const { controller, backend, f, open } = fixture(['r', 's', 't']); await open();
  f.fieldType = FieldType.DateTime; controller.store.setState({ fields: [{ ...controller.state.fields[0], type: f.fieldType }] });
  const events = create(RepeatedCalendarEventPBSchema, { items: ['r', 's', 't'].map((id, index) => create(CalendarEventPBSchema, { rowMeta: { id }, dateFieldId: 'f', title: id, oneOfTimestamp: { case: 'timestamp', value: index ? 150n : 50n } })) });
  const small = new HyperDatabaseController('v', { ...backend, DatabaseEventGetAllCalendarEvents: vi.fn(async () => ok(events)) }, { batchSize: 10, concurrency: 2, maxCachedCells: 2 });
  small.store.setState(controller.state); disposals.push(() => small.dispose());
  backend.DatabaseEventGetCell.mockImplementation(async ({ rowId }) => ok(create(CellPBSchema, { rowId, fieldId: 'f', data: toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: rowId === 'r' ? 50n : 150n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 200n }, isRange: true, includeTime: true })) })));
  expect(await small.getCalendarEvents(100n, 300n)).toMatchObject([{ rowId: 'r', endTimestamp: 200n, includeTime: true }, { rowId: 's' }, { rowId: 't' }]);
  expect(small.state.cells.r?.f).toBeUndefined();
});

it('removes a status option without invoking the destructive group/row API', async () => {
  const { controller, backend, f, database, open } = fixture(); await open();
  f.fieldType = FieldType.SingleSelect;
  const todo = create(SelectOptionPBSchema, { id: 'todo', name: 'To do' }); const done = create(SelectOptionPBSchema, { id: 'done', name: 'Done' });
  f.typeOptionData = toBinary(SingleSelectTypeOptionPBSchema, create(SingleSelectTypeOptionPBSchema, { options: [todo, done] }));
  controller.store.setState({ fields: [{ ...controller.state.fields[0], type: f.fieldType, options: [todo, done] }], groups: [{ ...create(GroupPBSchema, { groupId: 'todo', fieldId: 'f', rows: database.rows }), name: 'To do', option: todo }] });
  const destructive = vi.fn(async () => ok(undefined)); const removeRows = backend.DatabaseEventDeleteRows;
  backend.DatabaseEventDeleteGroup = destructive;
  backend.DatabaseEventUpdateFieldTypeOption = vi.fn(async payload => { f.typeOptionData = payload.typeOptionData!; return ok(undefined); });
  await controller.deleteGroup('todo');
  expect(destructive).not.toHaveBeenCalled(); expect(removeRows).not.toHaveBeenCalled();
  expect(controller.state.rowIds).toEqual(['r','s']); expect(controller.state.fields[0].options.map(option => option.id)).toEqual(['done']);
  // The native selection decoder omits IDs absent from its option schema; see fix ledger.
  expect(controller.state.rows.r).toBeDefined();
});


it('replays visibility arriving during a refresh without restoring hidden rows', async () => {
  const { controller, backend, database, open } = fixture(); await open();
  let finish!: (value: ReturnType<typeof ok<typeof database>>) => void;
  backend.DatabaseEventGetDatabase.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = controller.refresh();
  notify(controller, N.DidUpdateViewRowsVisibility, toBinary(RowsVisibilityChangePBSchema, create(RowsVisibilityChangePBSchema, { invisibleRows: ['s'] })));
  finish(ok(database)); await refresh; expect(controller.state.rowIds).toEqual(['r']);
});
it('hydrates a metadata write explicitly when no full notification was received', async () => {
  const { controller, backend, open } = fixture(); await open();
  backend.DatabaseEventUpdateRowMeta = vi.fn(async () => ok(undefined));
  backend.DatabaseEventGetRowMeta = vi.fn(async () => ok(create(RowMetaPBSchema, { id: 'r', oneOfDocumentId: { case: 'documentId', value: 'doc' }, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false }, oneOfIcon: { case: 'icon', value: 'saved' } })));
  await controller.updateRowMeta('r', { icon: 'saved' });
  expect(controller.state.rows.r).toMatchObject({ icon: 'saved', documentId: 'doc', isDocumentEmpty: false });
});


it('returns current scan data when a cell is invalidated while its first read is pending', async () => {
  const { controller, backend, open } = fixture(); await open();
  let finish!: (value: ReturnType<typeof ok<ReturnType<typeof cell>>>) => void;
  backend.DatabaseEventGetCell.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  backend.DatabaseEventGetCell.mockImplementation(async () => ok(cell(utf8('Current'))));
  const scan = controller.scanRows(['r'], ['f']);
  notify(controller, N.DidUpdateCell, new Uint8Array(), 'r:f');
  finish(ok(cell(utf8('Stale'))));
  expect((await scan).r.f?.display).toBe('Current');
});
it.each([N.DidReorderRows, N.DidReorderSingleRow])('replays a first-load sort against the incoming snapshot rows (%s)', async type => {
  const ids = Array.from({ length: 50 }, (_, index) => 'row-' + index);
  const { controller, backend, database } = fixture(ids);
  const ordered = type === N.DidReorderRows ? [...ids].reverse() : [ids[49], ...ids.slice(0, 49)];
  backend.DatabaseEventGetDatabase.mockImplementationOnce(async () => {
    expect(controller.state.rows).toEqual({});
    notify(controller, type, type === N.DidReorderRows
      ? toBinary(ReorderAllRowsPBSchema, create(ReorderAllRowsPBSchema, { rowOrders: ordered }))
      : toBinary(ReorderSingleRowPBSchema, create(ReorderSingleRowPBSchema, { rowId: ids[49], newIndex: 0 })));
    return ok(database);
  });
  await controller.open();
  expect(controller.state.rowIds).toEqual(ordered);
  expect(Object.keys(controller.state.rows)).toHaveLength(50);
});
it('does not replace newer row metadata with a read started before its notification', async () => {
  const { controller, backend, open } = fixture(); await open();
  let finish!: (value: ReturnType<typeof ok<ReturnType<typeof create<typeof RowMetaPBSchema>>>>) => void;
  backend.DatabaseEventGetRowMeta = vi.fn(() => new Promise<Awaited<ReturnType<typeof hyperDatabaseBackend.DatabaseEventGetRowMeta>>>(resolve => { finish = resolve; }));
  const read = controller.loadRowMeta('r');
  notify(controller, N.DidUpdateRowMeta, toBinary(RowMetaPBSchema, create(RowMetaPBSchema, { id: 'r', oneOfIcon: { case: 'icon', value: 'new' } })), 'r');
  finish(ok(create(RowMetaPBSchema, { id: 'r', oneOfIcon: { case: 'icon', value: 'old' } }))); await read;
  expect(controller.state.rows.r.icon).toBe('new');
});
it('uses one date-cell version for both calendar endpoints', async () => {
  const { controller, backend, f, open } = fixture(); f.fieldType = FieldType.DateTime; await open();
  backend.DatabaseEventGetAllCalendarEvents = vi.fn(async () => ok(create(RepeatedCalendarEventPBSchema, { items: [{ rowMeta: { id: 'r' }, dateFieldId: 'f', oneOfTimestamp: { case: 'timestamp', value: 50n } }] })));
  backend.DatabaseEventGetCell.mockImplementation(async () => ok(create(CellPBSchema, { rowId: 'r', fieldId: 'f', data: toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: 300n }, oneOfEndTimestamp: { case: 'endTimestamp', value: 350n }, isRange: true })) })));
  expect(await controller.getCalendarEvents(150n, 250n)).toEqual([]);
  expect(await controller.getCalendarEvents(300n, 400n)).toMatchObject([{ timestamp: 300n, endTimestamp: 350n }]);
});
it('commits queued extras from the update acknowledgement without a fragile readback', async () => {
  const { controller, backend, view, open } = fixture(); await open(); let persisted = view.oneOfExtra.value ?? '{}';
  backend.views.updateView.mockImplementation(async payload => { persisted = payload.extra!; throw new Error('write succeeded but GetView readback failed'); });
  backend.updateView.mockImplementation(async payload => { persisted = payload.oneOfExtra?.value ?? '{}'; return ok(undefined); });
  const results = await Promise.allSettled([controller.updateViewExtra({ a: 1 }), controller.updateViewExtra({ b: 2 })]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(JSON.parse(persisted)).toMatchObject({ a: 1, b: 2 });
  expect(backend.views.updateView).not.toHaveBeenCalled();
});
