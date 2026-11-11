import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { ApplyActionPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, DocumentRedoUndoResponsePBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperAssets } from '../src/main/HyperAssets';
import { HyperGeneratedImages } from '../src/main/HyperGeneratedImages';
import type { HyperDocumentChange } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCanvasLabel, hyperDeleteCanvasElement, hyperEditCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas, hyperUpdateCanvasElement } from '../src/renderer/features/whiteboard/HyperWhiteboardModel';
import { hyperAddMindMapChild, hyperCanvasMoveGroup, hyperInsertMindMap } from '../src/renderer/features/whiteboard/HyperWhiteboardFeatures';
import { hyperExportWhiteboardSVG, hyperPrepareWhiteboardExport } from '../src/renderer/features/whiteboard/HyperWhiteboardExport';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper canvas (real Rust core)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypertask-canvas-test-'));
  const documentId = randomUUID();
  let core = new CoreProcess(binary), log = '';
  async function init() {
    await core.start(chunk => { log = (log + chunk.toString()).slice(-6000); });
    expect(await core.init({ root: dataDir, app_version: '0.11.4', custom_app_path: dataDir, origin_app_path: dataDir, device_id: 'hyper-canvas-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  async function request(event: string, schema: DescMessage, value: object) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        core.request(event, toBinary(schema, create(schema, value as MessageInitShape<DescMessage>))),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${event} timed out. Core log: ${log}`)), 20_000); }),
      ]);
      if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
      return reply.payload;
    } finally { clearTimeout(timer); }
  }
  const read = async () => fromBinary(DocumentDataPBSchema, await request('GetDocumentData', OpenDocumentPayloadPBSchema, { documentId }));
  const apply = async (change: HyperDocumentChange) => { await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions: change.actions }); return read(); };
  afterAll(async () => { await core.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  it('persists per-element actions and shared note text, with undo/redo and core restart', async () => {
    await init();
    fromBinary(UserProfilePBSchema, await request('SignUp', SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-canvas-test' }));
    await request('CreateDocument', CreateDocumentPayloadPBSchema, { documentId });
    let doc = fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId }));
    const rectangle = hyperInsertCanvasElement(doc, 'rectangle', { x: 10, y: 20, width: 120, height: 80 });
    doc = await apply(rectangle);
    const shapeId = rectangle.focus!.id;
    doc = await apply(hyperUpdateCanvasElement(doc, shapeId, { x: -30, color: 'primary' }));
    const note = hyperInsertCanvasElement(doc, 'note', { x: 200, y: 20, width: 200, height: 160 }, { text: 'Shared 🌍 note' });
    doc = await apply(note);
    const noteId = note.focus!.id;
    doc = await apply(hyperEditCanvasLabel(doc, noteId, 'Updated shared 🌎 note'));
    let snapshot = hyperReadCanvas(doc);
    expect(snapshot.elements).toHaveLength(2);
    expect(snapshot.elements[0].x).toBe(-30);
    expect(hyperCanvasLabel(snapshot.elements[1], doc)).toBe('Updated shared 🌎 note');
    const sourceId = snapshot.elements[1].sourceId!;
    doc = await apply(hyperDeleteCanvasElement(doc, shapeId));
    expect(hyperReadCanvas(doc).elements).toHaveLength(1);
    const undo = fromBinary(DocumentRedoUndoResponsePBSchema, await request('Undo', DocumentRedoUndoPayloadPBSchema, { documentId }));
    expect(undo.isSuccess).toBe(true);
    const redo = fromBinary(DocumentRedoUndoResponsePBSchema, await request('Redo', DocumentRedoUndoPayloadPBSchema, { documentId }));
    expect(redo.isSuccess).toBe(true);
    doc = await read();
    const frame = hyperInsertCanvasElement(doc, 'frame', { x: -100, y: -100, width: 1500, height: 1200 });
    doc = await apply(frame);
    const map = hyperInsertMindMap(doc, 'Plan\n  Build\n  Test', { x: 400, y: 200 });
    doc = await apply(map);
    doc = await apply(hyperAddMindMapChild(doc, map.focus!.id, 'Verify'));
    doc = await apply(hyperCanvasMoveGroup(doc, frame.focus!.id, 0, 0));
    expect(hyperReadCanvas(doc).elements.find(element => element.id === map.focus!.id)).toMatchObject({ x: 500, y: 300 });
    expect(hyperReadCanvas(doc).elements.filter(element => element.mindMapRootId === map.focus!.id && element.kind === 'note')).toHaveLength(4);
    const exported = hyperExportWhiteboardSVG(doc);
    expect(exported).toContain('Verify');
    snapshot = hyperReadCanvas(doc);
    await core.stop(); core = new CoreProcess(binary); await init();
    doc = fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId }));
    expect(hyperReadCanvas(doc)).toEqual(snapshot);
    expect(hyperExportWhiteboardSVG(doc)).toBe(exported);
    expect(hyperCanvasLabel(hyperReadCanvas(doc).elements[0], doc)).toBe('Updated shared 🌎 note');
    expect(doc.blocks[sourceId].ty).toBe('paragraph');

    const artifacts = path.join(dataDir, 'ai_generated_images'); fs.mkdirSync(artifacts);
    const source = path.join(artifacts, 'generated.png');
    fs.writeFileSync(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=', 'base64'));
    const assets = new HyperAssets(() => dataDir), images = new HyperGeneratedImages({ applicationRoot: () => dataDir, importImage: assets.importGeneratedImage.bind(assets) });
    const imported = await images.importUrl(pathToFileURL(source).href);
    const image = hyperInsertCanvasElement(doc, 'image', { x: 50, y: 60, width: 120, height: 180 }, { imagePath: imported.path, alt: 'Generated original' });
    doc = await apply(image);
    doc = await apply(hyperUpdateCanvasElement(doc, image.focus!.id, { x: -200, width: 80, height: 120 }));
    doc = await apply(hyperEditCanvasLabel(doc, image.focus!.id, 'Generated image after edit'));
    const imageBeforeRestart = hyperReadCanvas(doc).elements.find(element => element.id === image.focus!.id)!;
    const embeddedBefore = hyperExportWhiteboardSVG(doc, await hyperPrepareWhiteboardExport(doc, {}, assets.inlineUrl.bind(assets)));
    expect(embeddedBefore).toContain('href="data:image/png;base64,'); expect(embeddedBefore).not.toContain(imported.path);
    await core.stop(); core = new CoreProcess(binary); await init();
    doc = fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId }));
    expect(hyperReadCanvas(doc).elements.find(element => element.id === image.focus!.id)).toEqual(imageBeforeRestart);
    expect(await assets.resolve(imported.previewUrl)).toBe(imported.path);
    expect(hyperExportWhiteboardSVG(doc, await hyperPrepareWhiteboardExport(doc, {}, assets.inlineUrl.bind(assets)))).toBe(embeddedBefore);
    doc = await apply(hyperDeleteCanvasElement(doc, image.focus!.id));
    expect(hyperReadCanvas(doc).elements.some(element => element.id === image.focus!.id)).toBe(false);
    expect(fs.existsSync(imported.path)).toBe(true);
  });
});
