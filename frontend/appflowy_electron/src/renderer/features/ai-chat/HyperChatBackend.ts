import { fromBinary } from '@bufbuild/protobuf';
import {
  AIModelPBSchema, ChatMessageErrorPBSchema, ChatMessageListPBSchema, ChatMessagePBSchema, ChatSettingsPBSchema,
  ChatMessageTypePB, type AIModelPB, type ChatMessageListPB, type ChatMessagePB, type ChatSettingsPB, type ModelSelectionPB,
} from '@shared/protobuf/flowy-ai/entities_pb';
import { ChatNotification } from '@shared/protobuf/flowy-ai/notification_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import {
  AIEventGetChatSettings, AIEventGetSourceModelSelection, AIEventLoadPrevMessage, AIEventStopStream,
  AIEventStreamMessage, AIEventUpdateChatSettings, AIEventUpdateSelectedModel, AIEventGetLocalAISetting, AIEventCreateChatContext,
} from '@/backend/events/flowy-ai';
import { FolderEventGetCurrentWorkspaceSetting, FolderEventReadWorkspaceViews, FolderEventGetView } from '@/backend/events/flowy-folder';
import { DocumentEventGetDocumentText } from '@/backend/events/flowy-document';
import { unwrap } from '@/backend/dispatch';
import { listen, NotificationSource } from '@/backend/notifications';
import { openReceivePort, type ReceivePort } from '@/backend/ports';
import { flushHyperDocument } from '../document/HyperDocumentSession';

export type HyperChatEvent =
  | { type: 'message'; message: ChatMessagePB }
  | { type: 'messages'; messages: ChatMessagePB[] }
  | { type: 'settings'; settings: ChatSettingsPB }
  | { type: 'model'; model: AIModelPB }
  | { type: 'models'; selection: ModelSelectionPB }
  | { type: 'error'; error: string }
  | { type: 'finish' };
export interface HyperChatSource { id: string; name: string }
export interface HyperChatBackend {
  load(chatId: string, before?: bigint): Promise<ChatMessageListPB>;
  settings(chatId: string): Promise<ChatSettingsPB>;
  models(chatId: string): Promise<ModelSelectionPB>;
  selectModel(chatId: string, model: AIModelPB): Promise<void>;
  setSources(chatId: string, ids: string[]): Promise<void>;
  sources(): Promise<HyperChatSource[]>;
  send(chatId: string, message: string, answerPort: bigint, questionPort: bigint): Promise<ChatMessagePB>;
  stop(chatId: string): Promise<void>;
  listen(chatId: string, listener: (event: HyperChatEvent) => void): () => void;
  openPort(listener: (value: unknown) => void): ReceivePort;
}

export function hyperChatSources(views: ViewPB[]): HyperChatSource[] {
  const seen = new Set<string>(), result: HyperChatSource[] = [], stack = [...views].reverse();
  while (stack.length) {
    const view = stack.pop()!;
    if (seen.has(view.id)) continue;
    seen.add(view.id);
    if (view.layout === ViewLayoutPB.Document) result.push({ id: view.id, name: view.name });
    stack.push(...[...view.childViews].reverse());
  }
  return result;
}

async function refreshEndpointSources(chatId: string, requireCurrent: () => void) {
  requireCurrent();
  const local = unwrap(await AIEventGetLocalAISetting());
  requireCurrent();
  if (!local.serverUrl.startsWith('openai+file:')) return;
  // Endpoint mode deliberately skips the upstream Ollama/cloud indexing job. Refresh only
  // the pages selected for this chat, including pending edits, before creating the question.
  const settings = unwrap(await AIEventGetChatSettings({ value: chatId }));
  requireCurrent();
  for (const id of settings.ragIds) {
    requireCurrent();
    await flushHyperDocument(id);
    requireCurrent();
    const view = unwrap(await FolderEventGetView({ value: id }));
    requireCurrent();
    if (view.layout !== ViewLayoutPB.Document) throw new Error('This chat source is not a document page. Remove it from Sources before sending.');
    const document = unwrap(await DocumentEventGetDocumentText({ documentId: id }));
    requireCurrent();
    unwrap(await AIEventCreateChatContext({ chatId, contentType: 'text/plain', text: `${view.name}\n\n${document.text}`, metadata: { id, name: view.name } }));
    requireCurrent();
  }
}

/** An owner check also guards the multi-event source refresh inside send(). */
export function createHyperChatBackend(isCurrent: () => boolean = () => true): HyperChatBackend {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('The chat workspace or account changed.'); };
  return {
  load: async (chatId, before) => unwrap(await AIEventLoadPrevMessage({ chatId, limit: 50n, ...(before !== undefined ? { oneOfBeforeMessageId: { case: 'beforeMessageId', value: before } } : {}) })),
  settings: async value => unwrap(await AIEventGetChatSettings({ value })),
  models: async source => unwrap(await AIEventGetSourceModelSelection({ source })),
  selectModel: async (source, selectedModel) => unwrap(await AIEventUpdateSelectedModel({ source, selectedModel })),
  setSources: async (value, ragIds) => unwrap(await AIEventUpdateChatSettings({ chatId: { value }, ragIds })),
  sources: async () => {
    requireCurrent();
    const setting = unwrap(await FolderEventGetCurrentWorkspaceSetting());
    requireCurrent();
    const views = unwrap(await FolderEventReadWorkspaceViews({ value: setting.workspaceId }));
    requireCurrent();
    return hyperChatSources(views.items);
  },
  send: async (chatId, message, answerStreamPort, questionStreamPort) => {
    requireCurrent();
    await refreshEndpointSources(chatId, requireCurrent);
    requireCurrent();
    const saved = unwrap(await AIEventStreamMessage({ chatId, message, answerStreamPort, questionStreamPort, messageType: ChatMessageTypePB.User }));
    requireCurrent();
    return saved;
  },
  stop: async chatId => unwrap(await AIEventStopStream({ chatId })),
  openPort: openReceivePort,
  listen: (chatId, listener) => listen<ChatNotification>(NotificationSource.Chat, (type, result) => {
    if (!result.ok) { listener({ type: 'error', error: result.error.msg }); return; }
    try {
      switch (type) {
        case ChatNotification.DidReceiveChatMessage: listener({ type: 'message', message: fromBinary(ChatMessagePBSchema, result.value) }); break;
        case ChatNotification.DidLoadLatestChatMessage: case ChatNotification.DidLoadPrevChatMessage:
          listener({ type: 'messages', messages: fromBinary(ChatMessageListPBSchema, result.value).messages }); break;
        case ChatNotification.StreamChatMessageError: listener({ type: 'error', error: fromBinary(ChatMessageErrorPBSchema, result.value).errorMessage }); break;
        case ChatNotification.FinishStreaming: listener({ type: 'finish' }); break;
        case ChatNotification.DidUpdateChatSettings: listener({ type: 'settings', settings: fromBinary(ChatSettingsPBSchema, result.value) }); break;
        case ChatNotification.DidUpdateSelectedModel: listener({ type: 'model', model: fromBinary(AIModelPBSchema, result.value) }); break;
      }
    } catch { listener({ type: 'error', error: 'Could not read an AI chat update.' }); }
  }, chatId),
  };
}

export const hyperChatBackend: HyperChatBackend = createHyperChatBackend();
