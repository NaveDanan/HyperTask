import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalAISettingPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { ApplyActionPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperAssets } from '../src/main/HyperAssets';
import { HyperGeneratedImages } from '../src/main/HyperGeneratedImages';
import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas } from '../src/renderer/features/whiteboard/HyperWhiteboardModel';
import { createHyperCanvasAIStore, type HyperCanvasAIStore } from '../src/renderer/features/canvas-ai/HyperCanvasAIStore';
import { createHyperCanvasImageAIStore, type HyperCanvasImageAIStore } from '../src/renderer/features/canvas-ai/HyperCanvasImageAIStore';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper Canvas AI with Rust and a loopback provider', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-canvas-ai-')), documentId = randomUUID();
  const bridge = new EventEmitter<{ port: [bigint, unknown] }>(), timers = new Set<ReturnType<typeof setTimeout>>();
  let core = new CoreProcess(binary), store: HyperCanvasAIStore | undefined, imageStore: HyperCanvasImageAIStore | undefined, session: HyperDocumentSession | undefined;
  let mode: 'map' | 'slides' | 'invalid' | 'error' | 'slow' = 'map';
  const requests: Array<{ model: string; messages: Array<{ content: string }> }> = [];
  const imageRequests: Array<{ model: string; prompt: string; n: number }> = [];
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=', 'base64');
  const assets = new HyperAssets(() => support), generated = new HyperGeneratedImages({ applicationRoot: () => support, importImage: assets.importGeneratedImage.bind(assets) });
  const server = http.createServer(async (request, response) => {
    if (request.url === '/v1/images/generations') {
      let body = ''; for await (const chunk of request) body += chunk; imageRequests.push(JSON.parse(body));
      if (mode === 'error') { response.writeHead(503).end('Provider unavailable'); return; }
      const send = () => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }));
      if (mode === 'slow') { const timer = setTimeout(() => { timers.delete(timer); send(); }, 20_000); timers.add(timer); response.once('close', () => { clearTimeout(timer); timers.delete(timer); }); } else send(); return;
    }
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    let body = ''; for await (const chunk of request) body += chunk; requests.push(JSON.parse(body));
    if (mode === 'error') { response.writeHead(503).end('Provider unavailable'); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (text: string) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    if (mode === 'slow') {
      data('{'); const timer = setTimeout(() => { timers.delete(timer); data('}'); response.end('data: [DONE]\n\n'); }, 20_000); timers.add(timer); response.once('close', () => { clearTimeout(timer); timers.delete(timer); }); return;
    }
    const output = mode === 'invalid' ? '{"version":1,"root":{"text":"Unsafe","children":[],"url":"file:///private"}}'
      : mode === 'slides' ? JSON.stringify({ version: 1, slides: [{ title: 'Plan 🌍', bullets: ['Build', 'Test'] }, { title: 'Release', bullets: ['Ship'] }] })
      : JSON.stringify({ version: 1, root: { text: 'Plan 🌍', children: [{ text: 'Build', children: [] }, { text: 'Test', children: [] }] } });
    data(output.slice(0, 16)); data(output.slice(16)); response.end('data: [DONE]\n\n');
  });
  async function request(event: string, schema?: DescMessage, value: object = {}) {
    const reply = await core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array());
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input?.[0], input?.[1])); }
  async function init() {
    core.on('portMessage', (port, value) => bridge.emit('port', port, value)); await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-canvas-ai-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  const read = () => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  afterAll(async () => { store?.dispose(); imageStore?.dispose(); await session?.dispose(); await core.stop(); timers.forEach(clearTimeout); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('reviews mind maps, slides and images without saving, applies explicitly, rejects malformed/provider errors, cancels and restores after restart', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    vi.stubGlobal('window', { appflowy: { assets: { importGeneratedImage: (url: string) => generated.importUrl(url) }, core: { request: (event: string, payload: Uint8Array) => core.request(event, payload), onNotification: () => () => {}, onPortMessage: (listener: (port: bigint, value: unknown) => void) => { bridge.on('port', listener); return () => bridge.off('port', listener); } } } });
    await init(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-canvas-ai-test' }]);
    const endpoint = path.join(support, 'endpoint.json'); fs.writeFileSync(endpoint, JSON.stringify({ base_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'hyper-canvas-test-model', image_model: 'hyper-image-test-model', enabled: true }));
    await request('UpdateLocalAISetting', LocalAISettingPBSchema, { serverUrl: `openai+file:${endpoint}`, globalChatModel: 'hyper-canvas-test-model', embeddingModelName: '' });
    fs.writeFileSync(path.join(support, `ai-sources-${documentId}.json`), JSON.stringify([{ id: 'attachment:ambient', name: 'Ambient attachment', text: 'Ambient attachment secret must stay private' }]));
    await request('CreateDocument', CreateDocumentPayloadPBSchema, { documentId });
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), owner = { workspaceId: workspace.workspaceId, actorId: String(user.id), contextKey: support, isCurrent: () => true };
    session = new HyperDocumentSession(documentId, { open: () => call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]), read, apply: async (id, actions) => { await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId: id, actions }); }, close: async () => {}, history: async () => {}, listen: () => () => {} }, owner);
    await session.flush();
    const original = session.change(doc => hyperInsertCanvasElement(doc, 'note', { x: 0, y: 0, width: 240, height: 120 }, { text: 'Private existing note' }))!;
    await session.flush(); let selectedIds: string[] = [];
    store = createHyperCanvasAIStore({ session, owner, editable: () => true, selectedIds: () => selectedIds, currentOwner: () => owner }); store.start();
    await vi.waitFor(() => expect(store!.getState().models.length).toBeGreaterThan(0)); expect(requests).toHaveLength(0);
    await store.generate('mindmap', 'Create a release plan', { includePage: false, includeSelected: false, selectedIds: [] });
    await vi.waitFor(() => expect(store!.getState().status).toBe('ready'), { timeout: 10_000 });
    expect(hyperReadCanvas(await read()).elements).toHaveLength(1); expect(JSON.stringify(requests[0].messages)).not.toContain('Private existing note'); expect(requests[0].model).toBe('hyper-canvas-test-model');
    expect(JSON.stringify(requests[0].messages)).not.toContain('Ambient attachment secret');
    await store.apply(); const map = hyperReadCanvas(await read()).elements; expect(map.filter(item => item.kind === 'note')).toHaveLength(4); expect(map.filter(item => item.kind === 'connector')).toHaveLength(2); await expect(store.apply()).rejects.toThrow();
    mode = 'slides'; selectedIds = [original.focus!.id];
    await store.generate('presentation', 'Create slides', { includePage: false, includeSelected: true, selectedIds }); await vi.waitFor(() => expect(store!.getState().status).toBe('ready'), { timeout: 10_000 });
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain('Private existing note'); expect(hyperReadCanvas(await read()).elements).toHaveLength(map.length);
    await store.apply(); let saved = hyperReadCanvas(await read()); expect(saved.elements.filter(item => item.kind === 'frame')).toHaveLength(2);
    imageStore = createHyperCanvasImageAIStore({ session, owner, editable: () => true, selectedIds: () => selectedIds, currentOwner: () => owner }); imageStore.start();
    expect(imageRequests).toHaveLength(0); await imageStore.generate('Paint an original blue square', { includePage: false, includeSelected: false, selectedIds: [] }); await vi.waitFor(() => expect(imageStore!.getState().status).toBe('ready'), { timeout: 10_000 });
    expect(imageRequests[0]).toEqual({ model: 'hyper-image-test-model', prompt: 'Paint an original blue square', n: 1 }); expect(imageRequests[0].prompt).not.toContain('Ambient attachment secret'); expect(hyperReadCanvas(await read())).toEqual(saved);
    const previewAsset = imageStore.getState().asset!; expect(previewAsset).toMatchObject({ width: 2, height: 3 }); expect(await fs.promises.readFile(previewAsset.path)).toEqual(imageBytes); expect(await assets.resolve(previewAsset.previewUrl)).toBe(previewAsset.path);
    await imageStore.apply(); await expect(imageStore.apply()).rejects.toThrow(); saved = hyperReadCanvas(await read()); expect(saved.elements.find(item => item.kind === 'image')).toMatchObject({ imagePath: previewAsset.path, alt: 'Paint an original blue square', width: 2, height: 3 });
    mode = 'error'; await imageStore.generate('Paint', { includePage: false, includeSelected: false, selectedIds: [] }); await vi.waitFor(() => expect(imageStore!.getState().status).toBe('error'), { timeout: 10_000 }); await expect(imageStore.apply()).rejects.toThrow(); expect(hyperReadCanvas(await read())).toEqual(saved);
    mode = 'slow'; await imageStore.generate('Paint', { includePage: false, includeSelected: false, selectedIds: [] }); await vi.waitFor(() => expect(imageRequests).toHaveLength(3)); imageStore.stop(); expect(imageStore.getState().status).toBe('cancelled'); await expect(imageStore.apply()).rejects.toThrow(); expect(hyperReadCanvas(await read())).toEqual(saved);
    for (const next of ['invalid', 'error'] as const) { mode = next; await store.generate('mindmap', 'Create', { includePage: false, includeSelected: false, selectedIds: [] }); await vi.waitFor(() => expect(store!.getState().status).toBe('error'), { timeout: 10_000 }); await expect(store.apply()).rejects.toThrow(); expect(hyperReadCanvas(await read())).toEqual(saved); }
    mode = 'slow'; await store.generate('mindmap', 'Create', { includePage: false, includeSelected: false, selectedIds: [] }); await vi.waitFor(() => expect(requests).toHaveLength(5)); store.stop(); expect(store.getState().status).toBe('cancelled'); await expect(store.apply()).rejects.toThrow(); expect(hyperReadCanvas(await read())).toEqual(saved);
    store.dispose(); imageStore.dispose(); await session.dispose(); session = undefined; await core.stop(); core = new CoreProcess(binary); await init();
    const restored = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]); expect(hyperReadCanvas(restored)).toEqual(saved); expect(hyperCanvasLabel(saved.elements.find(item => item.id === original.focus!.id)!, restored)).toBe('Private existing note');
    expect(await fs.promises.readFile(previewAsset.path)).toEqual(imageBytes);
  }, 45_000);
});
