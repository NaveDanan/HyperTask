import { clone, create, toBinary } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterPBSchema, FilterDataPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { DateFilterConditionPB, DateFilterPBSchema } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { hyperDatabaseFindDateFilters, hyperWriteDatabaseDateFilter } from './HyperDatabaseDateFilterWrite';
const state = vi.hoisted(() => ({ field: null as unknown, filters: [] as unknown[], reads: 0, writes: [] as unknown[], locked: false, actor: '1', hold: null as (() => Promise<void>) | null }));
vi.mock('@/backend/events/flowy-database2', async original => ({ ...await original<typeof import('@/backend/events/flowy-database2')>(), DatabaseEventGetDatabase: async () => { state.reads++; return { ok: true, value: { id: 'database' } }; }, DatabaseEventGetFields: async () => { await state.hold?.(); return { ok: true, value: { items: [state.field] } }; }, DatabaseEventGetAllFilters: async () => ({ ok: true, value: { items: state.filters } }), DatabaseEventUpdateDatabaseSetting: async (payload: unknown) => { state.writes.push(payload); return { ok: true }; } }));
vi.mock('@/backend/events/flowy-folder', async original => ({ ...await original<typeof import('@/backend/events/flowy-folder')>(), FolderEventGetView: async () => ({ ok: true, value: { oneOfIsLocked: { case: 'isLocked', value: state.locked }, oneOfCreatedBy: { case: undefined } } }), FolderEventReadCurrentWorkspace: async () => ({ ok: true, value: { id: 'workspace' } }) }));
vi.mock('@/backend/events/flowy-user', async original => ({ ...await original<typeof import('@/backend/events/flowy-user')>(), UserEventGetUserProfile: async () => ({ ok: true, value: { id: state.actor, userAuthType: AuthTypePB.Local, workspaceType: WorkspaceTypePB.LocalW } }) }));
function fixture() {
  const field = create(FieldPBSchema, { id: 'date', fieldType: FieldType.DateTime }); state.field = field;
  const bytes = (condition: DateFilterConditionPB) => toBinary(DateFilterPBSchema, create(DateFilterPBSchema, { condition, oneOfTimestamp: { case: 'timestamp', value: 0n } }));
  const source = create(FilterPBSchema, { id: 'filter', oneOfData: { case: 'data', value: { fieldId: 'date', fieldType: FieldType.DateTime, data: bytes(DateFilterConditionPB.DateStartsOn) } } });
  state.filters = [create(FilterPBSchema, { id: 'group', filterType: FilterType.And, children: [source] })];
  let current = true; const owner = { contextKey: 'filter-write', workspaceId: 'workspace', actorId: '1', isCurrent: () => current };
  return { field, source, owner, bytes, revoke: () => { current = false; }, write: (next: Uint8Array) => hyperWriteDatabaseDateFilter('view', 'database', field, source, next, owner, () => current) };
}
afterEach(() => { state.reads = 0; state.writes = []; state.locked = false; state.actor = '1'; state.hold = null; });
describe('date filter writes', () => {
  it('does not read or write when the exact legacy filter is unchanged', async () => {
    const f = fixture(); expect(await f.write(f.bytes(DateFilterConditionPB.DateStartsOn))).toBe(false); expect(state.reads).toBe(0); expect(state.writes).toEqual([]);
  });
  it('keeps future raw bytes on unchanged Save and blocks edits that would erase them', async () => {
    const f = fixture(), source = clone(FilterPBSchema, f.source);
    if (source.oneOfData.case !== 'data') throw Error('missing fixture data');
    const future = new Uint8Array([...source.oneOfData.value.data, 0x98, 0x06, 0x01]); source.oneOfData.value.data = future;
    expect(await hyperWriteDatabaseDateFilter('view', 'database', f.field, source, future, f.owner, () => true)).toBe(false);
    await expect(hyperWriteDatabaseDateFilter('view', 'database', f.field, source, f.bytes(DateFilterConditionPB.DateStartsAfter), f.owner, () => true)).rejects.toThrow('unsupported');
    expect(state.reads).toBe(0); expect(state.writes).toEqual([]);
  });
  it.each(['filter', 'data'] as const)('protects unknown fields on the %s envelope too', async envelope => {
    const f = fixture(), source = clone(FilterPBSchema, f.source);
    if (source.oneOfData.case !== 'data') throw Error('missing fixture data');
    const target = envelope === 'filter' ? source : source.oneOfData.value;
    target.$unknown = [{ no: 99, wireType: 0, data: new Uint8Array([1]) }];
    expect(await hyperWriteDatabaseDateFilter('view', 'database', f.field, source, source.oneOfData.value.data, f.owner, () => true)).toBe(false);
    await expect(hyperWriteDatabaseDateFilter('view', 'database', f.field, source, f.bytes(DateFilterConditionPB.DateStartsAfter), f.owner, () => true)).rejects.toThrow('unsupported');
    expect(state.reads).toBe(0); expect(state.writes).toEqual([]);
  });
  it('finds nested leaves in native order and updates the exact leaf without replacing its group', async () => {
    const f = fixture(); expect(hyperDatabaseFindDateFilters(state.filters as FilterPB[]).map(filter => filter.id)).toEqual(['filter']);
    expect(await f.write(f.bytes(DateFilterConditionPB.DateStartsAfter))).toBe(true);
    expect(state.writes[0]).toMatchObject({ oneOfUpdateFilterData: { case: 'updateFilterData', value: { filterId: 'filter' } } });
  });
  it('removes the exact nested leaf only after the same fresh permission and source guards', async () => {
    const f = fixture();
    expect(await hyperWriteDatabaseDateFilter('view', 'database', f.field, f.source, null, f.owner, () => true)).toBe(true);
    expect(state.writes[0]).toMatchObject({ oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId: 'filter' } } });
    state.writes = []; state.locked = true;
    await expect(hyperWriteDatabaseDateFilter('view', 'database', f.field, f.source, null, f.owner, () => true)).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
  it.each(['locked', 'actor', 'property', 'filter'] as const)('rejects an observed %s change before the update', async change => {
    const f = fixture(); if (change === 'locked') state.locked = true; if (change === 'actor') state.actor = '2'; if (change === 'property') state.field = { ...f.field, fieldType: FieldType.Number };
    if (change === 'filter') { const changed = clone(FilterPBSchema, f.source); changed.oneOfData = { case: 'data', value: create(FilterDataPBSchema, { fieldId: 'date', fieldType: FieldType.DateTime, data: f.bytes(DateFilterConditionPB.DateEndsOn) }) }; state.filters = [changed]; }
    await expect(f.write(f.bytes(DateFilterConditionPB.DateStartsAfter))).rejects.toThrow(); expect(state.writes).toEqual([]);
  });
  it('rejects owner loss while source metadata is pending', async () => {
    const f = fixture(); let release!: () => void; state.hold = () => new Promise<void>(resolve => { release = resolve; });
    const pending = f.write(f.bytes(DateFilterConditionPB.DateStartsAfter)); f.revoke(); release(); await expect(pending).rejects.toThrow(); expect(state.writes).toEqual([]);
  });
});
