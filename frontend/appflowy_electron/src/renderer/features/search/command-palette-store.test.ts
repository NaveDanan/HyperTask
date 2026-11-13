import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchStatePBSchema } from '@shared/protobuf/flowy-search/notification_pb';
import { RepeatedViewPBSchema, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import {
  LocalSearchResponseItemPBSchema,
  SearchResponseItemPBSchema,
  SearchResponsePBSchema,
} from '@shared/protobuf/flowy-search/result_pb';

// The stream port of the latest search (SearchResponseStream's RawReceivePort).
let portListener: ((value: unknown) => void) | null = null;
let ownerId = 'actor-one';
vi.mock('../document/HyperDocumentOwner', () => ({
  hyperGetDocumentOwner: () => {
    const actorId = ownerId;
    return { workspaceId: 'workspace', actorId, contextKey: 'realm', isCurrent: () => ownerId === actorId };
  },
  hyperDocumentOwnerKey: (owner: { actorId: string } | null) => owner?.actorId ?? '',
}));

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
const { useAppStore } = await import('@/startup/app-store');

const server = (id: string, content = '') => create(SearchResponseItemPBSchema, { id, displayName: `S-${id}`, content });
const local = (id: string) => create(LocalSearchResponseItemPBSchema, { id, displayName: `L-${id}` });

const emit = (state: Parameters<typeof create<typeof SearchStatePBSchema>>[1]) => {
  const bytes = toBinary(SearchStatePBSchema, create(SearchStatePBSchema, { searchId: store.useCommandPaletteStore.getState().searchId ?? '', ...state }));
  portListener?.(bytes);
};

// CommandPaletteBloc (workspace/application/command_palette/command_palette_bloc.dart).
describe('command palette store', () => {
  beforeEach(() => {
    ownerId = 'actor-one';
    useAppStore.setState({ launchId: 0 });
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

  it('ignores late answers after clearing the query or changing workspaces', () => {
    for (const cancel of [() => store.performSearch(''), () => store.workspaceChanged()]) {
      store.performSearch('private');
      const previous = portListener!, searchId = store.useCommandPaletteStore.getState().searchId!;
      cancel();
      previous(toBinary(SearchStatePBSchema, create(SearchStatePBSchema, { searchId, oneOfResponse: { case: 'response', value: { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('previous-owner')] } } } } })));
      expect(store.useCommandPaletteStore.getState().combinedResponseItems.size).toBe(0);
      expect(store.useCommandPaletteStore.getState().searching).toBe(false);
    }
  });

  it('uses increasing native numeric IDs even when queries share a millisecond or the clock moves back', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000);
    try {
      store.performSearch('first');
      const previous = portListener!, first = store.useCommandPaletteStore.getState().searchId!;
      store.performSearch('second');
      const second = store.useCommandPaletteStore.getState().searchId!;
      clock.mockReturnValue(1_800_000_000_000);
      store.performSearch('third');
      const third = store.useCommandPaletteStore.getState().searchId!;
      expect(BigInt(second)).toBeGreaterThan(BigInt(first));
      expect(BigInt(third)).toBeGreaterThan(BigInt(second));
      previous(toBinary(SearchStatePBSchema, create(SearchStatePBSchema, { searchId: first, oneOfResponse: { case: 'response', value: { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('stale')] } } } } })));
      expect(store.useCommandPaletteStore.getState().combinedResponseItems.size).toBe(0);
    } finally { clock.mockRestore(); }
  });

  it('keeps a late view-list reply out of the cache after clearing the palette', async () => {
    let reply!: (value: Awaited<ReturnType<typeof events.FolderEventGetAllViews>>) => void;
    vi.mocked(events.FolderEventGetAllViews).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const loading = store.refreshCachedViews();
    store.clearSearch();
    reply({ ok: true, value: create(RepeatedViewPBSchema, { items: [create(ViewPBSchema, { id: 'previous-account' })] }) });
    await loading;
    expect(store.useCommandPaletteStore.getState().cachedViews.size).toBe(0);
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

  it('discards owner-lost streams and cache responses before the host resets', async () => {
    let reply!: (value: Awaited<ReturnType<typeof events.FolderEventGetAllViews>>) => void;
    vi.mocked(events.FolderEventGetAllViews).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const loading = store.refreshCachedViews();
    store.performSearch('private actor query');
    const previous = portListener!, searchId = store.useCommandPaletteStore.getState().searchId!;
    ownerId = 'actor-two';
    previous(toBinary(SearchStatePBSchema, create(SearchStatePBSchema, { searchId, oneOfResponse: { case: 'response', value: { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('private')] } } } } })));
    reply({ ok: true, value: create(RepeatedViewPBSchema, { items: [create(ViewPBSchema, { id: 'private' })] }) });
    await loading;
    expect(store.useCommandPaletteStore.getState().combinedResponseItems.size).toBe(0);
    expect(store.useCommandPaletteStore.getState().cachedViews.size).toBe(0);
    store.performSearch('new actor');
    expect(store.useCommandPaletteStore.getState().ownerKey).toBe('actor-two');
    expect(store.useCommandPaletteStore.getState().query).toBe('new actor');
  });

  it('does not dispatch a debounced query after owner loss or a same-owner restart', () => {
    vi.useFakeTimers();
    try {
      store.searchChanged('private actor query');
      ownerId = 'actor-two';
      vi.advanceTimersByTime(300);
      store.searchChanged('private launch query');
      useAppStore.setState({ launchId: 1 });
      vi.advanceTimersByTime(300);
      expect(events.SearchEventStreamSearch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('rejects mismatched and missing payload IDs on the current request port', () => {
    store.performSearch('current');
    const searchId = store.useCommandPaletteStore.getState().searchId!;
    emit({ searchId: 'other-request', oneOfResponse: { case: 'response', value: { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('wrong-request')] } } } } });
    expect(store.useCommandPaletteStore.getState().combinedResponseItems.size).toBe(0);
    for (const wrongId of ['other-request', '']) {
      emit({ searchId: wrongId });
      expect(store.useCommandPaletteStore.getState().searching).toBe(true);
    }
    emit({ searchId, oneOfResponse: { case: 'response', value: { oneOfLocalSearchResult: { case: 'localSearchResult', value: { items: [local('current-request')] } } } } });
    expect([...store.useCommandPaletteStore.getState().combinedResponseItems.keys()]).toEqual(['current-request']);
    emit({ searchId });
    expect(store.useCommandPaletteStore.getState().searching).toBe(false);
  });
});
