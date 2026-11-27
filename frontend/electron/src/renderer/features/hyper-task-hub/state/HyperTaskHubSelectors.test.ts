import { describe, expect, it } from 'vitest';
import type { HyperHubTaskView } from '@shared/HyperTaskHub';
import { HyperHubM1Fixture, HyperHubM2Fixture, HyperHubM2NoAvailabilityFixture } from '@shared/HyperTaskHub.fixtures';
import {
  hyperSelectBoard, hyperSelectFocus, hyperSelectMeetings, hyperSelectPendingOrder, hyperSelectTasks, hyperSelectToday, hyperSelectTriage,
  type HyperHubMeetingAgendaDetails, type HyperHubMeetingsSnapshot,
} from './HyperTaskHubSelectors';

const snapshot = HyperHubM1Fixture;
const ids = (tasks: readonly { id: string }[]) => tasks.map(task => task.id);

describe('HyperTaskHub selectors', () => {
  it('selects five personal-state columns, today’s Done, and the Triage filter', () => {
    const prior = {
      ...snapshot.tasks[6], id: 'prior', stateChangedAt: { kind: 'instant', iso: '2026-11-28T21:59:00Z' } as const,
    };
    const midnight = {
      ...prior, id: 'midnight', stateChangedAt: { kind: 'instant', iso: '2026-11-28T22:00:00Z' } as const,
    };
    const board = hyperSelectBoard({ ...snapshot, tasks: [...snapshot.tasks, prior, midnight] });
    expect(board.map(column => [column.state, column.cards.length, column.overflowCount])).toEqual([
      ['review', 1, 0], ['ready', 4, 0], ['doing', 2, 0], ['waiting', 2, 0], ['done', 3, 0],
    ]);
    expect(ids(board[4].cards)).toEqual([snapshot.tasks[6].id, snapshot.tasks[11].id, 'midnight']);
    expect(ids(hyperSelectTriage(snapshot))).toEqual([snapshot.tasks[5].id]);
    expect(hyperSelectTasks(snapshot)).toHaveLength(snapshot.tasks.length - 1);
  });

  it('caps each Board column at 50 and preserves the relative order of overflow after a visible move', () => {
    const backlog = Array.from({ length: 54 }, (_, index) => ({ ...snapshot.tasks[1], id: String(index).padStart(2, '0') }));
    const data = { ...snapshot, tasks: [...backlog].reverse() };
    const [, ready] = hyperSelectBoard(data);
    expect(ready.overflowCount).toBe(4);
    expect(ids(ready.cards)).toEqual(ids(backlog.slice(0, 50)));
    const moved = backlog.map(task => task.id === '09' ? { ...task, manualOrder: 0 } : task);
    const [, afterMove] = hyperSelectBoard({ ...data, tasks: moved });
    expect(ids(afterMove.cards)).toEqual(['09', ...ids(backlog.slice(0, 50)).filter(id => id !== '09')]);
    const [, afterRemoving] = hyperSelectBoard({ ...data, tasks: moved.filter(task => task.id !== '09' && task.id !== '00') });
    expect(ids(afterRemoving.cards).slice(-2)).toEqual(['50', '51']);
    expect(afterRemoving.overflowCount).toBe(2);
  });

  it('applies pins and manual order ahead of rank, preserving memo identity', () => {
    const [migration, , pin, , checklist] = snapshot.tasks;
    const data = { ...snapshot, tasks: snapshot.tasks.map(task => task === checklist ? { ...task, manualOrder: 1 } : task) };
    const focus = hyperSelectFocus(data);
    expect(ids(focus.map(item => item.task)).slice(0, 3)).toEqual([pin.id, checklist.id, migration.id]);
    expect(focus.map(item => item.task.state)).toEqual(expect.arrayContaining(['ready', 'doing']));
    expect(focus.every(item => item.task.state === 'ready' || item.task.state === 'doing')).toBe(true);
    expect(hyperSelectFocus(data)).toBe(focus);
    const filters = { source: 'jira', personId: 'amir' } as const;
    const board = hyperSelectBoard(data, filters);
    expect(board[3].cards).toEqual([snapshot.tasks[3]]);
    expect(hyperSelectBoard(data, filters)).toBe(board);
    expect(hyperSelectTasks(data, { source: 'hypertask' })).toContain(migration); // source match includes mirrors
    expect(hyperSelectTasks(data, { source: 'hypertask', connectionId: 'jira-eng' })).toEqual([]);
  });

  it('caps Next after pin, manual and rank ordering, with a hidden drop anchor', () => {
    const tasks = Array.from({ length: 54 }, (_, index) => ({
      ...snapshot.tasks[1], id: String(index).padStart(2, '0'),
      pinned: index === 1, manualOrder: index === 2 ? 0 : undefined,
    }));
    const ranking = [...tasks].reverse().map(task => ({ ...snapshot.ranking[0], taskId: task.id }));
    const data = { ...snapshot, tasks, ranking };
    const expected = ['01', '02', ...ranking.map(rank => rank.taskId).filter(id => id !== '01' && id !== '02')];
    const next = hyperSelectBoard(data)[1];
    expect(ids(next.cards)).toEqual(expected.slice(0, 50));
    expect(ids(next.cards)).toEqual(ids(hyperSelectFocus(data).slice(0, 50).map(item => item.task)));
    expect(next).toMatchObject({ overflowCount: 4, firstOverflowId: expected[50] });
  });

  it('diffs the displayed Focus order against the new revision and ignores removed IDs in the moved count', () => {
    const oldOrder = ids(hyperSelectFocus(snapshot).map(item => item.task));
    const [, first, second, ...rest] = oldOrder;
    const newOrder = ['added', second, first, ...rest];
    const revised = {
      ...snapshot,
      revision: snapshot.revision + 1,
      tasks: newOrder.map((id, manualOrder) => ({
        ...(snapshot.tasks.find(task => task.id === id) ?? snapshot.tasks[1]), id, manualOrder, pinned: false,
      })),
    };
    expect(hyperSelectPendingOrder(oldOrder, revised)).toEqual({ order: newOrder, movedCount: 2 });
    expect(hyperSelectPendingOrder(newOrder, revised)).toEqual({ order: newOrder, movedCount: 0 });
  });
});

describe('HyperTaskHub meetings selector', () => {
  const fixture = HyperHubM2Fixture;
  const now = { kind: 'instant', iso: '2026-11-29T09:00:00Z' } as const;
  const event = (id: string, start: string, meeting?: HyperHubMeetingAgendaDetails) => ({
    id, title: id, sourceKind: 'outlook-calendar', private: false, isMeeting: true, allDay: false, availability: 'busy', meeting,
    interval: { start: { kind: 'instant', iso: start }, end: { kind: 'instant', iso: new Date(Date.parse(start) + 3_600_000).toISOString() } },
  } as const);
  const prepared = { verifiedEligible: true, readiness: 'prepared', viewed: true } as const;
  const planned = { verifiedEligible: true, readiness: 'planned', viewed: false } as const;

  it('requires verified public meetings, uses the upcoming seven-day window, and sorts start then code-unit id', () => {
    const start = '2026-11-29T10:00:00Z';
    const data = { ...fixture, asOf: now, agenda: [
      event('a', start, prepared), event('Z', start, planned), event('begins-now', now.iso, prepared),
      event('last-minute', '2026-12-06T08:59:00Z', planned), event('outside', '2026-12-06T09:00:00Z', planned),
      event('legacy', start), event('past', '2026-11-29T08:59:00Z', prepared),
      { ...event('appointment', start, planned), isMeeting: false },
      { ...event('busy', start, planned), private: true, isMeeting: false, title: undefined, meeting: undefined },
    ] as const };
    expect(hyperSelectMeetings(data).map(item => item.agendaItem.id)).toEqual(['begins-now', 'Z', 'a', 'last-minute']);
    expect(hyperSelectMeetings(data, { needsPrep: true }).map(item => item.agendaItem.id)).toEqual(['Z', 'last-minute']);
    expect(hyperSelectMeetings(data, { now: { kind: 'instant', iso: '2026-12-06T09:00:00Z' } }).map(item => item.agendaItem.id))
      .toEqual(['outside']);
    expect(hyperSelectMeetings(fixture)).toEqual([]);
  });

  it('exposes readiness and viewed separately and counts distinct linked open tasks', () => {
    const openTask: HyperHubTaskView = {
      ...fixture.tasks[0], state: 'ready', authoritativeCompletion: 'open', meetingIds: ['release', 'release'],
    };
    const agendaItem = event('release', now.iso, planned);
    const data: HyperHubMeetingsSnapshot = { ...fixture, asOf: now, agenda: [agendaItem], tasks: [
      openTask,
      { ...openTask, id: 'unlinked', meetingIds: [] },
      { ...openTask, id: 'complete', authoritativeCompletion: 'complete', meetingIds: ['release'] },
      { ...openTask, id: 'done', state: 'done', meetingIds: ['release'] },
      { ...openTask, id: 'dismissed', state: 'dismissed', meetingIds: ['release'] },
      { ...openTask, id: 'waiting', state: 'waiting', meetingIds: ['release'] },
    ] };
    expect(hyperSelectMeetings(data)).toEqual([
      { agendaItem, readiness: 'planned', viewed: false, relatedOpenItemCount: 2 },
    ]);
  });
});

describe('HyperTaskHub Today selector', () => {
  it('projects the M2 recommendation, day agenda and capacity from the same snapshot', () => {
    const fixture = HyperHubM2Fixture;
    const today = hyperSelectToday(fixture);
    const suggested = fixture.plan!.recommendation!;
    expect(today.recommendation).toMatchObject({
      task: { id: suggested.taskId }, ranked: { taskId: suggested.taskId, feasibility: { ready: true } },
      block: { taskId: suggested.taskId }, kind: suggested.kind, start: suggested.start, reasons: suggested.reasons,
    });
    expect(today.recommendationReason).toBeNull();
    expect(today.coverage).toBe('provisional');
    expect(today.needsOwnerWindow).toBe(false);
    expect(today.agenda).toEqual(fixture.agenda);
    expect(today.agenda.find(event => event.private)).not.toHaveProperty('title');
    expect(today.blocks.map(({ block }) => block)).toEqual(fixture.plan!.blocks);
    const starts = today.blocks.map(({ block }) => Date.parse(block.start.iso));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(today.capacity).toMatchObject({ freeMinutes: 360, provisional: true });
    expect(today.capacity.plannedMinutes + today.capacity.unplacedMinutes).toBe(360);
    expect(hyperSelectToday(fixture)).toBe(today);
  });

  it('keeps the agenda and free time across filters and skips forecast-only starts', () => {
    const fixture = HyperHubM2Fixture;
    const filters = { source: 'newsletter-task' } as const;
    const filtered = hyperSelectToday(fixture, filters);
    expect(filtered.recommendation?.task.title).toBe('Assemble the Sunday newsletter');
    expect(filtered.blocks.map(({ task }) => task.title)).toEqual([
      'Assemble the Sunday newsletter', 'Proof the Sunday newsletter',
    ]);
    expect(filtered.agenda).toEqual(fixture.agenda);
    expect(filtered.capacity).toEqual({ freeMinutes: 360, plannedMinutes: 60, unplacedMinutes: 0, provisional: true });
    expect(hyperSelectToday(fixture, filters)).toBe(filtered);
    const fallback = hyperSelectToday({
      ...fixture,
      tasks: fixture.tasks.map(task => task.title === 'Assemble the Sunday newsletter'
        ? { ...task, snoozeUntil: { kind: 'instant', iso: '2026-11-30T09:00:00+02:00' } } : task),
    }, filters);
    expect(fallback.recommendation).toBeNull();
    expect(fallback.recommendationReason).toBe('no-ready-task');
  });

  it('requests an owner window with the no-availability fixture and retains overflow facts', () => {
    const fixture = HyperHubM2NoAvailabilityFixture;
    const today = hyperSelectToday(fixture);
    expect(today).toMatchObject({
      recommendation: null, recommendationReason: 'no-coverage', coverage: 'missing', needsOwnerWindow: true,
      blocks: [], agenda: [],
      capacity: { freeMinutes: 0, plannedMinutes: 0, unplacedMinutes: 360, provisional: false },
    });
    expect(today.unscheduled.find(entry => entry.task.effortIsEstimate)).toMatchObject({
      code: 'no-coverage', facts: { effortMinutes: 45, estimateMinutes: 45 },
    });
    expect(hyperSelectFocus(fixture).length).toBeGreaterThan(0);
  });

  it('excludes out-of-day agenda, identifies uncovered work, and distinguishes a covered day with no fit', () => {
    const fixture = HyperHubM2Fixture;
    const [event] = fixture.agenda!;
    const nextDay = { ...event, id: 'tomorrow', interval: {
      start: { kind: 'instant', iso: '2026-11-30T00:00:00+02:00' } as const, end: { kind: 'instant', iso: '2026-11-30T10:00:00+02:00' } as const,
    } };
    const day = fixture.day!;
    const partial = hyperSelectToday({ ...fixture, agenda: [nextDay, ...fixture.agenda!], day: { ...day, coverage: [day.coverage[0]] } });
    expect(partial).toMatchObject({ coverage: 'provisional', needsOwnerWindow: true, capacity: { freeMinutes: 270 } });
    expect(ids(partial.agenda)).toEqual(ids(fixture.agenda!));
    const complete = hyperSelectToday({
      ...fixture,
      day: { ...day, coverage: day.working.map(interval => ({ interval, basis: 'complete' })) },
      plan: { pass: 'score-first', provisional: false, blocks: [], unscheduled: [] },
    });
    expect(complete).toMatchObject({ recommendation: null, recommendationReason: 'nothing-fits', coverage: 'complete', needsOwnerWindow: false });
  });
});
