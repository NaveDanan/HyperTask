// Generated from rust-lib/flowy-search/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type FlowyResult } from '../dispatch';
import { SearchQueryPBSchema } from '@shared/protobuf/flowy-search/query_pb';

export function SearchEventStreamSearch(payload: MessageInitShape<typeof SearchQueryPBSchema>): Promise<FlowyResult<void>> {
  return request('StreamSearch', toBinary(SearchQueryPBSchema, create(SearchQueryPBSchema, payload)));
}
