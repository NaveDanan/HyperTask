import { describe, expect, it } from 'vitest';
import { hyperCompareFocusOrder } from './HyperDayPlanner';
import { hyperNormalizeWeights, hyperPreviewWeights } from './HyperHubWeights';
import { hyperRankTasks } from './HyperPriorityEngine';
import type { HyperHubInstant, HyperHubTaskView, HyperHubWeights } from './HyperTaskHub';

const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const clock = instant('2026-11-29T07:00:00Z');
const nowMs = Date.parse(clock.iso);
const balanced = { slack: 45, importance: 25, unblocking: 20, age: 10 };
const urgent = { slack: 100, importance: 0, unblocking: 0, age: 0 };

function task(id: string, overrides: Partial<HyperHubTaskView> = {}): HyperHubTaskView {
  return {
    id, title: id, state: 'ready', stateChangedAt: clock, firstSeenAt: clock, authoritativeCompletion: 'open',
    sourceStatus: {}, sources: [], effortMinutes: 25, effortIsEstimate: false,
    people: [], meetingIds: [], blocks: [], blockedBy: [], pinned: false, ...overrides,
  };
}

describe('M5 weight preview', () => {
  it('rejects invalid inputs and normalizes finite extremes without overflow', () => {
    for (const weights of [
      { ...balanced, age: -1 }, { ...balanced, age: NaN }, { ...balanced, age: Infinity },
      { slack: 0, importance: 0, unblocking: 0, age: 0 }, { slack: 1 } as HyperHubWeights,
    ]) expect(() => hyperNormalizeWeights(weights)).toThrow(RangeError);
    const max = Number.MAX_VALUE;
    expect(hyperNormalizeWeights({ slack: max, importance: max / 2, unblocking: max / 4, age: 0 })).toEqual({
      slack: 4 / 7, importance: 2 / 7, unblocking: 1 / 7, age: 0,
    });
    expect(hyperNormalizeWeights({ ...urgent, slack: Number.MIN_VALUE })).toEqual({ ...urgent, slack: 1 });
  });

  it('keeps the Focus cohort, pins, manual order and unchanged top-ten rows', () => {
    const tasks = [
      task('pinned', { pinned: true }), task('manual', { manualOrder: 0, ownerPriority: 3 }),
      task('a', { ownerPriority: 3 }), task('b', { due: clock }), task('waiting', { state: 'waiting', due: clock }),
      task('complete', { authoritativeCompletion: 'complete', due: clock }), task('tie'),
    ];
    const draft = { ...urgent, slack: 0, importance: 100 };
    const input = { tasks, nowMs };
    const diff = hyperPreviewWeights(input, urgent, draft);
    expect(diff.topTen.map(row => row.taskId)).toEqual(['pinned', 'manual', 'a', 'b', 'tie']);
    expect(diff.rows.map(row => row.taskId)).toEqual(['manual', 'a', 'b']);
    expect(diff.movedCount).toBe(2);
    expect(diff.rows[0]).toMatchObject({
      oldPosition: 2, newPosition: 2, oldScoreCents: 0, newScoreCents: 10_000,
      signalDeltaCents: { importance: 10_000, slack: 0, age: 0, unblocking: 0 },
    });
    expect(diff.rows[2].signalDeltaCents.slack).toBe(-10_000);
    const savedRanking = hyperRankTasks({ ...input, weights: draft });
    const savedPositions = new Map(savedRanking.map((rank, index) => [rank.taskId, index]));
    const eligible = tasks.filter(item => !['waiting', 'complete'].includes(item.id))
      .sort((a, b) => hyperCompareFocusOrder(a, b, savedPositions));
    expect(diff.topTen.map(row => [row.taskId, row.newScoreCents])).toEqual(eligible.map(item =>
      [item.id, savedRanking[savedPositions.get(item.id)!].scoreCents]));
    const same = hyperPreviewWeights(input, balanced, balanced);
    expect(same.rows).toEqual([]);
    expect(same.topTen).toHaveLength(5);
    expect(same.movedCount).toBe(0);
    expect(diff).toEqual(hyperPreviewWeights({ ...input, tasks: [...tasks].reverse() }, urgent, draft));
    expect(hyperRankTasks(input)).toEqual(hyperRankTasks({ ...input, weights: balanced }));
  });
});

it.skipIf(process.env.HYPER_HUB_BENCH !== '1')('benchmarks 500-task warmed weight diffs', () => {
  const end = instant('2026-11-29T17:00:00Z');
  const deadlines = Array.from({ length: 80 }, (_, index) =>
    instant(new Date(nowMs + (index + 1) * 7.5 * 60_000).toISOString()));
  const tasks = Array.from({ length: 500 }, (_, index) => task('task-' + index, {
    ownerPriority: ([0, 1, 2, 3] as const)[index % 4],
    effortMinutes: 15 + (index % 6) * 10,
    due: index % 4 === 0 ? undefined : index % 4 === 1 ? clock : deadlines[index % deadlines.length],
    firstSeenAt: instant(`2026-11-${String(index % 28 + 1).padStart(2, '0')}T07:00:00Z`),
    pinned: index % 33 === 0,
    manualOrder: index % 26 === 0 ? index : undefined,
  }));
  const input = { tasks, nowMs, availability: {
    zone: 'Asia/Jerusalem', workdays: [0, 1, 2, 3, 4], hours: { start: '09:00', end: '19:00' },
    sources: [{ complete: [{ interval: { start: clock, end }, asOf: clock }], busy: [] }],
  } };
  const draft = { slack: 30, importance: 20, unblocking: 45, age: 5 };
  for (let index = 0; index < 30; index++) hyperPreviewWeights(input, balanced, draft);
  const samples = Array.from({ length: 120 }, () => {
    const start = performance.now();
    hyperPreviewWeights(input, balanced, draft);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const max = samples.at(-1)!;
  console.info(`500-task weight diff (120 warmed runs): median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, mean ${average.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
  expect(p95).toBeLessThan(20);
});
