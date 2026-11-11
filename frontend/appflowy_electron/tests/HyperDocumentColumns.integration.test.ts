import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { ApplyActionPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, DocumentRedoUndoResponsePBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperEditText, hyperInsertBlock, hyperUpdateBlock, type HyperDocumentChange } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperCaptureDocumentColumns, hyperInsertDocumentColumns, hyperReadDocumentColumns, hyperResizeDocumentColumns } from '../src/renderer/features/document-columns/HyperDocumentColumnsModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper document columns with the Rust core', () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-columns-core-')), documentId = randomUUID();
  let core = new CoreProcess(binary), log = '';
  async function initialize() {
    await core.start(chunk => { log = (log + chunk.toString()).slice(-4000); });
    expect(await core.init({ root: storage, custom_app_path: storage, origin_app_path: storage, app_version: '0.11.4', device_id: 'hyper-columns-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  async function request(event: string, schema: DescMessage, value: object) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([core.request(event, toBinary(schema, create(schema, value as MessageInitShape<DescMessage>))), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${event} timed out: ${log}`)), 20_000); })]);
      if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
      return reply.payload;
    } finally { clearTimeout(timer); }
  }
  const read = async () => fromBinary(DocumentDataPBSchema, await request('GetDocumentData', OpenDocumentPayloadPBSchema, { documentId }));
  const apply = async (change: HyperDocumentChange) => { await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions: change.actions }); return read(); };
  afterAll(async () => { await core.stop(); fs.rmSync(storage, { recursive: true, force: true }); });
  it('persists compatible columns, adjacent widths, rich text and unknown attributes through undo/redo and restart', async () => {
    await initialize();
    await request('SignUp', SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-columns-test' });
    await request('CreateDocument', CreateDocumentPayloadPBSchema, { documentId });
    let doc = fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId }));
    const previous = hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '';
    const paragraph = hyperInsertBlock(doc, doc.pageId, previous); doc = await apply(paragraph);
    const inserted = hyperInsertDocumentColumns(doc, doc.pageId, paragraph.focus!.id, 3); doc = await apply(inserted);
    const columnsId = doc.blocks[doc.blocks[inserted.focus!.id].parentId].parentId, initial = hyperReadDocumentColumns(doc, columnsId);
    expect(initial.supported).toBe(true); expect(initial.columns).toHaveLength(3);
    doc = await apply(hyperUpdateBlock(doc, columnsId, { futureMetadata: { keep: true } }));
    doc = await apply(hyperUpdateBlock(doc, initial.columns[0].id, { width: 220, custom: { keep: true } }));
    const runs = [{ insert: 'Column 🌍 ', attributes: { bold: true, custom: { keep: true } } }, { insert: '$', attributes: { mention: { type: 'page', page_id: 'atomic-mention' } } }];
    doc = await apply(hyperEditText(doc, inserted.focus!.id, runs));
    const secondText = hyperChildren(doc, doc.blocks[initial.columns[1].id])[0];
    doc = await apply(hyperEditText(doc, secondText, [{ insert: 'Second column' }]));
    const lastBefore = doc.blocks[initial.columns[2].id];
    doc = await apply(hyperResizeDocumentColumns(doc, hyperCaptureDocumentColumns(doc, columnsId), 0, 0.4));
    const snapshot = hyperReadDocumentColumns(doc, columnsId), html = hyperExportDocument(doc, 'html');
    expect(snapshot.columns[0].ratio).toBe(0.4); expect(snapshot.columns[1].ratio).toBeCloseTo(2 / 3 - 0.4);
    expect(doc.blocks[initial.columns[2].id]).toEqual(lastBefore);
    expect(hyperBlockText(doc, doc.blocks[inserted.focus!.id])).toEqual(runs);
    const undone = fromBinary(DocumentRedoUndoResponsePBSchema, await request('Undo', DocumentRedoUndoPayloadPBSchema, { documentId }));
    expect(undone.isSuccess).toBe(true);
    expect(fromBinary(DocumentRedoUndoResponsePBSchema, await request('Redo', DocumentRedoUndoPayloadPBSchema, { documentId })).isSuccess).toBe(true);
    expect(hyperReadDocumentColumns(await read(), columnsId)).toEqual(snapshot);
    await core.stop(); core = new CoreProcess(binary); await initialize();
    doc = fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId }));
    expect(hyperReadDocumentColumns(doc, columnsId)).toEqual(snapshot);
    expect(hyperBlockData(doc.blocks[initial.columns[0].id])).toMatchObject({ ratio: 0.4, width: 220, custom: { keep: true } });
    expect(hyperBlockData(doc.blocks[columnsId]).futureMetadata).toEqual({ keep: true });
    expect(hyperBlockText(doc, doc.blocks[inserted.focus!.id])).toEqual(runs);
    expect(hyperExportDocument(doc, 'html')).toBe(html);
  }, 60_000);
});
