import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { ConvertDataPayloadPBSchema, DocumentDataPBSchema, OpenDocumentPayloadPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { RepeatedViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ImportPayloadPBSchema, ImportTypePB } from '@shared/protobuf/flowy-folder/import_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { hyperBlockText, hyperChildren, type HyperTextRun } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { markdownToEditorJson } from '../src/renderer/features/sidebar/import/markdown';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
const units = (runs: HyperTextRun[]) => runs.flatMap(run => Array.from(run.insert as string, insert => ({ insert, attributes: run.attributes ?? {} })));
const paragraphs = (doc: DocumentDataPB) => hyperChildren(doc, doc.blocks[doc.pageId]).map(id => hyperBlockText(doc, doc.blocks[id]));

(fs.existsSync(binary) ? describe : describe.skip)('Hyper styled whitespace native conversion and restart', () => {
  it('retains the original leading-italic RED, all-whitespace code, adjacent code attrs and formatted newlines', async () => {
    const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-markdown-text-core-'));
    const cleared = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]));
    const makeCore = () => new CoreProcess(binary, () => ({ ...cleared, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TMPDIR: support }));
    let core = makeCore();
    const start = async () => {
      await core.start(() => {});
      expect(await core.init({ root: support, custom_app_path: support, origin_app_path: support, app_version: '0.11.4', device_id: 'hyper-markdown-text-fixture', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    };
    async function call<O extends DescMessage>(event: string, output: O, schema?: DescMessage, value: object = {}) {
      const reply = await core.request(event, schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array());
      if (reply.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
      return fromBinary(output, reply.payload);
    }
    const source: HyperTextRun[][] = [
      [{ insert: '🌍 ' }, { insert: ' literal $$', attributes: { italic: true } }],
      [{ insert: ' \t\r\n ', attributes: { code: true, opaque: { exact: 'whitespace' } } }],
      [{ insert: 'a', attributes: { code: true, opaque: 1 } }, { insert: 'b', attributes: { code: true, opaque: 2 } }],
      [{ insert: ' before 🌍\nline\r\nend ', attributes: { bold: true, italic: true, strikethrough: true, underline: true, code: true, font_color: '0xff12ab34', bg_color: '#fff', href: 'https://example.invalid/a(b)?q=1', opaque: { list: ['<script>', true, 7], unknown: { retain: 'source' } } } }],
    ];
    const doc = create(DocumentDataPBSchema, { pageId: 'page', blocks: {
      page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' },
      ...Object.fromEntries(source.map((runs, index) => ['text-' + index, { id: 'text-' + index, ty: 'paragraph', parentId: 'page', childrenId: 'children-' + index, data: JSON.stringify({ delta: runs }) }])),
    }, meta: { childrenMap: { children: { children: source.map((_runs, index) => 'text-' + index) } } } });
    try {
      await start();
      const user = await call('SignUp', UserProfilePBSchema, SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Styled source fixture', password: 'FakeLocalFixture123!', authType: 0, deviceId: 'hyper-markdown-text-fixture' });
      const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
      const converted = await call('ConvertDataToDocument', DocumentDataPBSchema, ConvertDataPayloadPBSchema, { convertType: 0, data: new TextEncoder().encode(JSON.stringify(markdownToEditorJson(hyperExportDocument(doc, 'markdown')))) });
      expect(paragraphs(converted).map(units)).toEqual(source.map(units));
      const imported = await call('ImportData', RepeatedViewPBSchema, ImportPayloadPBSchema, { parentViewId: workspace.workspaceId, items: [{ name: 'Styled whitespace imported', viewLayout: ViewLayoutPB.Document, importType: ImportTypePB.Markdown, oneOfData: { case: 'data', value: toBinary(DocumentDataPBSchema, converted) } }] });
      expect(imported.items).toHaveLength(1); const documentId = imported.items[0].id;
      const saved = await call('OpenDocument', DocumentDataPBSchema, OpenDocumentPayloadPBSchema, { documentId }); expect(paragraphs(saved).map(units)).toEqual(source.map(units));
      await core.stop(); core = makeCore(); await start();
      expect((await call('GetUserProfile', UserProfilePBSchema)).id).toBe(user.id);
      const reopened = await call('OpenDocument', DocumentDataPBSchema, OpenDocumentPayloadPBSchema, { documentId }); expect(paragraphs(reopened).map(units)).toEqual(source.map(units));
      const reexported = markdownToEditorJson(hyperExportDocument(reopened, 'markdown'));
      expect(reexported.children.map(block => units(block.data.delta as HyperTextRun[]))).toEqual(source.map(units));
    } finally { await core.stop(); fs.rmSync(support, { recursive: true, force: true }); }
  }, 45_000);
});
