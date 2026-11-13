import { clone, create, toBinary } from '@bufbuild/protobuf';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterDataPBSchema, FilterPBSchema, FilterType, RepeatedFilterPBSchema } from '@shared/protobuf/flowy-database2/util_pb';
import { DatabaseEventGetAllFilters, DatabaseEventGetDatabase, DatabaseEventGetFields, DatabaseEventUpdateDatabaseSetting } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { hyperReadDatabaseWriteView } from './HyperDatabaseDraftBackend';
import { hyperDatabaseDraftFieldKey, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { hyperCaptureDatabaseFilterWriteScope } from './HyperDatabaseFilterWrite';
import { hyperDatabaseFilterFieldEditable } from './HyperDatabaseFilter';
import { hyperAssertDatabaseFilterGroup, hyperDatabaseFilterGroupLimits, hyperDatabaseFilterGroupTree, hyperFilterBytesEqual, hyperFilterGroupCriterionKnown, type HyperFilterGroupAnchor } from './HyperDatabaseFilterGroupModel';

export interface HyperFilterGroupContext { viewId: string; databaseId: string; owner: HyperDatabaseDraftOwner; current(): boolean }
export type HyperFilterGroupAction = { kind: 'add'; field: FieldPB; bytes: Uint8Array } | { kind: 'type'; value: FilterType.And | FilterType.Or } | { kind: 'delete' };
export class HyperFilterGroupUncertain extends Error { constructor(readonly details: string) { super('uncertain'); } }
export const hyperDatabaseFilterGroupBackend = {
  database: async (viewId: string) => unwrap(await DatabaseEventGetDatabase({ value: viewId })),
  fields: async (viewId: string) => unwrap(await DatabaseEventGetFields({ viewId })).items,
  filters: async (viewId: string) => unwrap(await DatabaseEventGetAllFilters({ value: viewId })).items,
  writable: hyperReadDatabaseWriteView,
  write: async (change: Parameters<typeof DatabaseEventUpdateDatabaseSetting>[0]) => { unwrap(await DatabaseEventUpdateDatabaseSetting(change)); },
};
export async function hyperMutateDatabaseFilterGroup(context: HyperFilterGroupContext, anchor: HyperFilterGroupAnchor, action: HyperFilterGroupAction, backend = hyperDatabaseFilterGroupBackend) {
  const scope = hyperCaptureDatabaseFilterWriteScope(context.owner, context.current);
  if (action.kind === 'type' && (anchor.source.filterType === FilterType.Data || ![FilterType.And, FilterType.Or].includes(action.value))) throw Error('unsupported');
  if (action.kind === 'delete' && anchor.source.filterType === FilterType.Data) throw Error('unsupported');
  if (action.kind === 'add' && (!hyperDatabaseFilterFieldEditable(action.field) || action.field.$unknown?.length || action.field.typeOptionData.length > hyperDatabaseFilterGroupLimits.sourceBytes || !hyperFilterGroupCriterionKnown(action.field.fieldType, action.bytes) || anchor.depth + (anchor.source.filterType === FilterType.Data ? 1 : 0) > hyperDatabaseFilterGroupLimits.depth)) throw Error('unsupported');
  const database = await scope.run(() => backend.database(context.viewId));
  const view = await scope.run(() => backend.writable(context.viewId, scope.owner));
  if (database.id !== context.databaseId || ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout)) throw Error('changed');
  const [fields, filters] = await Promise.all([scope.run(() => backend.fields(context.viewId)), scope.run(() => backend.filters(context.viewId))]);
  const tree = hyperDatabaseFilterGroupTree(filters, fields), node = hyperAssertDatabaseFilterGroup(tree, fields, anchor, action.kind === 'type' ? action.value : undefined);
  if (action.kind === 'add' && !fields.some(field => field.id === action.field.id && hyperDatabaseDraftFieldKey(field) === hyperDatabaseDraftFieldKey(action.field))) throw Error('changed');
  if (action.kind === 'type' && node.filter.filterType === action.value) return false;
  if (tree.byId.size + (action.kind === 'add' ? node.filter.filterType === FilterType.Data ? 2 : 1 : 0) > hyperDatabaseFilterGroupLimits.nodes) throw Error('capacity');
  if (action.kind === 'add' && tree.criterionBytes + action.bytes.length > hyperDatabaseFilterGroupLimits.sourceBytes) throw Error('capacity');
  const details = JSON.stringify({ operation: action.kind === 'add' ? 'add-filter-criterion' : action.kind === 'type' ? 'change-filter-group-type' : 'delete-filter-group', workspaceId: scope.owner.workspaceId, actorId: scope.owner.actorId, viewId: context.viewId, databaseId: context.databaseId, anchor: { path: anchor.path, filter: anchor.source }, action: action.kind === 'add' ? { fieldId: action.field.id, fieldType: action.field.fieldType, bytes: Array.from(action.bytes) } : action.kind === 'type' ? { filterType: action.value } : { filterId: anchor.source.id } });
  if (details.length > 512 * 1024) throw Error('capacity');
  const data = action.kind === 'add' ? { fieldId: action.field.id, fieldType: action.field.fieldType, data: action.bytes } : undefined;
  const expectedDeletion = clone(RepeatedFilterPBSchema, create(RepeatedFilterPBSchema, { items: filters }));
  const removeExpected = (items: typeof filters) => { const index = items.findIndex(filter => filter.id === anchor.source.id); if (index >= 0) { items.splice(index, 1); return; } for (const filter of items) removeExpected(filter.children); };
  if (action.kind === 'delete') removeExpected(expectedDeletion.items);
  const mutation = action.kind === 'add' ? { oneOfInsertFilter: { case: 'insertFilter' as const, value: { oneOfParentFilterId: { case: 'parentFilterId' as const, value: anchor.source.id }, data } } } : action.kind === 'type' ? { oneOfUpdateFilterType: { case: 'updateFilterType' as const, value: { filterId: anchor.source.id, filterType: action.value } } } : { oneOfDeleteFilter: { case: 'deleteFilter' as const, value: { filterId: anchor.source.id } } };
  scope.check();
  try {
    await scope.run(() => backend.write({ viewId: context.viewId, ...mutation }));
    const [afterFields, afterFilters] = await Promise.all([scope.run(() => backend.fields(context.viewId)), scope.run(() => backend.filters(context.viewId))]);
    const after = hyperDatabaseFilterGroupTree(afterFilters, afterFields), actual = after.byId.get(anchor.source.id);
    if (!after.supported || anchor.fieldKeys.some(([id, key]) => !afterFields.some(field => field.id === id && hyperDatabaseDraftFieldKey(field) === key))) throw Error('changed');
    if (action.kind === 'delete') {
      if (actual || !hyperFilterBytesEqual(toBinary(RepeatedFilterPBSchema, expectedDeletion), toBinary(RepeatedFilterPBSchema, create(RepeatedFilterPBSchema, { items: afterFilters })))) throw Error('changed');
      return true;
    }
    if (!actual || actual.path !== anchor.path) throw Error('changed');
    if (action.kind === 'type') {
      const expected = clone(FilterPBSchema, node.filter); expected.filterType = action.value;
      if (!hyperFilterBytesEqual(toBinary(FilterPBSchema, expected), toBinary(FilterPBSchema, actual.filter))) throw Error('changed');
    } else {
      const previous = node.filter, current = actual.filter, old = previous.filterType === FilterType.Data ? [previous] : previous.children;
      if (current.filterType !== (previous.filterType === FilterType.Data ? FilterType.And : previous.filterType) || current.children.length !== old.length + 1) throw Error('changed');
      for (let i = 0; i < old.length; i++) {
        const expected = clone(FilterPBSchema, old[i]); if (previous.filterType === FilterType.Data) expected.id = current.children[i].id;
        if (!hyperFilterBytesEqual(toBinary(FilterPBSchema, expected), toBinary(FilterPBSchema, current.children[i]))) throw Error('changed');
      }
      const appended = current.children.at(-1)!;
      if (appended.filterType !== FilterType.Data || appended.children.length || appended.oneOfData.case !== 'data' || !hyperFilterBytesEqual(toBinary(FilterDataPBSchema, appended.oneOfData.value), toBinary(FilterDataPBSchema, create(FilterDataPBSchema, data!))) || !afterFields.some(field => field.id === action.field.id && hyperDatabaseDraftFieldKey(field) === hyperDatabaseDraftFieldKey(action.field))) throw Error('changed');
    }
    return true;
  } catch { throw new HyperFilterGroupUncertain(details); }
}
