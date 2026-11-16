import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { FieldPBSchema, FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { FieldSettingsPBSchema } from '@shared/protobuf/hyper-database2/field_settings_entities_pb';
import { DatabaseViewSettingPBSchema } from '@shared/protobuf/hyper-database2/setting_entities_pb';
import { RowMetaPBSchema } from '@shared/protobuf/hyper-database2/row_entities_pb';
import { ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import type { EventCalendarRangeInfo } from '@/components/reui/event-calendar/event-calendar-types';
import { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperCalendarEvent } from '../../HyperDatabaseTypes';
import { useHyperCalendarEvents } from './useHyperCalendarEvents';

// Exercise the adapter's asynchronous effects in the repo's Node test environment.
const hooks = vi.hoisted(() => ({ index: 0, values: [] as any[], effects: [] as any[], pending: [] as (() => void)[] }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/ui', () => ({ showToast: toast }));
vi.mock('react', () => ({
  useState: (initial: any) => {
    const i = hooks.index++;
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (next: any) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: any) => hooks.values[hooks.index++] ??= { current: initial },
  useMemo: (value: () => unknown) => value(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, deps: unknown[]) => {
    const i = hooks.index++, old = hooks.effects[i];
    if (!old || deps.some((value, j) => value !== old.deps[j])) hooks.pending.push(() => {
      old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: effect() };
    });
  },
}));

const HyperCalendarRange: EventCalendarRangeInfo = {
  view: 'month', date: new Date('2026-11-15T00:00:00Z'), timeZone: 'UTC',
  activeRange: { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') },
  range: { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') },
};
const HyperCalendarRow: HyperCalendarEvent = { rowId: 'row', title: 'Planning', dateFieldId: 'date', timestamp: 1794787200n, endTimestamp: null, includeTime: false, meta: create(RowMetaPBSchema, { id: 'row' }) };
let controller: HyperDatabaseController;
const render = () => {
  hooks.index = 0;
  const result = useHyperCalendarEvents({ controller, state: controller.state, view: create(ViewPBSchema, { id: 'calendar' }) }, 'UTC');
  for (const effect of hooks.pending.splice(0)) effect();
  return result;
};
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const configure = () => controller.store.setState({ settings: create(DatabaseViewSettingPBSchema, { layoutSetting: { oneOfCalendar: { case: 'calendar', value: { fieldId: 'date' } } } }) });
beforeEach(() => {
  hooks.index = 0; hooks.values = []; hooks.effects = []; hooks.pending = []; toast.mockClear();
  controller = new HyperDatabaseController('calendar');
  const field = create(FieldPBSchema, { id: 'date', name: 'Date', fieldType: FieldType.DateTime });
  controller.store.setState({ status: 'ready', fields: [{ id: field.id, name: field.name, type: FieldType.DateTime, isPrimary: false, settings: create(FieldSettingsPBSchema), options: [], proto: field }], rowIds: ['row'] });
  vi.spyOn(controller, 'scanRows').mockResolvedValue({});
  vi.spyOn(controller, 'getCalendarEvents').mockResolvedValue([HyperCalendarRow]);
});
afterEach(() => { for (const effect of hooks.effects) effect?.cleanup?.(); controller.dispose(); vi.restoreAllMocks(); });

it('surfaces failed default Date-field configuration and retries it before fetching', async () => {
  const settings = vi.spyOn(controller, 'updateCalendarSettings').mockRejectedValueOnce(new Error('Settings unavailable')).mockImplementation(async () => { configure(); });
  render().onRangeChange(HyperCalendarRange); await settle();
  expect(render().error).toBe('Settings unavailable');
  expect(controller.getCalendarEvents).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Settings unavailable' });
  render().refetch(); render(); await settle(); render(); await settle();
  expect(settings).toHaveBeenCalledTimes(2);
  expect(controller.getCalendarEvents).toHaveBeenCalledWith(1793491200n, 1796083200n, {});
  expect(render()).toMatchObject({ error: null, loading: false, events: [{ id: 'row' }] });
});

it('keeps previous events during refetch and ignores a late response for the old period', async () => {
  configure(); render().onRangeChange(HyperCalendarRange); render(); await settle();
  expect(render().events[0]?.title).toBe('Planning');
  let finishOld!: (events: HyperCalendarEvent[]) => void;
  vi.mocked(controller.getCalendarEvents).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  render().refetch(); render(); await settle();
  expect(render().events[0]?.title).toBe('Planning');
  vi.mocked(controller.getCalendarEvents).mockResolvedValueOnce([{ ...HyperCalendarRow, title: 'New period' }]);
  render().onRangeChange({ ...HyperCalendarRange, range: { start: new Date('2026-11-02T00:00:00Z'), end: HyperCalendarRange.range.end } });
  render(); await settle(); finishOld([{ ...HyperCalendarRow, title: 'Stale period' }]); await settle();
  expect(render().events[0]?.title).toBe('New period');
});


it('settles after a failed cell scan and cache revisions, and retries only on explicit/live invalidation', async () => {
  configure();
  vi.mocked(controller.scanRows).mockImplementation(async () => {
    controller.store.setState({ revision: controller.state.revision + 1 });
    return { row: { date: { kind: 'date', timestamp: null, endTimestamp: null, isRange: false, includeTime: false, reminderId: '', display: '', error: 'Read failed' } } };
  });
  render().onRangeChange(HyperCalendarRange); render(); await settle();
  for (let i=0;i<20;i++) { render(); await settle(); }
  expect(controller.scanRows).toHaveBeenCalledTimes(1); expect(render().error).toBe('Read failed'); expect(render().loading).toBe(false);
  render().refetch(); render(); await settle(); expect(controller.scanRows).toHaveBeenCalledTimes(2);
  controller.store.setState({ dataRevision: controller.state.dataRevision + 1 }); render(); await settle();
  expect(controller.scanRows).toHaveBeenCalledTimes(3);
});
