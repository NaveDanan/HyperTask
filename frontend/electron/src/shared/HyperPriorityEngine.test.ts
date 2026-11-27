import { describe, expect, it } from 'vitest';
import type { HyperHubAvailability } from './HyperDayPlanner';
import { hyperRankTasks } from './HyperPriorityEngine';
import type { HyperHubDependency, HyperHubInstant, HyperHubTaskView } from './HyperTaskHub';
import { HyperHubM1Fixture } from './HyperTaskHub.fixtures';

const now = '2026-11-29T09:00:00+02:00';
const nowMs = Date.parse(now);
const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const time = (hhmm: string) => instant(`2026-11-29T${hhmm}:00+02:00`);
const weights = HyperHubM1Fixture.settings.weights;
const [jiraTask, , , , nativeTask] = HyperHubM1Fixture.tasks;
const availability: HyperHubAvailability = {
  zone: 'Asia/Jerusalem', workdays: [0], hours: { start: '09:00', end: '19:00' },
  sources: [{
    complete: [{ interval: { start: time('09:00'), end: time('19:00') }, asOf: instant(now) }],
    busy: [{ start: time('10:00'), end: time('11:00'), status: 'busy' }],
  }],
};

function task(id: string, changes: Partial<HyperHubTaskView> = {}): HyperHubTaskView {
  return {
    ...nativeTask, id, state: 'ready', createdAt: instant(now), due: undefined,
    effortMinutes: 30, effortIsEstimate: false, ...changes,
  };
}

function edge(predecessorId: string, successorId: string, changes: Partial<HyperHubDependency> = {}): HyperHubDependency {
  return { predecessorId, successorId, provenance: { kind: 'owner' }, verified: true, resolvedByOwner: false, ...changes };
}

describe('HyperTaskHub ranking', () => {
  it('scores the renewal 42.19 and the checklist 43.00 with raw contributions in table order', () => {
    const renewal = task('renewal', { due: time('10:00'), ownerPriority: 0 });
    const checklist = task('checklist', {
      due: time('18:45'), ownerPriority: 3, effortMinutes: 45, createdAt: instant('2026-11-01T09:00:00+02:00'),
      blocks: [edge('checklist', 'a'), edge('checklist', 'b')],
    });
    const tasks = [renewal, checklist, task('a'), task('b')];
    const rank = () => hyperRankTasks({ nowMs, tasks, availability, weights });
    const [first, second] = rank();
    expect(first).toMatchObject({ taskId: 'checklist', score: 43, scoreCents: 4300, urgency: 0, importance: 1, unknown: [] });
    expect(first.reasons.map(reason => [reason.signal, reason.points])).toEqual([
      ['slack', 0], ['importance', 25], ['unblocking', 8], ['age', 10],
    ]);
    expect(second).toMatchObject({ taskId: 'renewal', score: 42.19, scoreCents: 4219, urgency: 0.9375, importance: 0 });
    expect(second.reasons[0].points).toBeCloseTo(42.1875, 12);
    expect(second.reasons[0].facts).toMatchObject({ minutesUntilDue: 60, slackMinutes: 30 });
    const original = rank();
    tasks.reverse();
    expect(rank()).toEqual(original);
  });

  it('rejects invalid weights and normalizes maximum finite weights without overflowing', () => {
    for (const slack of [-1, NaN, Infinity, -Infinity]) {
      expect(() => hyperRankTasks({ nowMs, tasks: [], weights: { ...weights, slack } })).toThrow(RangeError);
    }
    expect(() => hyperRankTasks({ nowMs, tasks: [], weights: { slack: 0, importance: 0, unblocking: 0, age: 0 } })).toThrow(RangeError);
    const max = Number.MAX_VALUE;
    const [rank] = hyperRankTasks({
      nowMs, tasks: [task('a', { ownerPriority: 3 })],
      weights: { slack: max, importance: max, unblocking: max, age: max },
    });
    expect(rank).toMatchObject({ score: 25, scoreCents: 2500, unknown: ['slack'] });
  });

  it('keeps the denominator fixed and distinguishes a zero signal from an unknown one', () => {
    const tasks = [task('a', { due: time('10:00'), effortIsEstimate: true }), task('b', { due: time('09:00'), effortIsEstimate: true })];
    const [reached, future] = hyperRankTasks({ nowMs, tasks, availability, weights });
    expect(future).toMatchObject({ unknown: ['slack', 'importance'], urgency: 0, importance: 0, score: 0 });
    expect(future.reasons.map(reason => reason.signal)).toEqual(['unblocking', 'age']);
    expect(reached).toMatchObject({ score: 45, urgency: 1, unknown: ['importance'] });
    const [missing] = hyperRankTasks({ nowMs, tasks: [task('c', { due: time('10:00') })], weights });
    expect(missing.unknown).toContain('slack');
    const [zeroEffort] = hyperRankTasks({
      nowMs, tasks: [task('d', { due: time('10:00'), effortMinutes: 0 })], availability, weights,
    });
    expect(zeroEffort.unknown).toContain('slack');
  });

  it('uses the earliest confirmed deadline, requires every working window to be covered and flags provisional slack', () => {
    const subject = task('a', { due: time('12:00'), prepDeadline: time('11:00') });
    const stale = {
      ...availability,
      sources: [{
        ...availability.sources![0],
        complete: [{ interval: { start: time('09:00'), end: time('11:00') }, asOf: time('08:00') }],
      }],
    };
    const [rank] = hyperRankTasks({ nowMs, tasks: [subject], weights, availability: stale });
    expect(rank).toMatchObject({ provisionalSlack: true });
    expect(rank.reasons[0].facts).toMatchObject({ minutesUntilDue: 120, slackMinutes: 30 });
    const [uncovered] = hyperRankTasks({
      nowMs, tasks: [{ ...subject, prepDeadline: undefined }], weights, availability: stale,
    });
    expect(uncovered.unknown).toContain('slack');
    const [ownerCovered] = hyperRankTasks({
      nowMs, tasks: [subject], weights,
      availability: { ...stale, ownerWindows: [{ start: time('09:00'), end: time('11:00') }], sources: [{ ...stale.sources[0], complete: [] }] },
    });
    expect(ownerCovered).toMatchObject({ provisionalSlack: true, urgency: rank.urgency });
  });

  it('keeps inferred deadlines unknown in Triage until they are accepted or confirmed by the owner', () => {
    const review = task('review', {
      state: 'review', due: time('09:00'),
      reviewSpan: { excerpt: 'Could you do this by nine?', confidence: 1, rule: 'request-with-date', evidenceId: 'mail' },
      fieldOrigins: { due: { kind: 'source', evidenceId: 'mail' } },
    });
    const tasks = [
      review, { ...review, id: 'accepted', state: 'ready' } as const,
      { ...review, id: 'confirmed', fieldOrigins: { due: { kind: 'owner' } } } as const,
    ];
    const ranked = hyperRankTasks({ nowMs, tasks, weights, availability });
    expect(ranked.map(rank => [rank.taskId, rank.urgency])).toEqual([['accepted', 1], ['confirmed', 1], ['review', 0]]);
    expect(ranked[2].unknown).toContain('slack');
  });

  it('uses a Jira mapping only with matching Jira evidence and respects owner priority zero', () => {
    const jiraPriority = jiraTask.sourcePriority!;
    const tasks = [
      task('mapped', { sources: jiraTask.sources, sourcePriority: jiraPriority }),
      task('owner', { sources: jiraTask.sources, sourcePriority: jiraPriority, ownerPriority: 0 }),
      task('unmapped', { sources: jiraTask.sources, sourcePriority: { ...jiraPriority, mapped: undefined } }),
      task('native', { sourcePriority: { ...jiraPriority, evidenceId: nativeTask.sources[0].evidenceId } }),
      task('no-evidence', { sourcePriority: jiraPriority }),
    ];
    const ranks = new Map(hyperRankTasks({ nowMs, tasks, weights }).map(rank => [rank.taskId, rank]));
    expect(ranks.get('mapped')!.reasons[0]).toMatchObject({
      signal: 'importance', points: 16.75, facts: { source: 'jira-priority', priority: 2 }, evidenceId: jiraPriority.evidenceId,
    });
    expect(ranks.get('owner')!.reasons[0]).toEqual({ signal: 'importance', points: 0, facts: { source: 'owner', priority: 0 } });
    for (const id of ['unmapped', 'native', 'no-evidence']) expect(ranks.get(id)!.unknown).toContain('importance');
  });

  it('deduplicates verified open successors and does not rank by pin, order or actual readiness', () => {
    const valid = edge('A', 'open');
    const subject = task('A', { blocks: [valid, valid, edge('A', 'completed'), edge('A', 'unknown'),
      edge('A', 'missing'), edge('A', 'resolved', { resolvedByOwner: true }), edge('A', 'unverified', { verified: false })] });
    const tied = [task('a', { pinned: true, manualOrder: 0 }), task('Z', { state: 'waiting' })];
    const tasks = [subject, task('open', { blockedBy: [valid] }), task('completed', { authoritativeCompletion: 'complete' }),
      task('unknown', { authoritativeCompletion: 'unknown' }), task('resolved'), task('unverified'), ...tied];
    const ranks = hyperRankTasks({ nowMs, tasks, weights });
    expect(ranks[0].reasons[0]).toMatchObject({ signal: 'unblocking', points: 4, facts: { successors: 1 } });
    expect(ranks.filter(rank => ['a', 'Z'].includes(rank.taskId))).toMatchObject([
      { taskId: 'Z', pinned: false, feasibility: { ready: false, code: 'waiting' } },
      { taskId: 'a', pinned: true, feasibility: { ready: true } },
    ]);
    expect(hyperRankTasks({ nowMs, tasks: [...tasks].reverse(), weights })).toEqual(ranks);
  });
});
