import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { AIModelPBSchema, CompleteTextTaskPBSchema, ModelSelectionPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { createHyperDatabaseAIStore, type HyperDatabaseAIBackend, type HyperDatabaseAIContext, type HyperDatabaseAISnapshot } from './HyperDatabaseAIStore';

const context: HyperDatabaseAIContext = { viewId: 'view', rowId: 'row', fieldId: 'summary', fieldType: FieldType.Summary, workspaceId: 'workspace', actorId: '1' };
function fixture(type: FieldType = FieldType.Summary) {
  const target = { ...context, fieldType: type };
  let snapshot: HyperDatabaseAISnapshot = { context: target, target: { text: 'Saved value', stamp: 'target-original', language: 'English' }, sources: [{ id: 'title', name: 'Title', text: 'Selected source fact', stamp: 'source-original' }, { id: 'private', name: 'Unselected', text: 'Never send this value', stamp: 'other' }] };
  let current = true, listener: (value: unknown) => void = () => {};
  const close = vi.fn(), complete = vi.fn(async () => create(CompleteTextTaskPBSchema, { taskId: 'task' }));
  const backend: HyperDatabaseAIBackend = {
    read: vi.fn(async () => structuredClone(snapshot)), write: vi.fn(async () => {}),
    ai: { complete, stop: vi.fn(async () => {}), models: vi.fn(async () => create(ModelSelectionPBSchema, { models: [{ name: 'Model A' }], selectedModel: { name: 'Model A' } })), selectModel: vi.fn(async () => {}), openPort: callback => { listener = callback; return { port: 1n, close }; } },
  };
  const store = createHyperDatabaseAIStore(target, backend, () => current);
  async function start() { store.start(); await vi.waitFor(() => expect(store.getState().snapshot).not.toBeNull()); }
  const finish = () => { listener('data:Generated 🌍'); listener('finish:'); };
  return { store, backend, complete, start, finish, emit: (value: string) => listener(value), close, setCurrent: (value: boolean) => { current = value; }, change: (change: (value: HyperDatabaseAISnapshot) => void) => { change(snapshot); }, setSnapshot: (value: HyperDatabaseAISnapshot) => { snapshot = value; } };
}
describe('Hyper database AI preview and apply', () => {
  it('reads local sources without generation, sends only selected content, and writes only after explicit apply', async () => {
    const f = fixture(); await f.start();
    expect(f.complete).not.toHaveBeenCalled(); expect(f.backend.write).not.toHaveBeenCalled(); expect(f.store.getState().selectedIds).toEqual([]);
    f.store.select(['title']); await f.store.generate(); f.finish();
    expect(f.complete).toHaveBeenCalledWith(expect.objectContaining({ action: 'summarize', documentId: context.viewId, sourceText: 'Title:\nSelected source fact' }));
    expect(JSON.stringify(f.complete.mock.calls, (_, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('Never send'); expect(f.store.completion.getState().status).toBe('ready');
    expect(f.backend.write).not.toHaveBeenCalled();
    await f.store.apply(); expect(f.backend.write).toHaveBeenCalledExactlyOnceWith(context, 'Generated 🌍');
    expect(f.store.getState().applied).toBe(true);
    await expect(f.store.apply()).rejects.toThrow('Generate and review'); f.store.dispose();
  });
  it('passes translation language and preserves the existing cell on stream failure', async () => {
    const f = fixture(FieldType.Translate); await f.start(); f.store.select(['title']); await f.store.generate('French');
    expect(f.complete).toHaveBeenCalledWith(expect.objectContaining({ action: 'translate', language: 'French' }));
    f.emit('data:Partial'); f.emit('error:Provider unavailable');
    await expect(f.store.apply()).rejects.toThrow('Generate and review'); expect(f.backend.write).not.toHaveBeenCalled();
    expect(f.store.getState().snapshot?.target.text).toBe('Saved value'); f.store.dispose();
  });
  it('cancels generation and rejects applying its partial result', async () => {
    const f = fixture(); await f.start(); f.store.select(['title']); await f.store.generate(); f.emit('data:Partial');
    await f.store.completion.stop(); f.emit('data:Late'); f.emit('finish:');
    expect(f.backend.ai.stop).toHaveBeenCalledExactlyOnceWith('task'); expect(f.store.completion.getState().result).toBe('Partial');
    await expect(f.store.apply()).rejects.toThrow('Generate and review'); expect(f.backend.write).not.toHaveBeenCalled(); f.store.dispose();
  });
  it.each(['target', 'selected source', 'field options'])('rejects a result when its %s changes before apply', async kind => {
    const f = fixture(); await f.start(); f.store.select(['title']); await f.store.generate(); f.finish();
    f.change(value => { if (kind === 'selected source') value.sources[0].stamp = 'changed'; else value.target.stamp = kind; });
    await expect(f.store.apply()).rejects.toThrow('source or saved cell changed'); expect(f.backend.write).not.toHaveBeenCalled(); f.store.dispose();
  });
  it('does not treat unselected content as sent context or block apply when it changes', async () => {
    const f = fixture(); await f.start(); f.store.select(['title']); await f.store.generate(); f.finish();
    f.change(value => { value.sources[1].stamp = 'changed'; }); await f.store.apply(); expect(f.backend.write).toHaveBeenCalledOnce(); f.store.dispose();
  });
  it.each(['workspaceId', 'actorId', 'rowId', 'fieldType'] as const)('rejects a backend snapshot with a changed %s', async property => {
    const f = fixture(); await f.start(); f.store.select(['title']); await f.store.generate(); f.finish();
    f.change(value => { if (property === 'fieldType') value.context.fieldType = FieldType.RichText; else value.context[property] = 'other'; });
    await expect(f.store.apply()).rejects.toThrow('changed'); expect(f.backend.write).not.toHaveBeenCalled(); f.store.dispose();
  });
  it('stops before sending if edit permission changes during source reads', async () => {
    const f = fixture(); await f.start(); f.store.select(['title']);
    let resolve!: (value: HyperDatabaseAISnapshot) => void;
    vi.mocked(f.backend.read).mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const generating = f.store.generate(); f.setCurrent(false);
    resolve({ context, target: { text: '', stamp: 'target', language: '' }, sources: [{ id: 'title', name: 'Title', text: 'Text', stamp: 'source' }] }); await generating;
    expect(f.complete).not.toHaveBeenCalled(); expect(f.store.getState().error).toContain('permission changed'); f.store.dispose();
  });
  it('rejects application after permission loss and invalidates previews when source choices change', async () => {
    const f = fixture(); await f.start(); f.store.select(['title']); await f.store.generate(); f.finish(); f.setCurrent(false);
    await expect(f.store.apply()).rejects.toThrow('permission changed'); expect(f.backend.write).not.toHaveBeenCalled(); f.setCurrent(true);
    f.store.select(['private']); await expect(f.store.apply()).rejects.toThrow('Generate and review'); f.store.dispose();
  });
  it('cleans up a late task acknowledgment after the dialog closes', async () => {
    const f = fixture(); await f.start(); f.store.select(['title']);
    let resolve!: (value: ReturnType<typeof create<typeof CompleteTextTaskPBSchema>>) => void;
    f.complete.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const generating = f.store.generate(); await vi.waitFor(() => expect(f.complete).toHaveBeenCalled()); f.store.dispose(); resolve(create(CompleteTextTaskPBSchema, { taskId: 'late-task' })); await generating;
    expect(f.backend.ai.stop).toHaveBeenCalledWith('late-task'); expect(f.close).toHaveBeenCalled(); expect(f.backend.write).not.toHaveBeenCalled();
  });
  it('requires a nonempty bounded source and never applies an old result after refreshing', async () => {
    const f = fixture(); await f.start(); await f.store.generate(); expect(f.complete).not.toHaveBeenCalled();
    f.store.select(['title']); f.change(value => { value.sources[0].text = 'x'.repeat(100_001); }); await f.store.generate(); expect(f.complete).not.toHaveBeenCalled();
    f.change(value => { value.sources[0].text = 'Okay'; }); await f.store.generate(); f.finish(); await f.store.refresh();
    await expect(f.store.apply()).rejects.toThrow('Generate and review'); expect(f.backend.write).not.toHaveBeenCalled(); f.store.dispose();
  });
  it('supports StrictMode lifecycle restart and explicit per-view model selection', async () => {
    const f = fixture(); const stop = f.store.start(); stop(); await f.start();
    const model = create(AIModelPBSchema, { name: 'Model B' }); await f.store.completion.selectModel(model);
    expect(f.backend.ai.selectModel).toHaveBeenCalledExactlyOnceWith(context.viewId, model); expect(f.store.getState().preparing).toBe(false); f.store.dispose();
  });
});
