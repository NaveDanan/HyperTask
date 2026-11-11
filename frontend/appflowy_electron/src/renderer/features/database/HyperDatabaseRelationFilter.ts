import { fromBinary } from '@bufbuild/protobuf';
import { RelationFilterPBSchema } from '@shared/protobuf/flowy-database2/relation_filter_pb';

/** Relation conditions use signed int64 on the wire. Only the two known choices become UI numbers. */
export function hyperDecodeDatabaseRelationFilter(bytes: Uint8Array) {
  const data = fromBinary(RelationFilterPBSchema, bytes);
  const known = data.condition === 0n || data.condition === 1n;
  return { condition: data.condition, choice: known ? Number(data.condition) : -1, editable: known && !data.$unknown?.length };
}
