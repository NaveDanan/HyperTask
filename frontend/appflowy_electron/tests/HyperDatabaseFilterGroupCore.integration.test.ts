import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CreateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { CreateFieldPayloadPBSchema, FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { CreateRowPayloadPBSchema, RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { CellChangesetPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { DatabaseSettingChangesetPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { FilterType, RepeatedFilterPBSchema, type FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { TextFilterPBSchema } from '@shared/protobuf/flowy-database2/text_filter_pb';
import { CheckboxFilterPBSchema } from '@shared/protobuf/flowy-database2/checkbox_filter_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
async function hashBinary() { const hash = createHash('sha256'); for await (const part of fs.createReadStream(binary)) hash.update(part); return hash.digest('hex'); }
(fs.existsSync(binary) ? describe : describe.skip)('Hyper advanced filter groups through public native events', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-public-filter-groups-'));
  let core = new CoreProcess(binary);
  const start = async () => { await core.start(() => {}); expect(await core.init({ root: directory, app_version: '0.11.4', custom_app_path: directory, origin_app_path: directory, device_id: 'hyper-filter-group', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0); };
  async function request(event: string, schema: DescMessage, data: object) { const result = await core.request(event, toBinary(schema, create(schema, data as MessageInitShape<DescMessage>))); if (result.status !== 0) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return result.payload; }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { const bytes = input ? await request(event, input[0], input[1]) : (await core.request(event, new Uint8Array())).payload; return fromBinary(output, bytes); }
  afterAll(async () => { await core.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  it('preserves a leaf when grouping, changes And/Or membership and deletes a nested child before restart', async () => {
    const before = await hashBinary(); await start();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Public filter group fixture', password: 'Guest!@123456', authType: 0, deviceId: 'hyper-filter-group' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.workspaceId, name: 'Advanced filters', layout: ViewLayoutPB.Grid }]);
    await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: view.id }]);
    const color = await call('CreateField', FieldPBSchema, [CreateFieldPayloadPBSchema, { viewId: view.id, fieldType: FieldType.RichText, oneOfFieldName: { case: 'fieldName', value: 'Color' } }]), flag = await call('CreateField', FieldPBSchema, [CreateFieldPayloadPBSchema, { viewId: view.id, fieldType: FieldType.Checkbox, oneOfFieldName: { case: 'fieldName', value: 'Flag' } }]);
    const rows: string[] = [];
    for (const [content, checked] of [['red', 'Yes'], ['red', 'No'], ['blue', 'Yes'], ['blue', 'No']]) {
      const row = await call('CreateRow', RowMetaPBSchema, [CreateRowPayloadPBSchema, { viewId: view.id }]); rows.push(row.id);
      for (const [fieldId, cellChangeset] of [[color.id, content], [flag.id, checked]]) await request('UpdateCell', CellChangesetPBSchema, { viewId: view.id, rowId: row.id, fieldId, cellChangeset });
    }
    const filters = async () => (await call('GetAllFilters', RepeatedFilterPBSchema, [DatabaseViewIdPBSchema, { value: view.id }])).items;
    const write = (change: object) => request('UpdateDatabaseSetting', DatabaseSettingChangesetPBSchema, { viewId: view.id, ...change });
    const visible = async (indices: number[]) => vi.waitFor(async () => { const value = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: view.id }]); expect(value.rows.map(row => row.id).filter(id => rows.includes(id)).sort()).toEqual(indices.map(index => rows[index]).sort()); }, { timeout: 5000 });
    const textData = (content: string) => ({ fieldId: color.id, fieldType: FieldType.RichText, data: toBinary(TextFilterPBSchema, create(TextFilterPBSchema, { condition: 0, content })) });
    await write({ oneOfInsertFilter: { case: 'insertFilter', value: { data: textData('red') } } });
    const original = (await filters())[0], originalData = original.oneOfData.value!; await visible([0, 1]);
    await write({ oneOfInsertFilter: { case: 'insertFilter', value: { oneOfParentFilterId: { case: 'parentFilterId', value: original.id }, data: { fieldId: flag.id, fieldType: FieldType.Checkbox, data: toBinary(CheckboxFilterPBSchema, create(CheckboxFilterPBSchema, { condition: 0 })) } } } });
    let group = (await filters())[0]; expect(group.id).toBe(original.id); expect(group.filterType).toBe(FilterType.And); expect(group.children).toHaveLength(2); expect(group.children[0].id).not.toBe(original.id); expect(group.children[0].oneOfData.value).toEqual(originalData); await visible([0]);
    const changeType = (filterId: string, filterType: FilterType) => write({ oneOfUpdateFilterType: { case: 'updateFilterType', value: { filterId, filterType } } });
    const children = group.children.map(child => child.id); await changeType(group.id, FilterType.Or); await visible([0, 1, 2]); expect((await filters())[0].children.map(child => child.id)).toEqual(children);
    await changeType(group.id, FilterType.And); await visible([0]); await changeType(group.id, FilterType.Or);
    const flagLeaf = group.children.find(child => child.oneOfData.value?.fieldId === flag.id)!;
    await write({ oneOfInsertFilter: { case: 'insertFilter', value: { oneOfParentFilterId: { case: 'parentFilterId', value: flagLeaf.id }, data: textData('blue') } } });
    group = (await filters())[0]; let nested = group.children.find(child => child.id === flagLeaf.id)!; expect(nested.filterType).toBe(FilterType.And); expect(nested.children).toHaveLength(2); expect(nested.children[0].oneOfData.value).toEqual(flagLeaf.oneOfData.value); await visible([0, 1, 2]);
    await changeType(nested.id, FilterType.Or); await visible([0, 1, 2, 3]);
    const childToRemove = nested.children.find(child => child.oneOfData.value?.fieldId === color.id)!;
    await write({ oneOfDeleteFilter: { case: 'deleteFilter', value: { filterId: childToRemove.id } } });
    const afterDelete = (await filters())[0]; nested = afterDelete.children.find(child => child.id === flagLeaf.id)!;
    console.log('Public group creation preserved source; And/Or membership passed; nested DeleteFilter ACKed; remaining children:', nested.children.length);
    expect(nested.children.map(child => child.id), 'an ACKed nested deletion must remove that exact child').not.toContain(childToRemove.id);
    expect(nested.children).toHaveLength(1); expect(afterDelete.children[0].oneOfData.value).toEqual(originalData); await visible([0, 1, 2]);
    const saved: FilterPB[] = await filters(); await core.stop(); core = new CoreProcess(binary); await start(); await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: view.id }]); expect(await filters()).toEqual(saved); await visible([0, 1, 2]); expect(await hashBinary()).toBe(before);
  }, 30000);
});
