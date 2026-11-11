import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { AIModelPBSchema, ChatMessageListPBSchema, ChatMessagePBSchema, ChatSettingsPBSchema, ModelSelectionPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import type { HyperChatBackend, HyperChatEvent } from './HyperChatBackend';
import { createHyperChatStore, hyperChatModelKey, hyperMergeMessages } from './HyperChatStore';

const message = (id: bigint, content: string, authorType = 1n) => create(ChatMessagePBSchema, { messageId: id, content, authorType, createdAt: id });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { resolve, reject, promise }; }
function fixture() {
  let listener: ((event: HyperChatEvent) => void) | undefined;
  let nextPort = 1n;
  const ports = new Map<bigint, (value: unknown) => void>();
  const model = create(AIModelPBSchema, { name: 'test-model', isLocal: true });
  const service: HyperChatBackend = {
    load: vi.fn(async () => create(ChatMessageListPBSchema)), settings: vi.fn(async () => create(ChatSettingsPBSchema, { ragIds: ['existing-page'] })),
    models: vi.fn(async () => create(ModelSelectionPBSchema, { models: [model], selectedModel: model })),
    selectModel: vi.fn(async () => {}), setSources: vi.fn(async () => {}), sources: vi.fn(async () => [{ id: 'one', name: 'One' }]),
    send: vi.fn(async (_id, text) => message(10n, text)), stop: vi.fn(async () => {}),
    listen: vi.fn((_id, handler) => { listener = handler; return () => { listener = undefined; }; }),
    openPort: vi.fn(handler => { const port = nextPort++; ports.set(port, handler); return { port, close() { ports.delete(port); } }; }),
  };
  const store = createHyperChatStore('chat-id', service), dispose = store.start();
  return { store, service, ports, dispose, emit: (event: HyperChatEvent) => listener?.(event), port: (value: string, which: 'answer' | 'question' = 'answer') => {
    const call = vi.mocked(service.send).mock.calls.at(-1);
    if (call) ports.get(call[which === 'answer' ? 2 : 3])?.(value);
  } };
}
const ready = async (f: ReturnType<typeof fixture>) => { await vi.waitFor(() => expect(f.store.getState().loading).toBe(false)); };
describe('Hyper chat lifecycle', () => {
  it('does not let a source load from a disposed lifecycle overwrite the reopened view', async () => {
    const f = fixture(); await ready(f);
    const old = deferred<Array<{ id: string; name: string }>>();
    vi.mocked(f.service.sources).mockReturnValueOnce(old.promise);
    const loading = f.store.loadSources();
    f.dispose(); const stop = f.store.start(); await ready(f);
    vi.mocked(f.service.sources).mockResolvedValueOnce([{ id: 'new', name: 'New source' }]);
    await f.store.loadSources();
    old.resolve([{ id: 'stale', name: 'Stale source' }]); await loading;
    expect(f.store.getState().sources).toEqual([{ id: 'new', name: 'New source' }]); stop();
  });
  it('ignores a failed source update from an earlier lifecycle', async () => {
    const f = fixture(); await ready(f);
    const old = deferred<void>(); vi.mocked(f.service.setSources).mockReturnValueOnce(old.promise);
    const saving = f.store.setSources(['stale']);
    f.dispose(); const stop = f.store.start(); await ready(f);
    await f.store.setSources(['new']); old.reject(new Error('Old save error')); await saving;
    expect(f.store.getState().ragIds).toEqual(['new']);
    expect(f.store.getState().sourceError).toBeNull(); stop();
  });
  it('loads persistent messages and merges history/notifications without losing bigint precision', async () => {
    const f = fixture(); await ready(f);
    const id = 9007199254740993n;
    f.emit({ type: 'messages', messages: [message(id + 1n, 'second'), message(id, 'first')] });
    f.emit({ type: 'message', message: message(id, 'updated') });
    expect(f.store.getState().messages.map(m => m.content)).toEqual(['updated', 'second']);
    expect(hyperMergeMessages([message(1n, 'a')], [message(1n, 'b')])).toHaveLength(1);
    f.dispose();
  });
  it('registers ports before sending, accumulates tokens and reconciles the persisted answer after finish', async () => {
    const f = fixture(); await ready(f);
    f.store.setState({ draft: '  Hello  ' });
    await f.store.send();
    expect(f.service.send).toHaveBeenCalledWith('chat-id', 'Hello', 2n, 1n);
    expect(f.store.getState().messages[0].content).toBe('Hello');
    expect(f.store.getState().draft).toBe('');
    expect(f.store.getState().question).toBe('');
    f.port('data: שלום'); f.port('data: 🌍 ');
    expect(f.store.getState().answer).toBe(' שלום 🌍 ');
    f.emit({ type: 'finish' });
    expect(f.store.getState().sending).toBe(false); expect(f.ports.size).toBe(0);
    expect(f.store.getState().answer).toBe(' שלום 🌍 ');
    f.emit({ type: 'message', message: message(11n, 'שלום 🌍', 3n) });
    expect(f.store.getState().answer).toBe('');
    expect(f.store.getState().messages.map(m => m.content)).toEqual(['Hello', 'שלום 🌍']);
    f.dispose();
  });
  it('prevents duplicate sends while creation is pending and preserves input when creation fails', async () => {
    const f = fixture(); await ready(f); const pending = deferred<ReturnType<typeof message>>();
    vi.mocked(f.service.send).mockReturnValue(pending.promise);
    f.store.setState({ draft: 'Do not lose this' });
    const sending = f.store.send(); await f.store.send();
    await vi.waitFor(() => expect(f.service.send).toHaveBeenCalledTimes(1));
    pending.reject(new Error('endpoint unavailable')); await sending;
    expect(f.store.getState().draft).toBe('Do not lose this');
    expect(f.store.getState().error).toBe('endpoint unavailable');
    expect(f.store.getState().sending).toBe(false); expect(f.ports.size).toBe(0);
    f.dispose();
  });
  it('stops again after pending question creation to avoid the cancellation/start race', async () => {
    const f = fixture(); await ready(f); const pending = deferred<ReturnType<typeof message>>();
    vi.mocked(f.service.send).mockReturnValue(pending.promise);
    f.store.setState({ draft: 'Question' }); const sending = f.store.send();
    await vi.waitFor(() => expect(f.service.send).toHaveBeenCalledTimes(1));
    const stopping = f.store.stop();
    await vi.waitFor(() => expect(f.service.stop).toHaveBeenCalledTimes(1));
    pending.resolve(message(10n, 'Question')); await sending;
    await vi.waitFor(() => expect(f.service.stop).toHaveBeenCalledTimes(2));
    expect(f.store.getState().sending).toBe(true);
    f.emit({ type: 'finish' }); await stopping;
    expect(f.service.stop).toHaveBeenCalledTimes(2); expect(f.store.getState().sending).toBe(false); expect(f.ports.size).toBe(0);
    f.dispose();
  });
  it('retains streamed text on service errors and handles capability/disabled states', async () => {
    const f = fixture(); await ready(f); f.store.setState({ draft: 'Q' }); await f.store.send();
    f.port('data:partial answer'); f.port('local_ai_disabled:Enable your endpoint in settings');
    expect(f.store.getState()).toMatchObject({ answer: 'partial answer', sending: false, error: 'Enable your endpoint in settings' });
    expect(f.ports.size).toBe(0); f.dispose();
  });
  it('loads earlier messages with an exclusive bigint cursor and keeps current messages', async () => {
    const f = fixture(); await ready(f);
    f.emit({ type: 'message', message: message(9007199254740993n, 'current') });
    f.store.setState({ hasMore: true });
    vi.mocked(f.service.load).mockResolvedValue(create(ChatMessageListPBSchema, { messages: [message(1n, 'earlier')], hasMore: false }));
    await f.store.loadMore();
    expect(f.service.load).toHaveBeenLastCalledWith('chat-id', 9007199254740993n);
    expect(f.store.getState().messages.map(m => m.content)).toEqual(['earlier', 'current']);
    expect(f.store.getState().hasMore).toBe(false); f.dispose();
  });
  it('persists sources without discarding existing selections, and keeps the old state on failure', async () => {
    const f = fixture(); await ready(f); await vi.waitFor(() => expect(f.store.getState().settingsLoaded).toBe(true));
    await f.store.setSources(['existing-page', 'one', 'one']);
    expect(f.service.setSources).toHaveBeenCalledWith('chat-id', ['existing-page', 'one']);
    vi.mocked(f.service.setSources).mockRejectedValue(new Error('permission denied'));
    await f.store.setSources([]);
    expect(f.store.getState().ragIds).toEqual(['existing-page', 'one']);
    expect(f.store.getState().sourceError).toBe('permission denied'); f.dispose();
  });
  it('does not overwrite source settings when the initial settings read failed', async () => {
    const f = fixture(); await ready(f); f.store.setState({ settingsLoaded: false });
    await f.store.setSources(['one']); expect(f.service.setSources).not.toHaveBeenCalled(); f.dispose();
  });
  it('selects models by name and provider location and preserves the model on errors', async () => {
    const f = fixture(); await ready(f);
    const cloud = create(AIModelPBSchema, { name: 'test-model', isLocal: false });
    f.store.setState({ models: [...f.store.getState().models, cloud] });
    await f.store.selectModel(hyperChatModelKey(cloud));
    expect(f.service.selectModel).toHaveBeenLastCalledWith('chat-id', cloud);
    vi.mocked(f.service.selectModel).mockRejectedValue(new Error('model rejected'));
    await f.store.selectModel('local:test-model');
    expect(f.store.getState().selectedModel).toEqual(cloud); expect(f.store.getState().modelError).toBe('model rejected'); f.dispose();
  });
  it('closes subscriptions and stops a response on disposal without accepting late tokens', async () => {
    const f = fixture(); await ready(f); f.store.setState({ draft: 'Q' }); await f.store.send();
    const callback = f.ports.get(2n)!;
    f.dispose(); callback('data:late');
    await vi.waitFor(() => expect(f.service.stop).toHaveBeenCalledTimes(2));
    f.emit({ type: 'finish' });
    expect(f.store.getState().answer).toBe(''); expect(f.ports.size).toBe(0);
  });
});
