// Generated from rust-lib/hyper-date/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type HyperResult } from '../dispatch';
import { DateQueryPBSchema, DateResultPBSchema, type DateResultPB } from '@shared/protobuf/hyper-date/entities_pb';

export function DateEventQueryDate(payload: MessageInitShape<typeof DateQueryPBSchema>): Promise<HyperResult<DateResultPB>> {
  return request('QueryDate', toBinary(DateQueryPBSchema, create(DateQueryPBSchema, payload)), DateResultPBSchema);
}
