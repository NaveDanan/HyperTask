import { createStore, type StoreApi } from 'zustand';
import { CompletionTypePB, type AIModelPB, type CompleteTextTaskPB, type ModelSelectionPB } from '@shared/protobuf/flowy-ai/entities_pb';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { AIEventCompleteText, AIEventGetSourceModelSelection, AIEventStopCompleteText, AIEventUpdateSelectedModel } from '@/backend/events/flowy-ai';
import { unwrap } from '@/backend/dispatch';
import { openReceivePort, type ReceivePort } from '@/backend/ports';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import {
  hyperAssertCanvasAISource, hyperBuildCanvasAI, hyperCanvasAILimits, hyperCanvasAIPreview,
  hyperCanvasAIPrompt, hyperCaptureCanvasAISource, hyperParseCanvasAIResult,
  type HyperCanvasAIKind, type HyperCanvasAIResult, type HyperCanvasAISource, type HyperCanvasAISourceOptions,
} from './HyperCanvasAIModel';

export interface HyperCanvasAIRequest { documentId: string; kind: HyperCanvasAIKind; instruction: string; source: string; port: bigint }
export function hyperCanvasAIRequest(input: HyperCanvasAIRequest) {
  const prompt = hyperCanvasAIPrompt(input.kind, input.instruction, input.source);
  return { objectId: input.documentId, text: prompt.text, completionType: CompletionTypePB.CustomPrompt,
    streamPort: input.port, ragIds: [], oneOfCustomPrompt: { case: 'customPrompt' as const, value: prompt.customPrompt } };
}
export interface HyperCanvasAIBackend {
  complete(request: HyperCanvasAIRequest): Promise<CompleteTextTaskPB>;
  stop(taskId: string): Promise<void>;
  models(documentId: string): Promise<ModelSelectionPB>;
  selectModel(documentId: string, model: AIModelPB): Promise<void>;
  openPort(listener: (value: unknown) => void): ReceivePort;
}
export const hyperCanvasAIBackend: HyperCanvasAIBackend = {
  complete: async input => unwrap(await AIEventCompleteText(hyperCanvasAIRequest(input))),
  stop: async taskId => unwrap(await AIEventStopCompleteText({ taskId })),
  models: async source => unwrap(await AIEventGetSourceModelSelection({ source })),
  selectModel: async (source, selectedModel) => unwrap(await AIEventUpdateSelectedModel({ source, selectedModel })),
  openPort: openReceivePort,
};
export interface HyperCanvasAIState {
  status: 'idle' | 'generating' | 'ready' | 'cancelled' | 'applying' | 'applied' | 'error';
  result: HyperCanvasAIResult | null;
  preview: DocumentDataPB | null;
  error: string | null;
  comment: string;
  models: AIModelPB[];
  selectedModel: AIModelPB | null;
  changingModel: boolean;
  modelError: string | null;
}
export interface HyperCanvasAIStore extends StoreApi<HyperCanvasAIState> {
  start(): () => void;
  generate(kind: HyperCanvasAIKind, instruction: string, options: HyperCanvasAISourceOptions): Promise<void>;
  reset(): void;
  stop(): void;
  loadModels(): Promise<void>;
  selectModel(model: AIModelPB): Promise<void>;
  apply(): Promise<string | undefined>;
  dispose(): void;
}
export interface HyperCanvasAIContext {
  session: HyperDocumentSession;
  owner: HyperDocumentOwner;
  editable(): boolean;
  selectedIds(): readonly string[];
  currentOwner?(): HyperDocumentOwner | null;
}
const message = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
/** The live document is only changed by apply(), once, after the user reviews a temporary preview. */
export function createHyperCanvasAIStore(context: HyperCanvasAIContext, backend: HyperCanvasAIBackend = hyperCanvasAIBackend): HyperCanvasAIStore {
  const { session } = context, owner = { ...context.owner }, ownerKey = hyperDocumentOwnerKey(owner);
  const store = createStore<HyperCanvasAIState>(() => ({ status: 'idle', result: null, preview: null, error: null, comment: '', models: [], selectedModel: null, changingModel: false, modelError: null }));
  let disposed = false, contextLost = false, version = 0, modelVersion = 0, source: HyperCanvasAISource | null = null;
  let port: ReceivePort | undefined, taskId: string | undefined, pending: Promise<CompleteTextTaskPB> | undefined;
  let stopWatching: (() => void) | undefined;
  const stopped = new Set<string>();
  const set = (value: Partial<HyperCanvasAIState>) => { if (!disposed) store.setState(value); };
  const requireCurrent = () => {
    const state = session.store.getState();
    if (disposed || contextLost || !owner.isCurrent() || hyperDocumentOwnerKey((context.currentOwner ?? hyperGetDocumentOwner)()) !== ownerKey || !session.belongsTo(owner) || !session.isCurrentOwner()) { contextLost = true; throw new Error('The document, workspace or account changed. Reopen Canvas AI.'); }
    if (!context.editable() || !state.document || state.historyPending || state.status === 'error' || state.status === 'loading') throw new Error('The canvas cannot be edited right now.');
    return state.document;
  };
  const stopTask = async (id: string) => {
    if (stopped.has(id)) return;
    stopped.add(id);
    try { await backend.stop(id); } catch (error) { stopped.delete(id); if (!disposed) set({ error: message(error) }); }
  };
  const close = () => { port?.close(); port = undefined; };
  const cancel = () => {
    version++; close();
    const id = taskId, request = pending;
    taskId = undefined; pending = undefined;
    if (id) void stopTask(id);
    else if (request) void request.then(task => stopTask(task.taskId)).catch(() => {});
  };
  const busy = () => ['generating', 'applying'].includes(store.getState().status);
  const reset = () => { if (disposed || store.getState().status === 'applying') return; cancel(); source = null; set({ status: 'idle', result: null, preview: null, error: null, comment: '' }); };
  return Object.assign(store, {
    start() {
      disposed = false;
      reset(); set({ changingModel: false });
      stopWatching?.();
      stopWatching = session.store.subscribe(() => {
        if (disposed) return;
        try { requireCurrent(); } catch { cancel(); source = null; set({ status: 'cancelled', result: null, preview: null, comment: '' }); }
      });
      void this.loadModels(); return () => this.dispose();
    },
    reset,
    async generate(kind: HyperCanvasAIKind, instruction: string, options: HyperCanvasAISourceOptions) {
      if (disposed || busy() || store.getState().changingModel) return;
      reset();
      const current = version;
      let terminal = false, raw = '';
      try {
        const doc = requireCurrent();
        source = hyperCaptureCanvasAISource(doc, options);
        hyperCanvasAIPrompt(kind, instruction, source.text);
        set({ status: 'generating' });
        port = backend.openPort(value => {
          if (disposed || version !== current || terminal || typeof value !== 'string') return;
          try {
            requireCurrent();
            if (value.startsWith('data:')) {
              raw += value.slice(5);
              if (raw.length > hyperCanvasAILimits.output) throw new Error('The AI result exceeds the canvas size limit.');
            } else if (value.startsWith('comment:')) set({ comment: value.slice(8, 520) });
            else if (value.startsWith('finish:') || value.startsWith('done:')) {
              terminal = true; close();
              const result = hyperParseCanvasAIResult(raw, kind), preview = hyperCanvasAIPreview(result);
              set({ status: 'ready', result, preview, comment: '' });
            } else if (value.startsWith('error:') || /^(local_ai_not_ready|local_ai_disabled|ai_response_limit|ai_image_response_limit|ai_max_required):/.test(value)) {
              throw new Error(value.slice(value.indexOf(':') + 1) || 'AI generation failed.');
            }
          } catch (error) { terminal = true; cancel(); source = null; set({ status: 'error', error: message(error), result: null, preview: null, comment: '' }); }
        });
        const streamPort = port.port, included = source.text;
        const request = Promise.resolve().then(() => { if (disposed || current !== version) throw new Error('Generation cancelled.'); requireCurrent(); return backend.complete({ documentId: session.id, kind, instruction, source: included, port: streamPort }); });
        pending = request;
        try {
          const task = await request;
          if (disposed || current !== version) { await stopTask(task.taskId); return; }
          taskId = terminal ? undefined : task.taskId;
        } finally { if (pending === request) pending = undefined; }
      } catch (error) { if (!disposed && current === version) { close(); source = null; set({ status: 'error', error: message(error), result: null, preview: null, comment: '' }); } }
    },
    stop() { if (disposed || store.getState().status !== 'generating') return; cancel(); source = null; set({ status: 'cancelled', result: null, preview: null, comment: '' }); },
    async loadModels() {
      const current = ++modelVersion;
      try { requireCurrent(); const selection = await backend.models(session.id); requireCurrent(); if (current === modelVersion) set({ models: selection.models, selectedModel: selection.selectedModel ?? null, modelError: null }); }
      catch (error) { if (current === modelVersion) set({ modelError: message(error) }); }
    },
    async selectModel(model: AIModelPB) {
      if (disposed || busy() || store.getState().changingModel) return;
      reset(); const current = ++modelVersion;
      set({ changingModel: true, modelError: null });
      try { requireCurrent(); await backend.selectModel(session.id, model); requireCurrent(); if (current === modelVersion) set({ selectedModel: model }); }
      catch (error) { if (current === modelVersion) set({ modelError: message(error) }); }
      finally { if (current === modelVersion) set({ changingModel: false }); }
    },
    async apply() {
      const state = store.getState(), included = source;
      if (disposed || state.status !== 'ready' || !state.result || !included) throw new Error('Generate and review a canvas result before applying.');
      const current = version, result = state.result;
      set({ status: 'applying', error: null });
      let accepted = false;
      try {
        requireCurrent(); await session.flush(); requireCurrent();
        if (version !== current) throw new Error('The canvas request changed. Generate again.');
        const change = session.change(doc => { requireCurrent(); hyperAssertCanvasAISource(doc, included, context.selectedIds()); return hyperBuildCanvasAI(doc, result); });
        if (!change) throw new Error('The canvas cannot be edited right now.');
        accepted = true; source = null;
        await session.flush();
        set({ status: 'applied' });
        return change.focus?.id;
      } catch (error) {
        // An accepted local draft must never be inserted twice after a failed save.
        set({ status: accepted ? 'error' : 'ready', error: message(error) }); throw error;
      }
    },
    dispose() { if (disposed) return; cancel(); disposed = true; modelVersion++; source = null; stopWatching?.(); stopWatching = undefined; },
  });
}
