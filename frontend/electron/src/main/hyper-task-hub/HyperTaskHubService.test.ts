import { expect, it, vi } from 'vitest';
import { disk, record, setup } from './HyperTaskHub.test-support';
import { HyperTaskHubService, type HyperHubSource } from './HyperTaskHubService';

function source(mirror: boolean): HyperHubSource {
  const r = record(mirror);
  return { kind: r.key.kind, connectionId: r.scope.connectionId, queryId: r.projectId, label: r.label,
    read: async scope => ({ records: [{ ...r, scope }], completeness: 'complete', cursor: null }), check: async () => {} };
}
const version = (s: HyperTaskHubService) => ({ expectedRevision: s.version.revision, scopeGeneration: s.version.scopeGeneration });
it('joins both sources, keeps the UUID and pin across an offline restart and a cache rebuild, and isolates users', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const queries = [source(true), source(false)];
  const dependencies = { accountId: 'account', workspaceId: 'workspace', generation: 1,
    queries: () => queries, changed: vi.fn(), openExternal: vi.fn(), validate: async () => true };
  const store = d.open();
  store.commit(() => true, draft => { draft.setup = setup; });
  const s = new HyperTaskHubService(store, dependencies);
  const snapshot = await s.refresh(version(s));
  expect(snapshot.tasks).toHaveLength(1);
  const [card] = snapshot.tasks;
  expect(card.sources.map(r => r.role)).toEqual(['origin', 'mirror']);
  expect(snapshot.ranking.map(rank => rank.taskId)).toEqual([card.id]);
  const ack = await s.sendFeedback({ ...version(s), targetId: card.id, type: 'pin' });
  expect(ack.ok).toBe(true);
  s.close();
  const transport = queries[1].read;
  queries[1].read = async () => { throw Error('offline'); };
  const reopened = d.open();
  const next = new HyperTaskHubService(reopened, { ...dependencies, generation: 2 });
  expect(next.snapshot().tasks[0].sources.every(r => r.stale)).toBe(true);
  expect((await next.refresh(version(next))).tasks).toMatchObject([{ id: card.id, pinned: true, sources: [{}, {}] }]);
  reopened.clearCache(() => true);
  queries[1].read = transport;
  expect((await next.refresh(version(next))).tasks).toMatchObject([{ id: card.id, pinned: true }]);
  if (!ack.ok) throw Error('Missing ledger entry');
  expect(await next.sendFeedback({ ...version(next), type: 'undo', targetId: card.id, ledgerEntryId: ack.ledgerEntryId })).toMatchObject({ ok: true });
  expect(next.snapshot().tasks[0].pinned).toBe(false);
  const other = new HyperTaskHubService(d.open('another'), { ...dependencies, accountId: 'another', generation: 3 });
  expect(other.snapshot().tasks).toEqual([]);
  queries[1].read = async () => ({ records: [], cursor: null, completeness: 'complete' });
  expect((await next.refresh(version(next))).tasks).toEqual([]);
});
it('declares and clears an owner window with day-scoped undo across a restart', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now: new Date('2026-11-29T07:00:00Z') }); onTestFinished(() => { vi.useRealTimers(); });
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open();
  store.commit(() => true, draft => { draft.setup = setup; });
  const deps = { generation: 1, accountId: 'user', workspaceId: 'workspace', queries: () => [source(false)],
    changed: vi.fn(), validate: async () => true, openExternal: vi.fn() };
  let s = new HyperTaskHubService(store, deps);
  const empty = await s.refresh(version(s));
  expect(empty.plan?.unscheduled[0].code).toBe('no-coverage');
  const day = empty.day!.date, windows = [empty.day!.working[0]];
  const declare = await s.sendFeedback({ ...version(s), day, type: 'declare-availability', windows });
  expect(s.snapshot().plan?.blocks[0].provisional).toBe(true);
  const clear = await s.sendFeedback({ ...version(s), day, type: 'clear-availability' });
  expect(s.snapshot().day?.ownerWindows).toEqual([]);
  s.close();
  s = new HyperTaskHubService(d.open(), { ...deps, generation: 2 });
  if (!declare.ok || !clear.ok) throw Error('Missing day ledger acknowledgement');
  const undo = (ledgerEntryId: string) => s.sendFeedback({ ...version(s), type: 'undo', ledgerEntryId, day });
  expect(await undo(declare.ledgerEntryId)).toMatchObject({ ok: false, code: 'revision-conflict' });
  expect(await undo(clear.ledgerEntryId)).toMatchObject({ ok: true });
  expect(s.snapshot().day?.ownerWindows).toEqual(windows);
  expect(await undo(declare.ledgerEntryId)).toMatchObject({ ok: true });
  expect(s.snapshot().plan?.unscheduled[0].code).toBe('no-coverage');
});

it('checks generation and revision before feedback or opening an old handle', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open(), query = source(false);
  store.commit(() => true, draft => { draft.setup = setup; });
  const external = vi.fn(), check = vi.spyOn(query, 'check');
  const s = new HyperTaskHubService(store, { accountId: 'account', workspaceId: 'workspace', generation: 1, queries: () => [query],
    changed: vi.fn(), validate: async () => true, openExternal: external });
  const [card] = (await s.refresh(version(s))).tasks;
  const event = { ...version(s), type: 'pin' as const, targetId: card.id };
  expect(await s.sendFeedback({ ...event, scopeGeneration: 8 })).toMatchObject({ ok: false, code: 'scope-changed' });
  expect(await s.sendFeedback({ ...event, expectedRevision: 0 })).toMatchObject({ ok: false, code: 'revision-conflict' });
  expect(check).not.toHaveBeenCalled();
  await s.sendFeedback(event);
  expect(await s.openSource(card.sources[0].handle)).toMatchObject({ ok: false, code: 'revision-conflict' });
  expect(external).not.toHaveBeenCalled();
});

it('persists Matrix placement and weights independently and validates both parts of the save version', async ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open(), changed = vi.fn(), now = Date.parse('2026-10-23T10:00:00Z');
  store.commit(() => true, d => { d.setup = setup; });
  const r = { ...record(), observedAt: { kind: 'instant' as const, iso: new Date(now).toISOString() } };
  const query = { ...source(false), read: async () => ({ records: [r], completeness: 'complete' as const, cursor: null }) };
  const deps = { accountId: r.scope.accountId, workspaceId: r.scope.workspaceId, now: () => now, generation: 1,
    validate: async () => true, changed, openExternal: vi.fn(), queries: () => [query] };
  const s = new HyperTaskHubService(store, deps), snap = await s.refresh(version(s));
  const id = snap.tasks[0].id;
  const move = await s.sendFeedback({ ...version(s), type: 'set-matrix-quadrant', taskId: id, quadrant: 'urgent' });
  if (!move.ok) throw Error(move.code);
  const placed = s.snapshot();
  expect(placed.ranking).toEqual(snap.ranking); expect(placed.plan).toEqual(snap.plan);
  const weights = { slack: 4, importance: 5, age: 6, unblocking: 7 };
  changed.mockClear();
  const preview = s.previewWeights({ ...version(s), draft: weights, seq: 1 });
  expect(changed).not.toHaveBeenCalled();
  const stale = version(s);
  expect(await s.saveWeights({ ...stale, weights })).toMatchObject({ok:true});
  expect(changed).toHaveBeenCalledOnce();
  const saved = s.snapshot();
  expect(saved.matrixOverrides).toEqual({ [id]: 'urgent' });
  expect(preview.diff.topTen[0].newScoreCents).toBe(saved.ranking[0].scoreCents);
  expect(saved.meetingWindow?.requested).toEqual({start:saved.asOf, end:{kind:'instant',iso:'2026-10-29T22:00:00.000Z'}});
  await expect(s.saveWeights({ ...stale, weights })).rejects.toThrow('revision-conflict');
  s.close();
  const next = new HyperTaskHubService(d.open(),{...deps,generation:2});
  await expect(next.saveWeights({scopeGeneration:1,expectedRevision:next.version.revision,weights})).rejects.toThrow('scope-changed');
  expect(next.snapshot().settings.weights).toEqual(weights);
  expect(next.snapshot().matrixOverrides).toEqual({[id]:'urgent'});
  expect(await next.sendFeedback({ ...version(next), type:'undo', targetId:id, ledgerEntryId:move.ledgerEntryId })).toMatchObject({ok:true});
  expect(next.snapshot().matrixOverrides).toEqual({});
  expect(next.snapshot().settings.weights).toEqual(weights);
});
