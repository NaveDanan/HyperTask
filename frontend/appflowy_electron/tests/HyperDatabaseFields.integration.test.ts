import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DatabaseLayoutPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { MediaFilePBSchema, MediaFileTypePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { FileUploadTypePB } from '@shared/protobuf/flowy-database2/file_entities_pb';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDecodeCell, hyperRelationDatabase } from '../src/renderer/features/database/HyperDatabaseCells';
import { HyperAssets } from '../src/main/HyperAssets';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper database checklist and relation fields (real Rust core)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-database-fields-'));
  let core = new CoreProcess(binary);
  const repository = new HyperDatabaseRepository();
  async function initialize() {
    await core.start(() => {});
    expect(await core.init({ root: dataDir, app_version: '0.11.4', custom_app_path: dataDir, origin_app_path: dataDir, device_id: 'hyper-fields-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const payload = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const reply = await core.request(event, payload);
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return fromBinary(output, reply.payload);
  }
  afterAll(async () => { await core.stop(); vi.unstubAllGlobals(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('mutates checklist tasks and cross-database links without coercing them to text, then persists them through layout changes and restart', async () => {
    await initialize();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-fields-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    const roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    const createGrid = (name: string) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: roots.items[0].id, name, layout: ViewLayoutPB.Grid }]);
    const source = await createGrid('Hyper tasks'), target = await createGrid('Hyper projects');
    const sourceSnapshot = await repository.load(source.id), targetSnapshot = await repository.load(target.id);
    const targetPrimary = targetSnapshot.fields.find(field => field.isPrimary)!;
    const projectA = await repository.createRow(target.id), projectB = await repository.createRow(target.id);
    await repository.updateText(target.id, projectA.id, targetPrimary.id, 'Project A 🌎');
    await repository.updateText(target.id, projectB.id, targetPrimary.id, 'Project B');
    expect((await repository.databases()).find(database => database.databaseId === targetSnapshot.database.id)?.name).toBe('Hyper projects');

    const checklist = await repository.createField(source.id, 'Steps', FieldType.Checklist);
    const relation = await repository.createField(source.id, 'Project', FieldType.Relation, targetSnapshot.database.id);
    const created = await repository.createField(source.id, 'Created', FieldType.CreatedTime);
    const edited = await repository.createField(source.id, 'Edited', FieldType.LastEditedTime);
    const media = await repository.createField(source.id, 'Attachments', FieldType.Media);
    expect(hyperRelationDatabase(relation)).toBe(targetSnapshot.database.id);
    const row = await repository.createRow(source.id);
    const readChecklist = async () => hyperDecodeCell(checklist, await repository.cell(source.id, row.id, checklist.id)).checklist!;
    const readRelation = async () => hyperDecodeCell(relation, await repository.cell(source.id, row.id, relation.id)).rowIds!;
    const readMedia = async () => hyperDecodeCell(media, await repository.cell(source.id, row.id, media.id)).files!;
    await repository.checklist(source.id, row.id, checklist.id, { insertTask: [{ name: 'Draft' }, { name: 'Review' }] });
    const tasks = (await readChecklist()).options;
    expect(tasks.map(task => task.name)).toEqual(['Draft', 'Review']);
    await repository.checklist(source.id, row.id, checklist.id, { completedTasks: [tasks[0].id] });
    expect((await readChecklist()).completed).toEqual([tasks[0].id]);
    await repository.checklist(source.id, row.id, checklist.id, { completedTasks: [tasks[0].id] });
    expect((await readChecklist()).completed).toEqual([]);
    await repository.checklist(source.id, row.id, checklist.id, { updateTasks: [{ ...tasks[1], name: 'Approve' }], reorder: `${tasks[1].id} ${tasks[0].id}` });
    expect((await readChecklist()).options.map(task => task.name)).toEqual(['Approve', 'Draft']);
    await repository.checklist(source.id, row.id, checklist.id, { completedTasks: [tasks[1].id], deleteTasks: [tasks[0].id] });
    expect((await readChecklist()).options.map(task => task.name)).toEqual(['Approve']);
    expect((await readChecklist()).completed).toEqual([tasks[1].id]);

    await repository.relation(source.id, row.id, relation.id, projectA.id, true);
    await repository.relation(source.id, row.id, relation.id, projectB.id, true);
    expect(new Set(await readRelation())).toEqual(new Set([projectA.id, projectB.id]));
    expect((await repository.relatedRows(targetSnapshot.database.id, await readRelation())).map(row => row.name).sort()).toEqual(['Project A 🌎', 'Project B']);
    await repository.relation(source.id, row.id, relation.id, projectB.id, false);
    expect(await readRelation()).toEqual([projectA.id]);
    await repository.relation(source.id, row.id, relation.id, 'deleted-related-row', true);
    expect(await readRelation()).toContain('deleted-related-row');
    await repository.relation(source.id, row.id, relation.id, 'deleted-related-row', false);
    expect(await readRelation()).toEqual([projectA.id]);
    await repository.renameField(source.id, checklist.id, 'Approval steps');
    const sourceFile = path.join(dataDir, 'Research.pdf');
    fs.writeFileSync(sourceFile, Buffer.from([0, 1, 128, 255]));
    const assets = new HyperAssets(() => dataDir), imported = await assets.importFile(sourceFile);
    fs.unlinkSync(sourceFile);
    const localFile = create(MediaFilePBSchema, { id: 'local-file-id', name: imported.name, url: imported.path, uploadType: FileUploadTypePB.LocalFile, fileType: MediaFileTypePB.Document });
    await repository.attachMedia(source.id, row.id, media.id, localFile);
    await repository.attachMediaLink(source.id, row.id, media.id, 'https://example.org/design', 'Design');
    await repository.renameMedia(source.id, row.id, media.id, localFile.id, 'Research notes.pdf');
    expect((await readMedia()).map(file => [file.name, file.uploadType, file.fileType])).toEqual([['Research notes.pdf', FileUploadTypePB.LocalFile, MediaFileTypePB.Document], ['Design', FileUploadTypePB.NetworkFile, MediaFileTypePB.Link]]);
    const link = (await readMedia())[1];
    await expect(repository.attachMediaLink(source.id, row.id, media.id, 'javascript:alert(1)', 'Invalid')).rejects.toThrow('HTTP or HTTPS');
    await repository.removeMedia(source.id, row.id, media.id, link.id);
    expect((await readMedia()).map(file => file.id)).toEqual([localFile.id]);
    for (const field of [created, edited]) {
      const value = hyperDecodeCell(field, await repository.cell(source.id, row.id, field.id));
      expect(value.editable).toBe(false);
      expect(value.text).not.toBe('');
    }
    for (const layout of [DatabaseLayoutPB.Board, DatabaseLayoutPB.Calendar, DatabaseLayoutPB.Grid]) {
      await repository.layout(source.id, layout);
      expect((await repository.load(source.id)).database.layoutType).toBe(layout);
      expect(await readRelation()).toEqual([projectA.id]);
      expect((await readChecklist()).completed).toEqual([tasks[1].id]);
    }
    await core.stop(); core = new CoreProcess(binary); await initialize();
    const restored = await repository.load(source.id);
    expect(restored.database.rows.some(item => item.id === row.id)).toBe(true);
    expect(restored.fields.find(field => field.id === checklist.id)?.name).toBe('Approval steps');
    expect(hyperRelationDatabase(restored.fields.find(field => field.id === relation.id)!)).toBe(targetSnapshot.database.id);
    expect((await readChecklist()).completed).toEqual([tasks[1].id]);
    expect(await readRelation()).toEqual([projectA.id]);
    expect((await readMedia()).map(file => [file.id, file.name, file.url, file.uploadType, file.fileType])).toEqual([[localFile.id, 'Research notes.pdf', localFile.url, localFile.uploadType, localFile.fileType]]);
    expect(fs.readFileSync(await new HyperAssets(() => dataDir).resolve(imported.previewUrl))).toEqual(Buffer.from([0, 1, 128, 255]));
    expect(restored.fields.some(field => field.id === sourceSnapshot.fields.find(field => field.isPrimary)?.id)).toBe(true);
  }, 30_000);
});
