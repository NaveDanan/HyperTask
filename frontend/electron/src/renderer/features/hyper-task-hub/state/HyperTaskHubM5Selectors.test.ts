import { describe, expect, it } from 'vitest';
import { HyperHubM5Fixture } from '@shared/HyperTaskHub.fixtures';
import { hyperRankTasks } from '@shared/HyperPriorityEngine';
import type {
  HyperHubAgendaItem, HyperHubCoverage, HyperHubDependency, HyperHubInstant, HyperHubPlanBlock, HyperHubRanked,
  HyperHubSnapshot, HyperHubSourceRef, HyperHubTaskView, HyperHubWriteView,
} from '@shared/HyperTaskHub';
import { hyperFormatHeld, hyperFormatMatrixReason } from './HyperTaskHubReasons';
import { hyperSelectMatrix, hyperSelectMeetingDays, hyperSelectStatusDiffers, hyperSelectTimeline, hyperSelectToday } from './HyperTaskHubSelectors';

const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const clock = instant('2026-03-24T07:00:00Z');
const zone = 'Asia/Jerusalem';
const weights = { slack: 45, importance: 25, unblocking: 20, age: 10 };
const range = { start: '2026-03-24', days: 7 } as const;
const dayStart = instant('2026-03-23T22:00:00.000Z');
const dayAfterLast = instant('2026-03-30T21:00:00.000Z');
const complete = { enabled: true, available: true };

function task(id: string, overrides: Partial<HyperHubTaskView> = {}): HyperHubTaskView {
  return {
    id, title: id, state: 'ready', stateChangedAt: clock, firstSeenAt: clock, authoritativeCompletion: 'open',
    sources: [], sourceStatus: {}, effortMinutes: 30, effortIsEstimate: false, people: [], meetingIds: [],
    blocks: [], blockedBy: [], pinned: false, ...overrides,
  };
}

function snapshot(overrides: Partial<HyperHubSnapshot> = {}): HyperHubSnapshot {
  return {
    scopeGeneration: 1, revision: 1, asOf: clock, tasks: [], ranking: [], sources: [],
    settings: { zone, setupComplete: true, workdays: [0, 1, 2, 3, 4], weights,
      writeBack: { jira: complete, newsletter: complete } }, ...overrides,
  };
}

function meeting(id: string, iso: string, readiness: 'none' | 'planned' | 'prepared', viewed = false): HyperHubAgendaItem {
  return {
    id, private: false, title: id, isMeeting: true, sourceKind: 'outlook-calendar', availability: 'busy', allDay: false,
    interval: { start: instant(iso), end: instant(new Date(Date.parse(iso) + 30 * 60_000).toISOString()) },
    meeting: { verifiedEligible: true, readiness, viewed },
  };
}

function rank(taskId: string, urgency: number, importance: number, overrides: Partial<HyperHubRanked> = {}): HyperHubRanked {
  return { taskId, urgency, importance, reasons: [], unknown: [], feasibility: { ready: true },
    score: 0, scoreCents: 0, pinned: false, ...overrides };
}

function edge(predecessorId: string, successorId: string, verified = true, resolvedByOwner = false): HyperHubDependency {
  return { predecessorId, successorId, verified, resolvedByOwner, provenance: { kind: 'owner' } };
}

function chunk(taskId: string, start: string, end: string, fixed = false): HyperHubPlanBlock {
  return { taskId, start: instant(start), end: instant(end), fixed, provisional: !fixed, reasons: [] };
}

const write: HyperHubWriteView = {
  operationId: 'write', taskId: 'held', evidenceId: 'J-1', source: 'newsletter', state: 'unknown', at: clock,
  fromName: 'pending', toName: 'completed', held: true, ownerReleaseAvailable: true, undoAvailable: false, readback: 'verified',
};

describe('M5 meeting days', () => {
  it('includes seven owner dates through the Jerusalem DST change and retains empty-day coverage', () => {
    const pending = meeting('before-cutoff', '2026-03-30T20:59:00Z', 'none');
    const next = meeting('at-cutoff', dayAfterLast.iso, 'none');
    const earlier = meeting('before-clock', '2026-03-24T06:59:00Z', 'none');
    const interval = { start: instant('2026-03-26T22:00:00Z'), end: instant('2026-03-27T21:00:00Z') };
    const coverage: HyperHubCoverage = { connectionId: 'calendar', queryId: 'meetings', interval,
      completeness: 'partial', lastSuccess: clock };
    const data = snapshot({
      agenda: [next, pending, earlier], meetingWindow: { requested: { start: clock, end: dayAfterLast }, coverage: [coverage] },
    });
    const days = hyperSelectMeetingDays(data);
    expect(days.map(day => day.date.date)).toEqual([
      '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30',
    ]);
    expect(days[3]).toMatchObject({ date: { zone }, coverage: [coverage], rows: [] });
    expect(days[2].coverage).toEqual([]);
    expect(days[4].coverage).toEqual([]);
    expect(days.flatMap(day => day.rows.map(row => row.agendaItem.id))).toEqual([pending.id]);
    expect(hyperSelectMeetingDays(data, { now: earlier.interval.start })[0].rows.map(row => row.agendaItem.id)).toEqual([earlier.id]);
    const pendingCoverage = { ...coverage, interval: undefined, lastSuccess: null };
    const stillLoading = { ...data, meetingWindow: { ...data.meetingWindow!, coverage: [pendingCoverage] } };
    expect(hyperSelectMeetingDays(stillLoading).every(day => day.coverage[0] === pendingCoverage)).toBe(true);
  });

  it('shows private busy rows and sorts by start and id, with needs-prep membership independent of Viewed', () => {
    const busy: HyperHubAgendaItem = {
      id: 'busy', private: true, isMeeting: false, sourceKind: 'outlook-calendar', availability: 'busy', allDay: true,
      interval: { start: dayStart, end: instant('2026-03-24T22:00:00.000Z') },
    };
    const time = '2026-03-24T09:00:00Z';
    const agenda = [meeting('z', time, 'prepared'), meeting('b', time, 'planned'), busy, meeting('A', time, 'none', true)];
    const tasks = [task('linked', { meetingIds: ['A', 'A', 'b'] }), task('closed', { state: 'done', meetingIds: ['A'] })];
    const data = snapshot({ agenda, tasks });
    const rows = hyperSelectMeetingDays(data)[0].rows;
    expect(rows.map(row => row.agendaItem.id)).toEqual(['busy', 'A', 'b', 'z']);
    expect(rows[0]).toEqual({ kind: 'busy', agendaItem: busy });
    expect(rows[0].agendaItem).not.toHaveProperty('title');
    expect(rows[0].agendaItem).not.toHaveProperty('handle');
    const prepRows = hyperSelectMeetingDays(data, { needsPrep: true })[0].rows;
    expect(prepRows).toMatchObject([
      { kind: 'meeting', agendaItem: { id: 'A' }, readiness: 'none', viewed: true, relatedOpenItemCount: 1 },
      { kind: 'meeting', agendaItem: { id: 'b' }, readiness: 'planned', viewed: false, relatedOpenItemCount: 1 },
    ]);
    const a = agenda[3];
    if (a.private || !a.meeting) throw new Error('Expected a verified meeting');
    const changed = { ...data, agenda: [...agenda.slice(0, 3), { ...a, meeting: { ...a.meeting, viewed: false } }] };
    expect(hyperSelectMeetingDays(changed, { needsPrep: true })[0].rows.map(row => row.agendaItem.id)).toEqual(['A', 'b']);
    expect(a.meeting.viewed).toBe(true);
  });
});

describe('M5 Matrix', () => {
  it('uses exact thresholds, retains blockers and preserves measured facts through override and Undo', () => {
    const tasks = [
      task('both'), task('urgent'), task('important'), task('waiting', { state: 'waiting' }),
      task('unknown', { effortIsEstimate: true, due: instant('2026-03-24T11:00:00Z') }),
      task('no-priority'),
      task('review', { state: 'review' }), task('done', { state: 'done' }), task('dismissed', { state: 'dismissed' }),
    ];
    const ranking = [
      rank('both', 0.50, 0.67, { provisionalSlack: true }), rank('urgent', 0.50, 0.669),
      rank('important', 0.499, 0.67), rank('waiting', 0.499, 0.669, {
        feasibility: { ready: false, code: 'waiting', facts: { predecessorId: 'prev' } },
      }),
      rank('unknown', 0, 0.67, { unknown: ['slack'] }),
      rank('no-priority', 0.72, 0, { unknown: ['importance'] }),
    ];
    const base = snapshot({ tasks, ranking });
    const automatic = hyperSelectMatrix(base);
    expect(automatic.quadrants.map(item => [item.quadrant, item.cards.map(card => card.task.id)])).toEqual([
      ['urgent-important', ['both']], ['important', ['important']], ['urgent', ['urgent']], ['neither', ['waiting']],
    ]);
    expect(automatic.quadrants[3].cards[0].blocker).toMatchObject({ code: 'waiting', facts: { predecessorId: 'prev' } });
    const unknown = automatic.needsDetails[0];
    expect(unknown).toMatchObject({ task: { id: 'unknown' }, urgency: null, importance: 0.67 });
    expect(hyperFormatMatrixReason(unknown.reasons[0], 'en')).toBe('Effort needed to calculate urgency');
    expect(hyperFormatMatrixReason(unknown.reasons[0], 'he')).toMatch(/[\u0590-\u05ff]/);
    expect(automatic.needsDetails[1]).toMatchObject({ task: { id: 'no-priority' }, urgency: 0.72, importance: null });
    expect(hyperFormatMatrixReason(automatic.quadrants[0].cards[0].reasons[0], 'en')).toBe('Urgency 50% (provisional)');
    const moved = { ...base, matrixOverrides: { unknown: 'urgent-important' as const } };
    const movedCard = hyperSelectMatrix(moved).quadrants[0].cards[1];
    expect(movedCard).toMatchObject({ urgency: unknown.urgency, importance: unknown.importance, override: 'urgent-important' });
    expect(hyperFormatMatrixReason(movedCard.reasons.at(-1)!, 'en')).toBe('Moved by you');
    const changedWeights = { ...moved, settings: { ...moved.settings, weights: { ...weights, importance: 99 } },
      ranking: [...ranking].reverse() };
    expect(hyperSelectMatrix(changedWeights).quadrants[0].cards[0].task.id).toBe('unknown');
    expect(hyperSelectMatrix({ ...moved, matrixOverrides: undefined })).toEqual(automatic);
  });

  it('caps quadrants and orders absent ranks by code-unit id independent of input permutation', () => {
    const tasks = ['a', 'Z', ...Array.from({ length: 50 }, (_, index) => 'x' + String(index).padStart(2, '0'))].map(id => task(id));
    const matrixOverrides = Object.fromEntries(tasks.map(item => [item.id, 'neither' as const]));
    const data = snapshot({ tasks, matrixOverrides, ranking: [rank('x49', 0, 0)] });
    const matrix = hyperSelectMatrix(data);
    expect(matrix.quadrants[3]).toMatchObject({ overflowCount: 2 });
    expect(matrix.quadrants[3].cards).toHaveLength(50);
    expect(matrix.quadrants[3].cards.slice(0, 3).map(card => card.task.id)).toEqual(['x49', 'Z', 'a']);
    expect(hyperSelectMatrix({ ...data, tasks: [...tasks].reverse() })).toEqual(matrix);
    expect(hyperSelectMatrix(data, { projectId: 'other' }).quadrants.every(quadrant => !quadrant.cards.length)).toBe(true);
  });
});

describe('M5 Timeline', () => {
  const schedule = { start: instant('2026-03-24T11:00:00Z'), end: instant('2026-03-24T12:00:00Z'),
    provenance: { kind: 'source', evidenceId: 'schedule' } as const };
  const pre = task('pre', { projectId: 'A' });
  const next = task('next', { projectId: 'B', schedule, planned: schedule.start,
    blockedBy: [edge('pre', 'next'), edge('missing', 'next'), edge('self', 'next', false), edge('absent', 'next', true, true)] });
  const split = task('split', { blockedBy: [edge('next', 'split')] });
  const planBlocks = [
    chunk('pre', '2026-03-23T21:00:00Z', '2026-03-23T23:00:00Z', true),
    chunk('pre', '2026-03-24T09:00:00Z', '2026-03-24T10:00:00Z'),
    chunk('split', '2026-03-24T13:00:00Z', '2026-03-24T14:00:00Z'),
    chunk('split', '2026-03-30T20:00:00Z', '2026-03-30T22:00:00Z'),
  ];

  it('clips bars, anchors verified edges to actual first and last chunks and reports hidden predecessors', () => {
    const data = snapshot({ tasks: [next, split, pre], plan: { pass: 'score-first', blocks: [...planBlocks].reverse(),
      unscheduled: [], provisional: true } });
    const timeline = hyperSelectTimeline(data, range, 'project');
    expect(timeline.interval).toEqual({ start: dayStart, end: dayAfterLast });
    const [a, b, ungrouped] = timeline.groups;
    expect(a.rows[0].bars[0]).toMatchObject({ fixed: true,
      interval: { start: planBlocks[0].start }, clipped: { start: dayStart } });
    expect(b.rows[0]).toMatchObject({ bars: [{ kind: 'source', provenance: schedule.provenance }],
      markers: [], missingPredecessorIds: ['missing'] });
    expect(ungrouped.rows[0].bars[1]).toMatchObject({ interval: { end: planBlocks[3].end }, clipped: { end: dayAfterLast } });
    expect(timeline.edges).toMatchObject([
      { predecessorId: 'pre', successorId: 'next', fromBarId: 'pre/plan/1', toBarId: 'next/source', from: planBlocks[1].end },
      { predecessorId: 'next', successorId: 'split', fromBarId: 'next/source', toBarId: 'split/plan/0', to: planBlocks[2].start },
    ]);
    const filtered = hyperSelectTimeline(data, range, 'project', { projectId: 'B' });
    expect(filtered.edges).toEqual([]);
    expect(filtered.groups[0].rows[0].hiddenPredecessorIds).toEqual(['pre']);
    const clippedEndpoint = { ...data, plan: { ...data.plan!, blocks: [...planBlocks,
      chunk('pre', '2026-03-30T20:00:00Z', '2026-03-30T22:00:00Z')] } };
    expect(hyperSelectTimeline(clippedEndpoint, range, 'project').edges.map(item => item.predecessorId)).toEqual(['next']);
  });

  it('keeps effort-only rows undated, uses markers for separate dates and suppresses edges within cycles', () => {
    const due = { kind: 'civil-date', date: '2026-03-27', zone } as const;
    const marker = task('marker', { planned: clock, due, effortMinutes: 150 });
    const undated = task('undated', { effortMinutes: 600 });
    const out = task('out', { due: dayAfterLast });
    const a = task('a', { schedule, blockedBy: [edge('b', 'a')] });
    const b = task('b', { schedule, blockedBy: [edge('a', 'b')] });
    const tl = hyperSelectTimeline(snapshot({ tasks: [undated, out, marker, b, a], cycleTaskIds: ['a', 'b'] }), range, 'source');
    expect(tl.groups[0].rows.map(row => [row.task.id, row.cycle])).toEqual([['a', true], ['b', true], ['marker', false]]);
    expect(tl.groups[0].rows[2]).toMatchObject({ bars: [], markers: [
      { kind: 'planned', date: clock }, { kind: 'due', date: due, at: instant('2026-03-26T22:00:00.000Z') },
    ] });
    expect(tl.edges).toEqual([]);
    expect(tl.undated).toMatchObject([{ task: { id: 'undated', effortMinutes: 600 }, bars: [], markers: [] }]);
    expect(tl.outOfRangeCount).toBe(1);
  });
});

it('omits a previously recommended task during its hold and restores it after owner release', () => {
  const held = task(write.taskId);
  const data = snapshot({ tasks: [held], ranking: [rank(held.id, 0, 0)], plan: { pass: 'score-first', unscheduled: [],
    provisional: false, blocks: [chunk(held.id, clock.iso, '2026-03-24T08:00:00Z', true)] } });
  expect(hyperSelectToday(data).recommendation?.task.id).toBe('held');
  expect(hyperSelectToday({ ...data, writes: [write] })).toMatchObject({ recommendation: null, blocks: [],
    capacity: { plannedMinutes: 0 } });
  expect(hyperSelectToday({ ...data, writes: [{ ...write, ownerReleasedAt: clock }] }).recommendation?.task.id).toBe('held');
  expect(hyperFormatHeld(write, 'en')).toBe('Waiting for Newsletter to confirm');
  expect(hyperFormatHeld({ ...write, state: 'pending' }, 'en')).toBe('Updating Newsletter…');
  expect(hyperFormatHeld({ ...write, ownerReleasedAt: clock }, 'he')).toMatch(/שחררת.*Newsletter/);
});

it('offers state intents per opted-in writable reference when the observed categories differ', () => {
  const ref = (evidenceId: string, kind: HyperHubSourceRef['kind'], role: HyperHubSourceRef['role']): HyperHubSourceRef => ({
    evidenceId, kind, role, handle: evidenceId, connectionId: kind, label: evidenceId, openable: true, stale: false,
    statusWrite: { available: true },
  });
  const sources = [ref('jira', 'jira', 'origin'), ref('newsletter', 'newsletter-task', 'assignment'),
    ref('mirror', 'jira', 'mirror'), ref('mail', 'outlook-mail', 'origin'), { ...ref('no-hint', 'jira', 'origin'), statusWrite: undefined }];
  const card = task('merged', { sources, sourceStatus: {
    jira: { rawStatus: 'Team review', completion: 'open', category: 'indeterminate' },
    newsletter: { rawStatus: 'completed', completion: 'complete' },
    mirror: { rawStatus: 'Done', completion: 'complete', category: 'done' },
    mail: { rawStatus: 'Received', completion: 'unknown' },
    'no-hint': { rawStatus: 'Done', completion: 'complete', category: 'done' },
  } });
  const data = snapshot();
  expect(hyperSelectStatusDiffers(data, card)).toEqual([
    { evidenceId: 'jira', source: sources[0], observedName: 'Team review', write: 'jira', category: 'indeterminate',
      intent: { kind: 'state', state: 'ready' } },
    { evidenceId: 'newsletter', source: sources[1], observedName: 'completed', write: 'newsletter', category: 'done',
      intent: { kind: 'state', state: 'ready' } },
  ]);
  expect(hyperSelectStatusDiffers(data, { ...card, state: 'doing' }).map(item => item.evidenceId)).toEqual(['newsletter']);
  expect(hyperSelectStatusDiffers(data, { ...card, state: 'done' }).map(item => item.evidenceId)).toEqual(['jira']);
  expect(hyperSelectStatusDiffers(data, { ...card, state: 'waiting' })).toEqual([]);
  const settings = { ...data.settings, writeBack: { jira: { enabled: false, available: true }, newsletter: complete } };
  expect(hyperSelectStatusDiffers({ ...data, settings }, card).map(item => item.evidenceId)).toEqual(['newsletter']);
});

it('smoke tests the shared M5 fixture through all new selectors', () => {
  const fixture = HyperHubM5Fixture;
  const days = hyperSelectMeetingDays(fixture);
  expect(days).toHaveLength(7);
  expect(days.flatMap(day => day.rows).some(row => row.kind === 'busy')).toBe(true);
  expect(hyperSelectMeetingDays(fixture, { needsPrep: true }).flatMap(day => day.rows)).toHaveLength(3);
  const matrix = hyperSelectMatrix(fixture);
  expect(matrix.needsDetails.length).toBeGreaterThan(0);
  expect(matrix.quadrants.flatMap(item => item.cards).some(card => card.override)).toBe(true);
  const changed = { ...fixture, ranking: hyperRankTasks({ tasks: fixture.tasks, nowMs: Date.parse(fixture.asOf.iso),
    weights: { ...weights, importance: 100 } }) };
  expect(hyperSelectMatrix(changed).quadrants.flatMap(item => item.cards).find(card => card.override)?.override).toBe('important');
  const timeline = hyperSelectTimeline(fixture, { start: days[0].date.date, days: 7 });
  expect(timeline.undated.length).toBeGreaterThan(0);
  expect([...timeline.undated, ...timeline.groups.flatMap(group => group.rows)].filter(row => row.cycle)).toHaveLength(2);
  expect(fixture.tasks.flatMap(item => hyperSelectStatusDiffers(fixture, item))).toContainEqual(expect.objectContaining({ write: 'jira' }));
});
