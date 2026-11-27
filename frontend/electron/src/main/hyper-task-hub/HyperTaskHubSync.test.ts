import { expect, it, vi } from 'vitest';
import { disk, record, scope } from './HyperTaskHub.test-support';
import { HyperTaskHubSync, type HyperHubBatch, type HyperHubQuery } from './HyperTaskHubSync';

const result = (full: boolean, records = [record()]): HyperHubBatch => ({ records, cursor: 'cursor', completeness: full ? 'complete' : 'partial' });
const query = (read: HyperHubQuery['read']): HyperHubQuery => ({ connectionId: 'jira', queryId: 'eng', label: 'Jira', kind: 'jira', read });
it('discards a late response including its cursor after a generation change', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open();
  let generation = 1, finish!: (r: HyperHubBatch) => void;
  const sync = new HyperTaskHubSync(store, async () => true, () => generation, vi.fn());
  const work = sync.run(scope, query(() => new Promise(resolve => { finish = resolve; })), new AbortController().signal);
  generation++;
  finish(result(true)); await work;
  expect(store.current.cache).toEqual({});
  expect(d.open().current.revision).toBe(0);
});
it('retains absent members on a partial inventory and reconciles them on exhaustion', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open();
  const sync = new HyperTaskHubSync(store, async () => true, () => 1, vi.fn());
  for (const batch of [result(true), result(false, []), result(true, [])]) {
    await sync.run(scope, query(async () => batch), new AbortController().signal);
    const [inventory] = Object.values(d.open().current.cache);
    expect(inventory.status.coverage[0].completeness).toBe(batch.completeness);
    expect(inventory.cursor).toBe('cursor');
    expect(inventory.records).toHaveLength(batch.completeness === 'partial' ? 1 : batch.records.length);
  }
});
it('coalesces reads and applies jittered backoff to automatic retries', async ({ onTestFinished }) => {
  vi.useFakeTimers(); onTestFinished(() => { vi.useRealTimers(); });
  const d = disk(); onTestFinished(d.cleanup);
  const fetch = vi.fn(async () => { throw Error('offline'); });
  const sync = new HyperTaskHubSync(d.open(), async () => true, () => 1, vi.fn(), Date.now, () => 0.5);
  const run = () => sync.run(scope, query(fetch), new AbortController().signal);
  await Promise.all([run(), run()]); await run();
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000); await run();
  expect(fetch).toHaveBeenCalledTimes(2);
});
