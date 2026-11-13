import { createStore, type StoreApi } from 'zustand';
import { CompletionTypePB, type AIModelPB, type CompleteTextTaskPB, type ModelSelectionPB } from '@shared/protobuf/flowy-ai/entities_pb';
import { AIEventCompleteText, AIEventGetSourceModelSelection, AIEventStopCompleteText, AIEventUpdateSelectedModel } from '@/backend/events/flowy-ai';
import { unwrap } from '@/backend/dispatch';
import { openReceivePort, type ReceivePort } from '@/backend/ports';

export type HyperDocumentAIAction = 'summarize' | 'rewrite' | 'grammar' | 'continue' | 'explain' | 'translate';
export interface HyperDocumentAISource { sourceText: string; selectionKey?: string; usedSelection: boolean }
export function hyperCanReplaceDocumentAI(source: HyperDocumentAISource | null, selectionText: string, selectionKey?: string): boolean {
  return !!source?.usedSelection && source.sourceText === selectionText && source.selectionKey === selectionKey;
}
export interface HyperDocumentAIRequest { documentId: string; action: HyperDocumentAIAction; sourceText: string; language?: string; port: bigint }
export function hyperDocumentAIRequest(input: HyperDocumentAIRequest) {
  const type = {
    summarize: CompletionTypePB.CustomPrompt, rewrite: CompletionTypePB.ImproveWriting,
    grammar: CompletionTypePB.SpellingAndGrammar, continue: CompletionTypePB.ContinueWriting,
    explain: CompletionTypePB.ExplainSelected, translate: CompletionTypePB.CustomPrompt,
  }[input.action];
  let prompt: string | undefined;
  if (input.action === 'summarize') prompt = 'Summarize the source text accurately. Return only the summary.';
  if (input.action === 'translate') {
    const language = input.language?.trim();
    if (!language) throw new Error('Enter the language to translate into.');
    prompt = `Translate the source text into ${language}. Preserve meaning and formatting. Return only the translation.`;
  }
  if (!input.sourceText.trim()) throw new Error('Select some text or write content in this page first.');
  return {
    objectId: input.documentId, text: input.sourceText, completionType: type, streamPort: input.port,
    ...(prompt ? { oneOfCustomPrompt: { case: 'customPrompt' as const, value: prompt } } : {}),
  };
}
export interface HyperDocumentAIBackend {
  complete(input: HyperDocumentAIRequest): Promise<CompleteTextTaskPB>;
  stop(taskId: string): Promise<void>;
  models(documentId: string): Promise<ModelSelectionPB>;
  selectModel(documentId: string, model: AIModelPB): Promise<void>;
  openPort(listener: (value: unknown) => void): ReceivePort;
}
export const hyperDocumentAIBackend: HyperDocumentAIBackend = {
  complete: async input => unwrap(await AIEventCompleteText(hyperDocumentAIRequest(input))),
  stop: async taskId => unwrap(await AIEventStopCompleteText({ taskId })),
  models: async source => unwrap(await AIEventGetSourceModelSelection({ source })),
  selectModel: async (source, selectedModel) => unwrap(await AIEventUpdateSelectedModel({ source, selectedModel })),
  openPort: openReceivePort,
};
export interface HyperDocumentAIState {
  status: 'idle' | 'generating' | 'stopping' | 'ready' | 'cancelled' | 'error';
  result: string;
  comment: string;
  error: string | null;
  source: HyperDocumentAISource | null;
  models: AIModelPB[];
  selectedModel: AIModelPB | null;
  modelError: string | null;
  changingModel: boolean;
}
export interface HyperDocumentAIStore extends StoreApi<HyperDocumentAIState> {
  start(): () => void;
  run(action: HyperDocumentAIAction, source: HyperDocumentAISource, language?: string): Promise<void>;
  stop(): Promise<void>;
  loadModels(): Promise<void>;
  selectModel(model: AIModelPB): Promise<void>;
  dispose(): void;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
export function createHyperDocumentAIStore(documentId: string, service: HyperDocumentAIBackend = hyperDocumentAIBackend): HyperDocumentAIStore {
  const store = createStore<HyperDocumentAIState>(() => ({ status: 'idle', result: '', comment: '', error: null, source: null, models: [], selectedModel: null, modelError: null, changingModel: false }));
  let port: ReceivePort | undefined, taskId: string | undefined, request: Promise<CompleteTextTaskPB> | undefined;
  let disposed = false, version = 0, modelVersion = 0, cancelled = false;
  const stoppingTasks = new Map<string, Promise<void>>();
  const stopTask = (id: string) => {
    let stopping = stoppingTasks.get(id);
    if (!stopping) {
      stopping = Promise.resolve().then(() => service.stop(id)).catch(error => { stoppingTasks.delete(id); throw error; });
      stoppingTasks.set(id, stopping);
    }
    return stopping;
  };
  const set = (state: Partial<HyperDocumentAIState>) => { if (!disposed) store.setState(state); };
  const close = () => { port?.close(); port = undefined; };
  const busy = () => ['generating', 'stopping'].includes(store.getState().status);
  const stop = async () => {
    if (!busy() || store.getState().status === 'stopping') return;
    cancelled = true;
    const current = version;
    set({ status: 'stopping' });
    try {
      const task = taskId ?? (await request)?.taskId;
      if (task) await stopTask(task);
      if (disposed || current !== version) return;
      close(); set({ status: 'cancelled', comment: '' });
    } catch (error) { if (!disposed && current === version) { close(); set({ status: 'error', error: errorText(error), comment: '' }); } }
  };
  return Object.assign(store, {
    start() {
      disposed = false;
      set({ changingModel: false });
      if (busy()) set({ status: 'cancelled', comment: '' });
      void this.loadModels();
      return () => this.dispose();
    },
    async run(action: HyperDocumentAIAction, source: HyperDocumentAISource, language?: string) {
      if (disposed || request || busy() || store.getState().changingModel) return;
      close(); taskId = undefined; cancelled = false;
      const current = ++version;
      let terminal = false;
      set({ status: 'generating', result: '', comment: '', error: null, source: { ...source } });
      try { port = service.openPort(value => {
        if (disposed || current !== version || terminal || typeof value !== 'string') return;
        if (cancelled && !value.startsWith('finish:') && !value.startsWith('done:')) return;
        if (value.startsWith('data:')) set({ result: store.getState().result + value.slice(5) });
        else if (value.startsWith('comment:')) set({ comment: value.slice(8) });
        else if (value.startsWith('finish:') || value.startsWith('done:')) { terminal = true; close(); set({ status: cancelled ? 'cancelled' : 'ready', comment: '' }); }
        else if (value.startsWith('error:')) { terminal = true; close(); set({ status: 'error', error: value.slice(6), comment: '' }); }
        else if (/^(local_ai_not_ready|local_ai_disabled|ai_response_limit|ai_image_response_limit|ai_max_required):/.test(value)) {
          const colon = value.indexOf(':'); terminal = true; close(); set({ status: 'error', error: value.slice(colon + 1) || value.slice(0, colon).replaceAll('_', ' '), comment: '' });
        }
      }); } catch (error) { set({ status: 'error', error: errorText(error) }); return; }
      const streamPort = port.port;
      const pending = Promise.resolve().then(() => service.complete({ documentId, action, sourceText: source.sourceText, language, port: streamPort }));
      request = pending;
      try {
        const task = await pending;
        if (disposed || current !== version) { await stopTask(task.taskId).catch(() => {}); return; }
        taskId = task.taskId;
      } catch (error) { if (!disposed && current === version) { close(); set({ status: 'error', error: errorText(error), comment: '' }); } }
      finally { if (request === pending) request = undefined; }
    },
    stop,
    async loadModels() {
      if (disposed) return;
      const current = version, requestVersion = ++modelVersion;
      try { const selection = await service.models(documentId); if (current === version && requestVersion === modelVersion) set({ models: selection.models, selectedModel: selection.selectedModel ?? null, modelError: null }); }
      catch (error) { if (current === version && requestVersion === modelVersion) set({ modelError: errorText(error) }); }
    },
    async selectModel(model: AIModelPB) {
      if (disposed || busy() || store.getState().changingModel) return;
      const current = version;
      modelVersion++;
      set({ changingModel: true, modelError: null });
      try { await service.selectModel(documentId, model); if (current === version) set({ selectedModel: model }); }
      catch (error) { if (current === version) set({ modelError: errorText(error) }); }
      finally { if (current === version) set({ changingModel: false }); }
    },
    dispose() {
      if (disposed) return;
      const pending = request, id = taskId;
      disposed = true; version++; close(); request = undefined; taskId = undefined;
      if (id) void stopTask(id).catch(() => {});
      else if (pending) void pending.then(task => stopTask(task.taskId)).catch(() => {});
    },
  });
}
