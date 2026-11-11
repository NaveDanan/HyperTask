import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { ApplyActionPayloadPBSchema, CloseDocumentPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import { HyperDocumentSession, type HyperDocumentBackend } from '../src/renderer/features/document/HyperDocumentSession';
import { HyperDocumentTextCompatibilityError, hyperBlockText, hyperEditText, hyperFormatText, hyperInsertBlock, hyperSplitBlock, hyperUpdateBlock, type HyperDocumentChange } from '../src/renderer/features/document/HyperDocumentModel';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper text compatibility with the Rust core', () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-text-compatibility-')), documentId = randomUUID();
  let core = new CoreProcess(binary), session: HyperDocumentSession | undefined, applies = 0;
  async function initialize() {
    await core.start(() => {});
    expect(await core.init({ root: storage, custom_app_path: storage, origin_app_path: storage, app_version: '0.11.4', device_id: 'hyper-text-compatibility', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  }
  async function request(event: string, schema: DescMessage, value: object) {
    const reply = await core.request(event, toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)));
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  const read = async () => fromBinary(DocumentDataPBSchema, await request('GetDocumentData', OpenDocumentPayloadPBSchema, { documentId }));
  const backend: HyperDocumentBackend = {
    open: async () => fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId })),
    read,
    apply: async (_, actions) => { applies++; await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions }); },
    close: async () => { await request('CloseDocument', CloseDocumentPayloadPBSchema, { documentId }); },
    history: async () => {}, listen: () => () => {},
  };
  afterAll(async () => { await session?.dispose().catch(() => {}); await core.stop(); fs.rmSync(storage, { recursive: true, force: true }); });
  it('rejects unsafe edits before ApplyAction while preserving saved text and supported string mentions', async () => {
    await initialize();
    await request('SignUp', SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-text-compatibility' });
    await request('CreateDocument', CreateDocumentPayloadPBSchema, { documentId });
    session = new HyperDocumentSession(documentId, backend); await session.flush();
    const inserted = session.change(doc => hyperInsertBlock(doc, doc.pageId, ''))!; await session.flush();
    const id = inserted.focus!.id;
    session.change(doc => hyperEditText(doc, id, [{ insert: 'Saved original 🌍', attributes: { bold: true } }])); await session.flush();
    const nested = session.change(doc => hyperInsertBlock(doc, id, ''))!; await session.flush();
    session.change(doc => hyperEditText(doc, nested.focus!.id, [{ insert: 'Saved child' }])); await session.flush();
    const saved = await read(), originalText = hyperBlockText(saved, saved.blocks[id]), childText = hyperBlockText(saved, saved.blocks[nested.focus!.id]);
    async function rejectBeforeDispatch(document: DocumentDataPB, build: (doc: DocumentDataPB) => HyperDocumentChange) {
      session!.store.setState({ document });
      const source = JSON.stringify(document), count = applies;
      expect(() => session!.change(build)).toThrow(HyperDocumentTextCompatibilityError);
      await session!.flush(); expect(applies).toBe(count); expect(JSON.stringify(session!.store.getState().document)).toBe(source);
      const persisted = await read();
      expect(hyperBlockText(persisted, persisted.blocks[id])).toEqual(originalText);
      expect(hyperBlockText(persisted, persisted.blocks[nested.focus!.id])).toEqual(childText);
      expect(persisted.blocks[id].ty).toBe('paragraph');
    }
    await rejectBeforeDispatch(saved, doc => hyperEditText(doc, id, [{ insert: { unsupported: 'new object' } }]));
    const legacy = structuredClone(saved), block = legacy.blocks[id];
    if (block.oneOfExternalId.case !== 'externalId') throw new Error('Fixture text ID is missing.');
    legacy.meta!.textMap[block.oneOfExternalId.value] = JSON.stringify([{ insert: 'A' }, { insert: { unsupported: 'legacy snapshot' } }, { insert: 'B' }]);
    await rejectBeforeDispatch(legacy, doc => hyperEditText(doc, id, hyperFormatText(hyperBlockText(doc, doc.blocks[id]), 1, 2, 'italic', true)));
    await rejectBeforeDispatch(legacy, doc => hyperSplitBlock(doc, id, 1));
    const inline = structuredClone(legacy);
    inline.blocks[id].oneOfExternalId = { case: undefined }; inline.blocks[id].oneOfExternalType = { case: undefined };
    inline.blocks[id].data = JSON.stringify({ delta: [{ insert: { unsupported: 'legacy inline' } }, { insert: 'Keep' }], unknown: { keep: true } });
    await rejectBeforeDispatch(inline, doc => hyperEditText(doc, id, [{ insert: { unsupported: 'legacy inline' } }, { insert: 'Keep plus' }]));
    await rejectBeforeDispatch(inline, doc => hyperUpdateBlock(doc, id, { level: 2 }, 'heading'));
    const descendant = structuredClone(saved), child = descendant.blocks[nested.focus!.id];
    if (child.oneOfExternalId.case !== 'externalId') throw new Error('Fixture child text ID is missing.');
    descendant.meta!.textMap[child.oneOfExternalId.value] = JSON.stringify([{ insert: { unsupported: 'descendant snapshot' } }]);
    await rejectBeforeDispatch(descendant, doc => hyperUpdateBlock(doc, id, { level: 2 }, 'heading'));

    session.store.setState({ document: saved });
    const supported = [{ insert: 'Open ' }, { insert: '$', attributes: { mention: { type: 'page', page_id: randomUUID() }, custom: { keep: true } } }, { insert: ' safely 🌍', attributes: { italic: true } }];
    session.change(doc => hyperEditText(doc, id, supported)); await session.flush();
    const persisted = await read(); expect(hyperBlockText(persisted, persisted.blocks[id])).toEqual(supported);
    await session.dispose(); session = undefined; await core.stop(); core = new CoreProcess(binary); await initialize();
    const restored = fromBinary(DocumentDataPBSchema, await request('OpenDocument', OpenDocumentPayloadPBSchema, { documentId }));
    expect(hyperBlockText(restored, restored.blocks[id])).toEqual(supported);
    expect(hyperBlockText(restored, restored.blocks[nested.focus!.id])).toEqual(childText);
  }, 60_000);
});
