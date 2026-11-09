// Generated from rust-lib/flowy-date/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type FlowyResult } from '../dispatch';
import { DateQueryPBSchema, DateResultPBSchema, type DateResultPB } from '@shared/protobuf/flowy-date/entities_pb';

export function DateEventQueryDate(payload: MessageInitShape<typeof DateQueryPBSchema>): Promise<FlowyResult<DateResultPB>> {
  return request('QueryDate', toBinary(DateQueryPBSchema, create(DateQueryPBSchema, payload)), DateResultPBSchema);
}
