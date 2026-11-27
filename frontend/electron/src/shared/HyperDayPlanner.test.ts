import { describe, expect, it } from 'vitest';
import {
  hyperEvaluatePlanPasses, hyperHubAvailabilityFromSnapshotParts, hyperHubDayBounds, hyperHubDayCapacity, hyperHubProjectAvailabilityDay,
  hyperPlanDay, type HyperHubAvailability, type HyperHubPlanInput,
} from './HyperDayPlanner';
import { hyperRankTasks } from './HyperPriorityEngine';
import type { HyperHubAgendaItem, HyperHubDependency, HyperHubInstant, HyperHubPlan, HyperHubRanked, HyperHubTaskView, HyperHubWriteView } from './HyperTaskHub';
import { HyperHubM1Fixture } from './HyperTaskHub.fixtures';

const now = '2026-11-29T09:00:00+02:00';
const nowMs = Date.parse(now);
const zone = 'Asia/Jerusalem';
const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const time = (hhmm: string) => instant(`2026-11-29T${hhmm}:00+02:00`);
const span = (from: string, to: string) => ({ start: time(from), end: time(to) });
const complete = { interval: span('09:00', '19:00'), asOf: instant(now) };
const coverage: HyperHubAvailability = {
  zone, workdays: [0], hours: { start: '09:00', end: '19:00' },
  sources: [{ complete: [complete], busy: [] }],
};
const withMeeting: HyperHubAvailability = {
  ...coverage, sources: [{ complete: [complete], busy: [{ ...span('10:00', '11:00'), status: 'busy', meetingId: 'meeting' }] }],
};
function action(id: string, changes: Partial<HyperHubTaskView> = {}): HyperHubTaskView {
  return {
    ...HyperHubM1Fixture.tasks[4], id, state: 'ready', createdAt: instant(now), due: undefined,
    effortMinutes: 30, effortIsEstimate: false, ...changes,
  };
}
function edge(predecessorId: string, successorId: string, resolvedByOwner = false): HyperHubDependency {
  return { predecessorId, successorId, verified: true, resolvedByOwner, provenance: { kind: 'owner' } };
}
function input(tasks: HyperHubTaskView[], availability = coverage, clock = nowMs): HyperHubPlanInput {
  const ranking = hyperRankTasks({ tasks, nowMs: clock, availability, weights: HyperHubM1Fixture.settings.weights });
  return { tasks, ranking, nowMs: clock, availability };
}
function expectNoOverlap(plan: HyperHubPlan) {
  plan.blocks.slice(1).forEach((block, i) => {
    expect(Date.parse(block.start.iso)).toBeGreaterThanOrEqual(Date.parse(plan.blocks[i].end.iso));
  });
}

describe('M5 day planning holds', () => {
  const base: HyperHubTaskView = {
    id: 'parent', title: 'Parent', state: 'ready', stateChangedAt: instant(now), firstSeenAt: instant(now),
    authoritativeCompletion: 'open', sourceStatus: {}, sources: [], effortMinutes: 30, effortIsEstimate: false,
    people: [], meetingIds: [], blocks: [], blockedBy: [], pinned: false,
  };
  const write: HyperHubWriteView = {
    operationId: 'write', taskId: base.id, evidenceId: 'origin', source: 'jira', state: 'unknown', at: instant(now),
    fromName: 'Open', toName: 'Done', held: true, ownerReleaseAvailable: true, undoAvailable: false, readback: 'verified',
  };

  function plan(input: Omit<HyperHubPlanInput, 'ranking'>) {
    const ranking = hyperRankTasks(input);
    return { ranking, plan: hyperPlanDay({ ...input, ranking }) };
  }

  it.each(['open', 'complete'] as const)('blocks the forecast and dependency release with last completion %s', authoritativeCompletion => {
    const parent = { ...base, authoritativeCompletion, fixedBlocks: [span('09:00', '10:00')], ownerPriority: 3 as const };
    const child = { ...base, id: 'child', blockedBy: [edge('parent', 'child')] };
    const other = { ...base, id: 'other' };
    const input = { tasks: [parent, child, other], nowMs, availability: coverage };
    const held = plan({ ...input, writes: [write] });
    const parentRank = held.ranking.find(rank => rank.taskId === parent.id);
    expect(parentRank?.scoreCents).toBe(plan(input).ranking.find(rank => rank.taskId === parent.id)?.scoreCents);
    expect(parentRank?.feasibility).toEqual({ ready: false, code: 'waiting', facts: { held: 1 } });
    expect(held.ranking.find(rank => rank.taskId === child.id)?.feasibility)
      .toMatchObject({ ready: false, code: 'waiting', facts: { predecessorId: 'parent' } });
    expect(held.plan.blocks.map(block => block.taskId)).toEqual(['other']);
    expect(held.plan.recommendation).toMatchObject({ taskId: 'other', start: { iso: '2026-11-29T08:00:00.000Z' } });
    expect(hyperHubDayCapacity(nowMs, hyperHubProjectAvailabilityDay(nowMs, coverage), [], input.tasks, held.plan.blocks,
      new Set(['parent'])).freeMinutes).toBe(540);

    const ownerRelease = plan({ ...input, writes: [{ ...write, ownerReleasedAt: time('09:00') }] });
    expect(ownerRelease).toEqual(plan(input));
    expect(ownerRelease.plan.blocks.map(block => block.taskId)).toContain(child.id);
    if (authoritativeCompletion === 'complete') expect(ownerRelease.plan.recommendation?.taskId).toBe(child.id);
    else expect(ownerRelease.plan.recommendation?.taskId).toBe(parent.id);
  });
});

describe('HyperTaskHub day planner', () => {
  it('chooses due-first by 8,719 to 4,400 and recommends the renewal at 09:00', () => {
    const tasks = [
      action('renewal', { due: time('10:00'), ownerPriority: 0 }),
      action('checklist', { due: time('18:45'), effortMinutes: 45, ownerPriority: 3,
        createdAt: instant('2026-11-01T09:00:00+02:00'), blocks: [edge('checklist', 'a'), edge('checklist', 'b')] }),
      action('a', { state: 'waiting' }), action('b', { state: 'waiting' }),
    ];
    const data = input(tasks, withMeeting);
    const passes = hyperEvaluatePlanPasses(data);
    expect(passes['score-first'].onTime).toBe(4400);
    expect(passes['due-first'].onTime).toBe(8719);
    expect(passes['score-first'].plan.blocks.map(block => [block.taskId, block.start.iso])).toEqual([
      ['checklist', '2026-11-29T07:00:00.000Z'], ['renewal', '2026-11-29T09:00:00.000Z'],
    ]);
    expect(passes['score-first'].plan.blocks[1].reasons).toContainEqual(expect.objectContaining({ code: 'late' }));
    const plan = hyperPlanDay(data);
    expect(plan).toEqual(passes['due-first'].plan);
    expect(plan.recommendation).toMatchObject({
      kind: 'start-now', taskId: 'renewal', start: { iso: '2026-11-29T07:00:00.000Z' },
      reasons: [{ code: 'fits-before-meeting', facts: { meetingId: 'meeting', minutes: 30 } }],
    });
    expectNoOverlap(passes['score-first'].plan);
    expectNoOverlap(plan);
  });

  it('counts a civil deadline at the end of today, after the final window', () => {
    const deadline = { kind: 'civil-date', date: '2026-11-29', zone } as const;
    const data = input([action('civil', { due: deadline }), action('tomorrow', { due: instant('2026-11-30T00:00:00+02:00') })]);
    const passes = hyperEvaluatePlanPasses(data);
    const civilValue = 100 + data.ranking.find(rank => rank.taskId === 'civil')!.scoreCents;
    expect(passes['score-first'].onTime).toBe(civilValue);
    expect(passes['due-first'].onTime).toBe(civilValue);
    expect(hyperPlanDay(data).pass).toBe('score-first');
  });

  it('uses total placed value when the on-time objectives tie', () => {
    const availability = { ...coverage, workdays: [0, 1], hours: { start: '09:00', end: '10:00' } };
    const small = { ownerPriority: 2, due: instant('2026-11-30T10:00:00+02:00') } as const;
    const data = input([action('large', { ownerPriority: 3, effortMinutes: 45 }), action('a', small), action('b', small)], availability);
    const passes = hyperEvaluatePlanPasses(data);
    expect(passes['score-first'].onTime).toBe(0);
    expect(passes['due-first'].onTime).toBe(0);
    expect(passes['due-first'].total).toBeGreaterThan(passes['score-first'].total);
    expect(hyperPlanDay(data).blocks.map(block => block.taskId)).toEqual(['a', 'b']);
  });

  it('is deterministic for shuffled ties and gives pins and manual order precedence', () => {
    const tasks = [action('a'), action('Z'), action('pin', { pinned: true }), action('manual', { manualOrder: 0 })];
    const plan = hyperPlanDay(input(tasks));
    expect(plan.blocks.map(block => block.taskId)).toEqual(['pin', 'manual', 'Z', 'a']);
    expect(plan.pass).toBe('score-first');
    expect(hyperPlanDay(input([tasks[3], tasks[0], tasks[2], tasks[1]]))).toEqual(plan);
  });

  it('propagates effective due backward with the provisional 45-minute placement estimate', () => {
    const tasks = [
      action('other', { due: time('09:50') }),
      action('parent'),
      action('child', { due: time('10:00'), effortMinutes: 5, effortIsEstimate: true, blockedBy: [edge('parent', 'child')] }),
    ];
    const { 'due-first': result } = hyperEvaluatePlanPasses(input(tasks));
    expect(result.plan.blocks.map(block => block.taskId)).toEqual(['parent', 'other', 'child']);
    const child = result.plan.blocks[2];
    expect(child.provisional).toBe(true);
    expect(child.reasons[0].facts).toMatchObject({ minutes: 45, estimateMinutes: 45 });
    expect(child.reasons.map(reason => reason.code)).toEqual(['earliest-fit', 'after-predecessor', 'waiting', 'late']);
    expectNoOverlap(result.plan);
  });

  it('reports cycles and missing edges and keeps forecasts separate from actual readiness', () => {
    const tasks = [
      action('a', { blockedBy: [edge('b', 'a')] }), action('b', { blockedBy: [edge('a', 'b')] }),
      action('downstream', { blockedBy: [edge('b', 'downstream')] }),
      action('missing', { blockedBy: [edge('outside', 'missing')] }),
      action('done-for-me', { state: 'done' }),
      action('depends-on-done-for-me', { blockedBy: [edge('done-for-me', 'depends-on-done-for-me')] }),
      action('resolved', { blockedBy: [edge('outside', 'resolved', true)] }),
      action('parent', { release: time('09:05'), effortMinutes: 45 }),
      action('forecast-only', { blockedBy: [edge('parent', 'forecast-only')] }),
    ];
    const plan = hyperPlanDay(input(tasks));
    expect(plan.unscheduled).toEqual([
      { taskId: 'a', code: 'cycle', facts: { cycleIds: 'a, b' } },
      { taskId: 'b', code: 'cycle', facts: { cycleIds: 'a, b' } },
      { taskId: 'depends-on-done-for-me', code: 'waiting', facts: { predecessorId: 'done-for-me', predecessorIds: 'done-for-me' } },
      { taskId: 'downstream', code: 'waiting', facts: { predecessorId: 'b', predecessorIds: 'b' } },
      { taskId: 'missing', code: 'waiting', facts: { predecessorId: 'outside', predecessorIds: 'outside', missingPredecessorIds: 'outside' } },
    ]);
    expect(plan.blocks.map(block => block.taskId)).toEqual(['parent', 'forecast-only', 'resolved']);
    expect(plan.recommendation).toMatchObject({ taskId: 'resolved', kind: 'start-later' });
    expect(hyperPlanDay(input([...tasks].reverse()))).toEqual(plan);
  });

  it('validates fixed reservations against work, releases, meetings, each other and predecessor finishes', () => {
    const tasks = [
      action('outside-work', { fixedBlocks: [span('18:45', '19:15')] }),
      action('released-later', { fixedBlocks: [span('11:00', '11:15')], release: time('11:30') }),
      action('meeting-conflict', { fixedBlocks: [span('10:15', '10:30')] }),
      action('overlap-a', { fixedBlocks: [span('13:00', '14:00')] }),
      action('overlap-b', { fixedBlocks: [span('13:30', '14:30')] }),
      action('valid-fixed', { fixedBlocks: [span('12:00', '12:30')] }),
      action('too-early', { fixedBlocks: [span('11:30', '12:00')], blockedBy: [edge('valid-fixed', 'too-early')] }),
      action('child', { blockedBy: [edge('too-early', 'child')] }),
      action('ordinary'),
    ];
    const plan = hyperPlanDay(input(tasks, withMeeting));
    expect(plan.blocks.map(block => [block.taskId, block.fixed])).toEqual([['ordinary', false], ['valid-fixed', true]]);
    expect(plan.unscheduled.filter(task => task.code === 'fixed-conflict').map(task => task.taskId)).toEqual([
      'meeting-conflict', 'outside-work', 'overlap-a', 'overlap-b', 'released-later', 'too-early',
    ]);
    expect(plan.unscheduled.find(task => task.taskId === 'too-early')?.facts).toMatchObject({
      fixedStart: '2026-11-29T09:30:00.000Z', predecessorId: 'valid-fixed', earliestStart: '2026-11-29T10:30:00.000Z',
    });
    expect(plan.unscheduled[0]).toMatchObject({ taskId: 'child', code: 'waiting' });
    expect(hyperPlanDay(input([...tasks].reverse(), withMeeting))).toEqual(plan);
    expectNoOverlap(plan);
  });

  it('places only explicit chunks and unlocks a successor after the final chunk', () => {
    const availability = { ...withMeeting, hours: { start: '09:00', end: '12:00' } };
    const parent = action('split', { effortMinutes: 90, chunkMinutes: 30, pinned: true });
    const child = action('child', { blockedBy: [edge('split', 'child')] });
    const whole = action('whole', { effortMinutes: 90 });
    const plan = hyperPlanDay(input([parent, child, whole], availability));
    expect(plan.blocks.map(block => [block.taskId, block.start.iso.slice(11, 16)])).toEqual([
      ['split', '07:00'], ['split', '07:30'], ['split', '09:00'], ['child', '09:30'],
    ]);
    expect(plan.unscheduled).toEqual([{ taskId: 'whole', code: 'no-window', facts: { effortMinutes: 90 } }]);
    expectNoOverlap(plan);
    const incomplete = hyperPlanDay(input([{ ...parent, effortMinutes: 150 }, child], availability));
    expect(incomplete.blocks).toEqual([]);
    expect(incomplete.unscheduled.map(task => task.code)).toEqual(['waiting', 'no-window']);
  });

  it('keeps a fixed chunk in place and forecasts the remainder before unlocking a successor', () => {
    const availability = { ...withMeeting, hours: { start: '09:00', end: '12:00' } };
    const parent = action('split', { effortMinutes: 90, chunkMinutes: 30, fixedBlocks: [span('09:30', '10:00')] });
    const child = action('child', { blockedBy: [edge('split', 'child')] });
    const plan = hyperPlanDay(input([parent, child], availability));
    expect(plan.blocks.map(block => [block.taskId, block.fixed, block.start.iso.slice(11, 16)])).toEqual([
      ['split', false, '07:00'], ['split', true, '07:30'], ['split', false, '09:00'], ['child', false, '09:30'],
    ]);
    expectNoOverlap(plan);
    const incomplete = hyperPlanDay(input([{ ...parent, effortMinutes: 150 }, child], availability));
    expect(incomplete.unscheduled).toMatchObject([{ taskId: 'child', code: 'waiting' },
      { taskId: 'split', code: 'no-window', facts: { fixedBlockCount: 1 } }]);
  });

  it('intersects enabled-source coverage, uses only authorized complete reads and subtracts later busy intervals', () => {
    const task = action('a');
    const partial: HyperHubAvailability = {
      ...coverage, sources: [...coverage.sources!, { complete: [], busy: [{ ...span('09:00', '09:30'), status: 'tentative' }] }],
    };
    expect(hyperPlanDay(input([task], partial)).unscheduled[0].code).toBe('no-coverage');
    const ownerPlan = hyperPlanDay(input([task], { ...partial, ownerWindows: [span('09:00', '10:00')] }));
    expect(ownerPlan).toMatchObject({
      provisional: true, recommendation: { kind: 'start-later', start: { iso: '2026-11-29T07:30:00.000Z' } },
    });
    expect(ownerPlan.blocks[0].reasons.map(reason => reason.code)).toContain('owner-availability');
    const stalePlan = hyperPlanDay(input([task], {
      ...partial, sources: [coverage.sources![0], { ...partial.sources![1], complete: [{ ...complete, newerRefreshPartial: true }] }],
    }));
    expect(stalePlan.provisional).toBe(true);
    expect(stalePlan.blocks[0].reasons.map(reason => reason.code)).toContain('stale-coverage');
    const fixed = hyperPlanDay(input([{ ...task, fixedBlocks: [span('09:30', '10:00')] }], partial));
    expect(fixed.unscheduled[0]).toMatchObject({ code: 'no-coverage', facts: { fixedBlockCount: 1 } });
  });

  it('uses the owner workweek and civil-day boundaries across Jerusalem DST', () => {
    const clock = Date.parse('2026-03-27T01:30:00+02:00');
    const day = (date: string) => ({ kind: 'civil-date', date, zone } as const);
    const availability: HyperHubAvailability = {
      zone, workdays: [5], hours: { start: '01:00', end: '05:00' }, breaks: [{ start: '03:30', end: '04:00' }],
      sources: [{ complete: [{ interval: { start: day('2026-03-27'), end: day('2026-03-28') }, asOf: instant(new Date(clock).toISOString()) }],
        busy: [{ start: day('2026-03-26'), end: day('2026-03-27'), status: 'out-of-office' }] }],
    };
    const plan = hyperPlanDay(input([action('dst', { effortMinutes: 60 })], availability, clock));
    expect(plan.blocks[0]).toMatchObject({ start: { iso: '2026-03-26T23:30:00.000Z' }, end: { iso: '2026-03-27T00:30:00.000Z' } });
    const off = hyperPlanDay(input([action('dst')], { ...availability, workdays: [0] }, clock));
    expect(off.unscheduled[0].code).toBe('no-window');
  });

  it.each([
    { date: '2026-03-27', offset: '+02:00', dayHours: 23 },
    { date: '2026-10-25', offset: '+03:00', dayHours: 25 },
  ])('uses a $dayHours-hour Jerusalem civil day on $date', ({ date, offset, dayHours }) => {
    const clock = Date.parse(`${date}T00:00:00${offset}`);
    const { start, end } = hyperHubDayBounds(clock, zone);
    expect(start).toBe(clock);
    expect((end - start) / 3_600_000).toBe(dayHours);
    const onDay = {
      zone, workdays: [0, 5], hours: { start: '00:00', end: '04:00' },
      ownerWindows: [{ start: instant(new Date(start).toISOString()), end: instant(new Date(end).toISOString()) }],
    };
    const task = action('dst', { due: { kind: 'civil-date', date, zone } });
    const data = input([task], onDay, clock);
    expect(data.ranking[0].reasons[0].facts.slackMinutes).toBe((dayHours - 20) * 60 - 30);
    expect(hyperPlanDay(data).blocks[0].start.iso).toBe(new Date(clock).toISOString());
  });

  it('plans on Sunday even when the supplied instant is still Saturday in UTC', () => {
    const clock = Date.parse('2026-11-28T23:00:00Z');
    const availability = {
      ...coverage, workdays: [0, 1, 2, 3, 4],
      sources: [{ complete: [{ ...complete, asOf: instant(new Date(clock).toISOString()) }], busy: [] }],
    };
    const data = input([action('sunday')], availability, clock);
    expect(hyperHubProjectAvailabilityDay(clock, availability).date.date).toBe('2026-11-29');
    expect(hyperPlanDay(data).recommendation).toMatchObject({ kind: 'start-later', start: { iso: '2026-11-29T07:00:00.000Z' } });
  });

  it('maps Outlook and native occurrences, combines freshness by source and subtracts known busy from owner windows', () => {
    const outlook: HyperHubAgendaItem[] = [
      { id: 'oof', interval: span('09:00', '09:30'), availability: 'oof', allDay: false,
        sourceKind: 'outlook-calendar', private: true, isMeeting: false },
      { id: 'free', interval: span('10:00', '10:30'), availability: 'free', allDay: false,
        sourceKind: 'outlook-calendar', private: false, isMeeting: true },
      { id: 'tentative', interval: span('11:30', '11:45'), availability: 'tentative', allDay: false,
        sourceKind: 'outlook-calendar', private: true, isMeeting: false },
    ];
    const native: HyperHubAgendaItem[] = [
      { id: 'reservation', interval: span('09:30', '10:00'), availability: 'busy', allDay: false,
        sourceKind: 'hypertask', private: false, isMeeting: false },
      { id: 'all-day', interval: span('09:00', '12:30'), availability: 'busy', allDay: true,
        sourceKind: 'hypertask', private: false, isMeeting: false },
      { id: 'milestone', interval: span('10:00', '10:00'), availability: 'free', allDay: false,
        sourceKind: 'hypertask', private: false, isMeeting: false },
    ];
    const parts = {
      zone, workdays: [0], hours: { start: '09:00', end: '12:30' }, ownerWindows: [span('11:00', '12:00')],
      sources: [
        { complete: [{ ...complete, interval: span('09:00', '10:00') },
          { ...complete, interval: span('10:00', '11:30'), asOf: time('08:29') }], agenda: outlook },
        { complete: [{ ...complete, interval: span('09:00', '12:30') }], agenda: native },
      ],
    };
    const availability = hyperHubAvailabilityFromSnapshotParts(parts);
    expect(availability.sources?.map(source => source.busy.map(event => event.status))).toEqual([
      ['out-of-office', 'tentative'], ['reservation'],
    ]);
    const { coverage: dayCoverage } = hyperHubProjectAvailabilityDay(nowMs, availability);
    expect(dayCoverage.map(({ basis, interval: { start, end } }) => [basis, start.iso.slice(11, 16), end.iso.slice(11, 16)])).toEqual([
      ['complete', '07:00', '08:00'], ['stale-complete', '08:00', '09:30'], ['owner', '09:30', '10:00'],
      ['missing', '10:00', '10:30'],
    ]);
    const tasks = [
      action('stale', { due: time('12:00') }),
      action('owner', { release: time('11:30'), effortMinutes: 15 }),
    ];
    const data = input(tasks, availability);
    const staleRank = data.ranking.find(rank => rank.taskId === 'stale');
    expect(staleRank?.provisionalSlack).toBe(true);
    expect(staleRank?.reasons.find(reason => reason.signal === 'slack')?.facts.slackMinutes).toBe(75);
    const plan = hyperPlanDay(data);
    expect(plan.blocks.map(block => [block.taskId, block.start.iso.slice(11, 16)])).toEqual([
      ['stale', '08:00'], ['owner', '09:45'],
    ]);
    expect(plan.blocks[0].reasons).toContainEqual({ code: 'stale-coverage', facts: {} });
    expect(plan.blocks[1].reasons).toContainEqual({ code: 'owner-availability', facts: {} });
    expectNoOverlap(plan);
    const missing = hyperHubAvailabilityFromSnapshotParts({
      ...parts, ownerWindows: [], sources: [parts.sources[0], { ...parts.sources[1], complete: [] }],
    });
    const uncovered = input(tasks, missing);
    expect(uncovered.ranking.find(rank => rank.taskId === 'stale')?.unknown).toContain('slack');
    expect(hyperPlanDay(uncovered).unscheduled.map(task => task.code)).toEqual(['no-coverage', 'no-coverage']);
  });

  it('uses the moved busy interval and releases free, working-elsewhere, declined and cancelled events', () => {
    const busy: NonNullable<HyperHubAvailability['sources']>[number]['busy'] = [
      { ...span('09:00', '10:00'), status: 'cancelled', meetingId: 'old-occurrence' },
      { ...span('09:00', '10:00'), status: 'free' },
      { ...span('09:00', '10:00'), status: 'working-elsewhere' },
      { ...span('09:00', '10:00'), status: 'declined' },
      { ...span('10:00', '11:00'), status: 'busy', meetingId: 'moved-occurrence' },
      { ...span('10:30', '11:30'), status: 'reservation' },
    ];
    const availability = { ...coverage, sources: [{ complete: [complete], busy }] };
    const plan = hyperPlanDay(input([action('a', { effortMinutes: 60 }), action('b')], availability));
    expect(plan.blocks.map(block => [block.taskId, block.start.iso.slice(11, 16)])).toEqual([['a', '07:00'], ['b', '09:30']]);
    expect(plan.blocks[0].reasons[0]).toMatchObject({ code: 'fits-before-meeting', facts: { meetingId: 'moved-occurrence' } });
    expectNoOverlap(plan);
  });
});

it.skipIf(process.env.HYPER_HUB_BENCH !== '1')('benchmark only: ranking and both planning passes for 500 tasks', () => {
  const tasks = Array.from({ length: 500 }, (_, index) => {
    const id = String(index).padStart(3, '0');
    return action(id, {
      effortMinutes: 5 + index % 55, ownerPriority: (index % 4) as HyperHubTaskView['ownerPriority'],
      due: index % 3 === 0 ? time('10:00') : index % 3 === 1 ? time('18:45') : undefined,
      blockedBy: index >= 50 ? [edge(String(index % 50).padStart(3, '0'), id)] : [],
    });
  });
  const durations = { ranking: [] as number[], 'score-first': [] as number[], 'due-first': [] as number[], combined: [] as number[] };
  const availability: HyperHubAvailability = {
    ...withMeeting,
    ownerWindows: [span('17:30', '19:00')],
    sources: [...withMeeting.sources!, {
      complete: [
        { ...complete, interval: span('09:00', '14:00') },
        { ...complete, interval: span('14:00', '17:30'), newerRefreshPartial: true },
      ],
      busy: [{ ...span('15:30', '16:00'), status: 'reservation' }],
    }],
  };
  let ranking: HyperHubRanked[] = [];
  for (let i = 0; i < 60; i++) {
    const start = performance.now();
    ranking = hyperRankTasks({ tasks, nowMs, availability, weights: HyperHubM1Fixture.settings.weights });
    if (i >= 10) durations.ranking.push(performance.now() - start);
    hyperEvaluatePlanPasses({ tasks, nowMs, ranking, availability }, (pass, run) => {
      const passStart = performance.now();
      run();
      if (i >= 10) durations[pass].push(performance.now() - passStart);
    });
    if (i >= 10) durations.combined.push(performance.now() - start);
  }
  expect(ranking).toHaveLength(500);
  const percentiles = (samples: number[]) => {
    samples.sort((a, b) => a - b);
    return { medianMs: ((samples[24] + samples[25]) / 2).toFixed(2), p95Ms: samples[47].toFixed(2) };
  };
  console.table(Object.fromEntries(Object.entries(durations).map(([metric, samples]) => [metric, percentiles(samples)])));
});
