// Generated from rust-lib/hyper-search/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { request, type HyperResult } from '../dispatch';
import { SearchQueryPBSchema } from '@shared/protobuf/hyper-search/query_pb';

export function SearchEventStreamSearch(payload: MessageInitShape<typeof SearchQueryPBSchema>): Promise<HyperResult<void>> {
  return request('StreamSearch', toBinary(SearchQueryPBSchema, create(SearchQueryPBSchema, payload)));
}
