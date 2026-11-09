// CommandPaletteBloc (workspace/application/command_palette/command_palette_bloc.dart) and
// SearchBackendService / SearchResponseStream (search_service.dart).
import { fromBinary } from '@bufbuild/protobuf';
import { create } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { SearchStatePBSchema, type SearchStatePB } from '@shared/protobuf/flowy-search/notification_pb';
import {
  type LocalSearchResponseItemPB,
  type ResultIconPB,
  type SearchResponseItemPB,
  type SearchSummaryPB,
} from '@shared/protobuf/flowy-search/result_pb';
import { FolderEventGetAllViews, SearchEventStreamSearch } from '@/backend/events';
import { openReceivePort, portBytes, type ReceivePort } from '@/backend/ports';

/** SearchResultItem: a server or local hit. */
export interface SearchResultItem {
  id: string;
  icon?: ResultIconPB;
  displayName: string;
  content: string;
  workspaceId?: string;
}

export interface CommandPaletteState {
  /** null when the field is empty. */
  query: string | null;
  serverResponseItems: SearchResponseItemPB[];
  localResponseItems: LocalSearchResponseItemPB[];
  combinedResponseItems: Map<string, SearchResultItem>;
  cachedViews: Map<string, ViewPB>;
  resultSummaries: SearchSummaryPB[];
  searching: boolean;
  generatingAIOverview: boolean;
  searchId: string | null;
}

const initialState = (): CommandPaletteState => ({
  query: null,
  serverResponseItems: [],
  localResponseItems: [],
  combinedResponseItems: new Map(),
  cachedViews: new Map(),
  resultSummaries: [],
  searching: false,
  generatingAIOverview: false,
  searchId: null,
});

export const useCommandPaletteStore = create<CommandPaletteState>(initialState);
const get = useCommandPaletteStore.getState;
const set = useCommandPaletteStore.setState;

/** _onResultsChanged: server items first, then local items that are not already present. */
export function combineResults(
  serverItems: SearchResponseItemPB[],
  localItems: LocalSearchResponseItemPB[],
): Map<string, SearchResultItem> {
  const combined = new Map<string, SearchResultItem>();
  for (const item of serverItems) {
    combined.set(item.id, {
      id: item.id,
      icon: item.oneOfIcon.case === 'icon' ? item.oneOfIcon.value : undefined,
      displayName: item.displayName,
      content: item.content,
      workspaceId: item.workspaceId,
    });
  }
  for (const item of localItems) {
    if (combined.has(item.id)) continue;
    combined.set(item.id, {
      id: item.id,
      icon: item.oneOfIcon.case === 'icon' ? item.oneOfIcon.value : undefined,
      displayName: item.displayName,
      content: '',
      workspaceId: item.workspaceId,
    });
  }
  return combined;
}

interface ResultsChanged {
  searchId: string;
  serverItems?: SearchResponseItemPB[];
  localItems?: LocalSearchResponseItemPB[];
  summaries?: SearchSummaryPB[];
  searching: boolean;
  generatingAIOverview: boolean;
}

/** CommandPaletteEvent.resultsChanged: ignored unless it belongs to the active search. */
export function resultsChanged(event: ResultsChanged) {
  const state = get();
  if (state.searchId !== event.searchId) return;
  const serverItems = event.serverItems ?? state.serverResponseItems;
  const localItems = event.localItems ?? state.localResponseItems;
  set({
    serverResponseItems: serverItems,
    localResponseItems: localItems,
    resultSummaries: event.summaries ?? state.resultSummaries,
    combinedResponseItems: combineResults(serverItems, localItems),
    searching: event.searching,
    generatingAIOverview: event.generatingAIOverview,
  });
}

/** SearchResponseStream._onResultsChanged for one SearchStatePB of the stream `searchId`. */
export function handleSearchState(searchId: string, state: SearchStatePB) {
  if (state.oneOfResponse.case !== 'response') {
    // onFinished
    resultsChanged({ searchId, searching: false, generatingAIOverview: false });
    return;
  }
  const response = state.oneOfResponse.value;
  if (response.oneOfSearchResult.case === 'searchResult') {
    // Server results clear the summaries.
    resultsChanged({
      searchId,
      serverItems: response.oneOfSearchResult.value.items,
      summaries: [],
      searching: response.searching,
      generatingAIOverview: response.generatingAiSummary,
    });
  }
  if (response.oneOfSearchSummary.case === 'searchSummary') {
    resultsChanged({
      searchId,
      summaries: response.oneOfSearchSummary.value.items,
      searching: response.searching,
      generatingAIOverview: response.generatingAiSummary,
    });
  }
  if (response.oneOfLocalSearchResult.case === 'localSearchResult') {
    // _handleResultsUpdate's defaults: still searching, no AI overview.
    resultsChanged({ searchId, localItems: response.oneOfLocalSearchResult.value.items, searching: true, generatingAIOverview: false });
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
let activeQuery: string | null = null;
let stream: ReceivePort | null = null;

/** CommandPaletteEvent.performSearch. */
export function performSearch(search: string) {
  if (search === '') {
    set({
      query: null,
      searching: false,
      serverResponseItems: [],
      localResponseItems: [],
      combinedResponseItems: new Map(),
      resultSummaries: [],
      generatingAIOverview: false,
    });
    return;
  }
  activeQuery = search;
  // SearchBackendService.performSearch: a new stream (searchId = now in ms) per query.
  const searchId = String(Date.now());
  stream?.close();
  stream = openReceivePort((value) => {
    const bytes = portBytes(value);
    if (!bytes) return;
    try {
      handleSearchState(searchId, fromBinary(SearchStatePBSchema, bytes));
    } catch (error) {
      console.error('Search result decode error', error);
    }
  });
  set({ query: search, searching: true, searchId });
  void SearchEventStreamSearch({ search, searchId, streamPort: stream.port }).then((result) => {
    if (!result.ok && activeQuery === search) {
      console.error('Search error', result.error);
      resultsChanged({ searchId, searching: false, generatingAIOverview: false });
    }
  });
}

/** CommandPaletteEvent.searchChanged: debounced 300 ms. */
export function searchChanged(search: string) {
  clearTimeout(debounce);
  debounce = setTimeout(() => performSearch(search), 300);
}

/** CommandPaletteEvent.clearSearch: back to the initial state (the cached views too). */
export function clearSearch() {
  clearTimeout(debounce);
  stream?.close();
  stream = null;
  activeQuery = null;
  set(initialState());
}

/** refreshCachedViews: all views, to filter stale results and resolve icons. */
export async function refreshCachedViews() {
  const result = await FolderEventGetAllViews();
  if (!result.ok) return;
  set({ cachedViews: new Map(result.value.items.map((v) => [v.id, v])) });
}

/** CommandPaletteEvent.workspaceChanged. */
export function workspaceChanged() {
  set({
    query: '',
    serverResponseItems: [],
    localResponseItems: [],
    combinedResponseItems: new Map(),
    resultSummaries: [],
    searching: false,
    generatingAIOverview: false,
  });
  void refreshCachedViews();
}

/** For tests. */
export function resetCommandPalette() {
  clearTimeout(debounce);
  stream?.close();
  stream = null;
  activeQuery = null;
  set(initialState());
}
