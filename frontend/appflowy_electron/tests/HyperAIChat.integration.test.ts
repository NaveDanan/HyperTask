/// <reference types="electron" />
/// <reference path="../src/renderer/env.d.ts" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalAISettingPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { createHyperChatStore, type HyperChatStore } from '../src/renderer/features/ai-chat/HyperChatStore';
import { createHyperScopedChatBackend } from '../src/renderer/features/ai-chat/HyperChatScopedBackend';
import { hyperChildren, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper AI chat (real core and loopback OpenAI-compatible server)', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hypertask-ai-chat-test-'));
  const bridge = new EventEmitter<{ notification: [Uint8Array]; port: [bigint, unknown] }>();
  const finishedPorts: bigint[] = [];
  let core = new CoreProcess(binary), chatId = '', sourceId = '', stopStore: (() => void) | undefined, store: HyperChatStore;
  let responseMode: 'success' | 'error' | 'slow' = 'success';
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }>; stream: boolean }> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    if (responseMode === 'error') { response.writeHead(503).end('temporarily unavailable'); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (text: string) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    data('שלום ');
    if (responseMode === 'slow') {
      const timer = setTimeout(() => { timers.delete(timer); data('late response'); response.end('data: [DONE]\n\n'); }, 20_000);
      timers.add(timer);
      response.once('close', () => { clearTimeout(timer); timers.delete(timer); });
    } else { data('🌍'); response.end('data: [DONE]\n\n'); }
  });
  async function request(event: string, schema?: DescMessage, value: object = {}) {
    const payload = schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array();
    const reply = await core.request(event, payload);
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    return fromBinary(output, await request(event, input?.[0], input?.[1]));
  }
  async function init() {
    core.on('notification', payload => bridge.emit('notification', payload));
    core.on('portMessage', (port, value) => { if (value === 'finish:') finishedPorts.push(port); bridge.emit('port', port, value); });
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-ai-chat-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  function startStore() {
    store = createHyperChatStore(chatId, createHyperScopedChatBackend({ workspaceId: 'fixture-workspace', actorId: 'fixture-actor', contextKey: support, isCurrent: () => true }));
    stopStore = store.start();
  }
  afterAll(async () => {
    stopStore?.(); await core.stop();
    timers.forEach(timer => clearTimeout(timer));
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true });
  });
  it('streams Unicode responses through real ports and persists messages through restart', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    vi.stubGlobal('window', { appflowy: { core: {
      request: (event: string, payload: Uint8Array) => core.request(event, payload),
      onNotification: (listener: (value: Uint8Array) => void) => { bridge.on('notification', listener); return () => bridge.off('notification', listener); },
      onPortMessage: (listener: (port: bigint, value: unknown) => void) => { bridge.on('port', listener); return () => bridge.off('port', listener); },
    } } });
    await init();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-ai-chat-test' }]);
    const settingsPath = path.join(support, 'test-ai-endpoint.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ base_url: `http://127.0.0.1:${port}/v1`, model: 'hyper-test-model', enabled: true }));
    await request('UpdateLocalAISetting', LocalAISettingPBSchema, { serverUrl: `openai+file:${settingsPath}`, globalChatModel: 'hyper-test-model', embeddingModelName: '' });
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    const roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const chat = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'Hyper AI integration', layout: ViewLayoutPB.Chat, setAsCurrent: false }]);
    chatId = chat.id;
    const source = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'AI context source', layout: ViewLayoutPB.Document, setAsCurrent: false }]);
    sourceId = source.id;
    let document = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: sourceId }]);
    const inserted = hyperInsertBlock(document, document.pageId, hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '', 'paragraph');
    await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId: sourceId, actions: inserted.actions });
    document = await call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: sourceId }]);
    const text = hyperEditText(document, inserted.focus!.id, [{ insert: 'Selected source fact: HyperTask has a Rust core.' }]);
    await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId: sourceId, actions: text.actions });
    startStore();
    await vi.waitFor(() => expect(store.getState().loading).toBe(false), { timeout: 10_000 });
    await vi.waitFor(() => expect(store.getState().settingsLoaded).toBe(true), { timeout: 10_000 });
    await store.setSources([sourceId]);
    store.setState({ draft: 'Say hello' }); await store.send();
    await vi.waitFor(() => expect(store.getState().messages.some(message => message.authorType === 3n && message.content === 'שלום 🌍')).toBe(true), { timeout: 15_000 });
    expect(store.getState().error).toBeNull(); expect(store.getState().sending).toBe(false); expect(store.getState().answer).toBe('');
    expect(finishedPorts.length).toBeGreaterThan(0);
    expect(requests[0]).toMatchObject({ model: 'hyper-test-model', stream: true });
    expect(requests[0].messages.some(message => message.role === 'user' && message.content === 'Say hello')).toBe(true);
    expect(JSON.stringify(requests[0].messages)).toContain('Selected source fact: HyperTask has a Rust core.');
    stopStore?.(); stopStore = undefined; await core.stop(); core = new CoreProcess(binary); await init(); startStore();
    await vi.waitFor(() => expect(store.getState().messages.map(message => message.content)).toEqual(['Say hello', 'שלום 🌍']), { timeout: 10_000 });
    await vi.waitFor(() => expect(store.getState().ragIds).toEqual([sourceId]), { timeout: 10_000 });
  });
  it('reports a real provider failure without leaving generation busy', async () => {
    responseMode = 'error'; store.setState({ draft: 'Trigger provider error' }); await store.send();
    await vi.waitFor(() => expect(store.getState().error).toBeTruthy(), { timeout: 10_000 });
    expect(store.getState().sending).toBe(false);
    expect(store.getState().messages.some(message => message.content === 'Trigger provider error')).toBe(true);
  });
  it('cancels a slow response and persists its partial answer', async () => {
    const before = finishedPorts.length;
    responseMode = 'slow'; store.setState({ draft: 'Slow question' }); await store.send();
    await vi.waitFor(() => expect(store.getState().answer).toBe('שלום '), { timeout: 10_000 });
    await store.stop(); expect(store.getState().sending).toBe(false);
    expect(finishedPorts).toHaveLength(before + 1);
    await vi.waitFor(() => expect(store.getState().messages.some(message => message.authorType === 3n && message.content === 'שלום')).toBe(true), { timeout: 10_000 });
    expect(store.getState().answer).toBe('');
  });
});
