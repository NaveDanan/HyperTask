// Generated from rust-lib/hyper-storage/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type HyperResult } from '../dispatch';
import { FileStatePBSchema, QueryFilePBSchema, RegisterStreamPBSchema, type FileStatePB } from '@shared/protobuf/hyper-storage/entities_pb';

export function FileStorageEventRegisterStream(payload: MessageInitShape<typeof RegisterStreamPBSchema>): Promise<HyperResult<void>> {
  return request('RegisterStream', toBinary(RegisterStreamPBSchema, create(RegisterStreamPBSchema, payload)));
}

export function FileStorageEventQueryFile(payload: MessageInitShape<typeof QueryFilePBSchema>): Promise<HyperResult<FileStatePB>> {
  return request('QueryFile', toBinary(QueryFilePBSchema, create(QueryFilePBSchema, payload)), FileStatePBSchema);
}
