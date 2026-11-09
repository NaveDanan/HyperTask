import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchStatePBSchema } from '@shared/protobuf/flowy-search/notification_pb';
import {
  LocalSearchResponseItemPBSchema,
  SearchResponseItemPBSchema,
  SearchResponsePBSchema,
} from '@shared/protobuf/flowy-search/result_pb';

// The stream port of the latest search (SearchResponseStream's RawReceivePort).
let portListener: ((value: unknown) => void) | null = null;

vi.mock('@/backend/ports', () => ({
  openReceivePort: (listener: (value: unknown) => void) => {
    portListener = listener;
    return { port: 1n, close: () => {} };
  },
  portBytes: (value: unknown) => (value instanceof Uint8Array ? value : null),
}));
vi.mock('@/backend/events', () => ({
  SearchEventStreamSearch: vi.fn(async () => ({ ok: true, value: undefined })),
  FolderEventGetAllViews: vi.fn(async () => ({ ok: true, value: { items: [] } })),
}));

const store = await import('./command-palette-store');
const events = await import('@/backend/events');

const server = (id: string, content = '') => create(SearchResponseItemPBSchema, { id, displayName: `S-${id}`, content });
const local = (id: string) => create(LocalSearchResponseItemPBSchema, { id, displayName: `L-${id}` });

const emit = (state: Parameters<typeof create<typeof SearchStatePBSchema>>[1]) => {
  const bytes = toBinary(SearchStatePBSchema, create(SearchStatePBSchema, state));
  portListener?.(bytes);
};

// CommandPaletteBloc (workspace/application/command_palette/command_palette_bloc.dart).
describe('command palette store', () => {
  beforeEach(() => {
    store.resetCommandPalette();
    vi.clearAllMocks();
  });

  it('combines server items first and keeps local items only when new', () => {
    const combined = store.combineResults([server('a', 'body'), server('b')], [local('b'), local('c')]);
    expect([...combined.keys()]).toEqual(['a', 'b', 'c']);
    expect(combined.get('b')?.displayName).toBe('S-b');
    expect(combined.get('a')?.content).toBe('body');
    expect(combined.get('c')).toMatchObject({ displayName: 'L-c', content: '' });
  });

  it('streams a search and applies only results of the active search', () => {
    vi.useFakeTimers();
    store.performSearch('old');
    const staleStream = portListener!;
    vi.advanceTimersByTime(5);
    store.performSearch('note');
    vi.useRealTimers();
    const state = store.useCommandPaletteStore.getState();
    expect(state.query).toBe('note');
    expect(state.searching).toBe(true);
    const searchId = state.searchId!;
    expect(events.SearchEventStreamSearch).toHaveBeenLastCalledWith({ search: 'note', searchId, streamPort: 1n });

    // Results of a previous search's stream are ignored.
    staleStream(
      toBinary(
        SearchStatePBSchema,
        create(SearchStatePBSchema, {
          oneOfResponse: {
            case: 'response',
            value: create(SearchResponsePBSchema, { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('x')] } } }),
          },
        }),
      ),
    );
    expect(store.useCommandPaletteStore.getState().combinedResponseItems.size).toBe(0);

    // Local results keep the search running; the empty state finishes it.
    emit({
      searchId,
      oneOfResponse: {
        case: 'response',
        value: create(SearchResponsePBSchema, { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('x')] } } }),
      },
    });
    expect([...store.useCommandPaletteStore.getState().combinedResponseItems.keys()]).toEqual(['x']);
    expect(store.useCommandPaletteStore.getState().searching).toBe(true);
    emit({ searchId });
    expect(store.useCommandPaletteStore.getState().searching).toBe(false);
    expect(store.useCommandPaletteStore.getState().combinedResponseItems.size).toBe(1);
  });

  it('server results clear the summaries and carry the searching flags', () => {
    store.performSearch('q');
    const searchId = store.useCommandPaletteStore.getState().searchId!;
    emit({
      searchId,
      oneOfResponse: {
        case: 'response',
        value: create(SearchResponsePBSchema, {
          oneOfSearchSummary: { case: 'searchSummary', value: { items: [{ content: 'sum' }] } },
          searching: true,
        }),
      },
    });
    expect(store.useCommandPaletteStore.getState().resultSummaries).toHaveLength(1);
    emit({
      searchId,
      oneOfResponse: {
        case: 'response',
        value: create(SearchResponsePBSchema, {
          oneOfSearchResult: { case: 'searchResult', value: { items: [server('s')] } },
          searching: false,
          generatingAiSummary: true,
        }),
      },
    });
    const state = store.useCommandPaletteStore.getState();
    expect(state.resultSummaries).toHaveLength(0);
    expect(state.searching).toBe(false);
    expect(state.generatingAIOverview).toBe(true);
    expect([...state.combinedResponseItems.keys()]).toEqual(['s']);
  });

  it('an empty search resets the results without a request', () => {
    store.performSearch('q');
    vi.clearAllMocks();
    store.performSearch('');
    const state = store.useCommandPaletteStore.getState();
    expect(state.query).toBeNull();
    expect(state.searching).toBe(false);
    expect(events.SearchEventStreamSearch).not.toHaveBeenCalled();
  });

  it('debounces typing by 300 ms', () => {
    vi.useFakeTimers();
    store.searchChanged('a');
    store.searchChanged('ab');
    vi.advanceTimersByTime(299);
    expect(events.SearchEventStreamSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(events.SearchEventStreamSearch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(events.SearchEventStreamSearch).mock.calls[0][0]).toMatchObject({ search: 'ab' });
    vi.useRealTimers();
  });
});
