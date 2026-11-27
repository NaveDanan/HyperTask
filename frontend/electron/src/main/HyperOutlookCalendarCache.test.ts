import { expect, it, vi, onTestFinished } from 'vitest';
import { HyperOutlookCalendarCache } from './HyperOutlookCalendarCache';
import type { HyperOutlookBridge } from './HyperOutlookBridge';
import { hyperHubHash } from './hyper-task-hub/HyperTaskHubStore';

const day = (d: number) => new Date(Date.UTC(2026,10,d)).toISOString();
const range = (a: number, b: number) => ({ start: day(a), end: day(b) });
it('coalesces overlapping Hub and calendar reads and tracks partial interval coverage', async () => {
  let complete = true;
  const request = vi.fn(async (_op, value) => ({ ...value, exhausted: complete, completeness: complete ? 'complete' : 'partial', events: [] }));
  const cache = new HyperOutlookCalendarCache({ request: request as HyperOutlookBridge['request'] });
  await Promise.all([cache.read('AA',range(5,12)), cache.read('AA',range(1,32)), cache.read('AA',range(1,32))]);
  expect(request.mock.calls.map(([,v]) => [v.start,v.end])).toEqual([[day(5),day(12)],[day(1),day(5)],[day(12),day(32)]]);
  complete = false;
  expect(await cache.read('AA',range(28,40))).toMatchObject({ exhausted: false, completeness:'partial' });
  complete = true;
  expect(await cache.read('AA',range(28,40))).toMatchObject({ exhausted: true, completeness:'complete' });
  expect(request.mock.calls.slice(-2).map(([,v]) => [v.start,v.end])).toEqual([[day(32),day(40)],[day(32),day(40)]]);
});
it('serves visible months before Hub setup, refreshes visible subscribers once per minute and revokes editor handles on a store switch', async () => {
  vi.useFakeTimers(); onTestFinished(() => { vi.useRealTimers(); });
  let active = 'AA';
  const request = vi.fn(async (op: string, v?: Record<string,string>) => {
    if (op === 'hub.store') return active;
    if (op === 'calendar.resolve') return { id: 'AB', body: 'Editor text', lastModified: day(20) };
    return { ...v, storeId: active, exhausted: true, completeness: 'complete', events: [
      { ...range(20,21), private: true },
      { ...range(21,22), private: false, entryId:'AB', originalStart:day(21), title:'Meeting', isMeeting:true, allDay:false, details:{modified:day(20)} },
    ] };
  });
  const cache = new HyperOutlookCalendarCache({ request: request as HyperOutlookBridge['request'] });
  const document = {}, notify = vi.fn(), watch = (id: string) => cache.subscribe(id,range(1,32),document,()=>true,()=>true,notify,false);
  const [first] = await Promise.all([watch('one'),watch('two')]);
  expect(notify).not.toHaveBeenCalled(); // The initial reply must reach both subscribers.
  expect(first[0]).toMatchObject({subject:'Busy', isPrivate:true, occurrenceHandle:undefined});
  expect(first[1].hubMeetingId).toBeUndefined();
  const scans = () => request.mock.calls.filter(([op]) => op === 'hub.calendar');
  expect(scans()).toHaveLength(1);
  cache.meetings = () => new Map([[hyperHubHash('AA','AB',Date.parse(day(21))),day(20)]]);
  expect(await cache.resolve(first[1].occurrenceHandle!,document)).toMatchObject({ body:'Editor text', hubMeetingId:expect.any(String) });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(scans()).toHaveLength(2);
  cache.edited('AB', { ...range(21,22), allDay:false, isRecurring:false });
  await vi.advanceTimersByTimeAsync(0);
  expect(scans()).toHaveLength(3);
  active = 'BB';
  await watch('three');
  expect(scans()).toHaveLength(4);
  await expect(cache.resolve(first[1].occurrenceHandle!,document)).rejects.toThrow();
  for (const id of ['one','two','three']) cache.stop(id,document);
  expect(vi.getTimerCount()).toBe(0);
});
