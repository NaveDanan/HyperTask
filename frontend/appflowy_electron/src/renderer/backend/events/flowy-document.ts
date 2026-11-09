// Generated from rust-lib/flowy-document/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type FlowyResult } from '../dispatch';
import { ApplyActionPayloadPBSchema, CloseDocumentPayloadPBSchema, ConvertDataPayloadPBSchema, CreateDocumentPayloadPBSchema, DeleteFilePBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, DocumentRedoUndoResponsePBSchema, DocumentSnapshotMetaPBSchema, DocumentSnapshotPBSchema, DocumentTextPBSchema, DownloadFilePBSchema, EncodedCollabPBSchema, OpenDocumentPayloadPBSchema, RepeatedDocumentSnapshotMetaPBSchema, TextDeltaPayloadPBSchema, UpdateDocumentAwarenessStatePBSchema, UploadFileParamsPBSchema, UploadedFilePBSchema, type DocumentDataPB, type DocumentRedoUndoResponsePB, type DocumentSnapshotPB, type DocumentTextPB, type EncodedCollabPB, type RepeatedDocumentSnapshotMetaPB, type UploadedFilePB } from '@shared/protobuf/flowy-document/entities_pb';
import { ConvertDataToJsonPayloadPBSchema, ConvertDataToJsonResponsePBSchema, ConvertDocumentPayloadPBSchema, ConvertDocumentResponsePBSchema, type ConvertDataToJsonResponsePB, type ConvertDocumentResponsePB } from '@shared/protobuf/flowy-document/parser_entities_pb';

export function DocumentEventCreateDocument(payload: MessageInitShape<typeof CreateDocumentPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('CreateDocument', toBinary(CreateDocumentPayloadPBSchema, create(CreateDocumentPayloadPBSchema, payload)));
}

export function DocumentEventOpenDocument(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<FlowyResult<DocumentDataPB>> {
  return request('OpenDocument', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), DocumentDataPBSchema);
}

export function DocumentEventCloseDocument(payload: MessageInitShape<typeof CloseDocumentPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('CloseDocument', toBinary(CloseDocumentPayloadPBSchema, create(CloseDocumentPayloadPBSchema, payload)));
}

export function DocumentEventApplyAction(payload: MessageInitShape<typeof ApplyActionPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('ApplyAction', toBinary(ApplyActionPayloadPBSchema, create(ApplyActionPayloadPBSchema, payload)));
}

export function DocumentEventGetDocumentData(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<FlowyResult<DocumentDataPB>> {
  return request('GetDocumentData', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), DocumentDataPBSchema);
}

export function DocumentEventConvertDataToDocument(payload: MessageInitShape<typeof ConvertDataPayloadPBSchema>): Promise<FlowyResult<DocumentDataPB>> {
  return request('ConvertDataToDocument', toBinary(ConvertDataPayloadPBSchema, create(ConvertDataPayloadPBSchema, payload)), DocumentDataPBSchema);
}

export function DocumentEventRedo(payload: MessageInitShape<typeof DocumentRedoUndoPayloadPBSchema>): Promise<FlowyResult<DocumentRedoUndoResponsePB>> {
  return request('Redo', toBinary(DocumentRedoUndoPayloadPBSchema, create(DocumentRedoUndoPayloadPBSchema, payload)), DocumentRedoUndoResponsePBSchema);
}

export function DocumentEventUndo(payload: MessageInitShape<typeof DocumentRedoUndoPayloadPBSchema>): Promise<FlowyResult<DocumentRedoUndoResponsePB>> {
  return request('Undo', toBinary(DocumentRedoUndoPayloadPBSchema, create(DocumentRedoUndoPayloadPBSchema, payload)), DocumentRedoUndoResponsePBSchema);
}

export function DocumentEventCanUndoRedo(payload: MessageInitShape<typeof DocumentRedoUndoPayloadPBSchema>): Promise<FlowyResult<DocumentRedoUndoResponsePB>> {
  return request('CanUndoRedo', toBinary(DocumentRedoUndoPayloadPBSchema, create(DocumentRedoUndoPayloadPBSchema, payload)), DocumentRedoUndoResponsePBSchema);
}

export function DocumentEventGetDocumentSnapshotMeta(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<FlowyResult<RepeatedDocumentSnapshotMetaPB>> {
  return request('GetDocumentSnapshotMeta', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), RepeatedDocumentSnapshotMetaPBSchema);
}

export function DocumentEventCreateText(payload: MessageInitShape<typeof TextDeltaPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('CreateText', toBinary(TextDeltaPayloadPBSchema, create(TextDeltaPayloadPBSchema, payload)));
}

export function DocumentEventApplyTextDeltaEvent(payload: MessageInitShape<typeof TextDeltaPayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('ApplyTextDeltaEvent', toBinary(TextDeltaPayloadPBSchema, create(TextDeltaPayloadPBSchema, payload)));
}

export function DocumentEventConvertDocument(payload: MessageInitShape<typeof ConvertDocumentPayloadPBSchema>): Promise<FlowyResult<ConvertDocumentResponsePB>> {
  return request('ConvertDocument', toBinary(ConvertDocumentPayloadPBSchema, create(ConvertDocumentPayloadPBSchema, payload)), ConvertDocumentResponsePBSchema);
}

export function DocumentEventConvertDataToJSON(payload: MessageInitShape<typeof ConvertDataToJsonPayloadPBSchema>): Promise<FlowyResult<ConvertDataToJsonResponsePB>> {
  return request('ConvertDataToJSON', toBinary(ConvertDataToJsonPayloadPBSchema, create(ConvertDataToJsonPayloadPBSchema, payload)), ConvertDataToJsonResponsePBSchema);
}

export function DocumentEventGetDocumentSnapshot(payload: MessageInitShape<typeof DocumentSnapshotMetaPBSchema>): Promise<FlowyResult<DocumentSnapshotPB>> {
  return request('GetDocumentSnapshot', toBinary(DocumentSnapshotMetaPBSchema, create(DocumentSnapshotMetaPBSchema, payload)), DocumentSnapshotPBSchema);
}

export function DocumentEventUploadFile(payload: MessageInitShape<typeof UploadFileParamsPBSchema>): Promise<FlowyResult<UploadedFilePB>> {
  return request('UploadFile', toBinary(UploadFileParamsPBSchema, create(UploadFileParamsPBSchema, payload)), UploadedFilePBSchema);
}

export function DocumentEventDownloadFile(payload: MessageInitShape<typeof DownloadFilePBSchema>): Promise<FlowyResult<void>> {
  return request('DownloadFile', toBinary(DownloadFilePBSchema, create(DownloadFilePBSchema, payload)));
}

export function DocumentEventDeleteFile(payload: MessageInitShape<typeof DeleteFilePBSchema>): Promise<FlowyResult<void>> {
  return request('DeleteFile', toBinary(DeleteFilePBSchema, create(DeleteFilePBSchema, payload)));
}

export function DocumentEventSetAwarenessState(payload: MessageInitShape<typeof UpdateDocumentAwarenessStatePBSchema>): Promise<FlowyResult<void>> {
  return request('SetAwarenessState', toBinary(UpdateDocumentAwarenessStatePBSchema, create(UpdateDocumentAwarenessStatePBSchema, payload)));
}

export function DocumentEventGetDocEncodedCollab(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<FlowyResult<EncodedCollabPB>> {
  return request('GetDocEncodedCollab', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), EncodedCollabPBSchema);
}

export function DocumentEventGetDocumentText(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<FlowyResult<DocumentTextPB>> {
  return request('GetDocumentText', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), DocumentTextPBSchema);
}
