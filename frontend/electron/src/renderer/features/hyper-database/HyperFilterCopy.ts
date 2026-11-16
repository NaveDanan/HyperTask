import { unwrap } from '@/backend/dispatch';
import { FilterType, type FilterPB, type FilterDataPB } from '@shared/protobuf/hyper-database2/util_pb';
import type { HyperDatabaseBackend } from './HyperDatabaseBackend';
/** Copy a filter tree with fresh core-assigned IDs. No assumptions about notification timing. */
export async function copyHyperFilters(backend: HyperDatabaseBackend, viewId: string, filters: FilterPB[]) {
  const all = async () => unwrap(await backend.DatabaseEventGetAllFilters({ value: viewId })).items;
  const find = (nodes: FilterPB[], id: string): FilterPB | undefined => {
    for (const node of nodes) { if (node.id === id) return node; const nested = find(node.children, id); if (nested) return nested; }
  };
  const data = (node: FilterPB): FilterDataPB | undefined => node.oneOfData.value ?? node.children.map(data).find(value => value !== undefined);
  const copy = async (node: FilterPB, parentId?: string) => {
    // Empty groups have no effect and contain no criteria to copy.
    const criterion = data(node); if (!criterion) return;
    const before = await all(); const siblings = parentId ? find(before, parentId)?.children ?? [] : before;
    const known = new Set(siblings.map(f => f.id));
    unwrap(await backend.DatabaseEventUpdateDatabaseSetting({ viewId, oneOfInsertFilter: { case: 'insertFilter', value: { data: criterion, ...(parentId ? { oneOfParentFilterId: { case: 'parentFilterId', value: parentId } as const } : {}) } } }));
    const after = await all(); const inserted = (parentId ? find(after, parentId)?.children ?? [] : after).find(f => !known.has(f.id));
    if (!inserted) throw new Error('The core did not return the duplicated filter');
    if (node.filterType !== FilterType.Data) {
      unwrap(await backend.DatabaseEventUpdateDatabaseSetting({ viewId, oneOfUpdateFilterType: { case: 'updateFilterType', value: { filterId: inserted.id, filterType: node.filterType } } }));
      for (const child of node.children) await copy(child, inserted.id);
    }
  };
  for (const node of filters) await copy(node);
}
