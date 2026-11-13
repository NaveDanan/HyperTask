import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentOwnerKey } from '../document/HyperDocumentOwner';
import { rowDocumentIdForRow } from '../templates/converter';
export interface HyperRowDuplicateRequest { viewId: string; rowId: string; operationId: string; groupId?: string }
export function hyperRowDuplicateKey(owner: HyperDocumentOwner, viewId: string, rowId: string): string { return JSON.stringify([hyperDocumentOwnerKey(owner), viewId, rowId]); }
export function hyperRowDuplicateDocument(row: RowMetaPB): string | null {
  if (row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) return null;
  return row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
}
export function hyperRowDuplicateBinding(row: RowMetaPB): string { return JSON.stringify([row.id, row.oneOfDocumentId, row.oneOfIsDocumentEmpty]); }
