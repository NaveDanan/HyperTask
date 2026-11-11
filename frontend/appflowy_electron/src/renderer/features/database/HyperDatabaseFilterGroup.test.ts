import { clone, create, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DatabasePBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { FilterPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { TextFilterPBSchema } from '@shared/protobuf/flowy-database2/text_filter_pb';
import { CheckboxFilterPBSchema } from '@shared/protobuf/flowy-database2/checkbox_filter_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperAssertDatabaseFilterGroup, hyperCaptureDatabaseFilterGroup, hyperDatabaseFilterGroupTree } from './HyperDatabaseFilterGroupModel';
import { HyperFilterGroupUncertain, hyperMutateDatabaseFilterGroup, type hyperDatabaseFilterGroupBackend } from './HyperDatabaseFilterGroupService';

const previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/filter-group-tests' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); });
const textBytes = (content: string) => toBinary(TextFilterPBSchema, create(TextFilterPBSchema, { condition: 0, content }));
const leaf = (id: string, content = 'red') => create(FilterPBSchema, { id, oneOfData: { case: 'data', value: { fieldId: 'title', fieldType: FieldType.RichText, data: textBytes(content) } } });
const group = (id: string, children: FilterPB[], filterType: FilterType = FilterType.And) => create(FilterPBSchema, { id, filterType, children });
function fixture(initial: FilterPB[] = [leaf('root')]) {
  const fields = [create(FieldPBSchema, { id: 'title', name: 'Title', fieldType: FieldType.RichText }), create(FieldPBSchema, { id: 'flag', name: 'Flag', fieldType: FieldType.Checkbox })];
  let filters = initial.map(filter => clone(FilterPBSchema, filter)), allowed = true, serial = 0;
  const writes: Parameters<typeof hyperDatabaseFilterGroupBackend.write>[0][] = [], reads: string[] = [];
  const backend: typeof hyperDatabaseFilterGroupBackend = {
    database: async () => { reads.push('database'); return create(DatabasePBSchema, { id: 'database' }); },
    writable: async () => { reads.push('writable'); if (!allowed) throw Error('unavailable'); return create(ViewPBSchema, { id: 'view', layout: ViewLayoutPB.Grid }); },
    fields: async () => { reads.push('fields'); return fields; },
    filters: async () => { reads.push('filters'); return filters.map(filter => clone(FilterPBSchema, filter)); },
    write: async change => {
      writes.push(change); serial++;
      const find = (id: string) => { const stack = [...filters]; while (stack.length) { const node = stack.pop()!; if (node.id === id) return node; stack.push(...node.children); } throw Error('not found'); };
      if (change.oneOfInsertFilter?.case === 'insertFilter') {
        const value = change.oneOfInsertFilter.value, parent = find(value.oneOfParentFilterId!.value!);
        const child = create(FilterPBSchema, { id: `added-${serial}`, oneOfData: { case: 'data', value: value.data! } });
        if (parent.filterType === FilterType.Data) { const original = clone(FilterPBSchema, parent); original.id = `original-${serial}`; parent.filterType = FilterType.And; parent.oneOfData = { case: undefined }; parent.children = [original, child]; } else parent.children.push(child);
      } else if (change.oneOfUpdateFilterType?.case === 'updateFilterType') { const value = change.oneOfUpdateFilterType.value; find(value.filterId!).filterType = value.filterType!; }
      else if (change.oneOfDeleteFilter?.case === 'deleteFilter') {
        const id = change.oneOfDeleteFilter.value.filterId; const remove = (items: FilterPB[]) => { const at = items.findIndex(item => item.id === id); if (at >= 0) items.splice(at, 1); else items.forEach(item => remove(item.children)); }; remove(filters);
      }
    },
  };
  const owner = hyperGetDocumentOwner()!, context = { viewId: 'view', databaseId: 'database', owner, current: () => allowed };
  const anchor = (id = 'root') => hyperCaptureDatabaseFilterGroup(hyperDatabaseFilterGroupTree(filters, fields), fields, id);
  const add = () => ({ kind: 'add' as const, field: fields[1], bytes: toBinary(CheckboxFilterPBSchema, create(CheckboxFilterPBSchema)) });
  return { fields, backend, context, anchor, add, writes, reads, filters: () => filters, setFilters: (next: FilterPB[]) => { filters = next; }, lock: () => { allowed = false; } };
}
describe('Hyper bounded filter group source model', () => {
  it('captures real ancestor paths and exact descendants without flattening the tree', () => {
    const f = fixture([group('root', [leaf('sibling'), group('nested', [leaf('deep')], FilterType.Or)])]), anchor = f.anchor('deep');
    expect(JSON.parse(anchor.path)).toEqual([['root', FilterType.And], ['nested', FilterType.Or]]);
    const changed = f.filters().map(filter => clone(FilterPBSchema, filter)); changed[0].children[1].children[0].oneOfData.value!.data = textBytes('new');
    expect(() => hyperAssertDatabaseFilterGroup(hyperDatabaseFilterGroupTree(changed, f.fields), f.fields, anchor)).toThrow('changed');
  });
  it('does not treat unknown nodes, criteria or properties as writable', () => {
    for (const value of [Object.assign(leaf('root'), { $unknown: [{ no: 99, wireType: 0, data: new Uint8Array([1]) }] }), group('root', [leaf('nested')], 300 as FilterType), Object.assign(leaf('root'), { children: [leaf('invalid')] })]) {
      const f = fixture([value]); expect(hyperDatabaseFilterGroupTree(f.filters(), f.fields).supported).toBe(false); expect(() => f.anchor()).toThrow('unsupported');
    }
    const missing = fixture(); missing.fields.splice(0, 1); expect(() => missing.anchor()).toThrow('unsupported');
    const malformed = fixture(); malformed.filters()[0].oneOfData.value!.data = new Uint8Array([0xff]); expect(() => malformed.anchor()).toThrow('unsupported');
  });
  it('bounds node count, group depth, duplicate identity and source bytes before materializing snapshots', () => {
    const f = fixture(Array.from({ length: 129 }, (_, index) => leaf(String(index)))); expect(() => f.anchor('0')).toThrow('capacity');
    const deep = fixture([group('root', [group('b', [group('c', [group('d', [leaf('e')])])])])]); expect(() => deep.anchor()).toThrow('capacity');
    const duplicate = fixture([leaf('root'), leaf('root')]); expect(() => duplicate.anchor()).toThrow('unsupported');
    const large = fixture(Array.from({ length: 9 }, (_, index) => leaf(String(index), 'x'.repeat(8000)))); expect(() => large.anchor('0')).toThrow('capacity');
  });
});
describe('Hyper filter group one-mutation native service', () => {
  it('creates AND in one insertion with exact old criterion and native IDs, then OR only by separate explicit action', async () => {
    const f = fixture(), before = clone(FilterPBSchema, f.filters()[0]);
    expect(await hyperMutateDatabaseFilterGroup(f.context, f.anchor(), f.add(), f.backend)).toBe(true);
    expect(f.writes).toHaveLength(1); expect(f.writes[0].oneOfInsertFilter).toMatchObject({ case: 'insertFilter', value: { oneOfParentFilterId: { case: 'parentFilterId', value: 'root' } } });
    expect(f.filters()[0].filterType).toBe(FilterType.And); expect(f.filters()[0].children[0].oneOfData).toEqual(before.oneOfData); expect(f.filters()[0].children[0].id).not.toBe(before.id);
    await hyperMutateDatabaseFilterGroup(f.context, f.anchor(), { kind: 'type', value: FilterType.Or }, f.backend); expect(f.writes).toHaveLength(2); expect(f.writes[1].oneOfUpdateFilterType).toMatchObject({ case: 'updateFilterType', value: { filterId: 'root', filterType: FilterType.Or } });
  });
  it('appends to an existing nested group and preserves unrelated sibling edits', async () => {
    const f = fixture([group('root', [group('nested', [leaf('child')]), leaf('sibling')])]), anchor = f.anchor('nested'); f.filters()[0].children[1].oneOfData.value!.data = textBytes('unrelated fresh edit');
    await hyperMutateDatabaseFilterGroup(f.context, anchor, f.add(), f.backend); expect(f.filters()[0].children[1].oneOfData.value!.data).toEqual(textBytes('unrelated fresh edit')); expect(f.filters()[0].children[0].children).toHaveLength(2); expect(f.writes).toHaveLength(1);
  });
  it('rejects direct Data to group conversion and confirms an already-applied operator without writing', async () => {
    const data = fixture(); await expect(hyperMutateDatabaseFilterGroup(data.context, data.anchor(), { kind: 'type', value: FilterType.Or }, data.backend)).rejects.toThrow('unsupported'); expect(data.writes).toEqual([]);
    const f = fixture([group('root', [leaf('one')])]), anchor = f.anchor(); f.filters()[0].filterType = FilterType.Or; expect(await hyperMutateDatabaseFilterGroup(f.context, anchor, { kind: 'type', value: FilterType.Or }, f.backend)).toBe(false); expect(f.writes).toEqual([]);
  });
  it('checks fresh target/source path and descendant field metadata before sending anything', async () => {
    for (const mode of ['source', 'path', 'field', 'unknown']) {
      const f = fixture([group('root', [group('nested', [leaf('deep')])])]), anchor = f.anchor('nested');
      if (mode === 'source') f.filters()[0].children[0].children[0].oneOfData.value!.data = textBytes('changed');
      if (mode === 'path') f.filters()[0].filterType = FilterType.Or;
      if (mode === 'field') f.fields[0].typeOptionData = new Uint8Array([1]);
      if (mode === 'unknown') f.filters().push(Object.assign(leaf('future'), { $unknown: [{ no: 99, wireType: 0, data: new Uint8Array([1]) }] }));
      await expect(hyperMutateDatabaseFilterGroup(f.context, anchor, f.add(), f.backend)).rejects.toThrow(); expect(f.writes).toEqual([]);
    }
  });
  it('blocks native lock, owner ABA and source changes during permission reads', async () => {
    for (const mode of ['lock', 'owner', 'source']) {
      const f = fixture(), anchor = f.anchor(); f.backend.writable = async () => {
        if (mode === 'lock') throw Error('unavailable');
        if (mode === 'owner') { useAppStore.setState({ dataDirectory: '/foreign' }); useAppStore.setState({ dataDirectory: '/filter-group-tests' }); }
        if (mode === 'source') f.filters()[0].oneOfData.value!.data = textBytes('changed during permissions');
        return create(ViewPBSchema, { layout: ViewLayoutPB.Grid });
      };
      await expect(hyperMutateDatabaseFilterGroup(f.context, anchor, f.add(), f.backend)).rejects.toThrow(); expect(f.writes).toEqual([]);
    }
  });
  it('enforces prospective depth/count/source bounds before mutation', async () => {
    const depth = fixture([group('root', [group('second', [group('third', [leaf('at-limit')])])])]); await expect(hyperMutateDatabaseFilterGroup(depth.context, depth.anchor('at-limit'), depth.add(), depth.backend)).rejects.toThrow('unsupported'); expect(depth.writes).toEqual([]);
    const count = fixture(Array.from({ length: 127 }, (_, index) => leaf(String(index)))); await expect(hyperMutateDatabaseFilterGroup(count.context, count.anchor('0'), count.add(), count.backend)).rejects.toThrow('capacity'); expect(count.writes).toEqual([]);
    const bytes = fixture(Array.from({ length: 8 }, (_, index) => leaf(String(index), 'x'.repeat(8000)))); await expect(hyperMutateDatabaseFilterGroup(bytes.context, bytes.anchor('0'), { kind: 'add', field: bytes.fields[0], bytes: textBytes('y'.repeat(3000)) }, bytes.backend)).rejects.toThrow('capacity'); expect(bytes.writes).toEqual([]);
  });
  it('retains a bounded uncertain plan after an accepted ACK failure without retrying', async () => {
    const f = fixture(), write = f.backend.write; f.backend.write = async change => { await write(change); throw Error('ACK lost'); };
    let failure: unknown; try { await hyperMutateDatabaseFilterGroup(f.context, f.anchor(), f.add(), f.backend); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(HyperFilterGroupUncertain); const details = JSON.parse((failure as HyperFilterGroupUncertain).details); expect(details.operation).toBe('add-filter-criterion'); expect(details.anchor.filter.id).toBe('root'); await Promise.resolve(); expect(f.writes).toHaveLength(1); expect(f.filters()[0].children).toHaveLength(2);
  });
  it('does not claim success from an ACK that left the target unchanged or dropped source data', async () => {
    for (const mode of ['noop', 'lost-source']) {
      const f = fixture(), write = f.backend.write; f.backend.write = async change => { if (mode === 'noop') f.writes.push(change); else { await write(change); f.filters()[0].children[0].oneOfData.value!.data = textBytes('lost source'); } };
      await expect(hyperMutateDatabaseFilterGroup(f.context, f.anchor(), f.add(), f.backend)).rejects.toBeInstanceOf(HyperFilterGroupUncertain); expect(f.writes).toHaveLength(1);
    }
  });
  it('removes one nested group and confirms exact parent/sibling preservation', async () => {
    const f = fixture([group('root', [leaf('sibling'), group('nested', [leaf('remove')])]), leaf('other-root')]); await hyperMutateDatabaseFilterGroup(f.context, f.anchor('nested'), { kind: 'delete' }, f.backend); expect(f.writes).toHaveLength(1); expect(f.filters()[0].children.map(child => child.id)).toEqual(['sibling']); expect(f.filters()[1].id).toBe('other-root');
  });
  it('blocks removal when fresh unrelated data becomes unsupported and treats deletion ACK no-op as uncertain', async () => {
    const unknown = fixture([group('root', [leaf('inside')])]), anchor = unknown.anchor(); unknown.backend.writable = async () => { unknown.filters().push(Object.assign(leaf('future'), { $unknown: [{ no: 99, wireType: 0, data: new Uint8Array([1]) }] })); return create(ViewPBSchema, { layout: ViewLayoutPB.Grid }); };
    await expect(hyperMutateDatabaseFilterGroup(unknown.context, anchor, { kind: 'delete' }, unknown.backend)).rejects.toThrow('unsupported'); expect(unknown.writes).toEqual([]);
    const noop = fixture([group('root', [leaf('inside')])]); noop.backend.write = async change => { noop.writes.push(change); }; await expect(hyperMutateDatabaseFilterGroup(noop.context, noop.anchor(), { kind: 'delete' }, noop.backend)).rejects.toBeInstanceOf(HyperFilterGroupUncertain); expect(noop.writes).toHaveLength(1);
  });
});
