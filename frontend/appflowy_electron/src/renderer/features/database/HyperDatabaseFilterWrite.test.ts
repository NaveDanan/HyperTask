import { clone, create, toBinary } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterPBSchema, FilterDataPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { hyperDeleteDatabaseFilterGroup, hyperWriteDatabaseFilter } from './HyperDatabaseFilterWrite';
import { hyperDatabaseFilterNew, hyperEncodeDatabaseFilter } from './HyperDatabaseFilter';
import { RelationFilterPBSchema } from '@shared/protobuf/flowy-database2/relation_filter_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
const state = vi.hoisted(() => ({ field: null as unknown, filters: [] as FilterPB[], writes: [] as unknown[], allowed: true, pending: null as Promise<void> | null, acknowledgement: null as Promise<void> | null }));
vi.mock('@/backend/events/flowy-database2', async original => ({ ...await original<typeof import('@/backend/events/flowy-database2')>(), DatabaseEventGetDatabase: async () => ({ ok: true, value: { id: 'database' } }), DatabaseEventGetFields: async () => ({ ok: true, value: { items: [state.field] } }), DatabaseEventGetAllFilters: async () => { await state.pending; return { ok: true, value: { items: state.filters } }; }, DatabaseEventUpdateDatabaseSetting: async (value: unknown) => { state.writes.push(value); await state.acknowledgement; return { ok: true }; } }));
vi.mock('./HyperDatabaseDraftBackend', () => ({ hyperReadDatabaseWriteView: async () => { if (!state.allowed) throw Error('unavailable'); } }));
const owner = { contextKey: 'filter-source-tests', workspaceId: 'workspace', actorId: '1', isCurrent: () => true };
const originalApp = useAppStore.getState(), originalWorkspace = useWorkspaceStore.getState();
function fixture() {
  const field = create(FieldPBSchema, { id: 'select', fieldType: FieldType.MultiSelect }); state.field = field;
  const bytes = (id: string) => hyperEncodeDatabaseFilter(FieldType.MultiSelect, { ...hyperDatabaseFilterNew(FieldType.MultiSelect), optionIds: [id] });
  const leaf = create(FilterPBSchema, { id: 'leaf', oneOfData: { case: 'data', value: { fieldId: field.id, fieldType: field.fieldType, data: bytes('kept') } } });
  const group = create(FilterPBSchema, { id: 'group', filterType: FilterType.And, children: [leaf] }); state.filters = [group];
  return { field, leaf, group, bytes };
}
afterEach(() => {
  state.writes = []; state.allowed = true; state.pending = null; state.acknowledgement = null;
  useAppStore.setState({ dataDirectory: originalApp.dataDirectory, launchId: originalApp.launchId });
  useWorkspaceStore.setState({ userProfile: originalWorkspace.userProfile, currentWorkspace: originalWorkspace.currentWorkspace, actionResult: originalWorkspace.actionResult });
});
describe('generic filter source guards', () => {
  it.each(['success', 'error'] as const)('quarantines a late write %s after owner generation changes without replay', async reply => {
    const f = fixture(); let complete!: () => void, fail!: (error: Error) => void;
    state.acknowledgement = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const pending = hyperWriteDatabaseFilter('view', 'database', f.field, f.leaf, f.bytes('next'), owner, () => true);
    await vi.waitFor(() => expect(state.writes).toHaveLength(1));
    useAppStore.setState({ launchId: useAppStore.getState().launchId + 1 });
    if (reply === 'success') complete(); else fail(Error('Old owner private error'));
    await expect(pending).rejects.toThrow('changed');
    expect(state.writes).toHaveLength(1);
  });
  it.each(['edit', 'delete', 'group'] as const)('rejects a pending %s after a restart or realm round trip even when the plain owner is current again', async operation => {
    for (const transition of ['restart', 'realm'] as const) {
      useAppStore.setState({ dataDirectory: '/disposable/filter-owner-A' });
      useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null });
      const liveOwner = hyperGetDocumentOwner()!, f = fixture();
      let release!: () => void; state.pending = new Promise<void>(resolve => { release = resolve; });
      const pending = operation === 'group'
        ? hyperDeleteDatabaseFilterGroup('view', 'database', clone(FilterPBSchema, f.group), liveOwner, () => true)
        : hyperWriteDatabaseFilter('view', 'database', f.field, f.leaf, operation === 'edit' ? f.bytes('next') : null, liveOwner, () => true);
      await Promise.resolve();
      if (transition === 'restart') useAppStore.setState({ launchId: useAppStore.getState().launchId + 1 });
      else { useAppStore.setState({ dataDirectory: '/disposable/filter-owner-B' }); useAppStore.setState({ dataDirectory: '/disposable/filter-owner-A' }); }
      expect(liveOwner.isCurrent()).toBe(true);
      release(); await expect(pending).rejects.toThrow('changed');
      expect(state.writes).toEqual([]); state.pending = null;
    }
  });
  it.each([-1n, 255n, 300n, -9223372036854775808n, 9223372036854775807n])('never reinterprets unsupported relation condition %s on Save or intentional removal', async condition => {
    const field = create(FieldPBSchema, { id: 'relation', fieldType: FieldType.Relation }); state.field = field;
    const bytes = toBinary(RelationFilterPBSchema, create(RelationFilterPBSchema, { condition })), before = bytes.slice();
    const source = create(FilterPBSchema, { id: 'future-relation', oneOfData: { case: 'data', value: { fieldId: field.id, fieldType: field.fieldType, data: bytes } } }); state.filters = [clone(FilterPBSchema, source)];
    expect(await hyperWriteDatabaseFilter('view', 'database', field, source, bytes, owner, () => true)).toBe(false);
    const supported = toBinary(RelationFilterPBSchema, create(RelationFilterPBSchema, { condition: 0n }));
    await expect(hyperWriteDatabaseFilter('view', 'database', field, source, supported, owner, () => true)).rejects.toThrow('unsupported'); expect(state.writes).toEqual([]);
    state.filters[0].oneOfData = { case: 'data', value: create(FilterDataPBSchema, { fieldId: field.id, fieldType: field.fieldType, data: supported }) };
    await expect(hyperWriteDatabaseFilter('view', 'database', field, source, null, owner, () => true)).rejects.toThrow('changed'); expect(state.writes).toEqual([]);
    state.filters = [clone(FilterPBSchema, source)];
    expect(await hyperWriteDatabaseFilter('view', 'database', field, source, null, owner, () => true)).toBe(true);
    expect(state.writes[0]).toEqual({ viewId: 'view', oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId: source.id } } }); expect(source.oneOfData.value!.data).toEqual(before);
  });
  it('rejects changed select option bytes and never replays an edit against new metadata', async () => {
    const f = fixture(); state.field = { ...f.field, typeOptionData: new Uint8Array([0x0a, 0x00]) };
    await expect(hyperWriteDatabaseFilter('view', 'database', f.field, f.leaf, f.bytes('next'), owner, () => true)).rejects.toThrow('changed'); expect(state.writes).toEqual([]);
  });
  it('updates a leaf without replacing siblings added since the editor opened', async () => {
    const f = fixture(), sibling = clone(FilterPBSchema, f.leaf); sibling.id = 'sibling'; state.filters[0].children.push(sibling);
    expect(await hyperWriteDatabaseFilter('view', 'database', f.field, f.leaf, f.bytes('next'), owner, () => true)).toBe(true);
    expect(state.writes[0]).toMatchObject({ oneOfUpdateFilterData: { case: 'updateFilterData', value: { filterId: 'leaf' } } });
  });
  it('guards removal of a whole group against permission loss and changed descendants', async () => {
    const f = fixture(), source = clone(FilterPBSchema, f.group); state.allowed = false;
    await expect(hyperDeleteDatabaseFilterGroup('view', 'database', source, owner, () => true)).rejects.toThrow('unavailable'); state.allowed = true;
    state.filters[0].children[0].oneOfData = { case: 'data', value: create(FilterDataPBSchema, { fieldId: f.field.id, fieldType: f.field.fieldType, data: f.bytes('changed') }) };
    await expect(hyperDeleteDatabaseFilterGroup('view', 'database', source, owner, () => true)).rejects.toThrow('changed'); expect(state.writes).toEqual([]);
    await hyperDeleteDatabaseFilterGroup('view', 'database', clone(FilterPBSchema, state.filters[0]), owner, () => true);
    expect(state.writes[0]).toMatchObject({ oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId: 'group' } } });
  });
});
