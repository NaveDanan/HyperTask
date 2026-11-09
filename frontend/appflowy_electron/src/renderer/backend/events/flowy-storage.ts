// Generated from rust-lib/flowy-storage/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type FlowyResult } from '../dispatch';
import { FileStatePBSchema, QueryFilePBSchema, RegisterStreamPBSchema, type FileStatePB } from '@shared/protobuf/flowy-storage/entities_pb';

export function FileStorageEventRegisterStream(payload: MessageInitShape<typeof RegisterStreamPBSchema>): Promise<FlowyResult<void>> {
  return request('RegisterStream', toBinary(RegisterStreamPBSchema, create(RegisterStreamPBSchema, payload)));
}

export function FileStorageEventQueryFile(payload: MessageInitShape<typeof QueryFilePBSchema>): Promise<FlowyResult<FileStatePB>> {
  return request('QueryFile', toBinary(QueryFilePBSchema, create(QueryFilePBSchema, payload)), FileStatePBSchema);
}
