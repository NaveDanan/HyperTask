import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { ChecklistCellDataPBSchema } from '@shared/protobuf/flowy-database2/checklist_entities_pb';
import { TimestampCellDataPBSchema } from '@shared/protobuf/flowy-database2/timestamp_entities_pb';
import { TimeCellDataPBSchema } from '@shared/protobuf/flowy-database2/time_entities_pb';
import type { FilterPB } from '@shared/protobuf/flowy-database2/util_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDateTimestamp, hyperSelectOptions, hyperDecodeCell } from '../src/renderer/features/database/HyperDatabaseCells';
import { hyperDatabaseDateParts, hyperDatabaseDateZone } from '../src/renderer/features/database/HyperDatabaseDate';
import { hyperDatabaseFilterKind, hyperDatabaseFilterNew, hyperDecodeDatabaseFilter, hyperEncodeDatabaseFilter, type HyperDatabaseFilterValue } from '../src/renderer/features/database/HyperDatabaseFilter';
import { hyperDatabaseTimestampFilterEdit, hyperDatabaseTimestampFilterForm } from '../src/renderer/features/database/HyperDatabaseTimestampFilter';
import { hyperDatabaseFindFilters, hyperWriteDatabaseFilter } from '../src/renderer/features/database/HyperDatabaseFilterWrite';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper typed filters against the Rust core', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-typed-filters-')), repository = new HyperDatabaseRepository();
  let core = new CoreProcess(binary), parentId = '', workspaceId = '', actorId = '', updates = 0;
  const archive: { viewId: string; bytes: Uint8Array; rows: string[]; expected: number[] }[] = [];
  const start = async () => {
    await core.start(() => {}); expect(await core.init({ root: directory, app_version: '0.11.4', custom_app_path: directory, origin_app_path: directory, device_id: 'hyper-typed-filters', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => { if (event === 'UpdateDatabaseSetting') updates++; return core.request(event, payload); } } } });
  };
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { const reply = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array()); if (reply.status !== 0) throw Error(event + ': ' + fromBinary(FlowyErrorSchema, reply.payload).msg); return fromBinary(output, reply.payload); }
  beforeAll(async () => { await start(); const user = await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Typed filter fixture', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-typed-filters' }]); actorId = String(user.id); const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema); workspaceId = workspace.workspaceId; parentId = (await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspaceId }])).items[0].id; });
  afterAll(async () => { await core.stop(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); });
  const all = [0, 1, 2, 3], cases = [FieldType.RichText, FieldType.URL, FieldType.Summary, FieldType.Translate, FieldType.Number, FieldType.Time, FieldType.Checkbox, FieldType.Checklist, FieldType.SingleSelect, FieldType.MultiSelect, FieldType.CreatedTime, FieldType.LastEditedTime, FieldType.Media, FieldType.Relation].filter(type => hyperDatabaseFilterKind(type));
  it.each(cases)('filters actual rows for field type %s and keeps exact no-op bytes', async type => {
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name: 'Filter ' + type, layout: ViewLayoutPB.Grid, setAsCurrent: false }]), snapshot = await repository.load(view.id);
    let relatedId: string | undefined; const targets: string[] = [];
    if (type === FieldType.Relation) { const target = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name: 'Related filter target', layout: ViewLayoutPB.Grid, setAsCurrent: false }]); relatedId = (await repository.load(target.id)).database.id; targets.push((await repository.createRow(target.id)).id); }
    let field: FieldPB = await repository.createField(view.id, 'Property', type, relatedId); const rows: string[] = [];
    for (let index = 0; index < 4; index++) rows.push((await repository.createRow(view.id)).id);
    const entries: { condition: number; content?: string; optionIds?: string[]; expected: number[]; date?: HyperDatabaseFilterValue['date'] }[] = [];
    if ([FieldType.RichText, FieldType.Summary, FieldType.Translate].includes(type)) {
      for (const [index, value] of ['Alpha beta', 'beta END', 'GAMMA', ''].entries()) await repository.updateText(view.id, rows[index], field.id, value);
      for (const [condition, content, expected] of [[0, 'ALPHA BETA', [0]], [1, 'alpha beta', [1, 2, 3]], [2, 'BeTa', [0, 1]], [3, 'beta', [2, 3]], [4, 'ALPHA', [0]], [5, 'end', [1]], [6, '', [3]], [7, '', [0, 1, 2]]] as [number, string, number[]][]) entries.push({ condition, content, expected });
    } else if (type === FieldType.URL) {
      for (const [index, value] of ['https://alpha.example/Beta', 'https://beta.example/end', 'https://gamma.example', ''].entries()) await repository.updateText(view.id, rows[index], field.id, value);
      entries.push({ condition: 2, content: 'ALPHA.EXAMPLE', expected: [0] }, { condition: 6, expected: [3] });
    } else if (type === FieldType.Number) {
      for (const [index, value] of ['2.0000000000000000000000000001', '2.0000000000000000000000000002', '-3', ''].entries()) await repository.updateText(view.id, rows[index], field.id, value);
      [[0], [1, 2], [1], [2], [0, 1], [0, 2], [3], [0, 1, 2]].forEach((expected, condition) => entries.push({ condition, content: '2.0000000000000000000000000001', expected }));
    } else if (type === FieldType.Time) {
      for (const [index, value] of ['9007199254740992', '9007199254740993', '-30', ''].entries()) await repository.updateText(view.id, rows[index], field.id, value);
      [[0], [1, 2], [1], [2], [0, 1], [0, 2], [3], [0, 1, 2]].forEach((expected, condition) => entries.push({ condition, content: '9007199254740992', expected }));
    } else if (type === FieldType.Checkbox) {
      for (const [index, value] of ['Yes', 'No', '', 'No'].entries()) await repository.updateText(view.id, rows[index], field.id, value);
      entries.push({ condition: 0, expected: [0] }, { condition: 1, expected: [1, 2, 3] });
    } else if (type === FieldType.Checklist) {
      for (const index of [0, 1, 3]) { await repository.checklist(view.id, rows[index], field.id, { insertTask: [{ name: 'First' }, { name: 'Second' }] }); const data = fromBinary(ChecklistCellDataPBSchema, (await repository.cell(view.id, rows[index], field.id)).data); if (index !== 1) await repository.checklist(view.id, rows[index], field.id, { completedTasks: data.options.slice(0, index === 0 ? 2 : 1).map(option => option.id) }); }
      entries.push({ condition: 0, expected: [0] }, { condition: 1, expected: [1, 2, 3] });
    } else if (type === FieldType.SingleSelect || type === FieldType.MultiSelect) {
      for (const name of ['A', 'B', 'C']) await repository.createSelectOption(view.id, rows[0], field.id, name);
      field = (await repository.load(view.id)).fields.find(item => item.id === field.id)!; const options = hyperSelectOptions(field), ids = ['A', 'B', 'C'].map(name => options.find(option => option.name === name)!.id);
      const desired = type === FieldType.SingleSelect ? [[ids[0]], [ids[1]], [], [ids[0]]] : [[ids[0], ids[1]], [ids[1]], [], [ids[2]]];
      for (let index = 0; index < 4; index++) { const previous = hyperDecodeCell(field, await repository.cell(view.id, rows[index], field.id)).selected?.map(option => option.id) ?? []; await repository.updateSelect(view.id, rows[index], field.id, previous, desired[index]); }
      if (type === FieldType.SingleSelect) entries.push({ condition: 0, optionIds: [ids[0]], expected: [0, 3] }, { condition: 1, optionIds: [ids[0]], expected: [1, 2] });
      else entries.push({ condition: 2, optionIds: ids.slice(0, 2), expected: [0, 1] }, { condition: 3, optionIds: ids.slice(0, 2), expected: [2, 3] });
      entries.push({ condition: 4, expected: [2] }, { condition: 5, expected: [0, 1, 3] });
    } else if (type === FieldType.Media) {
      for (const index of [0, 1]) await repository.attachMediaLink(view.id, rows[index], field.id, 'https://example.invalid/attachment-' + index, 'Attachment ' + index);
      entries.push({ condition: 0, expected: [2, 3] }, { condition: 1, expected: [0, 1] });
    } else if (type === FieldType.Relation) {
      for (const index of [0, 1]) await repository.relation(view.id, rows[index], field.id, targets[0], true);
      entries.push({ condition: 0, expected: [2, 3] }, { condition: 1, expected: [0, 1] });
    } else {
      const timestamp = fromBinary(TimestampCellDataPBSchema, (await repository.cell(view.id, rows[0], field.id)).data).oneOfTimestamp.value!; expect(timestamp).toBeDefined();
      const today = hyperDatabaseDateParts(timestamp, '').day, shifted = (days: number) => new Date(Number(hyperDateTimestamp(today) + BigInt(days * 86400)) * 1000).toISOString().slice(0, 10), original = { condition: 0, timestamp, useFieldTimezone: false }, form = hyperDatabaseTimestampFilterForm(original);
      for (let condition = 0; condition < 8; condition++) { const day = condition === 1 || condition === 4 ? shifted(1) : condition === 2 || condition === 3 ? shifted(-1) : today; entries.push({ condition, date: hyperDatabaseTimestampFilterEdit(original, { ...form, condition, day, start: today, end: today }).value, expected: [3, 4, 6].includes(condition) ? [] : all }); }
    }
    const owner = { contextKey: directory, workspaceId, actorId, isCurrent: () => true }; let source: FilterPB | null = null;
    for (const entry of entries) {
      const value = { ...hyperDatabaseFilterNew(type), ...entry }, bytes = hyperEncodeDatabaseFilter(type, value);
      expect(await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, bytes, owner, () => true)).toBe(true);
      await vi.waitFor(async () => { const visible = (await repository.load(view.id)).database.rows.map(row => row.id).filter(id => rows.includes(id)).sort(); expect(visible).toEqual(entry.expected.map(index => rows[index]).sort()); }, { timeout: 5000 });
      source = hyperDatabaseFindFilters((await repository.load(view.id)).settings.filters?.items ?? [])[0]; expect(hyperDecodeDatabaseFilter(type, source.oneOfData.value!.data).value.condition).toBe(entry.condition);
    }
    const bytes = source!.oneOfData.value!.data, before = updates; expect(await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, bytes, owner, () => true)).toBe(false); expect(updates).toBe(before);
    archive.push({ viewId: view.id, bytes: bytes.slice(), rows, expected: entries.at(-1)!.expected });
  }, 30000);
  it('distinguishes empty Time cells from zero and preserves signed i64 comparisons by actual row membership', async () => {
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name: 'Exact Time presence', layout: ViewLayoutPB.Grid, setAsCurrent: false }]);
    const snapshot = await repository.load(view.id), field = await repository.createField(view.id, 'Minutes', FieldType.Time), rows: string[] = [];
    for (const content of ['', '0', '-9223372036854775808', '9223372036854775807']) {
      const row = await repository.createRow(view.id); rows.push(row.id);
      if (content !== '') await repository.updateText(view.id, row.id, field.id, content);
    }
    const owner = { contextKey: directory, workspaceId, actorId, isCurrent: () => true };
    let source: FilterPB | null = null;
    const expected = [[1], [2, 3], [3], [2], [1, 3], [1, 2], [0], [1, 2, 3]];
    for (let condition = 0; condition < 8; condition++) {
      const bytes = hyperEncodeDatabaseFilter(FieldType.Time, { ...hyperDatabaseFilterNew(FieldType.Time), condition, content: '0' });
      await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, bytes, owner, () => true);
      // The scalar cell protobuf encodes both None and Some(0) as zero. Only
      // authoritative filtered row membership proves this distinction.
      await vi.waitFor(async () => expect((await repository.load(view.id)).database.rows.map(row => row.id).filter(id => rows.includes(id)).sort()).toEqual(expected[condition].map(index => rows[index]).sort()), { timeout: 5000 });
      source = hyperDatabaseFindFilters((await repository.load(view.id)).settings.filters?.items ?? [])[0];
    }
  }, 20000);
  it('prefills newly created Time rows in exact minutes, retains endpoints and blocks a newly locked view', async () => {
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name: 'Time filter prefill', layout: ViewLayoutPB.Grid, setAsCurrent: false }]);
    const snapshot = await repository.load(view.id), field = await repository.createField(view.id, 'Minutes', FieldType.Time);
    const owner = { contextKey: directory, workspaceId, actorId, isCurrent: () => true };
    let source: FilterPB | null = null;
    for (const [condition, content, expected] of [[2, '90', 91n], [3, '-30', -31n], [0, '9223372036854775807', 9223372036854775807n], [0, '-9223372036854775808', -9223372036854775808n]] as const) {
      await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, hyperEncodeDatabaseFilter(FieldType.Time, { ...hyperDatabaseFilterNew(FieldType.Time), condition, content }), owner, () => true);
      source = hyperDatabaseFindFilters((await repository.load(view.id)).settings.filters?.items ?? [])[0];
      const row = await repository.createRow(view.id), cell = await repository.cell(view.id, row.id, field.id);
      expect(fromBinary(TimeCellDataPBSchema, cell.data).time).toBe(expected);
      await vi.waitFor(async () => expect((await repository.load(view.id)).database.rows.some(item => item.id === row.id)).toBe(true), { timeout: 5000 });
    }
    const locked = await core.request('LockView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, { value: view.id })));
    expect(locked.status).toBe(0);
    const before = updates;
    await expect(hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, hyperEncodeDatabaseFilter(FieldType.Time, { ...hyperDatabaseFilterNew(FieldType.Time), content: '0' }), owner, () => true)).rejects.toThrow();
    expect(updates).toBe(before);
  }, 20000);
  it('persists typed criteria and actual filtered results after a core restart', async () => {
    expect(archive).toHaveLength(cases.length); await core.stop(); core = new CoreProcess(binary); await start();
    for (const saved of archive) { const snapshot = await repository.load(saved.viewId), filter = hyperDatabaseFindFilters(snapshot.settings.filters?.items ?? [])[0]; expect(filter.oneOfData.value!.data).toEqual(saved.bytes); await vi.waitFor(async () => { expect((await repository.load(saved.viewId)).database.rows.map(row => row.id).filter(id => saved.rows.includes(id)).sort()).toEqual(saved.expected.map(index => saved.rows[index]).sort()); }, { timeout: 5000 }); }
  }, 30000);
  it.runIf(process.platform === 'linux')('matches the selected CreatedTime day in a negative-offset core timezone instead of the previous UTC-token day', async () => {
    const zone = 'America/Los_Angeles';
    await core.stop(); vi.stubEnv('TZ', zone);
    try {
      core = new CoreProcess(binary, () => ({ TZ: zone })); await start();
      expect(hyperDatabaseDateZone('')).toBe(zone);
      const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name: 'Negative-offset timestamp day', layout: ViewLayoutPB.Grid, setAsCurrent: false }]), snapshot = await repository.load(view.id), field = await repository.createField(view.id, 'Created', FieldType.CreatedTime), row = await repository.createRow(view.id);
      const created = fromBinary(TimestampCellDataPBSchema, (await repository.cell(view.id, row.id, field.id)).data).oneOfTimestamp.value; expect(created).toBeDefined();
      const day = hyperDatabaseDateParts(created!, zone).day, oldCriterion = hyperDateTimestamp(day), oldDay = hyperDatabaseDateParts(oldCriterion, zone).day;
      expect(oldDay < day).toBe(true);
      const owner = { contextKey: directory, workspaceId, actorId, isCurrent: () => true }, oldDate = { condition: 0, timestamp: oldCriterion, useFieldTimezone: false }, oldValue = { ...hyperDatabaseFilterNew(FieldType.CreatedTime), date: oldDate };
      await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, null, hyperEncodeDatabaseFilter(field.fieldType, oldValue), owner, () => true);
      await vi.waitFor(async () => { expect((await repository.load(view.id)).database.rows.some(item => item.id === row.id)).toBe(false); });
      const source = hyperDatabaseFindFilters((await repository.load(view.id)).settings.filters?.items ?? [])[0], bytes = source.oneOfData.value!.data, stored = hyperDecodeDatabaseFilter(field.fieldType, bytes).value;
      expect(hyperDatabaseTimestampFilterForm(stored.date!).day).toBe(oldDay);
      const before = updates; expect(await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, hyperEncodeDatabaseFilter(field.fieldType, stored, bytes), owner, () => true)).toBe(false); expect(updates).toBe(before);
      const corrected = hyperDatabaseTimestampFilterEdit(stored.date!, { ...hyperDatabaseTimestampFilterForm(stored.date!), day }).value;
      expect(corrected.useFieldTimezone).toBe(false); expect(hyperDatabaseDateParts(corrected.timestamp!, zone).day).toBe(day);
      await hyperWriteDatabaseFilter(view.id, snapshot.database.id, field, source, hyperEncodeDatabaseFilter(field.fieldType, { ...stored, date: corrected }, bytes), owner, () => true);
      await vi.waitFor(async () => { expect((await repository.load(view.id)).database.rows.some(item => item.id === row.id)).toBe(true); }, { timeout: 5000 });
    } finally { vi.unstubAllEnvs(); }
  }, 30000);
});
