import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { AIModelPBSchema, CompleteTextPBSchema, CompleteTextTaskPBSchema, CompletionTypePB, ModelSelectionPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { createHyperDocumentAIStore, hyperCanReplaceDocumentAI, hyperDocumentAIRequest, type HyperDocumentAIBackend } from './HyperDocumentAIStore';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
function fixture() {
  let listener: (value: unknown) => void = () => {};
  const close = vi.fn();
  const model = create(AIModelPBSchema, { name: 'local-test', isLocal: true });
  const service: HyperDocumentAIBackend = {
    complete: vi.fn(async () => create(CompleteTextTaskPBSchema, { taskId: 'task-1' })), stop: vi.fn(async () => {}),
    models: vi.fn(async () => create(ModelSelectionPBSchema, { models: [model], selectedModel: model })), selectModel: vi.fn(async () => {}),
    openPort: vi.fn(callback => { listener = callback; return { port: 19n, close }; }),
  };
  const store = createHyperDocumentAIStore('document-id', service), dispose = store.start();
  return { store, service, dispose, close, model, emit: (value: unknown) => listener(value) };
}
const source = { sourceText: 'Original source 🌍', usedSelection: true, selectionKey: 'block:0:18:revision-1' };

describe('Hyper document AI requests', () => {
  it('permits replacement only for the captured text and exact selection identity', () => {
    expect(hyperCanReplaceDocumentAI(source, source.sourceText, source.selectionKey)).toBe(true);
    expect(hyperCanReplaceDocumentAI(source, 'Changed source', source.selectionKey)).toBe(false);
    expect(hyperCanReplaceDocumentAI(source, source.sourceText, 'another-block:same-text')).toBe(false);
    expect(hyperCanReplaceDocumentAI({ ...source, usedSelection: false }, source.sourceText, source.selectionKey)).toBe(false);
    expect(hyperCanReplaceDocumentAI(null, source.sourceText, source.selectionKey)).toBe(false);
  });
  it('encodes native completion actions and explicit custom prompts', () => {
    for (const [action, type] of Object.entries({ rewrite: CompletionTypePB.ImproveWriting, grammar: CompletionTypePB.SpellingAndGrammar, continue: CompletionTypePB.ContinueWriting, explain: CompletionTypePB.ExplainSelected }) ) {
      const request = hyperDocumentAIRequest({ documentId: 'id', sourceText: 'שלום 🌍', port: 42n, action: action as 'rewrite' });
      const decoded = fromBinary(CompleteTextPBSchema, toBinary(CompleteTextPBSchema, create(CompleteTextPBSchema, request)));
      expect(decoded).toMatchObject({ objectId: 'id', text: 'שלום 🌍', completionType: type, streamPort: 42n });
      expect(decoded.oneOfCustomPrompt.case).toBeUndefined();
    }
    expect(hyperDocumentAIRequest({ documentId: 'id', sourceText: 'text', port: 1n, action: 'summarize' }).oneOfCustomPrompt?.value).toContain('Summarize');
    expect(hyperDocumentAIRequest({ documentId: 'id', sourceText: 'text', port: 1n, action: 'translate', language: ' Hebrew ' }).oneOfCustomPrompt?.value).toContain('into Hebrew');
    expect(() => hyperDocumentAIRequest({ documentId: 'id', sourceText: ' ', port: 1n, action: 'rewrite' })).toThrow('Select some text');
    expect(() => hyperDocumentAIRequest({ documentId: 'id', sourceText: 'text', port: 1n, action: 'translate' })).toThrow('language');
  });
});
describe('Hyper document AI lifecycle', () => {
  it('opens the port before sending and accumulates Unicode while preserving captured selection', async () => {
    const f = fixture(); await f.store.run('rewrite', source);
    expect(f.service.openPort).toHaveBeenCalledOnce();
    expect(f.service.complete).toHaveBeenCalledWith({ documentId: 'document-id', action: 'rewrite', sourceText: source.sourceText, port: 19n, language: undefined });
    f.emit('comment:Thinking'); f.emit('data:שלום '); f.emit('data:🌍');
    expect(f.store.getState()).toMatchObject({ status: 'generating', result: 'שלום 🌍', source, comment: 'Thinking' });
    f.emit('finish:'); f.emit('data:late'); f.emit('error:late');
    expect(f.store.getState()).toMatchObject({ status: 'ready', result: 'שלום 🌍', comment: '', error: null });
    expect(f.close).toHaveBeenCalledOnce(); f.dispose();
  });
  it('waits for task acknowledgement when stop is requested early and stops once', async () => {
    const f = fixture(), pending = deferred<ReturnType<typeof create<typeof CompleteTextTaskPBSchema>>>();
    vi.mocked(f.service.complete).mockReturnValueOnce(pending.promise);
    const run = f.store.run('rewrite', source);
    await vi.waitFor(() => expect(f.service.complete).toHaveBeenCalledOnce());
    f.emit('data:partial'); const stopping = f.store.stop(); await f.store.stop();
    f.emit('data:must not append');
    pending.resolve(create(CompleteTextTaskPBSchema, { taskId: 'task-delayed' })); await run; await stopping;
    expect(f.service.stop).toHaveBeenCalledExactlyOnceWith('task-delayed');
    expect(f.store.getState()).toMatchObject({ status: 'cancelled', result: 'partial' }); f.dispose();
    await Promise.resolve(); expect(f.service.stop).toHaveBeenCalledOnce();
  });
  it('retains partial output on provider errors and capability failures', async () => {
    const f = fixture(); await f.store.run('rewrite', source); f.emit('data:partial'); f.emit('local_ai_disabled:Configure AI in settings');
    expect(f.store.getState()).toMatchObject({ status: 'error', result: 'partial', error: 'Configure AI in settings' });
    expect(f.close).toHaveBeenCalledOnce(); f.dispose();
  });
  it('reports rejected completion requests and closes their ports', async () => {
    const f = fixture(); vi.mocked(f.service.complete).mockRejectedValueOnce(new Error('endpoint unavailable'));
    await f.store.run('summarize', source);
    expect(f.store.getState()).toMatchObject({ status: 'error', error: 'endpoint unavailable', source });
    expect(f.close).toHaveBeenCalledOnce(); f.dispose();
  });
  it('prevents duplicate requests and disposes a pending task without duplicate stop calls', async () => {
    const f = fixture(), pending = deferred<ReturnType<typeof create<typeof CompleteTextTaskPBSchema>>>();
    vi.mocked(f.service.complete).mockReturnValueOnce(pending.promise);
    const run = f.store.run('rewrite', source); await f.store.run('continue', source);
    await vi.waitFor(() => expect(f.service.complete).toHaveBeenCalledOnce()); f.dispose();
    pending.resolve(create(CompleteTextTaskPBSchema, { taskId: 'pending-dispose' })); await run;
    await vi.waitFor(() => expect(f.service.stop).toHaveBeenCalledExactlyOnceWith('pending-dispose'));
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('keeps an old model request from changing a restarted session', async () => {
    const f = fixture(); await f.store.loadModels();
    const pending = deferred<void>(); vi.mocked(f.service.selectModel).mockReturnValueOnce(pending.promise);
    const other = create(AIModelPBSchema, { name: 'other', isLocal: true }); const changing = f.store.selectModel(other);
    f.dispose(); const stop = f.store.start(); await f.store.loadModels(); pending.resolve(); await changing;
    expect(f.store.getState().selectedModel?.name).toBe('local-test'); expect(f.store.getState().changingModel).toBe(false); stop();
  });
  it('does not let an older model response overwrite a newer model list', async () => {
    const f = fixture(); await f.store.loadModels();
    const older = deferred<ReturnType<typeof create<typeof ModelSelectionPBSchema>>>();
    vi.mocked(f.service.models).mockReturnValueOnce(older.promise);
    const first = f.store.loadModels();
    const fresh = create(AIModelPBSchema, { name: 'fresh', isLocal: true });
    vi.mocked(f.service.models).mockResolvedValueOnce(create(ModelSelectionPBSchema, { models: [fresh], selectedModel: fresh }));
    await f.store.loadModels();
    older.resolve(create(ModelSelectionPBSchema, { models: [f.model], selectedModel: f.model })); await first;
    expect(f.store.getState().selectedModel?.name).toBe('fresh'); f.dispose();
  });
  it('does not overwrite an explicit model selection with an earlier discovery response', async () => {
    const f = fixture(); await f.store.loadModels();
    const discovery = deferred<ReturnType<typeof create<typeof ModelSelectionPBSchema>>>();
    vi.mocked(f.service.models).mockReturnValueOnce(discovery.promise);
    const loading = f.store.loadModels();
    const selected = create(AIModelPBSchema, { name: 'chosen', isLocal: true });
    await f.store.selectModel(selected);
    discovery.resolve(create(ModelSelectionPBSchema, { models: [f.model], selectedModel: f.model })); await loading;
    expect(f.store.getState().selectedModel?.name).toBe('chosen'); f.dispose();
  });
});
