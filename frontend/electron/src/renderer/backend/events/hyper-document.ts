// Generated from rust-lib/hyper-document/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type HyperResult } from '../dispatch';
import { ApplyActionPayloadPBSchema, CloseDocumentPayloadPBSchema, ConvertDataPayloadPBSchema, CreateDocumentPayloadPBSchema, DeleteFilePBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, DocumentRedoUndoResponsePBSchema, DocumentSnapshotMetaPBSchema, DocumentSnapshotPBSchema, DocumentTextPBSchema, DownloadFilePBSchema, EncodedCollabPBSchema, OpenDocumentPayloadPBSchema, RepeatedDocumentSnapshotMetaPBSchema, TextDeltaPayloadPBSchema, UpdateDocumentAwarenessStatePBSchema, UploadFileParamsPBSchema, UploadedFilePBSchema, type DocumentDataPB, type DocumentRedoUndoResponsePB, type DocumentSnapshotPB, type DocumentTextPB, type EncodedCollabPB, type RepeatedDocumentSnapshotMetaPB, type UploadedFilePB } from '@shared/protobuf/hyper-document/entities_pb';
import { ConvertDataToJsonPayloadPBSchema, ConvertDataToJsonResponsePBSchema, ConvertDocumentPayloadPBSchema, ConvertDocumentResponsePBSchema, type ConvertDataToJsonResponsePB, type ConvertDocumentResponsePB } from '@shared/protobuf/hyper-document/parser_entities_pb';

export function DocumentEventCreateDocument(payload: MessageInitShape<typeof CreateDocumentPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('CreateDocument', toBinary(CreateDocumentPayloadPBSchema, create(CreateDocumentPayloadPBSchema, payload)));
}

export function DocumentEventOpenDocument(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<HyperResult<DocumentDataPB>> {
  return request('OpenDocument', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), DocumentDataPBSchema);
}

export function DocumentEventCloseDocument(payload: MessageInitShape<typeof CloseDocumentPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('CloseDocument', toBinary(CloseDocumentPayloadPBSchema, create(CloseDocumentPayloadPBSchema, payload)));
}

export function DocumentEventApplyAction(payload: MessageInitShape<typeof ApplyActionPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('ApplyAction', toBinary(ApplyActionPayloadPBSchema, create(ApplyActionPayloadPBSchema, payload)));
}

export function DocumentEventGetDocumentData(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<HyperResult<DocumentDataPB>> {
  return request('GetDocumentData', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), DocumentDataPBSchema);
}

export function DocumentEventConvertDataToDocument(payload: MessageInitShape<typeof ConvertDataPayloadPBSchema>): Promise<HyperResult<DocumentDataPB>> {
  return request('ConvertDataToDocument', toBinary(ConvertDataPayloadPBSchema, create(ConvertDataPayloadPBSchema, payload)), DocumentDataPBSchema);
}

export function DocumentEventRedo(payload: MessageInitShape<typeof DocumentRedoUndoPayloadPBSchema>): Promise<HyperResult<DocumentRedoUndoResponsePB>> {
  return request('Redo', toBinary(DocumentRedoUndoPayloadPBSchema, create(DocumentRedoUndoPayloadPBSchema, payload)), DocumentRedoUndoResponsePBSchema);
}

export function DocumentEventUndo(payload: MessageInitShape<typeof DocumentRedoUndoPayloadPBSchema>): Promise<HyperResult<DocumentRedoUndoResponsePB>> {
  return request('Undo', toBinary(DocumentRedoUndoPayloadPBSchema, create(DocumentRedoUndoPayloadPBSchema, payload)), DocumentRedoUndoResponsePBSchema);
}

export function DocumentEventCanUndoRedo(payload: MessageInitShape<typeof DocumentRedoUndoPayloadPBSchema>): Promise<HyperResult<DocumentRedoUndoResponsePB>> {
  return request('CanUndoRedo', toBinary(DocumentRedoUndoPayloadPBSchema, create(DocumentRedoUndoPayloadPBSchema, payload)), DocumentRedoUndoResponsePBSchema);
}

export function DocumentEventGetDocumentSnapshotMeta(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<HyperResult<RepeatedDocumentSnapshotMetaPB>> {
  return request('GetDocumentSnapshotMeta', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), RepeatedDocumentSnapshotMetaPBSchema);
}

export function DocumentEventCreateText(payload: MessageInitShape<typeof TextDeltaPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('CreateText', toBinary(TextDeltaPayloadPBSchema, create(TextDeltaPayloadPBSchema, payload)));
}

export function DocumentEventApplyTextDeltaEvent(payload: MessageInitShape<typeof TextDeltaPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('ApplyTextDeltaEvent', toBinary(TextDeltaPayloadPBSchema, create(TextDeltaPayloadPBSchema, payload)));
}

export function DocumentEventConvertDocument(payload: MessageInitShape<typeof ConvertDocumentPayloadPBSchema>): Promise<HyperResult<ConvertDocumentResponsePB>> {
  return request('ConvertDocument', toBinary(ConvertDocumentPayloadPBSchema, create(ConvertDocumentPayloadPBSchema, payload)), ConvertDocumentResponsePBSchema);
}

export function DocumentEventConvertDataToJSON(payload: MessageInitShape<typeof ConvertDataToJsonPayloadPBSchema>): Promise<HyperResult<ConvertDataToJsonResponsePB>> {
  return request('ConvertDataToJSON', toBinary(ConvertDataToJsonPayloadPBSchema, create(ConvertDataToJsonPayloadPBSchema, payload)), ConvertDataToJsonResponsePBSchema);
}

export function DocumentEventGetDocumentSnapshot(payload: MessageInitShape<typeof DocumentSnapshotMetaPBSchema>): Promise<HyperResult<DocumentSnapshotPB>> {
  return request('GetDocumentSnapshot', toBinary(DocumentSnapshotMetaPBSchema, create(DocumentSnapshotMetaPBSchema, payload)), DocumentSnapshotPBSchema);
}

export function DocumentEventUploadFile(payload: MessageInitShape<typeof UploadFileParamsPBSchema>): Promise<HyperResult<UploadedFilePB>> {
  return request('UploadFile', toBinary(UploadFileParamsPBSchema, create(UploadFileParamsPBSchema, payload)), UploadedFilePBSchema);
}

export function DocumentEventDownloadFile(payload: MessageInitShape<typeof DownloadFilePBSchema>): Promise<HyperResult<void>> {
  return request('DownloadFile', toBinary(DownloadFilePBSchema, create(DownloadFilePBSchema, payload)));
}

export function DocumentEventDeleteFile(payload: MessageInitShape<typeof DeleteFilePBSchema>): Promise<HyperResult<void>> {
  return request('DeleteFile', toBinary(DeleteFilePBSchema, create(DeleteFilePBSchema, payload)));
}

export function DocumentEventSetAwarenessState(payload: MessageInitShape<typeof UpdateDocumentAwarenessStatePBSchema>): Promise<HyperResult<void>> {
  return request('SetAwarenessState', toBinary(UpdateDocumentAwarenessStatePBSchema, create(UpdateDocumentAwarenessStatePBSchema, payload)));
}

export function DocumentEventGetDocEncodedCollab(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<HyperResult<EncodedCollabPB>> {
  return request('GetDocEncodedCollab', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), EncodedCollabPBSchema);
}

export function DocumentEventGetDocumentText(payload: MessageInitShape<typeof OpenDocumentPayloadPBSchema>): Promise<HyperResult<DocumentTextPB>> {
  return request('GetDocumentText', toBinary(OpenDocumentPayloadPBSchema, create(OpenDocumentPayloadPBSchema, payload)), DocumentTextPBSchema);
}
