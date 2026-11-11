import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { hyperBlockText, hyperChildren, hyperEditText, hyperInsertBlock, type HyperDocumentChange } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperInsertTable } from '../src/renderer/features/document/HyperDocumentTable';
import { hyperCaptureDocumentBlock, hyperDocumentBlockCommand, hyperMoveDocumentBlock } from '../src/renderer/features/document-block-controls/HyperDocumentBlockControlsModel';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper document block controls with the Rust core', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-block-controls-core-'));
  let core = new CoreProcess(binary), documentId = '';
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-block-controls', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, schema: DescMessage, value: object) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([core.request(event, toBinary(schema, create(schema, value as MessageInitShape<DescMessage>))), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${event}`)), 15_000); })]).finally(() => clearTimeout(timer));
    if (result.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`);
    return result.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    return fromBinary(output, input ? await request(event, input[0], input[1]) : (await core.request(event, new Uint8Array())).payload);
  }
  const read = () => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  async function apply(change: HyperDocumentChange) {
    await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions: change.actions }); return read();
  }
  afterAll(async () => { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); });
  it('persists sibling/nested moves and whole table/media/database blocks without deleting backing data', async () => {
    await initialize(); await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-block-controls' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'Hyper block control persistence', layout: ViewLayoutPB.Document }]); documentId = view.id;
    let doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
    const a = hyperInsertBlock(doc, doc.pageId, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '', 'paragraph'), aId = a.focus!.id; doc = await apply(a);
    doc = await apply(hyperEditText(doc, aId, [{ insert: 'Rich 🌍', attributes: { bold: true, custom: { keep: true } } }]));
    const child = hyperInsertBlock(doc, aId, '', 'bulleted_list'), childId = child.focus!.id; doc = await apply(child); doc = await apply(hyperEditText(doc, childId, [{ insert: 'Nested child', attributes: { italic: true } }]));
    const b = hyperInsertBlock(doc, doc.pageId, aId, 'heading', { level: 2 }), bId = b.focus!.id; doc = await apply(b); doc = await apply(hyperEditText(doc, bId, [{ insert: 'Heading' }]));
    const table = hyperInsertTable(doc, doc.pageId, bId, 2, 2), tableId = hyperChildren(table.document, table.document.blocks[doc.pageId]).at(-1)!; doc = await apply(table); doc = await apply(hyperEditText(doc, table.focus!.id, [{ insert: 'Cell content' }]));
    const assetPath = path.join(support, 'Attachment.pdf'); fs.writeFileSync(assetPath, 'Preserved attachment bytes');
    const media = hyperInsertBlock(doc, doc.pageId, tableId, 'file', { name: 'Attachment.pdf', url: assetPath }), mediaId = media.focus!.id; doc = await apply(media);
    const database = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: documentId, name: 'Backing database', layout: ViewLayoutPB.Grid }]);
    const grid = hyperInsertBlock(doc, doc.pageId, mediaId, 'grid', { parent_id: documentId, view_id: database.id }), gridId = grid.focus!.id; doc = await apply(grid);
    const rich = hyperBlockText(doc, doc.blocks[aId]), nested = hyperBlockText(doc, doc.blocks[childId]), tableRows = hyperChildren(doc, doc.blocks[tableId]);
    doc = await apply(hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, bId), 'up')); expect(hyperChildren(doc, doc.blocks[doc.pageId]).indexOf(bId)).toBeLessThan(hyperChildren(doc, doc.blocks[doc.pageId]).indexOf(aId));
    doc = await apply(hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, bId), 'down'));
    doc = await apply(hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, bId), 'indent')); expect(doc.blocks[bId].parentId).toBe(aId);
    doc = await apply(hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, bId), 'outdent')); expect(doc.blocks[bId].parentId).toBe(doc.pageId);
    doc = await apply(hyperMoveDocumentBlock(doc, hyperCaptureDocumentBlock(doc, tableId), hyperCaptureDocumentBlock(doc, aId), 'before'));
    doc = await apply(hyperMoveDocumentBlock(doc, hyperCaptureDocumentBlock(doc, aId), hyperCaptureDocumentBlock(doc, gridId), 'after'));
    expect(hyperChildren(doc, doc.blocks[aId])).toEqual([childId]); expect(hyperBlockText(doc, doc.blocks[aId])).toEqual(rich); expect(hyperBlockText(doc, doc.blocks[childId])).toEqual(nested); expect(hyperChildren(doc, doc.blocks[tableId])).toEqual(tableRows);
    doc = await apply(hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, mediaId), 'delete')); doc = await apply(hyperDocumentBlockCommand(doc, hyperCaptureDocumentBlock(doc, gridId), 'delete'));
    expect(fs.readFileSync(assetPath, 'utf8')).toBe('Preserved attachment bytes'); expect((await call('GetView', ViewPBSchema, [ViewIdPBSchema, { value: database.id }])).id).toBe(database.id);
    const ordering = hyperChildren(doc, doc.blocks[doc.pageId]); await core.stop(); core = new CoreProcess(binary); await initialize();
    const restored = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
    expect(hyperChildren(restored, restored.blocks[restored.pageId])).toEqual(ordering); expect(hyperChildren(restored, restored.blocks[aId])).toEqual([childId]); expect(hyperBlockText(restored, restored.blocks[aId])).toEqual(rich); expect(hyperBlockText(restored, restored.blocks[childId])).toEqual(nested); expect(hyperChildren(restored, restored.blocks[tableId])).toEqual(tableRows); expect(restored.blocks[mediaId]).toBeUndefined(); expect(restored.blocks[gridId]).toBeUndefined();
  }, 30_000);
});
