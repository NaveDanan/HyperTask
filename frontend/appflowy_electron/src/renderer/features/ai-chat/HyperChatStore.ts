import { createStore, type StoreApi } from 'zustand';
import type { AIModelPB, ChatMessagePB } from '@shared/protobuf/flowy-ai/entities_pb';
import type { ReceivePort } from '@/backend/ports';
import { hyperChatBackend, type HyperChatBackend, type HyperChatEvent, type HyperChatSource } from './HyperChatBackend';

export interface HyperChatState {
  messages: ChatMessagePB[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  sending: boolean;
  stopping: boolean;
  draft: string;
  question: string;
  answer: string;
  metadata: string;
  progress: string;
  error: string | null;
  modelError: string | null;
  sourceError: string | null;
  models: AIModelPB[];
  selectedModel: AIModelPB | null;
  changingModel: boolean;
  ragIds: string[];
  sources: HyperChatSource[];
  loadingSources: boolean;
  savingSources: boolean;
  settingsLoaded: boolean;
}
export interface HyperChatStore extends StoreApi<HyperChatState> {
  start(): () => void;
  reload(): Promise<void>;
  loadMore(): Promise<void>;
  send(): Promise<void>;
  stop(): Promise<void>;
  selectModel(name: string): Promise<void>;
  loadSources(): Promise<void>;
  setSources(ids: string[]): Promise<void>;
}
export const hyperChatError = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
export const hyperChatModelKey = (model: AIModelPB) => `${model.isLocal ? 'local' : 'server'}:${model.name}`;
export function hyperMergeMessages(current: ChatMessagePB[], incoming: ChatMessagePB[]): ChatMessagePB[] {
  const messages = new Map(current.map(message => [message.messageId, message]));
  incoming.forEach(message => messages.set(message.messageId, message));
  return [...messages.values()].sort((a, b) => a.createdAt !== b.createdAt ? a.createdAt < b.createdAt ? -1 : 1 : a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0);
}
export function createHyperChatStore(chatId: string, service: HyperChatBackend = hyperChatBackend): HyperChatStore {
  const store = createStore<HyperChatState>(() => ({ messages: [], loading: true, loadingMore: false, hasMore: false, sending: false, stopping: false, draft: '', question: '', answer: '', metadata: '', progress: '', error: null, modelError: null, sourceError: null, models: [], selectedModel: null, changingModel: false, ragIds: [], sources: [], loadingSources: false, savingSources: false, settingsLoaded: false }));
  const get = store.getState;
  let alive = false, lifecycle = 0, generation = 0, responseGeneration = 0;
  let answerPort: ReceivePort | undefined, questionPort: ReceivePort | undefined;
  let stopListening: (() => void) | undefined;
  let submission: Promise<unknown> | undefined;
  let completion: Promise<void> = Promise.resolve(), complete: (() => void) | undefined;
  let pendingQuestionId: bigint | undefined;
  const set = (patch: Partial<HyperChatState>) => { if (alive) store.setState(patch); };
  const closePorts = () => { answerPort?.close(); questionPort?.close(); answerPort = undefined; questionPort = undefined; };
  const merge = (incoming: ChatMessagePB[]) => {
    const state = get();
    const patch: Partial<HyperChatState> = { messages: hyperMergeMessages(state.messages, incoming) };
    const question = incoming.find(message => message.authorType === 1n && (message.messageId === pendingQuestionId || !!state.question && message.content === state.question));
    if (question) { pendingQuestionId = question.messageId; patch.question = ''; }
    // FinishStreaming is emitted before the core persists its answer. Keep the streamed
    // response visible until its durable message arrives.
    if (incoming.some(message => message.authorType === 3n && message.content.trim() === state.answer.trim())) { patch.answer = ''; patch.metadata = ''; }
    set(patch);
  };
  const finish = () => { closePorts(); complete?.(); complete = undefined; set({ sending: false, stopping: false, progress: '' }); };
  const failStream = (error: string) => { closePorts(); complete?.(); complete = undefined; set({ sending: false, stopping: false, progress: '', error }); };
  const onEvent = (event: HyperChatEvent) => {
    // A disposed view still waits for the old stream to finish before releasing its core
    // listener. The core emits FinishStreaming after observing the stop flag.
    if (event.type === 'finish') { finish(); return; }
    if (event.type === 'error') { failStream(event.error); return; }
    if (!alive) return;
    switch (event.type) {
      case 'message': merge([event.message]); break;
      case 'messages': merge(event.messages); break;
      case 'settings': set({ ragIds: event.settings.ragIds }); break;
      case 'model': set({ selectedModel: event.model, modelError: null, models: [...get().models.filter(model => hyperChatModelKey(model) !== hyperChatModelKey(event.model)), event.model] }); break;
      case 'models': set({ models: event.selection.models, selectedModel: event.selection.selectedModel ?? null, modelError: null }); break;
    }
  };
  const reload = async () => {
    const version = lifecycle;
    set({ loading: true, error: null });
    try {
      const result = await service.load(chatId);
      if (!alive || version !== lifecycle) return;
      merge(result.messages);
      set({ hasMore: result.hasMore });
    } catch (error) { if (version === lifecycle) set({ error: hyperChatError(error) }); }
    finally { if (version === lifecycle) set({ loading: false }); }
  };
  const modelSettings = async (version: number) => {
    try {
      const selection = await service.models(chatId);
      if (version === lifecycle) set({ models: selection.models, selectedModel: selection.selectedModel ?? null, modelError: null });
    } catch (error) { if (version === lifecycle) set({ modelError: hyperChatError(error) }); }
  };
  const chatSettings = async (version: number) => {
    try { const settings = await service.settings(chatId); if (version === lifecycle) set({ ragIds: settings.ragIds, settingsLoaded: true }); }
    catch (error) { if (version === lifecycle) set({ sourceError: hyperChatError(error) }); }
  };
  const stop = async () => {
    if (!get().sending || get().stopping) return;
    const version = generation;
    set({ stopping: true });
    try {
      // The question may still be being created. Stop again after the request resolves so
      // cancellation cannot race the core resetting its stop flag at stream startup.
      await service.stop(chatId);
      await submission;
      if (version !== generation) return;
      await service.stop(chatId);
      // StopStream only sets a flag. Wait for FinishStreaming before permitting another
      // request, otherwise the new request could reset that flag while the old task runs.
      await completion;
    } catch (error) { if (version === generation) { set({ stopping: false, error: hyperChatError(error) }); } }
  };
  return Object.assign(store, {
    start() {
      alive = true;
      const version = ++lifecycle;
      set({ loadingMore: false, changingModel: false, loadingSources: false, savingSources: false });
      stopListening?.();
      stopListening = service.listen(chatId, onEvent);
      void Promise.allSettled([reload(), modelSettings(version), chatSettings(version)]);
      return () => {
        if (version !== lifecycle) return;
        alive = false; lifecycle++; generation++;
        const wasSending = get().sending;
        closePorts();
        if (wasSending) {
          // Wait for pending question creation before the final stop on disposal, too.
          const oldStop = stopListening; stopListening = undefined;
          void service.stop(chatId).catch(() => {}).then(() => submission?.catch(() => {})).then(() => service.stop(chatId)).then(() => completion).catch(() => {}).finally(() => oldStop?.());
        } else { stopListening?.(); stopListening = undefined; }
      };
    },
    reload,
    async loadMore() {
      const state = get();
      if (!alive || state.loading || state.loadingMore || !state.hasMore) return;
      const version = lifecycle;
      set({ loadingMore: true });
      try {
        const result = await service.load(chatId, state.messages[0]?.messageId);
        if (version !== lifecycle) return;
        merge(result.messages); set({ hasMore: result.hasMore });
      } catch (error) { if (version === lifecycle) set({ error: hyperChatError(error) }); }
      finally { if (version === lifecycle) set({ loadingMore: false }); }
    },
    async send() {
      const state = get(), message = state.draft.trim();
      if (!alive || submission || state.sending || state.loading || state.changingModel || state.savingSources || !message) return;
      closePorts();
      const version = ++generation;
      responseGeneration = version;
      completion = new Promise(resolve => { complete = resolve; });
      pendingQuestionId = undefined;
      set({ sending: true, stopping: false, question: message, answer: '', metadata: '', progress: '', draft: '', error: null });
      questionPort = service.openPort(value => {
        if (!alive || version !== generation || typeof value !== 'string') return;
        if (value.startsWith('message_id:')) {
          try { pendingQuestionId = BigInt(value.slice(11)); set({ question: '' }); } catch { /* The returned protobuf also contains the id. */ }
        } else if (value.startsWith('error:')) failStream(value.slice(6));
        else if (value.startsWith('start_index_file:')) set({ progress: value.slice(17) });
      });
      answerPort = service.openPort(value => {
        if (!alive || version !== generation || typeof value !== 'string') return;
        if (value.startsWith('data:')) set({ answer: get().answer + value.slice(5) });
        else if (value.startsWith('metadata:')) set({ metadata: value.slice(9) });
        else if (value.startsWith('error:')) failStream(value.slice(6));
        else if (value.startsWith('done:') || value.startsWith('finish:')) set({ progress: '' });
        else if (/^(local_ai_not_ready|local_ai_disabled|ai_response_limit|ai_image_response_limit|ai_max_required):/.test(value)) {
          const colon = value.indexOf(':');
          failStream(value.slice(colon + 1) || value.slice(0, colon).replaceAll('_', ' '));
        }
      });
      const answer = answerPort.port, question = questionPort.port;
      submission = Promise.resolve().then(() => service.send(chatId, message, answer, question));
      try {
        const savedQuestion = await submission as ChatMessagePB;
        if (!alive || version !== generation) return;
        pendingQuestionId = savedQuestion.messageId;
        merge([savedQuestion]); set({ question: '' });
      } catch (error) {
        if (alive && version === generation) {
          // Retain the draft when creating the question failed, so a retry is explicit.
          if (!pendingQuestionId) set({ draft: get().draft || message, question: '' });
          failStream(hyperChatError(error));
        }
      } finally { if (version === responseGeneration) submission = undefined; }
    },
    stop,
    async selectModel(name: string) {
      const state = get(), model = state.models.find(model => hyperChatModelKey(model) === name);
      if (!alive || !model || state.sending || state.changingModel) return;
      const version = lifecycle;
      set({ changingModel: true, modelError: null });
      try { await service.selectModel(chatId, model); if (version === lifecycle) set({ selectedModel: model }); }
      catch (error) { if (version === lifecycle) set({ modelError: hyperChatError(error) }); }
      finally { if (version === lifecycle) set({ changingModel: false }); }
    },
    async loadSources() {
      if (!alive || get().loadingSources) return;
      const version = lifecycle;
      set({ loadingSources: true, sourceError: null });
      try {
        if (!get().settingsLoaded) await chatSettings(version);
        if (!alive || version !== lifecycle) return;
        const sources = await service.sources();
        if (version === lifecycle) set({ sources });
      }
      catch (error) { if (version === lifecycle) set({ sourceError: hyperChatError(error) }); }
      finally { if (version === lifecycle) set({ loadingSources: false }); }
    },
    async setSources(ids: string[]) {
      if (!alive || !get().settingsLoaded || get().sending || get().savingSources) return;
      const version = lifecycle;
      set({ savingSources: true, sourceError: null });
      try { await service.setSources(chatId, [...new Set(ids)]); if (version === lifecycle) set({ ragIds: [...new Set(ids)] }); }
      catch (error) { if (version === lifecycle) set({ sourceError: hyperChatError(error) }); }
      finally { if (version === lifecycle) set({ savingSources: false }); }
    },
  });
}
