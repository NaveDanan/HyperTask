import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';
import { HyperDocumentHtmlImporter } from '../src/renderer/features/document-import/HyperDocumentHtmlImporter';
import { hyperBlockData, hyperBlockText, hyperDocumentPlainText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperHtmlElectronAvailable, hyperParseHtmlFixtures } from './HyperDocumentImportHarness';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) && hyperHtmlElectronAvailable ? describe : describe.skip)('Hyper HTML import (real core)', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-html-import-core-')); let core = new CoreProcess(binary);
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-html-import-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  };
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const bytes = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([core.request(event, bytes), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Core request timed out: ${event}`)), 15_000); })]).finally(() => clearTimeout(timer));
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return fromBinary(output, reply.payload);
  }
  afterAll(async () => { await core.stop(); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('imports parsed protobuf content and preserves title, Unicode, marks, tasks and tables after restart', async () => {
    const parsed = await hyperParseHtmlFixtures([{ source: '<title>HTML import 🌍</title><h2>Section</h2><p>Unicode 🌍 <strong>bold</strong> <a href="https://example.test">link</a></p><ul><li><input type="checkbox" checked>Done</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>One</td><td>Two</td></tr></table><pre><code class="language-js">const n = 42;\n next();</code></pre>' }]);
    const result = parsed.pages[0]; if (!result.ok) throw new Error(result.error);
    expect(result.issueCount).toBe(0); expect(parsed.requests).toBe(0);
    const document = fromBinary(DocumentDataPBSchema, Uint8Array.from(result.bytes));
    await initialize();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-html-import-test' }]);
    const workspace = await call('ReadCurrentWorkspace', WorkspacePBSchema);
    const parent = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.id, name: 'Import destination', layout: ViewLayoutPB.Document, setAsCurrent: false }]);
    const importer = new HyperDocumentHtmlImporter(), identity = await importer.identity();
    const imported = await importer.importPage(parent.id, { title: result.title, document, issues: result.issues, issueCount: result.issueCount, blockCount: result.blockCount, textLength: result.textLength }, identity);
    expect(imported.name).toBe('HTML import 🌍'); expect(imported.parentViewId).toBe(parent.id);
    const first = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: imported.id }]);
    const markdown = hyperExportDocument(first, 'markdown', imported.name);
    expect(markdown).toContain('Unicode 🌍 **bold**'); expect(markdown).toContain('- [x] Done'); expect(markdown).toContain('| One | Two |');
    await core.stop(); core = new CoreProcess(binary); await initialize();
    const reopened = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: imported.id }]);
    expect(hyperExportDocument(reopened, 'markdown', imported.name)).toBe(markdown);
    expect(hyperDocumentPlainText(reopened)).toContain('Unicode 🌍');
    const blocks = Object.values(reopened.blocks);
    expect(blocks.find(block => block.ty === 'todo_list') && hyperBlockData(blocks.find(block => block.ty === 'todo_list')!).checked).toBe(true);
    expect(blocks.flatMap(block => hyperBlockText(reopened, block)).some(run => run.attributes?.href === 'https://example.test')).toBe(true);
  });
});
