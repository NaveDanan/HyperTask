import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { GetWorkspaceViewPBSchema, WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DateCellDataPBSchema, DateTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { DateFilterConditionPB as Condition } from '@shared/protobuf/flowy-database2/date_filter_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { DatabaseEventGetCalendarEvent, DatabaseEventMoveCalendarEvent, DatabaseEventUpdateDateCell, DatabaseEventUpdateFieldTypeOption } from '../src/renderer/backend/events/flowy-database2';
import { unwrap } from '../src/renderer/backend/dispatch';
import { HyperDatabaseRepository } from '../src/renderer/features/database/HyperDatabaseRepository';
import { hyperDatabaseDateCandidates, hyperDatabaseDateOptions, hyperDatabaseDateParts } from '../src/renderer/features/database/HyperDatabaseDate';
import { hyperDateTimestamp } from '../src/renderer/features/database/HyperDatabaseCells';
import { hyperDatabaseFindDateFilters } from '../src/renderer/features/database/HyperDatabaseDateFilterWrite';
import { hyperDecodeDatabaseDateFilter, hyperEncodeDatabaseDateFilter } from '../src/renderer/features/database/HyperDatabaseDateFilterBinding';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Hyper zoned filters and calendar ranges against the Rust core', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-date-policy-core-')), repository = new HyperDatabaseRepository();
  let core = new CoreProcess(binary), parentId = '';
  const start = async () => {
    await core.start(() => {});
    expect(await core.init({ root: directory, app_version: '0.11.4', custom_app_path: directory, origin_app_path: directory, device_id: 'hyper-date-policy', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    vi.stubGlobal('window', { appflowy: { core: { request: (event: string, payload: Uint8Array) => core.request(event, payload) } } });
  };
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    const reply = await core.request(event, input ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>)) : new Uint8Array());
    if (reply.status !== 0) throw Error(event + ': ' + fromBinary(FlowyErrorSchema, reply.payload).msg);
    return fromBinary(output, reply.payload);
  }
  const view = (name: string, layout = ViewLayoutPB.Grid, databaseId?: string) => call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: parentId, name, layout, setAsCurrent: false, ...(databaseId ? { meta: { database_id: databaseId } } : {}) }]);
  const instant = (day: string, time: string) => hyperDatabaseDateCandidates(day, time, 'America/New_York')[0];
  afterAll(async () => { await core.stop(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); });
  it('persists explicit policies, refilters every linked opted-in view on timezone changes, and prefills compliant DST dates', async () => {
    await start();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Date policy fixture', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-date-policy' }]);
    const workspace = await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema), roots = await call('ReadWorkspaceViews', RepeatedViewPBSchema, [GetWorkspaceViewPBSchema, { value: workspace.workspaceId }]); parentId = roots.items[0].id;
    const source = await view('Zoned source'), initial = await repository.load(source.id), field = await repository.createField(source.id, 'When', FieldType.DateTime);
    const options = hyperDatabaseDateOptions(field.typeOptionData);
    const zone = async (timezoneId: string) => unwrap(await DatabaseEventUpdateFieldTypeOption({ viewId: source.id, fieldId: field.id, typeOptionData: toBinary(DateTypeOptionPBSchema, create(DateTypeOptionPBSchema, { ...options, timezoneId })) }));
    await zone('America/New_York');
    const rows: { id: string; timestamp: bigint }[] = [];
    for (const timestamp of [instant('2026-11-11', '23:30:00'), instant('2026-11-11', '01:30:00'), instant('2026-11-12', '01:00:00')]) {
      const row = await repository.createRow(source.id); await repository.updateDateDetails(source.id, row.id, field.id, { timestamp, isRange: false }); rows.push({ id: row.id, timestamp });
    }
    const linked = await view('Second opted view', ViewLayoutPB.Grid, initial.database.id), legacy = await view('Legacy view', ViewLayoutPB.Grid, initial.database.id);
    for (const id of [source.id, linked.id, legacy.id]) { expect((await repository.load(id)).database.id).toBe(initial.database.id); await repository.setting({ viewId: id, oneOfInsertFilter: { case: 'insertFilter', value: { data: { fieldId: field.id, fieldType: FieldType.DateTime, data: hyperEncodeDatabaseDateFilter({ condition: Condition.DateStartsOn, timestamp: hyperDateTimestamp('2026-11-11'), useFieldTimezone: id !== legacy.id }) } } } }); }
    const visible = async (id: string) => (await repository.load(id)).database.rows.map(row => row.id).filter(id => rows.some(row => row.id === id)).sort();
    const localDay = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleDateString('en-CA');
    const legacyExpected = rows.filter(row => localDay(row.timestamp) === localDay(hyperDateTimestamp('2026-11-11'))).map(row => row.id).sort();
    await vi.waitFor(async () => { expect(await visible(source.id)).toEqual(rows.slice(0, 2).map(row => row.id).sort()); expect(await visible(linked.id)).toEqual(rows.slice(0, 2).map(row => row.id).sort()); expect(await visible(legacy.id)).toEqual(legacyExpected); }, { timeout: 5000 });
    const saved = async (id: string) => hyperDatabaseFindDateFilters((await repository.load(id)).settings.filters?.items ?? [])[0];
    const legacyBytes = (await saved(legacy.id)).oneOfData.value!.data.slice();
    await core.stop(); core = new CoreProcess(binary); await start();
    for (const id of [source.id, linked.id, legacy.id]) { const filter = await saved(id); expect(hyperDecodeDatabaseDateFilter(filter.oneOfData.value!.data).value.useFieldTimezone).toBe(id !== legacy.id); }
    expect((await saved(legacy.id)).oneOfData.value!.data).toEqual(legacyBytes);
    await zone('UTC');
    await vi.waitFor(async () => { expect(await visible(source.id)).toEqual([rows[1].id]); expect(await visible(linked.id)).toEqual([rows[1].id]); expect(await visible(legacy.id)).toEqual(legacyExpected); }, { timeout: 5000 });
    expect((await saved(legacy.id)).oneOfData.value!.data).toEqual(legacyBytes);
    await zone('America/New_York'); const filter = await saved(source.id);
    await repository.setting({ viewId: source.id, oneOfUpdateFilterData: { case: 'updateFilterData', value: { filterId: filter.id, data: { fieldId: field.id, fieldType: FieldType.DateTime, data: hyperEncodeDatabaseDateFilter({ condition: Condition.DateStartsAfter, timestamp: hyperDateTimestamp('2026-03-07'), useFieldTimezone: true }) } } } });
    const prefilled = await repository.createRow(source.id), cell = fromBinary(DateCellDataPBSchema, (await repository.cell(source.id, prefilled.id, field.id)).data);
    expect(hyperDatabaseDateParts(cell.oneOfTimestamp.value!, 'America/New_York').day).toBe('2026-03-08');
    await vi.waitFor(async () => { expect((await repository.load(source.id)).database.rows.some(row => row.id === prefilled.id)).toBe(true); });
  }, 30000);
  it('returns native range ends and time flags, moves paired calendar dates across DST, and rejects unsafe moves', async () => {
    const calendar = await view('Ranges', ViewLayoutPB.Calendar), snapshot = await repository.load(calendar.id), field = snapshot.fields.find(field => field.fieldType === FieldType.DateTime)!;
    unwrap(await DatabaseEventUpdateFieldTypeOption({ viewId: calendar.id, fieldId: field.id, typeOptionData: toBinary(DateTypeOptionPBSchema, create(DateTypeOptionPBSchema, { ...hyperDatabaseDateOptions(field.typeOptionData), timezoneId: 'America/New_York' })) }));
    const row = await repository.createRow(calendar.id), start = instant('2026-03-07', '00:00:00'), end = instant('2026-03-09', '00:00:00');
    await repository.updateDateDetails(calendar.id, row.id, field.id, { timestamp: start, endTimestamp: end, isRange: true, includeTime: true });
    const all = (await repository.calendar(calendar.id)).events.find(event => event.rowMeta?.id === row.id)!, single = unwrap(await DatabaseEventGetCalendarEvent({ viewId: calendar.id, rowId: row.id }));
    expect(all.oneOfEndTimestamp.value).toBe(end); expect(single.oneOfEndTimestamp.value).toBe(end); expect(all.includeTime && single.includeTime).toBe(true);
    const move = (timestamp: bigint, endTimestamp?: bigint) => DatabaseEventMoveCalendarEvent({ cellPath: { viewId: calendar.id, rowId: row.id, fieldId: field.id }, timestamp, ...(endTimestamp !== undefined ? { oneOfEndTimestamp: { case: 'endTimestamp', value: endTimestamp } } : {}) });
    const read = async () => fromBinary(DateCellDataPBSchema, (await repository.cell(calendar.id, row.id, field.id)).data);
    unwrap(await move(instant('2026-03-10', '00:00:00'))); expect((await read()).oneOfEndTimestamp.value).toBe(instant('2026-03-12', '00:00:00'));
    await repository.updateDateDetails(calendar.id, row.id, field.id, { timestamp: instant('2026-03-05', '01:00:00'), endTimestamp: instant('2026-03-06', '02:30:00'), isRange: true, includeTime: true });
    const before = toBinary(DateCellDataPBSchema, await read()); expect((await move(instant('2026-03-07', '01:00:00'))).ok).toBe(false); expect(toBinary(DateCellDataPBSchema, await read())).toEqual(before);
    unwrap(await move(instant('2026-03-07', '01:00:00'), instant('2026-03-08', '03:30:00'))); expect((await read()).oneOfEndTimestamp.value).toBe(instant('2026-03-08', '03:30:00'));
    await repository.updateDateDetails(calendar.id, row.id, field.id, { timestamp: instant('2026-10-29', '01:00:00'), endTimestamp: instant('2026-10-30', '01:30:00'), isRange: true, includeTime: true });
    const beforeFold = toBinary(DateCellDataPBSchema, await read()); expect((await move(instant('2026-10-31', '01:00:00'))).ok).toBe(false); expect(toBinary(DateCellDataPBSchema, await read())).toEqual(beforeFold);
    const laterFold = hyperDatabaseDateCandidates('2026-11-01', '01:30:00', 'America/New_York')[1]; unwrap(await move(instant('2026-10-31', '01:00:00'), laterFold)); expect((await read()).oneOfEndTimestamp.value).toBe(laterFold);
    await repository.updateDateDetails(calendar.id, row.id, field.id, { includeTime: false }); expect((await repository.calendar(calendar.id)).events.find(event => event.rowMeta?.id === row.id)?.includeTime).toBe(false);
    // A native reminder ID is not a scheduling operation. Moves must preserve its instant.
    unwrap(await DatabaseEventUpdateDateCell({ cellId: { viewId: calendar.id, rowId: row.id, fieldId: field.id }, oneOfReminderId: { case: 'reminderId', value: 'existing-reminder' } }));
    const reminder = toBinary(DateCellDataPBSchema, await read()); expect((await move(instant('2026-04-01', '00:00:00'))).ok).toBe(false); expect(toBinary(DateCellDataPBSchema, await read())).toEqual(reminder);
  });
});
