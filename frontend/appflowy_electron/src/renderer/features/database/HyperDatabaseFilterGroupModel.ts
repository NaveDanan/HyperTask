import { clone, toBinary } from '@bufbuild/protobuf';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FilterPBSchema, FilterType, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { hyperDatabaseDraftFieldKey } from './HyperDatabaseDraft';
import { hyperDatabaseFilterFieldEditable, hyperDecodeDatabaseFilter } from './HyperDatabaseFilter';
import { hyperDecodeDatabaseDateFilter } from './HyperDatabaseDateFilterBinding';

export const hyperDatabaseFilterGroupLimits = { nodes: 128, depth: 3, criterionBytes: 8192, sourceBytes: 64 * 1024 } as const;
export const hyperFilterBytesEqual = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => right[index] === byte);
export interface HyperFilterGroupNode { filter: FilterPB; path: string; depth: number; supported: boolean; children: HyperFilterGroupNode[] }
export interface HyperFilterGroupTree { roots: HyperFilterGroupNode[]; byId: Map<string, HyperFilterGroupNode>; supported: boolean; criterionBytes: number }
export interface HyperFilterGroupAnchor { source: FilterPB; path: string; depth: number; fieldKeys: [string, string][] }
export function hyperFilterGroupCriterionKnown(type: FieldType, bytes: Uint8Array) {
  try { return bytes.length <= hyperDatabaseFilterGroupLimits.criterionBytes && (type === FieldType.DateTime ? hyperDecodeDatabaseDateFilter(bytes) : hyperDecodeDatabaseFilter(type, bytes)).editable; } catch { return false; }
}
export function hyperDatabaseFilterGroupTree(filters: readonly FilterPB[], fields: readonly FieldPB[]): HyperFilterGroupTree {
  const byId = new Map<string, HyperFilterGroupNode>(), seen = new Set<FilterPB>(), fieldMap = new Map(fields.map(field => [field.id, field])); let count = 0, bytes = 0;
  const visit = (filter: FilterPB, ancestors: [string, FilterType][], depth: number): HyperFilterGroupNode => {
    if (++count > hyperDatabaseFilterGroupLimits.nodes || depth > hyperDatabaseFilterGroupLimits.depth) throw Error('capacity');
    if (seen.has(filter) || byId.has(filter.id) || !filter.id || filter.id.length > 128) throw Error('unsupported');
    seen.add(filter);
    const data = filter.oneOfData, leaf = filter.filterType === FilterType.Data;
    if (data.case === 'data') bytes += data.value.data.length;
    if (bytes > hyperDatabaseFilterGroupLimits.sourceBytes) throw Error('capacity');
    let supported = !filter.$unknown?.length;
    if (leaf) {
      const field = data.case === 'data' && fieldMap.get(data.value.fieldId);
      supported = supported && filter.children.length === 0 && !!field && !field.$unknown?.length && field.typeOptionData.length <= hyperDatabaseFilterGroupLimits.sourceBytes && !data.value?.$unknown?.length && data.value?.fieldType === field.fieldType && (field.fieldType === FieldType.DateTime || hyperDatabaseFilterFieldEditable(field)) && hyperFilterGroupCriterionKnown(field.fieldType, data.value.data);
    } else supported = supported && [FilterType.And, FilterType.Or].includes(filter.filterType) && data.case === undefined;
    const node: HyperFilterGroupNode = { filter, path: JSON.stringify(ancestors), depth, supported, children: [] }; byId.set(filter.id, node);
    node.children = filter.children.map(child => visit(child, [...ancestors, [filter.id, filter.filterType]], depth + (child.filterType === FilterType.Data ? 0 : 1)));
    node.supported = node.supported && node.children.every(child => child.supported);
    return node;
  };
  const roots = filters.map(filter => visit(filter, [], filter.filterType === FilterType.Data ? 0 : 1));
  return { roots, byId, supported: roots.every(root => root.supported), criterionBytes: bytes };
}
export function hyperCaptureDatabaseFilterGroup(tree: HyperFilterGroupTree, fields: readonly FieldPB[], id: string): HyperFilterGroupAnchor {
  const node = tree.byId.get(id); if (!tree.supported || !node?.supported) throw Error('unsupported');
  const fieldIds = new Set<string>();
  const visit = (value: HyperFilterGroupNode) => { if (value.filter.oneOfData.case === 'data') fieldIds.add(value.filter.oneOfData.value.fieldId); value.children.forEach(visit); }; visit(node);
  const fieldKeys: [string, string][] = fields.filter(field => fieldIds.has(field.id)).map(field => [field.id, hyperDatabaseDraftFieldKey(field)]);
  return { source: clone(FilterPBSchema, node.filter), path: node.path, depth: node.depth, fieldKeys };
}
export function hyperAssertDatabaseFilterGroup(tree: HyperFilterGroupTree, fields: readonly FieldPB[], anchor: HyperFilterGroupAnchor, desiredType?: FilterType) {
  const node = tree.byId.get(anchor.source.id); if (!tree.supported) throw Error('unsupported'); if (!node) throw Error('changed'); if (!node.supported) throw Error('unsupported');
  if (node.path !== anchor.path || anchor.fieldKeys.some(([id, key]) => !fields.some(field => field.id === id && hyperDatabaseDraftFieldKey(field) === key))) throw Error('changed');
  const expected = clone(FilterPBSchema, anchor.source);
  if (desiredType !== undefined && node.filter.filterType === desiredType && expected.filterType !== FilterType.Data) expected.filterType = desiredType;
  if (!hyperFilterBytesEqual(toBinary(FilterPBSchema, expected), toBinary(FilterPBSchema, node.filter))) throw Error('changed');
  return node;
}
