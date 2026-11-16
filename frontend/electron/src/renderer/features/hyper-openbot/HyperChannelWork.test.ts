import { expect, it } from 'vitest';
import { hyperChannelHasWork, hyperUpdateChannelWork } from './HyperChannelWork';
it('a later arrival with an older database microsecond cannot clear continuing work', () => {
  const current = hyperUpdateChannelWork(undefined, { busy: false, work: [{ id: 'handoff' }], workAt: '2026-11-15T01:00:01.000002Z' });
  const stale = hyperUpdateChannelWork(current, { busy: false, work: [], workAt: '2026-11-15T01:00:01.000001Z' });
  expect(hyperChannelHasWork(stale)).toBe(true); expect(stale.work).toEqual([{ id: 'handoff' }]);
});
it('a newer empty work snapshot clears work without inventing a busy bit', () => {
  const current = hyperUpdateChannelWork(undefined, { busy: false, work: [{ id: 'routine' }], workAt: '2026-11-15T01:00:01.000002Z' });
  expect(hyperChannelHasWork(hyperUpdateChannelWork(current, { work: [], workAt: '2026-11-15T01:00:01.000003Z' }))).toBe(false);
});
it('busy and work remain independent and missing stamps cannot overwrite stamped work', () => {
  const current = hyperUpdateChannelWork(undefined, { busy: true, work: [], workAt: '2026-11-15T01:00:01.123456Z' });
  expect(hyperChannelHasWork(current)).toBe(true);
  const busyFalse = hyperUpdateChannelWork(current, { busy: false, work: [{ id: 'old' }] });
  expect(busyFalse.work).toEqual([]); expect(hyperChannelHasWork(busyFalse)).toBe(false);
  const active = hyperUpdateChannelWork(busyFalse, { work: [{ id: 'active' }], workAt: '2026-11-15T01:00:02.000000Z' });
  expect(hyperChannelHasWork(hyperUpdateChannelWork(active, { busy: false }))).toBe(true);
});
it('normalizes legacy whole-second and millisecond UTC clocks without losing microseconds', () => {
  const current = hyperUpdateChannelWork(undefined, { work: [{ id: 'work' }], workAt: '2026-11-15T01:00:01.123001Z' });
  expect(hyperChannelHasWork(hyperUpdateChannelWork(current, { work: [], workAt: '2026-11-15T01:00:01.123Z' }))).toBe(true);
  expect(hyperChannelHasWork(hyperUpdateChannelWork(current, { work: [], workAt: '2026-11-15T01:00:02Z' }))).toBe(false);
});
