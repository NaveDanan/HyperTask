import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalAISettingPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { TranslateLanguagePB, TranslateTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/translate_entities_pb';
import { TypeOptionChangesetPBSchema } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ApplyActionPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { DatabaseEventUpdateRowMeta } from '../src/renderer/backend/events/flowy-database2';
import { unwrap } from '../src/renderer/backend/dispatch';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDecodeCell } from '../src/renderer/features/database/HyperDatabaseCells';
import { hyperDatabaseAIBackend } from '../src/renderer/features/database/HyperDatabaseAIBackend';
import { hyperDatabaseAIRowDocument } from '../src/renderer/features/database/HyperDatabaseAIBackend';
import { createHyperDatabaseAIStore, type HyperDatabaseAIStore } from '../src/renderer/features/database/HyperDatabaseAIStore';
import { hyperChildren, hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { rowDocumentIdForRow } from '../src/renderer/features/templates/converter';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper database AI fields with Rust and a loopback provider', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-database-ai-'));
  const bridge = new EventEmitter<{ port: [bigint, unknown] }>();
  let core = new CoreProcess(binary), store: HyperDatabaseAIStore | undefined;
  let responseMode: 'success' | 'error' | 'slow' = 'success';
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }>; stream: boolean }> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    if (responseMode === 'error') { response.writeHead(503).end('Provider unavailable'); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (text: string) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    data('Generated ');
    if (responseMode === 'slow') {
      const timer = setTimeout(() => { timers.delete(timer); data('late'); response.end('data: [DONE]\n\n'); }, 20_000); timers.add(timer);
      response.once('close', () => { clearTimeout(timer); timers.delete(timer); });
    } else { data('🌍'); response.end('data: [DONE]\n\n'); }
  });
  async function request(event: string, schema?: DescMessage, value: object = {}) {
    const reply = await core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array());
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input?.[0], input?.[1])); }
  async function initialize() {
    core.on('portMessage', (port, value) => bridge.emit('port', port, value)); await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-database-ai-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  afterAll(async () => {
    useWorkspaceStore.setState({ userProfile: null, currentWorkspace: null });
    store?.dispose(); await core.stop(); timers.forEach(clearTimeout); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true });
  });
  it('previews selected sources, explicitly saves typed summary/translation cells, rejects stale values and preserves options through restart', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port;
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload), onNotification: () => () => {}, onPortMessage: (listener: (port: bigint, value: unknown) => void) => { bridge.on('port', listener); return () => bridge.off('port', listener); } } } });
    await initialize(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-database-ai-test' }]);
    const settingsPath = path.join(support, 'endpoint.json'); fs.writeFileSync(settingsPath, JSON.stringify({ base_url: `http://127.0.0.1:${port}/v1`, model: 'hyper-test-model', enabled: true }));
    await request('UpdateLocalAISetting', LocalAISettingPBSchema, { serverUrl: `openai+file:${settingsPath}`, globalChatModel: 'hyper-test-model', embeddingModelName: '' });
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: workspace.workspaceId, workspaceType: WorkspaceTypePB.LocalW }) });
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'Hyper AI fields', layout: ViewLayoutPB.Grid }]);
    const repository = new HyperDatabaseRepository(), initial = await repository.load(view.id), primary = initial.fields.find(field => field.isPrimary)!;
    const summary = await repository.createField(view.id, 'Summary', FieldType.Summary), translate = await repository.createField(view.id, 'French', FieldType.Translate), privateField = await repository.createField(view.id, 'Unselected private property', FieldType.RichText);
    await request('UpdateFieldTypeOption', TypeOptionChangesetPBSchema, { viewId: view.id, fieldId: translate.id, typeOptionData: toBinary(TranslateTypeOptionPBSchema, create(TranslateTypeOptionPBSchema, { language: TranslateLanguagePB.French, autoFill: false })) });
    const row = await repository.createRow(view.id); await repository.updateText(view.id, row.id, primary.id, 'Selected source fact'); await repository.updateText(view.id, row.id, privateField.id, 'Do not send this private value'); await repository.updateText(view.id, row.id, summary.id, 'Original summary');
    const documentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
    await request('CreateDocument', CreateDocumentPayloadPBSchema, { documentId });
    const document = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
    const inserted = hyperInsertBlock(document, document.pageId, hyperChildren(document, document.blocks[document.pageId]).at(-1) ?? '', 'paragraph');
    const written = hyperEditText(inserted.document, inserted.focus!.id, [{ insert: 'Row body is private until selected' }]);
    await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions: [...inserted.actions, ...written.actions] });
    unwrap(await DatabaseEventUpdateRowMeta({ viewId: view.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false } }));
    const fields = (await repository.load(view.id)).fields, summaryOptions = fields.find(field => field.id === summary.id)!.typeOptionData, translateOptions = fields.find(field => field.id === translate.id)!.typeOptionData;
    const text = async (field: typeof summary) => hyperDecodeCell(field, await repository.cell(view.id, row.id, field.id)).text;
    const createStore = async (field: typeof summary) => {
      store?.dispose(); store = createHyperDatabaseAIStore({ viewId: view.id, rowId: row.id, fieldId: field.id, fieldType: field.fieldType, workspaceId: workspace.workspaceId, actorId: String(user.id) }, hyperDatabaseAIBackend(repository), () => true); store.start(); await vi.waitFor(() => expect(store!.getState().snapshot).not.toBeNull(), { timeout: 10_000 }); store.select([primary.id]); return store;
    };
    const summaryStore = await createStore(summary);
    expect(summaryStore.getState().snapshot?.sources.map(source => source.id)).toContain(hyperDatabaseAIRowDocument);
    expect(requests).toHaveLength(0); await summaryStore.generate(); await vi.waitFor(() => expect(summaryStore.completion.getState().status).toBe('ready'), { timeout: 10_000 });
    expect(await text(summary)).toBe('Original summary'); expect(JSON.stringify(requests[0].messages)).toContain('Selected source fact'); expect(JSON.stringify(requests[0].messages)).not.toContain('Do not send this private value'); expect(requests[0].model).toBe('hyper-test-model');
    expect(JSON.stringify(requests[0].messages)).not.toContain('Row body is private until selected');
    await summaryStore.apply(); expect(await text(summary)).toBe('Generated 🌍');
    await summaryStore.refresh(); summaryStore.select([hyperDatabaseAIRowDocument]); await summaryStore.generate();
    expect(summaryStore.getState().error).toBeNull();
    await vi.waitFor(() => expect(summaryStore.completion.getState().status).toBe('ready'), { timeout: 10_000 });
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain('Row body is private until selected');
    expect(JSON.stringify(requests.at(-1)!.messages)).not.toContain('Selected source fact');
    const translationStore = await createStore(translate); expect(translationStore.getState().snapshot?.target.language).toBe('French'); await translationStore.generate('French'); await vi.waitFor(() => expect(translationStore.completion.getState().status).toBe('ready'), { timeout: 10_000 });
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain('French'); await translationStore.apply(); expect(await text(translate)).toBe('Generated 🌍');
    await translationStore.generate('French'); await vi.waitFor(() => expect(translationStore.completion.getState().status).toBe('ready'), { timeout: 10_000 }); await repository.updateText(view.id, row.id, translate.id, 'Concurrent edit'); await expect(translationStore.apply()).rejects.toThrow('source or saved cell changed'); expect(await text(translate)).toBe('Concurrent edit');
    responseMode = 'error'; await translationStore.generate('French'); await vi.waitFor(() => expect(translationStore.completion.getState().status).toBe('error'), { timeout: 10_000 }); expect(await text(translate)).toBe('Concurrent edit');
    responseMode = 'slow'; await translationStore.generate('French'); await vi.waitFor(() => expect(translationStore.completion.getState().result).toBe('Generated '), { timeout: 10_000 }); await translationStore.completion.stop(); expect(translationStore.completion.getState().status).toBe('cancelled'); await expect(translationStore.apply()).rejects.toThrow('Generate and review'); expect(await text(translate)).toBe('Concurrent edit');
    store?.dispose(); await core.stop(); core = new CoreProcess(binary); await initialize(); const restored = await repository.load(view.id);
    expect(restored.fields.find(field => field.id === summary.id)!.typeOptionData).toEqual(summaryOptions); expect(restored.fields.find(field => field.id === translate.id)!.typeOptionData).toEqual(translateOptions); expect(await text(summary)).toBe('Generated 🌍'); expect(await text(translate)).toBe('Concurrent edit');
  }, 40_000);
});
