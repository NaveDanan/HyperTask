import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { DatabaseLayoutPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { SortConditionPB } from '@shared/protobuf/flowy-database2/sort_entities_pb';
import { CalculationType } from '@shared/protobuf/flowy-database2/calculation_entities_pb';
import { TextFilterConditionPB, TextFilterPBSchema } from '@shared/protobuf/flowy-database2/text_filter_pb';
import { DatabaseEventCreateSelectOption, DatabaseEventInsertOrUpdateSelectOption, DatabaseEventGetNoDateCalendarEvents } from '../src/renderer/backend/events/flowy-database2';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDecodeCell } from '../src/renderer/features/database/HyperDatabaseCells';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper databases (real Rust core)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypertask-database-test-'));
  let core = new CoreProcess(binary);
  const repository = new HyperDatabaseRepository();
  let viewId = '', rootId = '';
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: dataDir, app_version: '0.11.4', custom_app_path: dataDir, origin_app_path: dataDir, device_id: 'hyper-database-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  };
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const payload = input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array();
    const reply = await core.request(event, payload);
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return fromBinary(output, reply.payload);
  }
  const createView = async (layout: ViewLayoutPB) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: rootId, name: 'Hyper database test', layout, setAsCurrent: false }]);
  afterAll(async () => { await core.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it('edits typed cells and preserves them across restart', async () => {
    await initialize();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-database-test' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    const roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]);
    rootId = roots.items[0].id;
    const view = await createView(ViewLayoutPB.Grid); viewId = view.id;
    let snapshot = await repository.load(viewId);
    const title = snapshot.fields.find(field => field.isPrimary)!;
    const checkbox = await repository.createField(viewId, 'Checked', FieldType.Checkbox);
    const number = await repository.createField(viewId, 'Count', FieldType.Number);
    const date = await repository.createField(viewId, 'Date', FieldType.DateTime);
    const select = await repository.createField(viewId, 'Choice', FieldType.SingleSelect);
    const row = await repository.createRow(viewId);
    await repository.updateText(viewId, row.id, title.id, 'Hyper row 🌎');
    await repository.updateText(viewId, row.id, checkbox.id, 'Yes');
    await repository.updateText(viewId, row.id, number.id, '42.5');
    await repository.updateDate(viewId, row.id, date.id, '2026-11-10');
    const optionResult = await DatabaseEventCreateSelectOption({ viewId, fieldId: select.id, optionName: 'Ready' });
    expect(optionResult.ok).toBe(true); if (!optionResult.ok) return;
    const inserted = await DatabaseEventInsertOrUpdateSelectOption({ viewId, fieldId: select.id, rowId: row.id, items: [optionResult.value] });
    expect(inserted.ok, inserted.ok ? '' : inserted.error.msg).toBe(true);
    await repository.updateSelect(viewId, row.id, select.id, [], [optionResult.value.id]);
    const read = async () => [
      hyperDecodeCell(title, await repository.cell(viewId, row.id, title.id)).text,
      hyperDecodeCell(checkbox, await repository.cell(viewId, row.id, checkbox.id)).checked,
      hyperDecodeCell(number, await repository.cell(viewId, row.id, number.id)).text,
      hyperDecodeCell(date, await repository.cell(viewId, row.id, date.id)).date,
      hyperDecodeCell(select, await repository.cell(viewId, row.id, select.id)).text,
    ];
    expect(await read()).toEqual(['Hyper row 🌎', true, '42.5', '2026-11-10', 'Ready']);
    await repository.calculate(viewId, number.id, CalculationType.Sum);
    await vi.waitFor(async () => {
      const calculated = await repository.load(viewId);
      expect(Number(calculated.calculations.find(item => item.fieldId === number.id)?.value)).toBe(42.5);
    });
    await repository.updateSelect(viewId, row.id, select.id, [optionResult.value.id], []);
    expect(hyperDecodeCell(select, await repository.cell(viewId, row.id, select.id)).text).toBe('');
    await repository.fieldVisibility(viewId, number.id, false);
    snapshot = await repository.load(viewId);
    expect(snapshot.fieldSettings.find(setting => setting.fieldId === number.id)?.visibility).toBe(FieldVisibility.AlwaysHidden);
    await core.stop(); core = new CoreProcess(binary); await initialize();
    snapshot = await repository.load(viewId);
    expect(snapshot.database.rows.some(item => item.id === row.id)).toBe(true);
    expect(await read()).toEqual(['Hyper row 🌎', true, '42.5', '2026-11-10', '']);
    await repository.updateDate(viewId, row.id, date.id, '');
    expect(hyperDecodeCell(date, await repository.cell(viewId, row.id, date.id)).date).toBe('');
  });
  it('persists per-view sorts and text filters', async () => {
    const snapshot = await repository.load(viewId), primary = snapshot.fields.find(field => field.isPrimary)!;
    await repository.setting({ viewId, oneOfUpdateSort: { case: 'updateSort', value: { viewId, fieldId: primary.id, condition: SortConditionPB.Descending } } });
    await repository.setting({ viewId, oneOfInsertFilter: { case: 'insertFilter', value: { data: { fieldId: primary.id, fieldType: FieldType.RichText, data: toBinary(TextFilterPBSchema, create(TextFilterPBSchema, { condition: TextFilterConditionPB.TextContains, content: 'Hyper row' })) } } } });
    const next = await repository.load(viewId);
    expect(next.settings.sorts?.items.some(sort => sort.fieldId === primary.id)).toBe(true);
    expect(next.settings.filters?.items.length).toBeGreaterThan(0);
  });
  it('loads board groups and adds rows to a chosen group', async () => {
    const board = await createView(ViewLayoutPB.Board);
    expect((await repository.load(board.id)).database.layoutType).toBe(DatabaseLayoutPB.Board);
    const groups = await repository.groups(board.id);
    expect(groups.length).toBeGreaterThan(0);
    const row = await repository.createRow(board.id, groups[0].groupId);
    await vi.waitFor(async () => { expect((await repository.groups(board.id)).find(group => group.groupId === groups[0].groupId)?.rows.some(item => item.id === row.id)).toBe(true); });
    if (groups.length > 1) {
      await repository.moveCard(board.id, row.id, groups[0].groupId, groups[1].groupId);
      await vi.waitFor(async () => { expect((await repository.groups(board.id)).find(group => group.groupId === groups[1].groupId)?.rows.some(item => item.id === row.id)).toBe(true); });
    }
  });
  it('loads calendar events with their row ids and date properties', async () => {
    const calendar = await createView(ViewLayoutPB.Calendar);
    const snapshot = await repository.load(calendar.id);
    const field = snapshot.fields.find(field => field.fieldType === FieldType.DateTime)!;
    expect(field).toBeDefined();
    const row = await repository.createRow(calendar.id);
    const before = await repository.calendar(calendar.id);
    expect(before.undated.some(event => event.rowId === row.id)).toBe(true);
    const backendUndated = await DatabaseEventGetNoDateCalendarEvents({ viewId: calendar.id });
    expect(backendUndated.ok).toBe(true);
    if (backendUndated.ok) expect(backendUndated.value.items.some(event => event.rowId === row.id)).toBe(true);
    await repository.updateDate(calendar.id, row.id, field.id, '2026-11-10');
    const events = await repository.calendar(calendar.id);
    expect(events.events.some(event => event.rowMeta?.id === row.id)).toBe(true);
    expect(events.undated.every(event => event.rowId !== row.id)).toBe(true);
  });
});
