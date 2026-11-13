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
import { hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureSearchOwner, hyperInvalidateSearchOwner, type HyperSearchOwnerScope } from './HyperSearchOwner';

/** SearchResultItem: a server or local hit. */
export interface SearchResultItem {
  id: string;
  icon?: ResultIconPB;
  displayName: string;
  content: string;
  workspaceId?: string;
}

export interface CommandPaletteState {
  ownerKey: string;
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
  ownerKey: '',
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
  if (state.searchId !== event.searchId || !activeScope?.isCurrent()) return;
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
  if (state.searchId !== searchId) return;
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
let activeScope: HyperSearchOwnerScope | null = null;
let stream: ReceivePort | null = null;
let lastSearchId = 0n;
let cachedViewsRevision = 0;

function invalidateSearch() {
  clearTimeout(debounce);
  stream?.close();
  stream = null;
  activeScope = null;
}

function captureOwner(owner: HyperDocumentOwner | null) {
  const scope = hyperCaptureSearchOwner(owner);
  if (!scope) return null;
  if (get().ownerKey !== scope.key) {
    clearSearch();
    set({ ownerKey: scope.key });
  }
  return scope;
}

/** CommandPaletteEvent.performSearch. */
export function performSearch(search: string, owner: HyperDocumentOwner | null = hyperGetDocumentOwner()) {
  if (search === '') {
    invalidateSearch();
    set({
      query: null,
      searchId: null,
      searching: false,
      serverResponseItems: [],
      localResponseItems: [],
      combinedResponseItems: new Map(),
      resultSummaries: [],
      generatingAIOverview: false,
    });
    return;
  }
  const scope = captureOwner(owner);
  if (!scope) return;
  // The native search manager orders numeric IDs. Keep them increasing even for
  // requests in one millisecond or after the system clock moves backwards.
  const now = BigInt(Date.now());
  const searchId = (lastSearchId = now > lastSearchId ? now : lastSearchId + 1n).toString();
  stream?.close();
  activeScope = scope;
  stream = openReceivePort((value) => {
    if (!scope.isCurrent()) return;
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
    if (!result.ok && scope.isCurrent() && get().searchId === searchId) {
      console.error('Search error', result.error);
      resultsChanged({ searchId, searching: false, generatingAIOverview: false });
    }
  });
}

/** CommandPaletteEvent.searchChanged: debounced 300 ms. */
export function searchChanged(search: string, owner: HyperDocumentOwner | null = hyperGetDocumentOwner()) {
  clearTimeout(debounce);
  const scope = captureOwner(owner);
  if (!scope) return;
  debounce = setTimeout(() => { if (scope.isCurrent()) performSearch(search, scope.owner); }, 300);
}

/** CommandPaletteEvent.clearSearch: back to the initial state (the cached views too). */
export function clearSearch() {
  invalidateSearch();
  cachedViewsRevision++;
  set(initialState());
}

/** refreshCachedViews: all views, to filter stale results and resolve icons. */
export async function refreshCachedViews(owner: HyperDocumentOwner | null = hyperGetDocumentOwner()) {
  const scope = captureOwner(owner);
  if (!scope) return;
  const revision = ++cachedViewsRevision;
  const result = await FolderEventGetAllViews();
  if (!result.ok || !scope.isCurrent() || revision !== cachedViewsRevision || get().ownerKey !== scope.key) return;
  set({ cachedViews: new Map(result.value.items.map((v) => [v.id, v])) });
}

/** CommandPaletteEvent.workspaceChanged. */
export function workspaceChanged(owner: HyperDocumentOwner | null = hyperGetDocumentOwner()) {
  hyperInvalidateSearchOwner();
  clearSearch();
  set({ query: '' });
  void refreshCachedViews(owner);
}

/** For tests. */
export function resetCommandPalette() {
  clearSearch();
}
