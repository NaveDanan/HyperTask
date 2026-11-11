import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { MediaFilterPBSchema } from '@shared/protobuf/flowy-database2/media_filter_pb';
import { RelationFilterPBSchema } from '@shared/protobuf/flowy-database2/relation_filter_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDecodeCell } from '../src/renderer/features/database/HyperDatabaseCells';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper attachment and relation presence filters through the Rust core', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-presence-filters-')), repository = new HyperDatabaseRepository();
  let core = new CoreProcess(binary), parentId = '';
  const start = async () => {
    await core.start(() => {});
    expect(await core.init({ root: directory, app_version: '0.11.4', custom_app_path: directory, origin_app_path: directory, device_id: 'hyper-presence-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  };
  async function call<T extends DescMessage>(event: string, output: T, input?: [DescMessage, object]) {
    const reply = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array());
    if (reply.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return fromBinary(output, reply.payload);
  }
  const grid = (name: string) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name, layout: ViewLayoutPB.Grid, setAsCurrent: false }]);
  beforeAll(async () => {
    await start();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Presence fixture', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-presence-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    parentId = (await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }])).items[0].id;
  });
  afterAll(async () => { await core.stop(); vi.unstubAllGlobals(); fs.rmSync(directory, { recursive: true, force: true }); });

  for (const fieldType of [FieldType.Media, FieldType.Relation]) it(`filters ${fieldType === FieldType.Media ? 'attachments' : 'relations'} by stored presence, tracks edits and persists both conditions`, async () => {
    const source = await grid('Presence source'), snapshot = await repository.load(source.id);
    const target = await grid('Related records'), targetSnapshot = await repository.load(target.id), targetRow = await repository.createRow(target.id);
    const field = await repository.createField(source.id, 'Presence', fieldType, targetSnapshot.database.id);
    const empty = await repository.createRow(source.id), populated = await repository.createRow(source.id);
    const all = [...snapshot.database.rows.map(row => row.id), empty.id, populated.id].sort();
    const add = async (rowId: string) => {
      if (fieldType === FieldType.Relation) await repository.relation(source.id, rowId, field.id, targetRow.id, true);
      else await repository.attachMediaLink(source.id, rowId, field.id, 'https://example.invalid/no-request', 'Stored link');
    };
    const clear = async (rowId: string) => {
      if (fieldType === FieldType.Relation) await repository.relation(source.id, rowId, field.id, targetRow.id, false);
      else for (const file of hyperDecodeCell(field, await repository.cell(source.id, rowId, field.id)).files!) await repository.removeMedia(source.id, rowId, field.id, file.id);
    };
    await add(populated.id);
    let filterId = '';
    const encoded = (condition: number) => fieldType === FieldType.Relation
      ? toBinary(RelationFilterPBSchema, create(RelationFilterPBSchema, { condition: BigInt(condition) }))
      : toBinary(MediaFilterPBSchema, create(MediaFilterPBSchema, { condition }));
    const readFilter = async () => (await repository.load(source.id)).settings.filters!.items.find(filter => filter.id === filterId || !filterId && filter.oneOfData.value?.fieldId === field.id)!;
    const condition = async () => {
      const bytes = (await readFilter()).oneOfData.value!.data;
      return fieldType === FieldType.Relation ? Number(fromBinary(RelationFilterPBSchema, bytes).condition) : fromBinary(MediaFilterPBSchema, bytes).condition;
    };
    const set = async (value: number) => {
      const data = { fieldId: field.id, fieldType, data: encoded(value) };
      await repository.setting({ viewId: source.id, ...(filterId ? { oneOfUpdateFilterData: { case: 'updateFilterData' as const, value: { filterId, data } } } : { oneOfInsertFilter: { case: 'insertFilter' as const, value: { data } } }) });
      filterId = (await readFilter()).id;
      expect(await condition()).toBe(value);
    };
    const visible = async () => (await repository.load(source.id)).database.rows.map(row => row.id).sort();
    const expectRows = (ids: string[]) => vi.waitFor(async () => expect(await visible()).toEqual([...ids].sort()), { timeout: 2500, interval: 50 });
    await set(1); await expectRows([populated.id]);
    await add(empty.id); await expectRows([empty.id, populated.id]);
    await clear(populated.id); await expectRows([empty.id]);
    await set(0); await expectRows(all.filter(id => id !== empty.id));
    await core.stop(); core = new CoreProcess(binary); await start();
    expect(await condition()).toBe(0); await expectRows(all.filter(id => id !== empty.id));
    await set(1); await expectRows([empty.id]);
    await repository.setting({ viewId: source.id, oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId } } });
    await expectRows(all);
  }, 20_000);
});
