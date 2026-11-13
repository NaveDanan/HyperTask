import { create, toBinary, type DescMessage } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIModelPBSchema, ChatMessageListPBSchema, ChatMessagePBSchema, ChatSettingsPBSchema, LocalAISettingPBSchema, ModelSelectionPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { DocumentTextPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { createHyperChatBackend, type HyperChatBackend, type HyperChatEvent } from './HyperChatBackend';
import { createHyperScopedChatBackend, HyperChatOwnerError } from './HyperChatScopedBackend';

const chatId = 'same-chat';
const message = (content: string) => create(ChatMessagePBSchema, { messageId: 1n, createdAt: 1n, authorType: 3n, content });
function fixture() {
  let active = true, notify: (event: HyperChatEvent) => void = () => {};
  const received: HyperChatEvent[] = [], opened: Array<{ port: bigint; closed: boolean; listener(value: unknown): void }> = [];
  const close = vi.fn();
  const base = {
    load: vi.fn(async () => create(ChatMessageListPBSchema, { messages: [message('Authoritative history')] })),
    settings: vi.fn(async () => create(ChatSettingsPBSchema, { ragIds: ['authoritative-page'] })),
    models: vi.fn(async () => create(ModelSelectionPBSchema, { models: [create(AIModelPBSchema, { name: 'Current model' })] })),
    selectModel: vi.fn(async () => {}), setSources: vi.fn(async () => {}), sources: vi.fn(async () => []),
    send: vi.fn(async () => message('Saved question')), stop: vi.fn(async () => {}),
    listen: vi.fn((_chatId: string, listener: (event: HyperChatEvent) => void) => { notify = listener; return close; }),
    openPort: vi.fn((listener: (value: unknown) => void) => {
      const item = { port: BigInt(opened.length + 1), listener, closed: false }; opened.push(item);
      return { port: item.port, close: () => { item.closed = true; } };
    }),
  } satisfies HyperChatBackend;
  const scoped = createHyperScopedChatBackend({ workspaceId: 'workspace', actorId: 'actor', contextKey: 'server', isCurrent: () => active }, base);
  const unsubscribe = scoped.listen(chatId, event => received.push(event));
  return { base, scoped, received, opened, close, unsubscribe, notify: (event: HyperChatEvent) => notify(event), loseOwner: () => { active = false; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('Hyper chat backend ownership', () => {
  it('treats notification payloads as invalidations and fetches current messages, settings and full model selection', async () => {
    const f = fixture();
    f.notify({ type: 'message', message: message('OLD owner secret') });
    f.notify({ type: 'settings', settings: create(ChatSettingsPBSchema, { ragIds: ['OLD owner source'] }) });
    f.notify({ type: 'model', model: create(AIModelPBSchema, { name: 'OLD owner model' }) });
    await vi.waitFor(() => expect(f.received).toHaveLength(3));
    expect(f.received).toEqual(expect.arrayContaining([
      { type: 'messages', messages: [message('Authoritative history')] },
      { type: 'settings', settings: create(ChatSettingsPBSchema, { ragIds: ['authoritative-page'] }) },
      { type: 'models', selection: create(ModelSelectionPBSchema, { models: [create(AIModelPBSchema, { name: 'Current model' })] }) },
    ]));
    expect(f.base.load).toHaveBeenCalledWith(chatId);
    expect(f.received.some(event => JSON.stringify(event, (_, value) => typeof value === 'bigint' ? String(value) : value).includes('OLD'))).toBe(false);
  });
  it('ignores global finish/errors and accepts completion only from its captured answer port', async () => {
    const f = fixture(), question = vi.fn(), answer = vi.fn();
    const q = f.scoped.openPort(question), a = f.scoped.openPort(answer);
    await f.scoped.send(chatId, 'Question', a.port, q.port);
    f.notify({ type: 'finish' }); f.notify({ type: 'error', error: 'Another owner failure' });
    f.opened[0].listener('finish:question');
    expect(f.received).toEqual([]);
    f.opened[1].listener('data:Current answer'); f.opened[1].listener('finish:');
    expect(answer.mock.calls).toEqual([['data:Current answer'], ['finish:']]);
    expect(f.received).toEqual([{ type: 'finish' }]);
    a.close(); f.opened[1].listener('finish:late');
    expect(f.received).toHaveLength(1);
  });
  it('settles a stale stream locally, closes ports/listener, and never stops the new owner chat', async () => {
    const f = fixture(), q = f.scoped.openPort(() => {}), a = f.scoped.openPort(() => {});
    await f.scoped.send(chatId, 'Question', a.port, q.port);
    f.loseOwner(); await f.scoped.stop(chatId);
    expect(f.base.stop).not.toHaveBeenCalled(); expect(f.received).toEqual([{ type: 'finish' }]);
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.opened.every(port => port.closed)).toBe(true);
    await f.scoped.stop(chatId); f.unsubscribe(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('guards every asynchronous read and mutation before dispatch and after an awaited reply', async () => {
    const f = fixture();
    let release!: (value: ReturnType<typeof create<typeof ChatMessageListPBSchema>>) => void;
    f.base.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.scoped.load(chatId); f.loseOwner(); release(create(ChatMessageListPBSchema, {}));
    await expect(pending).rejects.toBeInstanceOf(HyperChatOwnerError);
    for (const call of [() => f.scoped.load(chatId), () => f.scoped.models(chatId), () => f.scoped.settings(chatId), () => f.scoped.sources(), () => f.scoped.setSources(chatId, ['page']), () => f.scoped.selectModel(chatId, create(AIModelPBSchema, { name: 'Model' })), () => f.scoped.send(chatId, 'Question', 1n, 2n)]) await expect(call()).rejects.toBeInstanceOf(HyperChatOwnerError);
    expect(f.base.load).toHaveBeenCalledTimes(1);
    for (const operation of [f.base.models, f.base.settings, f.base.sources, f.base.setSources, f.base.selectModel, f.base.send]) expect(operation).not.toHaveBeenCalled();
  });
  it('coalesces notification bursts and ignores authoritative reads that finish after unsubscribe', async () => {
    const f = fixture();
    let release!: (value: ReturnType<typeof create<typeof ChatMessageListPBSchema>>) => void;
    f.base.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    for (let index = 0; index < 20; index++) f.notify({ type: 'messages', messages: [message('Old payload')] });
    expect(f.base.load).toHaveBeenCalledTimes(1);
    release(create(ChatMessageListPBSchema, { messages: [message('Fresh first')] }));
    await vi.waitFor(() => expect(f.base.load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(f.received).toHaveLength(2));
    f.base.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.notify({ type: 'message', message: message('Old payload') }); f.unsubscribe();
    release(create(ChatMessageListPBSchema, { messages: [message('Disposed reply')] }));
    await Promise.resolve(); await Promise.resolve(); expect(f.received).toHaveLength(2);
  });
});

describe('Hyper guarded chat source refresh', () => {
  const schemas: Record<string, DescMessage> = { GetLocalAISetting: LocalAISettingPBSchema, GetChatSettings: ChatSettingsPBSchema, GetView: ViewPBSchema, GetDocumentText: DocumentTextPBSchema, StreamMessage: ChatMessagePBSchema };
  it.each(['GetLocalAISetting', 'GetChatSettings', 'GetView', 'GetDocumentText', 'CreateChatContext', 'StreamMessage'])('checks ownership after %s before sending more source data', async boundary => {
    let active = true;
    const calls: string[] = [];
    vi.stubGlobal('window', { appflowy: { core: { request: async (event: string) => {
      calls.push(event);
      const value = event === 'GetLocalAISetting' ? { serverUrl: 'openai+file:/fixture/endpoint.json' } : event === 'GetChatSettings' ? { ragIds: ['source'] } : event === 'GetView' ? { id: 'source', name: 'Private page', layout: ViewLayoutPB.Document } : event === 'GetDocumentText' ? { text: 'Private text' } : {};
      if (event === boundary) active = false;
      const schema = schemas[event];
      return { status: 0, payload: schema ? toBinary(schema, create(schema, value)) : new Uint8Array() };
    } } } });
    await expect(createHyperChatBackend(() => active).send(chatId, 'Question', 1n, 2n)).rejects.toThrow('workspace or account changed');
    expect(calls.at(-1)).toBe(boundary);
    if (boundary !== 'StreamMessage') expect(calls).not.toContain('StreamMessage');
    if (['GetLocalAISetting', 'GetChatSettings', 'GetView', 'GetDocumentText'].includes(boundary)) expect(calls).not.toContain('CreateChatContext');
  });
  it.each(['GetCurrentWorkspaceSetting', 'ReadWorkspaceViews'])('checks ownership after source-picker %s', async boundary => {
    let active = true;
    const calls: string[] = [];
    vi.stubGlobal('window', { appflowy: { core: { request: async (event: string) => {
      calls.push(event); if (event === boundary) active = false;
      return { status: 0, payload: event === 'GetCurrentWorkspaceSetting' ? toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: 'workspace' })) : toBinary(RepeatedViewPBSchema, create(RepeatedViewPBSchema, {})) };
    } } } });
    await expect(createHyperChatBackend(() => active).sources()).rejects.toThrow('workspace or account changed');
    expect(calls.at(-1)).toBe(boundary);
    if (boundary === 'GetCurrentWorkspaceSetting') expect(calls).not.toContain('ReadWorkspaceViews');
  });
});
