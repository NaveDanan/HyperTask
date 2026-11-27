import { describe, expect, it } from 'vitest';
import { HyperHubSetupScopeSchema, HyperTaskHubArgs, HyperTaskHubChannels, HyperTaskHubM2Args } from './HyperTaskHub';
import { HyperHubM5Fixture, HyperHubM2Fixture, HyperHubM2NoAvailabilityFixture } from './HyperTaskHub.fixtures';

const { day, agenda, plan } = HyperHubM2Fixture;
const version = { scopeGeneration: 3, expectedRevision: 8 };

describe('M2 availability contract', () => {
  it('opens an M1 setup without enabling additional imports', () => {
    const setup = { zone: day.date.zone, workdays: [0], hours: { start: '09:00', end: '18:00' },
      breaks: [], daysOff: [], aliases: [], jiraProjects: [], nativeViews: [] };
    expect(HyperHubSetupScopeSchema.parse(setup)).toEqual({
      ...setup, writeBack: { jira: false, newsletter: false }, mail: null, ai: null, meetingLinks: [], nativePages: [], newsletterArticles: [], outlookCalendar: false, nativeCalendars: [], newsletterProjects: [],
    });
  });

  it('accepts day-scoped declare, clear and undo, and rejects windows outside that day', () => {
    const schema = HyperTaskHubM2Args.sendFeedback;
    const event = { ...version, type: 'declare-availability', day: day.date, windows: day.ownerWindows };
    expect(schema.parse(event)).toEqual(event);
    expect(schema.safeParse({ ...event, day: { ...day.date, date: '2026-11-30' } }).success).toBe(false);
    expect(schema.safeParse({ ...event, day: { ...day.date, zone: 'Unknown' } }).success).toBe(false);
    expect(schema.safeParse({ ...event, windows: [] }).success).toBe(false);
    const target = { ...version, day: day.date };
    expect(schema.safeParse({ ...target, type: 'clear-availability' }).success).toBe(true);
    expect(schema.safeParse({ ...target, type: 'undo', ledgerEntryId: 'entry' }).success).toBe(true);
  });

  it('reserves private and tentative time while leaving the declined invitation free', () => {
    expect(agenda.filter(item => item.isMeeting)).toHaveLength(2);
    const privateItem = agenda.find(item => item.private);
    expect(privateItem?.availability).toBe('busy');
    expect(privateItem).not.toHaveProperty('title');
    expect(privateItem).not.toHaveProperty('handle');
    expect(agenda.map(item => item.id)).not.toContain('declined-invitation');
    expect(plan.recommendation?.kind).toBe('start-now');
    for (const block of plan.blocks) {
      for (const { interval } of agenda) {
        expect(Date.parse(block.end.iso) <= Date.parse(interval.start.iso) ||
          Date.parse(block.start.iso) >= Date.parse(interval.end.iso)).toBe(true);
      }
    }
  });

  it('keeps ranked work but offers no placements without coverage', () => {
    const fixture = HyperHubM2NoAvailabilityFixture;
    expect(fixture.settings.outlookAvailability).toBe(false);
    expect(fixture.day.ownerWindows).toEqual([]);
    expect(fixture.ranking).toHaveLength(fixture.tasks.length);
    expect(fixture.plan.blocks).toEqual([]);
    expect(fixture.plan.recommendation).toBeUndefined();
    expect(fixture.plan.unscheduled.some(entry => entry.code === 'no-coverage')).toBe(true);
  });
});

describe('M5 contract', () => {
  const taskId = HyperHubM5Fixture.tasks[0].id;
  const cases = [
    ['previewStatus', { ...version, handle: 'fixture.1', intent: { kind: 'choose' } }],
    ['previewStatus', { ...version, intent: { kind: 'reverse', operationId: 'op-1' } }],
    ['approveStatus', { previewId: 'p', candidateId: 'c', resolutionId: 'fixed' }],
    ['discardStatus', { previewId: 'p' }],
    ['releaseHold', { ...version, operationId: 'op-1' }],
    ['previewWeights', { ...version, seq: 0, draft: HyperHubM5Fixture.settings.weights }],
    ['saveWeights', { ...version, weights: HyperHubM5Fixture.settings.weights }],
    ['previewMirror', { ...version, taskId }],
    ['applyMirror', { token: 'token' }],
    ['sendFeedback', { ...version, type: 'set-matrix-quadrant', taskId, quadrant: 'urgent-important' }],
  ] as const;
  it.each(cases)('limits %s to its declared payload', (method, request) => {
    const schema = HyperTaskHubArgs[method];
    expect(schema.safeParse(request).success).toBe(true);
    expect(schema.safeParse({ ...request, approve: true }).success).toBe(false);
    for (const key of ['token', 'previewId', 'candidateId', 'operationId', 'resolutionId', 'handle', 'taskId']) {
      if (key in request) expect(schema.safeParse({ ...request, [key]: 'https://other.example/' }).success).toBe(false);
    }
  });
  it('requires an opaque target for a forward preview and positive total weight', () => {
    const args = HyperTaskHubArgs;
    expect(args.previewStatus.safeParse({ ...version, intent: { kind: 'state', state: 'done' } }).success).toBe(false);
    expect(args.previewStatus.safeParse({ ...version, intent: { kind: 'reverse', operationId: 'https://other.example' } }).success).toBe(false);
    for (const invalid of [0, -1, NaN, Infinity]) expect(args.saveWeights.safeParse({ ...version,
      weights: { age: invalid, slack: 0, importance: 0, unblocking: 0 } }).success).toBe(false);
    expect(Object.values(HyperTaskHubChannels)).toContain('hyper-task-hub:release-hold');
  });
  it('projects seven civil days, private time, verified intervals, write receipts and matrix axes', () => {
    const f = HyperHubM5Fixture, rank = (n: number) => f.ranking.find(r => r.taskId.endsWith(String(n)))!;
    expect(f.settings.writeBack).toEqual({ jira: { enabled: true, available: true }, newsletter: { enabled: true, available: true } });
    expect(f.meetingWindow?.coverage).toHaveLength(7);
    expect(f.meetingWindow?.requested).toEqual({ start: f.asOf, end: { kind: 'instant', iso: '2026-12-06T00:00:00+02:00' } });
    expect(f.meetingWindow?.coverage.filter(c => c.completeness === 'partial')).toHaveLength(1);
    expect(new Set(f.agenda?.flatMap(a => a.meeting ? [a.meeting.readiness] : []))).toEqual(new Set(['prepared', 'planned', 'none']));
    expect(f.agenda?.find(a => a.private)).not.toHaveProperty('title');
    expect(f.agenda?.some(a => a.meeting?.viewed)).toBe(true);
    expect(f.agenda?.some(a => a.interval.start.iso.startsWith('2026-12-01'))).toBe(false);
    expect([31, 32, 33, 34].map(n => [rank(n).urgency >= 0.50, rank(n).importance >= 0.67]))
      .toEqual([[true, true], [true, false], [false, true], [false, false]]);
    expect(rank(35).unknown).toContain('slack');
    expect(rank(36).unknown).toContain('importance');
    expect(rank(37)).toMatchObject({ unknown: [], feasibility: { ready: false } });
    expect(f.writes?.map(w => [w.state, w.held, w.ownerReleaseAvailable, w.undoAvailable])).toEqual([
      ['pending', true, false, false], ['unknown', true, true, false], ['unknown', true, false, false],
      ['failed', false, false, false], ['succeeded', false, false, true], ['succeeded', true, false, false],
    ]);
    expect(f.tasks.filter(t => t.schedule)).toHaveLength(1);
    expect(f.tasks.filter(t => t.mirror?.exists)).toHaveLength(1);
    expect(f.tasks.find(t => t.id.endsWith('42'))?.sources[0].statusWrite?.code).toBe('not-leaf');
    expect(f.cycleTaskIds).toHaveLength(2);
    expect(f.plan?.blocks.length).toBeGreaterThan(0);
  });
});
