import { describe, expect, it } from 'vitest';
import {
  hyperBriefSummaryRequest, hyperBuildMeetingBrief,
  type HyperMeetingBriefEvidence, type HyperMeetingBriefInput, type HyperMeetingHistoryOccurrence,
  type HyperMeetingOccurrence, type HyperMeetingPreparation,
} from './HyperMeetingBrief';
import type { HyperHubInstant, HyperHubWriteView } from './HyperTaskHub';

const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const day = (date: string, time = '10:00') => instant(`2026-11-${date}T${time}:00Z`);
const interval = (date: string, start = '10:00', end = '11:00') => ({ start: day(date, start), end: day(date, end) });
const jiraKey = { instanceId: 'configured-jira', key: 'OPS-42' };
const meeting: HyperMeetingOccurrence = {
  key: { kind: 'outlook-calendar', connectionId: 'calendar', storeId: 'store', occurrenceId: 'release', originalStart: day('30') },
  id: 'release-agenda', revision: 'r1', sourceTime: day('20'), stale: false, subject: 'OPS-42 / שחרור גרסה',
  interval: interval('28'), joinUrl: 'https://meet.example/release', excerpt: 'Review release readiness.',
  accessible: true, isMeeting: true, sensitivity: 'normal', cancelled: false, organizerIsOwner: false, response: 'accepted',
  organizer: { name: 'Dana', verifiedIdentityId: 'dana' }, attendees: [{ name: 'Noa', verifiedIdentityId: 'noa' }, { name: 'Avi' }],
  jiraKeys: [jiraKey], projectIds: ['jira:configured-jira:ops'], trustedDocumentIds: ['page:release'], verifiedSeriesId: 'release-series',
};
const base: HyperMeetingBriefInput = {
  now: day('27'), requestedOccurrence: meeting.key, occurrence: meeting, evidence: [],
  configuredJiraInstanceId: jiraKey.instanceId, configuredNewsletterConnectionIds: ['newsletter'],
};

function source(id: string) {
  return { id, revision: 'r1', sourceTime: day('25'), stale: false, accessible: true, subject: 'שחרור גרסה' };
}

function mail(id: string, extra: Partial<Extract<HyperMeetingBriefEvidence, { kind: 'mail' }>> = {}): HyperMeetingBriefEvidence {
  return { ...source(id), kind: 'mail', connectionId: 'mail', storeId: 'store', messageId: id, ...extra };
}

function build(input: Partial<HyperMeetingBriefInput> = {}) {
  const brief = hyperBuildMeetingBrief({ ...base, ...input });
  if (!brief.eligible) throw new Error('Expected an eligible meeting');
  return brief;
}

it('keeps a held reopen from claiming Prepared or Planned and honors an owner release or confirmation', () => {
  const write: HyperHubWriteView = {
    operationId: 'reopen', taskId: 'prep', evidenceId: 'jira-1', source: 'jira', state: 'unknown', at: base.now,
    fromName: 'Done', toName: 'Open', held: true, ownerReleaseAvailable: true, undoAvailable: false, readback: 'verified',
  };
  const tasks = [{ id: 'prep', completion: 'complete' }, { id: 'other', completion: 'complete' }] as const;
  const blocks = [{ ...interval('28', '09:00', '09:30'), taskId: 'prep' }];
  const before = build({ preparation: { tasks, blocks } });
  const held = build({ writes: [write], preparation: { tasks, blocks, viewed: true } });
  expect(held).toMatchObject({ readiness: 'none', viewed: true });
  expect(held.briefVersion).not.toBe(before.briefVersion);
  expect(build({ writes: [write], preparation: { blocks } }).readiness).toBe('none');
  expect(build({ writes: [write], preparation: { tasks, blocks, ownerConfirmed: true } }).readiness).toBe('prepared');
  const writes = [{ ...write, ownerReleasedAt: day('27', '10:01') }];
  expect(build({ writes, preparation: { tasks, blocks } })).toEqual(before);
  expect(build({ writes, preparation: { blocks } }).readiness).toBe('planned');
  expect(build({ writes, preparation: { tasks: [{ id: 'prep', completion: 'open' }] } }).readiness).toBe('none');
});

describe('meeting brief eligibility', () => {
  it.each([
    ['plain appointment', { isMeeting: false }],
    ['private', { sensitivity: 'private' }],
    ['confidential', { sensitivity: 'confidential' }],
    ['unknown sensitivity', { sensitivity: 'unknown' }],
    ['cancelled', { cancelled: true }],
    ['declined even when owner-organized', { response: 'declined', organizerIsOwner: true }],
    ['inaccessible', { accessible: false }],
    ['tentative', { response: 'tentative' }],
    ['unanswered', { response: 'not-responded' }],
    ['unknown response', { response: 'unknown' }],
  ] as const)('withholds all meeting detail for %s', (_label, extra) => {
    const brief = hyperBuildMeetingBrief({ ...base, occurrence: { ...meeting, ...extra }, evidence: [mail('mail')] });
    expect(brief).toEqual({ eligible: false, briefVersion: expect.any(String) });
    expect(hyperBriefSummaryRequest(brief, [meeting.id, 'mail']).untrusted_data).toEqual([]);
  });

  it.each([
    { connectionId: 'other-calendar' }, { storeId: 'other-store' }, { occurrenceId: 'other-occurrence' }, { originalStart: day('29') },
  ])('requires the independently verified occurrence key to match %j', extra => {
    expect(hyperBuildMeetingBrief({ ...base, requestedOccurrence: { ...meeting.key, ...extra },
      evidence: [mail('linked')], manualEvidenceIds: ['linked'] })).toMatchObject({ eligible: false });
  });

  it('uses the original start rather than the moved start and recognizes equivalent offsets', () => {
    const brief = build({ requestedOccurrence: { ...meeting.key, originalStart: instant('2026-11-30T12:00:00+02:00') },
      occurrence: { ...meeting, organizerIsOwner: true, response: 'unknown', sensitivity: 'personal' } });
    expect(brief.meeting).toMatchObject({ interval: meeting.interval, joinUrl: meeting.joinUrl, attendees: meeting.attendees,
      excerpt: meeting.excerpt, sourceTime: meeting.sourceTime, stale: false, reasons: [{ code: 'owner-organized' }] });
  });
});

describe('meeting brief evidence', () => {
  it('scores the OPS-42 release message 100 and excludes an unrelated attendee message that scores 20', () => {
    const release = mail('release-mail', {
      jiraKeys: [jiraKey, jiraKey], trustedDocumentIds: ['page:release'], verifiedIdentityIds: ['noa', 'dana'],
      excerpt: 'OPS-42 ready to review', stale: true,
    });
    const unrelated = mail('unrelated', { subject: 'Office renovation', verifiedIdentityIds: ['noa'] });
    const unverified = mail('display-name-only', { subject: 'Avi', verifiedIdentityIds: ['Avi'] });
    const brief = build({ evidence: [unrelated, release, unverified] });
    expect(brief.threads.map(thread => thread.messages[0].id)).toEqual(['release-mail']);
    expect(brief.threads[0].messages[0]).toMatchObject({ score: 100, stale: true, sourceTime: day('25') });
    expect(brief.threads[0].messages[0].reasons.map(({ code, points }) => [code, points])).toEqual([
      ['jira-key', 60], ['subject-terms', 20], ['meeting-person', 15], ['recent', 5],
    ]);
    expect(build({ evidence: [release, unrelated], manualEvidenceIds: ['unrelated'] }).threads[0].messages[0])
      .toMatchObject({ id: 'unrelated', manual: true, score: 20 });
  });

  it('requires project or topic for automatic mail even when Jira or a trusted link matches', () => {
    const exact = mail('exact', { subject: 'Office renovation', jiraKeys: [jiraKey], trustedDocumentIds: ['page:release'] });
    const project = mail('project', { subject: 'Office renovation', projectIds: meeting.projectIds });
    const wrongInstance = mail('other', { jiraKeys: [{ ...jiraKey, instanceId: 'other' }] });
    expect(build({ evidence: [exact, project, wrongInstance] }).threads.map(thread =>
      [thread.messages[0].id, thread.messages[0].score])).toEqual([['other', 25], ['project', 5]]);
  });

  it('matches normalized English and Hebrew terms, ignores stopwords and keeps Jira keys whole', () => {
    const release = mail('release', { subject: 'FWD: release RELEASE checklist' });
    const hebrew = mail('hebrew', { subject: 'שִׁחְרוּר גִּרְסָה' });
    const stopwords = mail('stopwords', { subject: 'RE: The meeting and the agenda' });
    const repeated = mail('repeated', { subject: 'release release release' });
    const anotherIssue = mail('another-issue', { subject: 'OPS-420 release' });
    const sameIssue = mail('same-issue', { subject: 'OPS-42 release' });
    const brief = build({ occurrence: { ...meeting, subject: 'The meeting and agenda: OPS-42 release checklist שחרור גרסה' },
      evidence: [release, hebrew, stopwords, repeated, anotherIssue, sameIssue] });
    expect(brief.threads.map(thread => thread.messages[0].id)).toEqual(['hebrew', 'release', 'same-issue']);
    expect(brief.threads.map(thread => thread.messages[0].reasons[0].facts)).toEqual([
      { terms: ['גרסה', 'שחרור'] }, { terms: ['checklist', 'release'] }, { terms: ['ops-42', 'release'] },
    ]);
  });

  it('orders manual, score, source time, and code-unit id deterministically without mutating input', () => {
    const evidence = Object.freeze([
      mail('a-tie'), mail('Z-tie'), mail('stale-time', { sourceTime: day('24') }),
      mail('top-score', { jiraKeys: [jiraKey], sourceTime: day('10') }),
      mail('manual', { subject: 'Unrelated', sourceTime: day('10') }),
    ]);
    const options = { evidence, manualEvidenceIds: ['manual'] };
    const brief = build(options);
    expect(brief.threads.map(thread => thread.messages[0].id)).toEqual(['manual', 'top-score', 'Z-tie', 'a-tie', 'stale-time']);
    expect(build({ ...options, evidence: [...evidence].reverse() })).toEqual(brief);
  });

  it('keeps five ranked groups keyed by connection, store and verified thread or scoped message', () => {
    const evidence = [
      mail('a-verified', { verifiedThreadId: 'thread', jiraKeys: [jiraKey] }),
      mail('z-in-first-group', { verifiedThreadId: 'thread', sourceTime: day('10') }),
      mail('b-other-store', { verifiedThreadId: 'thread', storeId: 'other' }),
      mail('c-other-connection', { verifiedThreadId: 'thread', connectionId: 'other' }),
      mail('d-fallback', { messageId: 'thread', attachmentNames: ['release.pdf'] }),
      mail('z-same-message', { messageId: 'thread', sourceTime: day('10') }),
      mail('e-fallback', { messageId: 'different-message' }),
      mail('f-another-fallback', { messageId: 'thread', storeId: 'third-store' }),
    ];
    const brief = build({ evidence });
    expect(brief.threads.map(group => group.messages.map(message => message.id))).toEqual([
      ['a-verified', 'z-in-first-group'], ['b-other-store'], ['c-other-connection'], ['d-fallback', 'z-same-message'], ['e-fallback'],
    ]);
    expect(brief.threads[3].messages[0]).toMatchObject({ attachmentNames: ['release.pdf'] });
  });

  it('caps attendee-only open work at three with the same score, time, and id order', () => {
    const action = (id: string, sourceTime = day('25'), open = true): HyperMeetingBriefEvidence => ({ ...source(id),
      kind: 'action', subject: 'Unrelated', verifiedIdentityIds: ['noa'], sourceTime, open, ownerAssigned: true });
    const brief = build({ evidence: [action('z'), action('a'), action('Z'), action('new', day('26')),
      action('old', day('20')), action('closed', day('26'), false),
      { ...action('related'), subject: meeting.subject }] });
    expect(brief.openWithAttendees.map(item => item.id)).toEqual(['new', 'Z', 'a']);
    expect(brief.openActions.map(item => item.id)).toEqual(['related']);
  });

  it('selects at most two readable prior occurrences in the verified store-scoped series and requires cited decisions', () => {
    const prior = (date: string, extra: Partial<HyperMeetingHistoryOccurrence> = {}): HyperMeetingHistoryOccurrence => ({
      ...meeting, key: { ...meeting.key, originalStart: day(date) }, interval: interval(date), ...extra,
    });
    const first = prior('13');
    const second = prior('20');
    const third = prior('06');
    const future = prior('28');
    const privateEvent = prior('24', { sensitivity: 'private' });
    const wrongStore = prior('24', { key: { ...meeting.key, originalStart: day('24'), storeId: 'other-store' } });
    const decision = (id: string, event: HyperMeetingHistoryOccurrence, excerpt = 'Approve the rollout.'): HyperMeetingBriefEvidence =>
      ({ ...source(id), kind: 'prior-decision', excerpt, priorOccurrenceKey: event.key, subject: 'Older decision' });
    const options = {
      history: [first, third, future, second, privateEvent, wrongStore], manualEvidenceIds: ['uncited', 'wrong-store'],
      evidence: [decision('first', first), decision('second', second), decision('third', third), decision('future', future),
        decision('private', privateEvent), decision('wrong-store', wrongStore), decision('uncited', first, '  '),
        decision('wrong-original', { ...first, key: { ...first.key, originalStart: day('14') } })],
    };
    const brief = build(options);
    expect(brief.priorDecisions.map(item => item.id)).toEqual(['first', 'second']);
    expect(brief.priorDecisions[0].reasons[0]).toEqual({ code: 'series-history', points: 35, facts: { start: day('13').iso, ageDays: 14 } });
    expect(build({ ...options, occurrence: { ...meeting, verifiedSeriesId: undefined } }).priorDecisions).toEqual([]);
  });

  it('projects related actions, due decisions, issues and open blockers', () => {
    const work = (id: string, kind: 'action' | 'decision' | 'issue' | 'blocker', open = true) =>
      ({ ...source(id), kind, open, ownerAssigned: true, due: day('28') });
    const brief = build({ evidence: [work('action', 'action'), work('decision', 'decision'), work('issue', 'issue'),
      work('blocker', 'blocker'), work('closed-action', 'action', false), work('closed-blocker', 'blocker', false),
      { ...work('other-owner', 'action'), ownerAssigned: false }, { ...work('no-deadline', 'decision'), due: undefined }] });
    expect(brief.openActions.map(item => item.id)).toEqual(['action']);
    expect(brief.decisionsDue.map(item => item.id)).toEqual(['decision']);
    expect(brief.relatedIssues.map(item => item.id)).toEqual(['issue']);
    expect(brief.blockers.map(item => item.id)).toEqual(['blocker']);
  });

  it('resolves only allowed, accessible documents and retains selected Newsletter summary excerpts', () => {
    const doc = (id: string, document: Extract<HyperMeetingBriefEvidence, { kind: 'document' }>['document'],
      extra: Partial<Extract<HyperMeetingBriefEvidence, { kind: 'document' }>> = {}): HyperMeetingBriefEvidence =>
      ({ ...source(id), kind: 'document', documentId: id === 'page' ? 'page:release' : id, document, ...extra });
    const brief = build({ manualEvidenceIds: ['blocked', 'linked-article', 'wrong-jira', 'wrong-connection', 'project'],
      evidence: [doc('page', { kind: 'hypertask-page' }), doc('blocked', { kind: 'hypertask-row' }, { accessible: false }),
        doc('unlinked', { kind: 'hypertask-page' }), doc('jira', { kind: 'jira', jiraKey }),
        doc('wrong-jira', { kind: 'jira', jiraKey: { ...jiraKey, instanceId: 'other' } }),
        doc('article', { kind: 'newsletter-article', connectionId: 'newsletter', ownerSelected: true }, { excerpt: 'Article summary excerpt' }),
        doc('linked-article', { kind: 'newsletter-article', connectionId: 'newsletter', ownerSelected: false }),
        doc('unselected', { kind: 'newsletter-article', connectionId: 'newsletter', ownerSelected: false }),
        doc('wrong-connection', { kind: 'newsletter-article', connectionId: 'other', ownerSelected: true }),
        doc('project', { kind: 'newsletter-project', connectionId: 'newsletter' })],
    });
    expect(brief.linkedDocuments.map(item => item.id)).toEqual(['linked-article', 'project', 'jira', 'page', 'article']);
    expect(brief.linkedDocuments.at(-1)?.excerpt).toBe('Article summary excerpt');
    expect(brief.openActions).toEqual([]);
    expect(build().linkedDocuments).toEqual([]);
  });
});

describe('meeting brief readiness, version and summary', () => {
  const block = interval('27', '11:00', '11:30');
  const complete = { id: 'prep', completion: 'complete' } as const;
  const open = { id: 'prep-open', completion: 'open' } as const;
  it.each([
    [{ ownerConfirmed: true, tasks: [open], blocks: [block] }, 'prepared'],
    [{ tasks: [complete], blocks: [block] }, 'prepared'],
    [{ tasks: [complete, open], blocks: [block] }, 'planned'],
    [{ tasks: [], blocks: [block] }, 'planned'],
    [{ tasks: [open] }, 'none'],
    [{ viewed: true }, 'none'],
    [{ blocks: [interval('27', '09:00', '09:30'), interval('28', '09:30', '10:30'), interval('27', '11:30', '11:30')] }, 'none'],
  ] satisfies [HyperMeetingPreparation, string][])('computes readiness from %j', (preparation, expected) => {
    expect(build({ preparation })).toMatchObject({ readiness: expected, viewed: 'viewed' in preparation });
  });

  it('changes version on a move, cancellation, eligibility loss or evidence revision and exposes refresh times', () => {
    const evidence = [mail('release')];
    const before = build({ evidence });
    const moved = build({ evidence, occurrence: { ...meeting, interval: interval('28', '12:00', '13:00') } });
    const cancelled = hyperBuildMeetingBrief({ ...base, evidence, occurrence: { ...meeting, cancelled: true } });
    const inaccessible = hyperBuildMeetingBrief({ ...base, evidence, occurrence: { ...meeting, accessible: false } });
    const revised = build({ evidence: [{ ...evidence[0], revision: 'r2' }] });
    expect(new Set([before, moved, cancelled, inaccessible, revised].map(brief => brief.briefVersion)).size).toBe(5);
    expect(build({ evidence, now: day('27', '11:00') }).briefVersion).toBe(before.briefVersion);
    expect(moved).toMatchObject({
      prewarmAt: instant('2026-11-27T12:00:00.000Z'), refreshAt: instant('2026-11-28T11:30:00.000Z'),
    });
    expect(cancelled.eligible).toBe(false);
    expect(inaccessible.eligible).toBe(false);
  });

  it('serializes only selected excerpts from the brief and ignores unavailable ids', () => {
    const evidence = [mail('a', { excerpt: 'Selected mail excerpt', attachmentNames: ['private.pdf'] }),
      mail('b', { excerpt: 'Other mail excerpt' }), mail('c'), mail('d'), mail('e'),
      mail('f', { excerpt: 'Beyond the cap' }), mail('x', { excerpt: 'No access', accessible: false })];
    expect(hyperBriefSummaryRequest(build({ evidence }), ['x', 'a', 'a', 'c', 'f', meeting.id, 'unknown'])).toEqual({
      source: 'hyper-meeting-brief', untrusted_data: [{ id: meeting.id, excerpt: meeting.excerpt }, { id: 'a', excerpt: 'Selected mail excerpt' }],
    });
  });
});
