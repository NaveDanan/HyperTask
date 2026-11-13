import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageListPBSchema, ChatMessagePBSchema, ChatSettingsPBSchema, LocalAISettingPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { DocumentTextPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import * as ai from '@/backend/events/flowy-ai';
import * as folder from '@/backend/events/flowy-folder';
import * as document from '@/backend/events/flowy-document';
import { flushHyperDocument } from '../document/HyperDocumentSession';
import { hyperChatBackend, hyperChatSources } from './HyperChatBackend';

vi.mock('@/backend/events/flowy-ai', () => ({
  AIEventLoadPrevMessage: vi.fn(), AIEventGetChatSettings: vi.fn(), AIEventGetSourceModelSelection: vi.fn(), AIEventStopStream: vi.fn(),
  AIEventStreamMessage: vi.fn(), AIEventUpdateChatSettings: vi.fn(), AIEventUpdateSelectedModel: vi.fn(), AIEventGetLocalAISetting: vi.fn(), AIEventCreateChatContext: vi.fn(),
}));
vi.mock('@/backend/events/flowy-folder', () => ({ FolderEventGetCurrentWorkspaceSetting: vi.fn(), FolderEventReadWorkspaceViews: vi.fn(), FolderEventGetView: vi.fn() }));
vi.mock('@/backend/events/flowy-document', () => ({ DocumentEventGetDocumentText: vi.fn() }));
vi.mock('../document/HyperDocumentSession', () => ({ flushHyperDocument: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ai.AIEventGetLocalAISetting).mockResolvedValue({ ok: true, value: create(LocalAISettingPBSchema, { serverUrl: 'openai+file:/test/settings.json' }) });
  vi.mocked(ai.AIEventGetChatSettings).mockResolvedValue({ ok: true, value: create(ChatSettingsPBSchema, { ragIds: ['selected-page'] }) });
  vi.mocked(folder.FolderEventGetView).mockResolvedValue({ ok: true, value: create(ViewPBSchema, { id: 'selected-page', name: 'Selected page', layout: ViewLayoutPB.Document }) });
  vi.mocked(document.DocumentEventGetDocumentText).mockResolvedValue({ ok: true, value: create(DocumentTextPBSchema, { text: 'Current saved document text' }) });
  vi.mocked(ai.AIEventCreateChatContext).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(ai.AIEventStreamMessage).mockResolvedValue({ ok: true, value: create(ChatMessagePBSchema, { messageId: 1n }) });
});
describe('Hyper chat backend contracts', () => {
  it('preserves exact bigint cursors and sends a user message with both native ports', async () => {
    vi.mocked(ai.AIEventLoadPrevMessage).mockResolvedValue({ ok: true, value: create(ChatMessageListPBSchema) });
    await hyperChatBackend.load('chat', 9007199254740993n);
    expect(ai.AIEventLoadPrevMessage).toHaveBeenCalledWith({ chatId: 'chat', limit: 50n, oneOfBeforeMessageId: { case: 'beforeMessageId', value: 9007199254740993n } });
    await hyperChatBackend.send('chat', 'Q', 8n, 9n);
    expect(ai.AIEventStreamMessage).toHaveBeenCalledWith({ chatId: 'chat', message: 'Q', answerStreamPort: 8n, questionStreamPort: 9n, messageType: 1 });
  });
  it('refreshes only selected endpoint sources after flushing pending editor changes', async () => {
    await hyperChatBackend.send('chat', 'Q', 8n, 9n);
    expect(flushHyperDocument).toHaveBeenCalledWith('selected-page');
    expect(folder.FolderEventGetView).toHaveBeenCalledTimes(1);
    expect(document.DocumentEventGetDocumentText).toHaveBeenCalledWith({ documentId: 'selected-page' });
    expect(ai.AIEventCreateChatContext).toHaveBeenCalledWith({ chatId: 'chat', contentType: 'text/plain', text: 'Selected page\n\nCurrent saved document text', metadata: { id: 'selected-page', name: 'Selected page' } });
    expect(vi.mocked(flushHyperDocument).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(document.DocumentEventGetDocumentText).mock.invocationCallOrder[0]);
    expect(vi.mocked(ai.AIEventCreateChatContext).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ai.AIEventStreamMessage).mock.invocationCallOrder[0]);
  });
  it('leaves Ollama and self-hosted context synchronization to the core', async () => {
    vi.mocked(ai.AIEventGetLocalAISetting).mockResolvedValue({ ok: true, value: create(LocalAISettingPBSchema, { serverUrl: 'http://localhost:11434' }) });
    await hyperChatBackend.send('chat', 'Q', 8n, 9n);
    expect(ai.AIEventGetChatSettings).not.toHaveBeenCalled();
    expect(ai.AIEventCreateChatContext).not.toHaveBeenCalled();
    expect(ai.AIEventStreamMessage).toHaveBeenCalledOnce();
  });
  it('refuses to send stale or incomplete source text when a selected page cannot be read', async () => {
    vi.mocked(document.DocumentEventGetDocumentText).mockResolvedValue({ ok: false, error: create(FlowyErrorSchema, { msg: 'permission denied' }) });
    await expect(hyperChatBackend.send('chat', 'Q', 8n, 9n)).rejects.toMatchObject({ msg: 'permission denied' });
    expect(ai.AIEventStreamMessage).not.toHaveBeenCalled();
  });
  it('does not read documents when the chat has no selected sources', async () => {
    vi.mocked(ai.AIEventGetChatSettings).mockResolvedValue({ ok: true, value: create(ChatSettingsPBSchema) });
    await hyperChatBackend.send('chat', 'Q', 8n, 9n);
    expect(document.DocumentEventGetDocumentText).not.toHaveBeenCalled();
    expect(ai.AIEventCreateChatContext).not.toHaveBeenCalled();
  });
  it('flattens nested document sources once and excludes database and chat pages', () => {
    const child = create(ViewPBSchema, { id: 'child', name: 'Nested doc', layout: ViewLayoutPB.Document });
    const root = create(ViewPBSchema, { id: 'root', name: 'Root', layout: ViewLayoutPB.Grid, childViews: [child] });
    child.childViews.push(root);
    expect(hyperChatSources([root, child])).toEqual([{ id: 'child', name: 'Nested doc' }]);
  });
});
