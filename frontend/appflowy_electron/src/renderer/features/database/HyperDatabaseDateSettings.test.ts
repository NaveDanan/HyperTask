import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DateCellDataPBSchema, DateFormatPB, DateTypeOptionPBSchema, TimeFormatPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { hyperUpdateDatabaseDateSettings } from './HyperDatabaseDateSettings';
import { hyperDatabaseDrafts, type HyperDatabaseDraftLease } from './HyperDatabaseDraft';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
const backend = vi.hoisted(() => ({ field: null as unknown, calls: [] as unknown[], locked: false, actor: '1', workspace: 'workspace', hold: null as (() => Promise<void>) | null }));
vi.mock('@/backend/events/flowy-database2', async original => ({ ...await original<typeof import('@/backend/events/flowy-database2')>(), DatabaseEventGetDatabase: async () => ({ ok: true, value: { id: 'database' } }), DatabaseEventGetFields: async () => { await backend.hold?.(); return { ok: true, value: { items: [backend.field] } }; }, DatabaseEventUpdateFieldTypeOption: async (payload: unknown) => { backend.calls.push(payload); return { ok: true }; } }));
vi.mock('@/backend/events/flowy-folder', async original => ({ ...await original<typeof import('@/backend/events/flowy-folder')>(), FolderEventGetView: async () => ({ ok: true, value: { oneOfIsLocked: { case: 'isLocked', value: backend.locked }, oneOfCreatedBy: { case: undefined } } }), FolderEventReadCurrentWorkspace: async () => ({ ok: true, value: { id: backend.workspace } }) }));
vi.mock('@/backend/events/flowy-user', async original => ({ ...await original<typeof import('@/backend/events/flowy-user')>(), UserEventGetUserProfile: async () => ({ ok: true, value: { id: backend.actor, userAuthType: AuthTypePB.Local, workspaceType: WorkspaceTypePB.LocalW } }) }));
let sequence = 0;
function fixture() {
  const options = create(DateTypeOptionPBSchema, { dateFormat: DateFormatPB.ISO, timeFormat: TimeFormatPB.TwentyFourHour, timezoneId: 'America/New_York' });
  const field = create(FieldPBSchema, { id: 'date-' + sequence++, fieldType: FieldType.DateTime, typeOptionData: toBinary(DateTypeOptionPBSchema, options) }); backend.field = field;
  let current = true;
  const owner = { contextKey: 'settings-fixture-' + sequence, workspaceId: 'workspace', actorId: '1', isCurrent: () => current };
  return { field, options, owner, current: () => current, revoke: () => { current = false; }, save: () => hyperUpdateDatabaseDateSettings('view', 'database', field, { ...options, timeFormat: TimeFormatPB.TwelveHour }, owner, () => current) };
}
afterEach(() => { backend.calls = []; backend.locked = false; backend.actor = '1'; backend.workspace = 'workspace'; backend.hold = null; });
describe('database date field settings guards', () => {
  it('changes only the requested options and preserves the field timezone', async () => {
    const f = fixture(); await f.save(); expect(backend.calls).toHaveLength(1);
    const payload = backend.calls[0] as { typeOptionData: Uint8Array }; expect(fromBinary(DateTypeOptionPBSchema, payload.typeOptionData)).toMatchObject({ timezoneId: 'America/New_York', dateFormat: DateFormatPB.ISO, timeFormat: TimeFormatPB.TwelveHour });
  });
  it('canonicalizes a newly entered IANA zone so the native timezone parser receives its supported name', async () => {
    const f = fixture(); await hyperUpdateDatabaseDateSettings('view', 'database', f.field, { ...f.options, timezoneId: 'asia/kathmandu' }, f.owner, f.current);
    const payload = backend.calls[0] as { typeOptionData: Uint8Array }; expect(fromBinary(DateTypeOptionPBSchema, payload.typeOptionData).timezoneId).toMatch(/^Asia\/Kat(?:h)?mandu$/);
  });
  it.each(['lock', 'actor', 'workspace', 'field-type', 'options'] as const)('rejects a fresh %s change before writing', async change => {
    const f = fixture(); if (change === 'lock') backend.locked = true; if (change === 'actor') backend.actor = '2'; if (change === 'workspace') backend.workspace = 'other'; if (change === 'field-type') backend.field = { ...f.field, fieldType: FieldType.Number }; if (change === 'options') backend.field = { ...f.field, typeOptionData: new Uint8Array() };
    await expect(f.save()).rejects.toThrow(); expect(backend.calls).toEqual([]);
  });
  it('rejects owner or component loss while fresh metadata is pending', async () => {
    const f = fixture(); let release!: () => void; backend.hold = () => new Promise<void>(resolve => { release = resolve; });
    const pending = f.save(); f.revoke(); release(); await expect(pending).rejects.toThrow(); expect(backend.calls).toEqual([]);
  });
  it('does not change formats while an unsent cell draft still depends on their original options', async () => {
    const f = fixture(), cell = create(CellPBSchema, { data: toBinary(DateCellDataPBSchema, create(DateCellDataPBSchema)) });
    const repository = { cell: async () => cell } as unknown as HyperDatabaseRepository;
    const controller = hyperDatabaseDrafts.get(f.owner, 'database', 'row', f.field), lease: HyperDatabaseDraftLease = { repository, viewId: 'view', current: f.current, saved: () => {}, read: async () => ({ field: f.field, cell }), execute: async () => {} };
    const detach = controller.attach(lease); await controller.load(repository, 'view', f.field); controller.editForm('date.start', '2026-11-11');
    await expect(f.save()).rejects.toThrow('pending'); expect(backend.calls).toEqual([]); controller.discard(); detach(); hyperDatabaseDrafts.release(controller);
  });
});
