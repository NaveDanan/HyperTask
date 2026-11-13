import { clone, create, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CalendarLayoutPB as Layout, CalendarLayoutSettingPBSchema } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { DatabaseLayoutPB, DatabaseViewSettingPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCalendarPeriodFrame, hyperCalendarPeriodSettingsEditable, hyperCalendarWeekdayLabel, hyperCalendarWeekStartChoices, hyperCalendarWeekStartSetting } from './HyperCalendarPeriodModel';
import { hyperUpdateCalendarWeekStart, type HyperCalendarPeriodSettingsBackend } from './HyperCalendarPeriodSettings';

const previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/calendar-week-start' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let active = true, allow = true;
  const source = create(CalendarLayoutSettingPBSchema, { fieldId: 'date', layoutTy: Layout.WeekLayout, firstDayOfWeek: 1, showWeekends: false, showWeekNumbers: true });
  let fresh = clone(CalendarLayoutSettingPBSchema, source), databaseId = 'database', layout = DatabaseLayoutPB.Calendar;
  const original = hyperGetDocumentOwner()!, owner = { ...original, isCurrent: () => active && original.isCurrent() };
  const writes: typeof source[] = [], calls: string[] = [];
  const service: HyperCalendarPeriodSettingsBackend = {
    database: async () => { calls.push('database'); return { id: databaseId, layoutType: layout }; },
    writable: async () => { calls.push('writable'); if (!allow) throw Error('Native lock'); return { layout: ViewLayoutPB.Calendar }; },
    settings: async () => { calls.push('settings'); return create(DatabaseViewSettingPBSchema, { layoutType: layout, layoutSetting: { layoutType: layout, oneOfCalendar: { case: 'calendar', value: fresh } } }); },
    write: async (_view, value) => { calls.push('write'); writes.push(value); fresh = value; },
  };
  const run = (day = 0) => hyperUpdateCalendarWeekStart('view', 'database', source, day, owner, () => allow, service);
  return { source, fresh: () => fresh, setFresh: (value: typeof source) => { fresh = value; }, writes, calls, run, service, expire: () => { active = false; }, lock: () => { allow = false; }, foreign: () => { databaseId = 'foreign'; }, grid: () => { layout = DatabaseLayoutPB.Grid; } };
}
describe('Hyper calendar first weekday values', () => {
  it('offers the upstream Sunday/Monday choices and labels every retained native weekday without timezone shifts', () => {
    expect(hyperCalendarWeekStartChoices).toEqual([0, 1]);
    expect(hyperCalendarWeekdayLabel(0, 'en-US')).toBe('Sunday'); expect(hyperCalendarWeekdayLabel(1, 'en-US')).toBe('Monday'); expect(hyperCalendarWeekdayLabel(6, 'en-US')).toBe('Saturday'); expect(hyperCalendarWeekdayLabel(0, 'fr-FR')).toBe('dimanche');
    for (const day of [-1, 7, 0.5, NaN]) expect(() => hyperCalendarWeekdayLabel(day)).toThrow('unsupported');
  });
  it('changes only firstDayOfWeek and preserves valid existing weekdays and explicit flags until a choice', () => {
    const f = fixture(); f.source.firstDayOfWeek = 6; const bytes = toBinary(CalendarLayoutSettingPBSchema, f.source);
    expect(hyperCalendarPeriodSettingsEditable(f.source)).toBe(true); expect(hyperCalendarWeekStartSetting(f.source, 0)).toMatchObject({ ...f.source, firstDayOfWeek: 0 }); expect(toBinary(CalendarLayoutSettingPBSchema, f.source)).toEqual(bytes);
    const unchanged = fixture(); expect(hyperCalendarWeekStartSetting(unchanged.source, 1)).toBe(unchanged.source);
    expect(() => hyperCalendarWeekStartSetting(f.source, 6)).toThrow('unsupported');
  });
  it('keeps future payloads unchanged and rejects Day configuration', () => {
    const f = fixture(); f.source.$unknown = [{ no: 99, wireType: 0, data: new Uint8Array([7]) }]; const bytes = toBinary(CalendarLayoutSettingPBSchema, f.source); expect(() => hyperCalendarWeekStartSetting(f.source, 0)).toThrow('unsupported'); expect(toBinary(CalendarLayoutSettingPBSchema, f.source)).toEqual(bytes);
    const day = fixture(); day.source.layoutTy = Layout.DayLayout; expect(() => hyperCalendarWeekStartSetting(day.source, 0)).toThrow('changed');
  });
  it.each(['2026-01-01', '2026-03-08', '2026-11-01'])('realigns bounded week/month dates at %s without changing the anchor', anchor => {
    for (const layout of [Layout.WeekLayout, Layout.MonthLayout]) {
      const sunday = hyperCalendarPeriodFrame(anchor, layout, 0), monday = hyperCalendarPeriodFrame(anchor, layout, 1);
      expect(sunday.days).toHaveLength(layout === Layout.WeekLayout ? 7 : 42); expect(monday.days).toHaveLength(sunday.days.length); expect(new Set(sunday.days).size).toBe(sunday.days.length);
      expect(new Date(`${sunday.days[0]}T00:00:00Z`).getUTCDay()).toBe(0); expect(new Date(`${monday.days[0]}T00:00:00Z`).getUTCDay()).toBe(1); expect(monday.anchorDay).toBe(anchor);
    }
  });
});
describe('Hyper calendar first weekday native write guards', () => {
  it('merges a fresh Week/Month change and unrelated settings while editing only the weekday', async () => {
    const f = fixture(); f.setFresh({ ...f.fresh(), layoutTy: Layout.MonthLayout, showWeekends: true, showWeekNumbers: false }); await f.run();
    expect(f.writes).toHaveLength(1); expect(f.writes[0]).toMatchObject({ fieldId: 'date', layoutTy: Layout.MonthLayout, firstDayOfWeek: 0, showWeekends: true, showWeekNumbers: false }); expect(f.source.firstDayOfWeek).toBe(1); expect(f.calls).toEqual(['database', 'writable', 'settings', 'write']);
  });
  it('does not replay an already applied desired value', async () => { const f = fixture(); f.setFresh({ ...f.fresh(), firstDayOfWeek: 0 }); await f.run(); expect(f.writes).toEqual([]); });
  it('rejects a period that becomes Day while native permissions are pending, even if its weekday is already desired', async () => {
    for (const day of [0, 1]) {
      const f = fixture(), pending = deferred(), started = deferred(); f.service.writable = async () => { f.calls.push('writable'); started.resolve(); await pending.promise; return { layout: ViewLayoutPB.Calendar }; };
      const saving = f.run(); await started.promise; f.setFresh({ ...f.fresh(), layoutTy: Layout.DayLayout, firstDayOfWeek: day }); pending.resolve();
      await expect(saving).rejects.toMatchObject({ reason: 'changed' }); expect(f.writes).toEqual([]); expect(f.calls).toEqual(['database', 'writable', 'settings']);
    }
  });
  it('rejects competing edited weekday and changed date-field/database/layout bindings', async () => {
    for (const mutate of [(f: ReturnType<typeof fixture>) => f.setFresh({ ...f.fresh(), firstDayOfWeek: 6 }), (f: ReturnType<typeof fixture>) => f.setFresh({ ...f.fresh(), fieldId: 'other' }), (f: ReturnType<typeof fixture>) => f.foreign(), (f: ReturnType<typeof fixture>) => f.grid()]) { const f = fixture(); mutate(f); await expect(f.run()).rejects.toMatchObject({ reason: 'changed' }); expect(f.writes).toEqual([]); }
  });
  it('rejects source/fresh unknown fields, invalid values and stale Day callbacks without writes', async () => {
    for (const mode of ['source', 'fresh', 'day', 'invalid']) {
      const f = fixture(); if (mode === 'source') f.source.$unknown = [{ no: 99, wireType: 0, data: new Uint8Array([1]) }]; if (mode === 'fresh') f.setFresh({ ...f.fresh(), firstDayOfWeek: 8 }); if (mode === 'day') f.source.layoutTy = Layout.DayLayout;
      await expect(f.run(mode === 'invalid' ? 6 : 0)).rejects.toMatchObject({ reason: mode === 'day' ? 'changed' : 'unsupported' }); expect(f.writes).toEqual([]);
    }
  });
  it('checks owner generation, native lock and late permissions before writing', async () => {
    const expired = fixture(); expired.expire(); await expect(expired.run()).rejects.toMatchObject({ reason: 'unavailable' }); expect(expired.calls).toEqual([]);
    const lock = fixture(); lock.service.writable = async () => { throw Error('Native lock'); }; await expect(lock.run()).rejects.toMatchObject({ reason: 'unavailable' }); expect(lock.writes).toEqual([]);
    const denied = fixture(), settings = denied.service.settings; denied.service.settings = async view => { const result = await settings(view); denied.lock(); return result; }; await expect(denied.run()).rejects.toMatchObject({ reason: 'unavailable' }); expect(denied.writes).toEqual([]);
    const aba = fixture(); aba.service.writable = async () => { useAppStore.setState({ dataDirectory: '/other-realm' }); useAppStore.setState({ dataDirectory: '/calendar-week-start' }); return { layout: ViewLayoutPB.Calendar }; }; await expect(aba.run()).rejects.toMatchObject({ reason: 'unavailable' }); expect(aba.writes).toEqual([]);
  });
  it('retains an uncertain acknowledgement without automatic replay and permits explicit authoritative confirmation', async () => {
    const f = fixture(); f.service.write = async (_view, value) => { f.writes.push(value); f.setFresh(value); throw Error('ACK lost'); }; await expect(f.run()).rejects.toMatchObject({ reason: 'uncertain' }); await Promise.resolve(); expect(f.writes).toHaveLength(1); await f.run(); expect(f.writes).toHaveLength(1);
  });
  it('does not deliver a late acknowledgement into another owner', async () => { const f = fixture(), write = f.service.write; f.service.write = async (view, value) => { await write(view, value); f.expire(); }; await expect(f.run()).rejects.toMatchObject({ reason: 'unavailable' }); expect(f.writes).toHaveLength(1); });
});
