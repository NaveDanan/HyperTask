import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import type { HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { hyperDatabaseFindFilters, hyperWriteDatabaseFilter } from './HyperDatabaseFilterWrite';
export function hyperDatabaseFindDateFilters(filters: readonly FilterPB[]): FilterPB[] {
  return hyperDatabaseFindFilters(filters).filter(filter => filter.oneOfData.value?.fieldType === FieldType.DateTime);
}
export function hyperWriteDatabaseDateFilter(viewId: string, databaseId: string, field: FieldPB, source: FilterPB | null, next: Uint8Array | null, owner: HyperDatabaseDraftOwner, current: () => boolean) {
  if (field.fieldType !== FieldType.DateTime) return Promise.reject(Error('changed'));
  return hyperWriteDatabaseFilter(viewId, databaseId, field, source, next, owner, current);
}
