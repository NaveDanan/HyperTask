import { expect, it, vi } from 'vitest';
import { HyperHubArticleSource, HyperHubNewsletterReader, HyperHubNewsletterSource } from './HyperHubNewsletterSource';
import { HyperHubAccessLost } from './HyperTaskHubSync';
import { disk, setup } from './HyperTaskHub.test-support';
import { HyperTaskHubService } from './HyperTaskHubService';

it('fetches one chart per revision across mapped resources and projects only verified predecessor edges', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now: new Date('2026-11-29T07:00Z') }); onTestFinished(() => { vi.useRealTimers(); });
  const access = { baseUrl: 'https://newsletter.test', fingerprint: 'binding', authorization: 'Bearer test' };
  let updated = 'r1';
  const chart = { tasks: [
    { id: 'one', name: 'First', resourceId: 'me', status: 'pending', startDate: '2026-10-25', endDate: '2026-10-25' },
    { id: 'two', name: 'Second', resourceId: 'other-me', status: 'in-progress', endDate: '2026-10-26', predecessorIds: ['one', 'unknown'] },
    { id: 'three', name: 'Other resource', resourceId: 'third-party', status: 'pending' },
  ], resources: [{ id: 'me', name: 'Owner' }, { id: 'other-me', name: 'Editor' }] };
  const http = vi.fn(async (url: string) => Response.json(url.endsWith('view=summary')
    ? { items: [{ id: 'p', title: 'Edition', updated }] } : { id: 'p', title: 'Edition', updated, gantt: chart }));
  const reader = new HyperHubNewsletterReader({ access: async () => access }, 'user', access.fingerprint, http as typeof fetch,
    () => new Set(['me', 'other-me']));
  const source = new HyperHubNewsletterSource(reader, 'p', new Set(['me', 'other-me']), setup.zone, access.baseUrl);
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open();
  store.commit(() => true, x => { x.setup = setup; });
  const s = new HyperTaskHubService(store, { accountId: 'user', workspaceId: 'workspace', generation: 1, validate: async () => true,
    queries: () => [source], changed: vi.fn(), openExternal: vi.fn() });
  const version = () => ({ expectedRevision: s.version.revision, scopeGeneration: 1 });
  const refresh = () => s.refresh(version(), 'newsletter-task', false);
  const snapshot = await refresh();
  const [first, second] = snapshot.tasks;
  expect(snapshot.tasks).toHaveLength(2);
  expect(first.schedule).toEqual({ start: { kind: 'instant', iso: '2026-10-24T21:00:00.000Z' },
    end: { kind: 'instant', iso: '2026-10-25T22:00:00.000Z' }, provenance: { kind: 'source', evidenceId: first.sources[0].evidenceId } });
  expect(second.schedule).toBeUndefined();
  expect(second.blockedBy[0]).toEqual({ predecessorId: first.id, successorId: second.id, verified: true,
    provenance: { kind: 'source', evidenceId: second.sources[0].evidenceId }, resolvedByOwner: false });
  expect(second.blockedBy[1]).toMatchObject({ predecessorId: expect.any(String), successorId: second.id, verified: true });
  expect(snapshot.tasks.some(t => t.id === second.blockedBy[1].predecessorId)).toBe(false);
  expect(first.blocks).toEqual([second.blockedBy[0]]);
  expect(JSON.stringify(d.open().current)).not.toContain('Other resource');
  expect(await s.sendFeedback({ ...version(), targetId: second.id, type: 'reorder', position: { beforeId: first.id } })).toMatchObject({ ok: true });
  expect(s.snapshot().tasks.map(t => t.manualOrder)).toEqual([1, 0]);
  const requests = http.mock.calls.length;
  vi.advanceTimersByTime(14 * 60_000); await refresh();
  expect(http).toHaveBeenCalledTimes(requests);
  vi.advanceTimersByTime(60_000); await refresh();
  expect(http.mock.calls.filter(([url]) => url.endsWith('/api/projects/p'))).toHaveLength(1);
  updated = 'r2';
  vi.advanceTimersByTime(15 * 60_000); await refresh();
  expect(http.mock.calls.filter(([url]) => url.endsWith('/api/projects/p'))).toHaveLength(2);
  expect(s.snapshot().tasks.map(t => t.id)).toEqual([first.id, second.id]);
});

it('reads only the selected article, bounds the excerpt, and rechecks its revision and permissions on open', async () => {
  const baseUrl = 'https://newsletter.test';
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: 'article', title: 'Edition', excerpt: 'x'.repeat(2000), updated: 'v1' }))
    .mockResolvedValueOnce(Response.json({ id: 'article', title: 'Edition', excerpt: 'updated', updated: 'v2' }))
    .mockResolvedValueOnce(new Response('', { status: 403 }));
  const reader = new HyperHubNewsletterReader({ access: async () => ({ baseUrl, authorization: 'Bearer example', fingerprint: 'selected' }) },
    'user', 'selected', fetcher, () => new Set());
  const source = new HyperHubArticleSource(reader, baseUrl, 'article', 'meeting-id');
  const signal = new AbortController().signal;
  const batch = await source.read({ accountId: 'user', workspaceId: 'w', connectionId: 'newsletter', generation: 1 }, signal);
  expect(batch.records).toEqual([]);
  const item = batch.evidence![0];
  expect(item).toMatchObject({ linkedMeetingId: 'meeting-id', document: { kind: 'newsletter-article', ownerSelected: false } });
  expect(item.briefExcerpt).toHaveLength(1024);
  await expect(source.check(item, signal)).rejects.toThrow('Article changed');
  await expect(source.check(item, signal)).rejects.toBeInstanceOf(HyperHubAccessLost);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(Array(3).fill(baseUrl + '/api/newsletters/article?contentOffset=0'));
});
