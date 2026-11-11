import { toBinary } from '@bufbuild/protobuf';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { DatabaseEventGetAllFilters, DatabaseEventGetDatabase, DatabaseEventGetFields, DatabaseEventUpdateDatabaseSetting } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { hyperDatabaseDraftFieldKey, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { hyperReadDatabaseWriteView } from './HyperDatabaseDraftBackend';
import { hyperDecodeDatabaseDateFilter } from './HyperDatabaseDateFilterBinding';
import { hyperDatabaseFilterFieldEditable, hyperDatabaseFilterValidate, hyperDecodeDatabaseFilter } from './HyperDatabaseFilter';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
const same = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((value, index) => value === right[index]);
export function hyperCaptureDatabaseFilterWriteScope(owner: HyperDatabaseDraftOwner, current: () => boolean) {
  const captured = hyperCaptureDuplicateOwner(owner);
  const check = () => { if (!captured?.isCurrent() || !current()) throw Error('changed'); };
  check();
  const run = async <T,>(operation: () => Promise<T>): Promise<T> => {
    check();
    try { const result = await operation(); check(); return result; }
    catch (error) { check(); throw error; }
  };
  return { owner: captured!, check, run };
}
export function hyperDatabaseFindFilters(filters: readonly FilterPB[]): FilterPB[] {
  const found: FilterPB[] = [], stack = [...filters].reverse();
  while (stack.length) {
    const filter = stack.pop()!;
    if (filter.oneOfData.case === 'data' && filter.filterType === FilterType.Data && !filter.children.length) found.push(filter);
    for (let index = filter.children.length - 1; index >= 0; index--) stack.push(filter.children[index]);
  }
  return found;
}
export function hyperDatabaseFindFilterGroups(filters: readonly FilterPB[]): FilterPB[] {
  const groups: FilterPB[] = [], stack = [...filters].reverse();
  while (stack.length) { const filter = stack.pop()!; if (filter.filterType !== FilterType.Data || filter.children.length) groups.push(filter); for (let index = filter.children.length - 1; index >= 0; index--) stack.push(filter.children[index]); }
  return groups;
}
export async function hyperDeleteDatabaseFilterGroup(viewId: string, databaseId: string, source: FilterPB, owner: HyperDatabaseDraftOwner, current: () => boolean) {
  const scope = hyperCaptureDatabaseFilterWriteScope(owner, current);
  const [database, filters] = await Promise.all([scope.run(() => DatabaseEventGetDatabase({ value: viewId })), scope.run(() => DatabaseEventGetAllFilters({ value: viewId })), scope.run(() => hyperReadDatabaseWriteView(viewId, scope.owner))]);
  scope.check();
  const latest = hyperDatabaseFindFilterGroups(unwrap(filters).items).find(filter => filter.id === source.id);
  if (unwrap(database).id !== databaseId || !latest || !same(toBinary(FilterPBSchema, latest), toBinary(FilterPBSchema, source))) throw Error('changed');
  unwrap(await scope.run(() => DatabaseEventUpdateDatabaseSetting({ viewId, oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId: source.id } } })));
}
export async function hyperWriteDatabaseFilter(viewId: string, databaseId: string, field: FieldPB, source: FilterPB | null, next: Uint8Array | null, owner: HyperDatabaseDraftOwner, current: () => boolean) {
  if (!source && !next || next && source?.oneOfData.case === 'data' && same(source.oneOfData.value.data, next)) return false;
  if (source && (source.filterType !== FilterType.Data || source.children.length || source.oneOfData.case !== 'data' || source.oneOfData.value.fieldId !== field.id || next && source.oneOfData.value.fieldType !== field.fieldType)) throw Error('changed');
  const decode = (bytes: Uint8Array) => field.fieldType === FieldType.DateTime ? hyperDecodeDatabaseDateFilter(bytes) : hyperDecodeDatabaseFilter(field.fieldType, bytes);
  if (next) {
    if (!decode(next).editable || source?.$unknown?.length || source?.oneOfData.value?.$unknown?.length || source?.oneOfData.case === 'data' && !decode(source.oneOfData.value.data).editable) throw Error('unsupported');
    if (field.fieldType !== FieldType.DateTime) { if (!hyperDatabaseFilterFieldEditable(field)) throw Error('unsupported'); hyperDatabaseFilterValidate(field.fieldType, hyperDecodeDatabaseFilter(field.fieldType, next).value); }
  }
  const scope = hyperCaptureDatabaseFilterWriteScope(owner, current);
  const [database, fields, filters] = await Promise.all([scope.run(() => DatabaseEventGetDatabase({ value: viewId })), scope.run(() => DatabaseEventGetFields({ viewId })), scope.run(() => DatabaseEventGetAllFilters({ value: viewId })), scope.run(() => hyperReadDatabaseWriteView(viewId, scope.owner))]);
  scope.check();
  const latest = unwrap(fields).items.find(item => item.id === field.id);
  if (unwrap(database).id !== databaseId || !latest || latest.fieldType !== field.fieldType || hyperDatabaseDraftFieldKey(latest) !== hyperDatabaseDraftFieldKey(field)) throw Error('changed');
  if (source) {
    const latest = hyperDatabaseFindFilters(unwrap(filters).items).find(filter => filter.id === source.id);
    if (!latest || !same(toBinary(FilterPBSchema, latest), toBinary(FilterPBSchema, source))) throw Error('changed');
  }
  scope.check();
  if (!next) unwrap(await scope.run(() => DatabaseEventUpdateDatabaseSetting({ viewId, oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId: source!.id } } })));
  else {
    const data = { fieldId: field.id, fieldType: field.fieldType, data: next };
    unwrap(await scope.run(() => DatabaseEventUpdateDatabaseSetting({ viewId, ...(source ? { oneOfUpdateFilterData: { case: 'updateFilterData' as const, value: { filterId: source.id, data } } } : { oneOfInsertFilter: { case: 'insertFilter' as const, value: { data } } }) })));
  }
  return true;
}
