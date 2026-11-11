import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { ApplyActionPayloadPBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema, DocumentRedoUndoResponsePBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperDeleteBlock, hyperEditText, hyperInsertBlock, hyperMergeWithPrevious, hyperMoveBlock, hyperPlainText, hyperSplitBlock, hyperUpdateBlock, type HyperDocumentChange } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperAddTableColumn, hyperAddTableRow, hyperDeleteTableColumn, hyperDeleteTableRow, hyperInsertTable, hyperSetTableColumnWidth } from '../src/renderer/features/document/HyperDocumentTable';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper documents (real Rust core)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypertask-document-test-'));
  let core = new CoreProcess(binary);
  let documentId = '';
  const init = async () => {
    await core.start(() => {});
    expect(await core.init({ root: dataDir, app_version: '0.11.4', custom_app_path: dataDir, origin_app_path: dataDir, device_id: 'hyper-document-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, schema: DescMessage, value: object) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      core.request(event, toBinary(schema, create(schema, value as MessageInitShape<DescMessage>))),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Core request timed out: ${event}`)), 15_000); }),
    ]).finally(() => clearTimeout(timer));
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const payload = input ? await request(event, input[0], input[1]) : (await core.request(event, new Uint8Array())).payload;
    return fromBinary(output, payload);
  }
  const read = () => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  async function apply(change: HyperDocumentChange) {
    await request('ApplyAction', ApplyActionPayloadPBSchema, { documentId, actions: change.actions });
    return read();
  }
  afterAll(async () => { await core.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('persists editor actions, Unicode and formatting through core restart', async () => {
    await init();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-document-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    const roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name: 'Hyper document integration', layout: ViewLayoutPB.Document, setAsCurrent: false }]);
    documentId = view.id;
    let doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
    const inserted = hyperInsertBlock(doc, doc.pageId, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '', 'paragraph');
    const id = inserted.focus!.id;
    doc = await apply(inserted);
    doc = await apply(hyperEditText(doc, id, [{ insert: 'A🌍B', attributes: { bold: true, italic: true } }]));
    expect(hyperBlockText(doc, doc.blocks[id])).toEqual([{ insert: 'A🌍B', attributes: { bold: true, italic: true } }]);
    doc = await apply(hyperEditText(doc, id, [{ insert: 'A🌎B', attributes: { bold: true, italic: true } }]));
    expect(hyperPlainText(hyperBlockText(doc, doc.blocks[id]))).toBe('A🌎B');
    const child = hyperInsertBlock(doc, id, '', 'paragraph');
    doc = await apply(child);
    doc = await apply(hyperEditText(doc, child.focus!.id, [{ insert: 'Nested text', attributes: { underline: true } }]));
    doc = await apply(hyperUpdateBlock(doc, id, { checked: true }, 'todo_list'));
    expect(doc.blocks[id].ty).toBe('todo_list');
    expect(hyperPlainText(hyperBlockText(doc, doc.blocks[child.focus!.id]))).toBe('Nested text');
    expect(hyperChildren(doc, doc.blocks[id])).toEqual([child.focus!.id]);
    expect(hyperBlockData(doc.blocks[id]).checked).toBe(true);
    const split = hyperSplitBlock(doc, id, 1);
    doc = await apply(split);
    const second = split.focus!.id;
    expect(hyperPlainText(hyperBlockText(doc, doc.blocks[id]))).toBe('A');
    expect(hyperPlainText(hyperBlockText(doc, doc.blocks[second]))).toBe('🌎B');
    expect(hyperBlockData(doc.blocks[second]).checked).toBe(false);
    doc = await apply(hyperMoveBlock(doc, child.focus!.id, second, ''));
    doc = await apply(hyperMergeWithPrevious(doc, second));
    expect(doc.blocks[second]).toBeUndefined();
    expect(doc.blocks[child.focus!.id].parentId).toBe(id);
    expect(hyperPlainText(hyperBlockText(doc, doc.blocks[id]))).toBe('A🌎B');
    doc = await apply(hyperDeleteBlock(doc, child.focus!.id));
    // Undo/redo reload the core's state, including child ordering and removed blocks.
    const undo = await call('Undo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId }]);
    expect(undo.isSuccess).toBe(true);
    const redo = await call('Redo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId }]);
    expect(redo.isSuccess).toBe(true);
    doc = await read();
    const insertedTable = hyperInsertTable(doc, doc.pageId, hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '', 2, 2);
    doc = await apply(insertedTable);
    const tableId = hyperChildren(doc, doc.blocks[doc.pageId]).at(-1)!;
    doc = await apply(hyperEditText(doc, insertedTable.focus!.id, [{ insert: 'Persisted table cell', attributes: { bold: true } }]));
    doc = await apply(hyperAddTableRow(doc, tableId));
    doc = await apply(hyperAddTableColumn(doc, tableId));
    expect(hyperChildren(doc, doc.blocks[tableId])).toHaveLength(3);
    doc = await apply(hyperSetTableColumnWidth(doc, tableId, 1, 240));
    doc = await apply(hyperDeleteTableColumn(doc, tableId, 2));
    doc = await apply(hyperDeleteTableRow(doc, hyperChildren(doc, doc.blocks[tableId])[2]));
    expect(hyperChildren(doc, doc.blocks[tableId])).toHaveLength(2);
    expect(hyperBlockData(doc.blocks[tableId]).column_widths).toEqual({ 1: 240 });
    const beforeRestart = hyperExportDocument(doc, 'markdown');
    expect(beforeRestart).toContain('Persisted table cell');
    expect(beforeRestart).toContain('A');
    await core.stop(); core = new CoreProcess(binary); await init();
    const reopened = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
    expect(hyperExportDocument(reopened, 'markdown')).toBe(beforeRestart);
  });
});
