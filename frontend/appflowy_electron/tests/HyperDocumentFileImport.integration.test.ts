import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { DocumentDataPBSchema, OpenDocumentPayloadPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';
import { HyperDocumentFileImporter } from '../src/renderer/features/document-import/HyperDocumentFileImporter';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperPlainText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDecodeCell } from '../src/renderer/features/database/HyperDatabaseCells';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
const mathFormula = String.raw`\begin{pmatrix}
\frac{1}{x} & \alpha \\
\beta & y_2
\end{pmatrix} % keep original source`;
(fs.existsSync(binary) ? describe : describe.skip)('Hyper Markdown/text/CSV imports (real core)', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-file-import-core-')); let core = new CoreProcess(binary);
  let parentId = '', markdownId = '', injectFailure = true, writes = 0;
  const reads: string[] = [], files = new Map([
    ['/selected/good.md', `# Title\n\n\\# literal heading\n\n1. Parent\n\n   - Nested\n\n> **bold** \\<script\\>\n\n$$\n${mathFormula}\n$$\n`],
    ['/selected/failure.md', 'Second page'], ['/selected/later.md', 'Unattempted page'],
    ['/selected/data.csv', 'Name,Count\nAlpha,42\nBeta,7\n'],
  ]);
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-file-import-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { fs: { readText: async (path: string) => { reads.push(path); return files.get(path) ?? null; } }, core: { request: async (event: string, payload: Uint8Array) => {
      if (event === 'ImportData' && injectFailure && ++writes === 2) return { status: Status.Err, payload: toBinary(FlowyErrorSchema, create(FlowyErrorSchema, { msg: 'Injected second-file failure' })) };
      return core.request(event, payload);
    } } } });
  };
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const bytes = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([core.request(event, bytes), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Core request timed out: ${event}`)), 15_000); })]).finally(() => clearTimeout(timer));
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return fromBinary(output, reply.payload);
  }
  afterAll(async () => { await core.stop(); vi.unstubAllGlobals(); fs.rmSync(support, { recursive: true, force: true }); });
  it('keeps a confirmed Markdown page after a later failure and preserves round-trip content across restart', async () => {
    await initialize(); await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-file-import-test' }]);
    const workspace = await call('ReadCurrentWorkspace', WorkspacePBSchema), parent = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.id, name: 'File import destination', layout: ViewLayoutPB.Document, setAsCurrent: false }]); parentId = parent.id;
    const importer = new HyperDocumentFileImporter();
    const report = await importer.importFiles(await importer.capture(parentId), 'markdownOrText', ['/selected/good.md', '/selected/failure.md', '/selected/later.md']);
    expect(report.imported).toHaveLength(1); markdownId = report.imported[0].id;
    expect(report.failures).toEqual([{ path: '/selected/failure.md', message: 'Injected second-file failure', uncertain: true }]); expect(reads).not.toContain('/selected/later.md');
    const before = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: markdownId }]);
    const exported = hyperExportDocument(before, 'markdown'); expect(exported).toContain('\\# literal heading'); expect(exported).toContain('   - Nested'); expect(exported).toContain('> **bold** \\<script\\>');
    const equation = Object.values(before.blocks).find(block => block.ty === 'math_equation');
    expect(equation && hyperBlockData(equation).formula).toBe(mathFormula); expect(exported).toContain(`$$\n${mathFormula}\n$$`);
    const numbered = Object.values(before.blocks).find(block => block.ty === 'numbered_list')!;
    expect(before.blocks[hyperChildren(before, numbered)[0]].ty).toBe('bulleted_list');
    expect(Object.values(before.blocks).flatMap(block => hyperBlockText(before, block)).some(run => run.insert === '# literal heading')).toBe(true);
    await core.stop(); core = new CoreProcess(binary); await initialize();
    const reopened = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: markdownId }]); expect(hyperExportDocument(reopened, 'markdown')).toBe(exported);
    expect(hyperBlockData(Object.values(reopened.blocks).find(block => block.ty === 'math_equation')!).formula).toBe(mathFormula);
    const parentAfter = await call('GetView', ViewPBSchema, [ViewIdPBSchema, { value: parentId }]); expect(parentAfter.childViews.map(view => view.id)).toEqual([markdownId]);
  });
  it('imports CSV through its native database path and preserves its rows after restart', async () => {
    injectFailure = false;
    const importer = new HyperDocumentFileImporter(), report = await importer.importFiles(await importer.capture(parentId), 'csv', ['/selected/data.csv']);
    expect(report.failures).toEqual([]); expect(report.imported).toHaveLength(1); expect(report.imported[0].layout).toBe(ViewLayoutPB.Grid);
    const repository = new HyperDatabaseRepository(), viewId = report.imported[0].id;
    let snapshot = await repository.load(viewId); const nameField = snapshot.fields.find(field => field.name === 'Name') ?? snapshot.fields.find(field => field.isPrimary)!;
    expect(await Promise.all(snapshot.database.rows.map(async row => hyperDecodeCell(nameField, await repository.cell(viewId, row.id, nameField.id)).text))).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    await core.stop(); core = new CoreProcess(binary); await initialize(); snapshot = await repository.load(viewId);
    expect(await Promise.all(snapshot.database.rows.map(async row => hyperDecodeCell(nameField, await repository.cell(viewId, row.id, nameField.id)).text))).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    const markdown = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: markdownId }]); expect(Object.values(markdown.blocks).some(block => hyperPlainText(hyperBlockText(markdown, block)) === '# literal heading')).toBe(true);
  });
});
