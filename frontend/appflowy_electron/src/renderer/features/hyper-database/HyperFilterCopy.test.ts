import { expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { copyHyperFilters } from './HyperFilterCopy';
import { hyperDatabaseBackend } from './HyperDatabaseBackend';
import { FilterPBSchema, RepeatedFilterPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
it('duplicates nested filter trees with fresh IDs and preserves AND/OR criteria', async () => {
  const target: FilterPB[] = []; let nextId = 0;
  const find = (id: string, nodes = target): FilterPB | undefined => {
    for (const node of nodes) { if (node.id === id) return node; const hit = find(id, node.children); if (hit) return hit; }
  };
  const backend = { ...hyperDatabaseBackend,
    DatabaseEventGetAllFilters: vi.fn(async () => ({ ok: true as const, value: create(RepeatedFilterPBSchema, { items: target }) })),
    DatabaseEventUpdateDatabaseSetting: vi.fn(async (payload: Parameters<typeof hyperDatabaseBackend.DatabaseEventUpdateDatabaseSetting>[0]) => {
      if (payload.oneOfInsertFilter?.case === 'insertFilter') {
        const { data, oneOfParentFilterId } = payload.oneOfInsertFilter.value;
        const filter = create(FilterPBSchema, { id: `new-${++nextId}`, oneOfData: { case: 'data', value: data! } });
        if (oneOfParentFilterId?.case === 'parentFilterId') find(oneOfParentFilterId.value)!.children.push(filter); else target.push(filter);
      }
      if (payload.oneOfUpdateFilterType?.case === 'updateFilterType') {
        const { filterId, filterType } = payload.oneOfUpdateFilterType.value; const filter = find(filterId!)!;
        filter.filterType = filterType!; filter.oneOfData = { case: undefined };
      }
      return { ok: true as const, value: undefined };
    }),
  };
  const leaf = (id: string, fieldId: string) => create(FilterPBSchema, { id, oneOfData: { case: 'data', value: { fieldId, data: new Uint8Array([1]) } } });
  const source = create(FilterPBSchema, { id: 'old-root', filterType: FilterType.Or, children: [leaf('old-a', 'status'), { id: 'old-and', filterType: FilterType.And, children: [leaf('old-b', 'priority'), leaf('old-c', 'owner')] }] });
  await copyHyperFilters(backend, 'v', [source]);
  expect(target[0].id).toBe('new-1'); expect(target[0].filterType).toBe(FilterType.Or);
  expect(target[0].children[0].oneOfData.value?.fieldId).toBe('status');
  expect(target[0].children[1].filterType).toBe(FilterType.And);
  expect(target[0].children[1].children.map(child => child.oneOfData.value?.fieldId)).toEqual(['priority', 'owner']);
  expect(source.id).toBe('old-root');
});
