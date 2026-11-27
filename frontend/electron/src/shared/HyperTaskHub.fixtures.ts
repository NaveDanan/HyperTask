import { hyperPlanDay, type HyperHubAvailability } from './HyperDayPlanner';
import { hyperRankTasks } from './HyperPriorityEngine';
import type {
  HyperHubAgendaItem, HyperHubCivilDate, HyperHubConnectionStatus, HyperHubDay, HyperHubDependency, HyperHubInstant, HyperHubPerson,
  HyperHubWriteView, HyperHubRanked, HyperHubRankReason, HyperHubSnapshot, HyperHubSourceRef, HyperHubState, HyperHubTaskView,
} from './HyperTaskHub';

const zone = 'Asia/Jerusalem';
const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const civil = (date: string): HyperHubCivilDate => ({ kind: 'civil-date', date, zone });
const clock = instant('2026-11-29T09:00:00+02:00'); // Sunday, start of the selected working week
const twoWeeksAgo = instant('2026-11-15T09:00:00+02:00');
const yesterday = instant('2026-11-28T16:00:00+02:00');
const owner: HyperHubPerson = { id: 'yael', name: 'יעל כהן', role: 'assignee' };
const taskId = (n: number) => '71b1b822-1e1b-428a-9bbc-' + String(n).padStart(12, '0');

function connection(
  connectionId: string, kind: HyperHubConnectionStatus['kind'], label: string,
  status: HyperHubConnectionStatus['status'], lastSuccess: HyperHubInstant | null,
  completeness: 'complete' | 'partial', queryId: string,
): HyperHubConnectionStatus {
  return { connectionId, kind, label, status, lastSuccess, coverage: [{ connectionId, queryId, completeness, lastSuccess }] };
}
const jira = connection('jira-eng', 'jira', 'Jira · Engineering', 'fresh', clock, 'complete', 'assigned-or-reported:ENG');
const project = connection('project-release', 'hypertask', 'HyperTask · Release board', 'partial', clock, 'partial', 'release-rows');
const archive = connection('project-docs', 'hypertask', 'HyperTask · Documentation', 'stale', yesterday, 'complete', 'docs-rows');
const support = connection('jira-ops', 'jira', 'Jira · Operations', 'error', yesterday, 'partial', 'assigned-or-reported:OPS');

function ref(n: number, source: HyperHubConnectionStatus, label: string, role: HyperHubSourceRef['role'] = 'origin'): HyperHubSourceRef {
  return {
    evidenceId: 'evidence-' + n, handle: 'opaque-r8-' + n, connectionId: source.connectionId,
    kind: source.kind, role, label, openable: true, stale: source.status === 'stale' || source.status === 'error',
  };
}
const mirror = ref(101, project, 'Hyper-Kanban · Release', 'mirror');
const migration = ref(1, jira, 'ENG-317');
const edge: HyperHubDependency = {
  predecessorId: taskId(1), successorId: taskId(2), verified: true, resolvedByOwner: false,
  provenance: { kind: 'source', evidenceId: migration.evidenceId },
};
function task(
  n: number, title: string, state: HyperHubState, source: HyperHubSourceRef, rawStatus: string,
  overrides: Partial<HyperHubTaskView> = {},
): HyperHubTaskView {
  return {
    id: taskId(n), title, state, stateChangedAt: clock, firstSeenAt: twoWeeksAgo,
    authoritativeCompletion: 'open', sources: [source],
    sourceStatus: { [source.evidenceId]: { rawStatus, completion: 'open' } },
    projectId: source.connectionId === jira.connectionId ? 'ENG' : source.connectionId === support.connectionId ? 'OPS' : source.connectionId,
    people: [owner], meetingIds: [], blocks: [], blockedBy: [],
    effortMinutes: 30, effortIsEstimate: false, pinned: false, ...overrides,
  };
}

const tasks = [
  task(1, 'אישור migration של טבלת הלקוחות', 'doing', migration, 'In Progress', {
    sources: [migration, mirror], sourceStatus: {
      [migration.evidenceId]: { rawStatus: 'In Progress', completion: 'open' },
      [mirror.evidenceId]: { rawStatus: 'Next', completion: 'open' },
    },
    due: civil('2026-11-26'), blocks: [edge], effortMinutes: 60,
    fieldOrigins: { due: edge.provenance, effortMinutes: edge.provenance },
    sourcePriority: { priorityId: 'high', mapped: 2, evidenceId: migration.evidenceId },
  }),
  task(2, 'Verify customer import on staging', 'ready', ref(2, jira, 'ENG-319'), 'To Do', {
    blockedBy: [edge], due: civil('2026-11-30'), effortMinutes: 45,
  }),
  task(3, 'לפרסם את סיכום הגרסה', 'ready', ref(3, project, 'Release notes'), 'Draft', {
    pinned: true, manualOrder: 0, ownerPriority: 3, planned: civil('2026-11-29'),
    fieldOrigins: { planned: { kind: 'owner' } },
  }),
  task(4, 'Investigate intermittent VPN disconnects', 'waiting', ref(4, support, 'OPS-88'), 'Investigating', {
    people: [{ ...owner, role: 'reporter' }, { id: 'amir', name: 'Amir Levi', role: 'assignee' }],
  }),
  task(5, 'בדיקת נגישות למסך החיפוש', 'ready', ref(5, project, 'Accessibility checklist'), 'Next', {
    effortMinutes: 45, effortIsEstimate: true, due: civil('2026-12-02'),
  }),
  task(6, 'Confirm RTL examples with Design', 'review', ref(6, project, 'Design handoff'), 'Needs triage'),
  task(7, 'Update the support rotation', 'done', ref(7, jira, 'ENG-301'), 'To Do'),
  task(8, 'Retire the old screenshot checklist', 'dismissed', ref(8, archive, 'Screenshots'), 'Backlog'),
  task(9, 'לעדכן את מדריך ההתקנה', 'doing', ref(9, archive, 'Installation guide'), 'Editing', {
    effortMinutes: 90, ownerPriority: 1,
  }),
  task(10, 'Review API timeout defaults', 'ready', ref(10, jira, 'ENG-335'), 'Open', {
    snoozeUntil: instant('2026-11-30T09:00:00+02:00'),
  }),
  task(11, 'בדיקת הרשאות לקבוצת QA', 'waiting', ref(11, project, 'QA permissions'), 'Awaiting approval'),
  task(12, 'Publish the smoke-test results', 'done', ref(12, project, 'Smoke tests'), 'Published', {
    authoritativeCompletion: 'complete', sourceStatus: { 'evidence-12': { rawStatus: 'Published', completion: 'complete' } },
  }),
] satisfies HyperHubTaskView[];

// Golden inputs at the fixture clock. Every action was first seen exactly 14 days ago.
// No availability source is enabled in M1, so only the expired deadline has known urgency.
function ranked(t: HyperHubTaskView): HyperHubRanked {
  const reasons: HyperHubRankReason[] = [];
  const unknown: HyperHubRanked['unknown'] = [];
  const urgency = t.id === edge.predecessorId ? 1 : 0;
  if (urgency) reasons.push({ signal: 'slack', points: 45, facts: { deadline: '2026-11-27T00:00:00+02:00' }, evidenceId: migration.evidenceId });
  else unknown.push('slack');

  const priority = t.ownerPriority ?? t.sourcePriority?.mapped;
  const importance = priority === undefined ? 0 : [0, 0.33, 0.67, 1][priority];
  if (priority === undefined) unknown.push('importance');
  else reasons.push({
    signal: 'importance', points: 25 * importance, facts: { priority, origin: t.ownerPriority === undefined ? 'jira' : 'owner' },
    ...(t.ownerPriority === undefined && { evidenceId: t.sourcePriority?.evidenceId }),
  });
  reasons.push({ signal: 'unblocking', points: 4 * t.blocks.length, facts: { verifiedOpenSuccessors: t.blocks.length } });
  reasons.push({ signal: 'age', points: 5, facts: { daysSinceCreatedOrFirstSeen: 14 } });
  const scoreCents = Math.round(100 * reasons.reduce((sum, reason) => sum + reason.points, 0));
  let feasibility: HyperHubRanked['feasibility'] = { ready: true };
  if (t.blockedBy.length) feasibility = { ready: false, code: 'waiting', facts: { predecessorId: edge.predecessorId } };
  else if (t.snoozeUntil) feasibility = { ready: false, code: 'waiting', facts: { until: t.snoozeUntil.iso } };
  else if (t.state !== 'ready' && t.state !== 'doing') feasibility = { ready: false, code: 'waiting', facts: { state: t.state } };
  return { taskId: t.id, score: scoreCents / 100, scoreCents, urgency, importance, reasons, unknown, pinned: t.pinned, feasibility };
}

export const HyperHubM1Fixture: HyperHubSnapshot = {
  scopeGeneration: 3, revision: 8, asOf: clock, tasks,
  // Stable sort preserves the UUID ordering of the input for tied scores.
  ranking: tasks.map(ranked).sort((a, b) => b.scoreCents - a.scoreCents),
  sources: [jira, project, archive, support],
  settings: { setupComplete: true, zone, workdays: [0, 1, 2, 3, 4], weights: { slack: 45, importance: 25, unblocking: 20, age: 10 } },
};
export const HyperHubEmptyFixture: HyperHubSnapshot = {
  ...HyperHubM1Fixture, revision: 9, tasks: [], ranking: [], sources: [jira],
};
export const HyperHubNothingConnectedFixture: HyperHubSnapshot = {
  ...HyperHubEmptyFixture, scopeGeneration: 4, revision: 0,
  sources: [jira, project].map(source => ({ ...source, status: 'unconfigured', lastSuccess: null, coverage: [] })),
  settings: { ...HyperHubEmptyFixture.settings, setupComplete: false },
};

const fixtureDay = civil('2026-11-29');
function windowOnFixtureDay(start: string, end: string) {
  const at = (time: string) => instant(`${fixtureDay.date}T${time}:00+02:00`);
  return { start: at(start), end: at(end) };
}

const calendarOccurrences: (HyperHubAgendaItem & { declined?: boolean })[] = [
  { id: 'release-sync', title: 'Release sync', interval: windowOnFixtureDay('10:00', '10:30'),
    availability: 'busy', sourceKind: 'outlook-calendar', private: false, allDay: false,
    isMeeting: true, organizerIsOwner: true, handle: 'opaque-r8-sync' },
  { id: 'interval-24', interval: windowOnFixtureDay('11:00', '11:45'), availability: 'busy',
    sourceKind: 'outlook-calendar', private: true, allDay: false, isMeeting: false },
  { id: 'design-review', title: 'Design review', interval: windowOnFixtureDay('14:00', '14:45'),
    availability: 'busy', sourceKind: 'outlook-calendar', private: false, allDay: false,
    isMeeting: true, organizerIsOwner: false, handle: 'opaque-r8-review' },
  { id: 'editorial-hold', title: 'Editorial hold', interval: windowOnFixtureDay('15:30', '16:00'),
    availability: 'tentative', sourceKind: 'outlook-calendar', private: false, allDay: false, isMeeting: false },
  { id: 'declined-invitation', interval: windowOnFixtureDay('09:00', '09:30'), declined: true,
    availability: 'busy', sourceKind: 'outlook-calendar', private: false, allDay: false, isMeeting: true },
];
const agenda: HyperHubAgendaItem[] = calendarOccurrences.filter(event => !event.declined);

const newsletter = connection('newsletter', 'newsletter-task', 'Newsletter Gantt', 'fresh', clock, 'complete', 'editorial-plan');
const proof = ref(13, newsletter, 'Sunday edition · Final proof');
const proofEdge: HyperHubDependency = {
  predecessorId: taskId(14), successorId: taskId(13), verified: true, resolvedByOwner: false,
  provenance: { kind: 'source', evidenceId: proof.evidenceId },
};
const m2Tasks = [
  ...tasks,
  task(13, 'Proof the Sunday newsletter', 'ready', proof, 'Assigned', {
    projectId: 'sunday-edition', blockedBy: [proofEdge], due: fixtureDay, effortMinutes: 30,
    fieldOrigins: { due: proofEdge.provenance, effortMinutes: proofEdge.provenance },
  }),
  task(14, 'Assemble the Sunday newsletter', 'doing', ref(14, newsletter, 'Sunday edition · Layout'), 'In progress', {
    projectId: 'sunday-edition', blocks: [proofEdge], effortMinutes: 30,
  }),
];

function m2Fixture(outlookAvailability: boolean) {
  const settings = {
    ...HyperHubM1Fixture.settings, hours: { start: '09:00', end: '18:00' },
    breaks: [{ start: '13:00', end: '13:30' }], outlookAvailability,
  };
  const readInterval = windowOnFixtureDay('09:00', '16:30');
  const ownerWindow = windowOnFixtureDay('16:30', '18:00');
  const day: HyperHubDay = {
    date: fixtureDay,
    working: [windowOnFixtureDay('09:00', '13:00'), windowOnFixtureDay('13:30', '18:00')],
    coverage: outlookAvailability
      ? [{ interval: readInterval, basis: 'complete' }, { interval: ownerWindow, basis: 'owner' }]
      : [{ interval: windowOnFixtureDay('09:00', '18:00'), basis: 'missing' }],
    ownerWindows: outlookAvailability ? [ownerWindow] : [],
  };
  const events = outlookAvailability ? agenda : [];
  const outlook: HyperHubConnectionStatus = {
    connectionId: 'outlook', kind: 'outlook-calendar', label: 'Outlook calendar',
    status: outlookAvailability ? 'fresh' : 'unconfigured', lastSuccess: outlookAvailability ? clock : null,
    coverage: outlookAvailability ? [{ connectionId: 'outlook', queryId: 'calendar', interval: readInterval,
      completeness: 'complete', lastSuccess: clock }] : [],
  };
  const availability: HyperHubAvailability = {
    zone, workdays: settings.workdays, hours: settings.hours, breaks: settings.breaks, ownerWindows: day.ownerWindows,
    sources: outlookAvailability ? [{
      complete: [{ interval: readInterval, asOf: clock }],
      busy: events.map(event => ({
        ...event.interval, status: event.availability === 'oof' ? 'out-of-office' : event.availability,
        ...(event.isMeeting && !event.private && { meetingId: event.id }),
      })),
    }] : [],
  };
  const input = { tasks: m2Tasks, nowMs: Date.parse(clock.iso), availability };
  const ranking = hyperRankTasks({ ...input, weights: settings.weights });
  return {
    ...HyperHubM1Fixture, tasks: m2Tasks, settings, day, agenda: events, ranking,
    sources: [...HyperHubM1Fixture.sources, newsletter, outlook],
    plan: hyperPlanDay({ ...input, ranking }),
  } satisfies HyperHubSnapshot;
}

export const HyperHubM2Fixture = m2Fixture(true);
export const HyperHubM2NoAvailabilityFixture = m2Fixture(false);

const mailbox = connection('outlook-mail', 'outlook-mail', 'Outlook mail', 'fresh', clock, 'complete', 'inbox');
const assignments = [
  { excerpt: 'Yael, please review ENG-317 tomorrow.', cohort: 'en', message: 'release', start: 0 },
  { excerpt: 'יעל, נא לאשר את המועד.', cohort: 'he', message: 'release', start: 'Yael, please review ENG-317 tomorrow.\n'.length },
  { excerpt: 'יעל, נא לשלוח את קובץ ה-QA מחר.', cohort: 'mixed', message: 'qa', start: 0 },
  { excerpt: 'יעל, נא לאשר את תאריך ההשקה.', cohort: 'he', message: 'schedule', start: 0 },
] as const;
const triage = assignments.map(({ excerpt, cohort, message, start }, i) => {
  const source = ref(20 + i, mailbox, message);
  const due = i === 0 || i === 2 ? civil('2026-11-30') : undefined;
  return task(20 + i, excerpt, i === 1 ? 'dismissed' : 'review', source, 'Received', {
    due, createdAt: clock, sourceStatus: { [source.evidenceId]: { rawStatus: 'Received', completion: 'unknown' },
      ...(i === 0 && { [migration.evidenceId]: { rawStatus: 'In Progress', completion: 'open' } }) }, authoritativeCompletion: 'unknown', sources: i === 0 ? [source, { ...migration, role: 'mentions' }] : [source],
    reviewSpan: { evidenceId: source.evidenceId, excerpt, start, end: start + excerpt.length, rule: 'Request addressed to you',
      confidence: 0.95, inferredOwner: owner.name, resolvedDate: due, cohort, fingerprint: message + '-' + i },
  });
});
const m3Tasks = [...m2Tasks.map(t => t.id === taskId(2) ? { ...t, createdAt: yesterday } : t), ...triage];
const movedAgenda = HyperHubM2Fixture.agenda.map(e => e.id === 'release-sync' ? { ...e, interval: windowOnFixtureDay('10:30', '11:00') } : e);
const m3Availability = {
  zone, workdays: HyperHubM2Fixture.settings.workdays, hours: HyperHubM2Fixture.settings.hours,
  breaks: HyperHubM2Fixture.settings.breaks, ownerWindows: HyperHubM2Fixture.day.ownerWindows,
  sources: [{ complete: [{ interval: windowOnFixtureDay('09:00', '16:30'), asOf: clock }],
    busy: movedAgenda.map(e => ({ ...e.interval, status: e.availability === 'oof' ? 'out-of-office' as const : e.availability })) }],
};
const m3Input = { tasks: m3Tasks, availability: m3Availability, nowMs: Date.parse(clock.iso) };
const m3Ranking = hyperRankTasks({ ...m3Input, weights: HyperHubM2Fixture.settings.weights });
export const HyperHubM3Fixture: HyperHubSnapshot = {
  ...HyperHubM2Fixture, tasks: m3Tasks, ranking: m3Ranking, plan: hyperPlanDay({ ...m3Input, ranking: m3Ranking }), sources: [...HyperHubM2Fixture.sources, mailbox],
  agenda: movedAgenda,
  settings: { ...HyperHubM2Fixture.settings, cohortPrecision: {
    en: { accepted: 0, dismissed: 0, preview: true }, he: { accepted: 0, dismissed: 1, preview: true },
    mixed: { accepted: 0, dismissed: 0, preview: true },
  } },
  linkSuggestions: [{ targetId: taskId(20), otherTaskId: taskId(2), facts: ['Same owner', 'Within seven days', 'Same deadline'] }],
};

function m5Fixture(): HyperHubSnapshot {
  const today = (time: string) => instant(fixtureDay.date + 'T' + time + ':00+02:00');
  const writable = (n: number, source = jira, label = 'ENG-' + n) =>
    ({ ...ref(n, source, label), statusWrite: { available: true } });
  const held = (n: number) => ({ ...writable(n), statusWrite: { available: false, code: 'held' as const } });
  const cycleEdge = (from: number, to: number): HyperHubDependency => ({
    predecessorId: taskId(from), successorId: taskId(to), verified: true, resolvedByOwner: false,
    provenance: { kind: 'source', evidenceId: 'evidence-' + to },
  });
  const handoff = cycleEdge(31, 32), forward = cycleEdge(43, 44), back = cycleEdge(44, 43);
  const cards = [
    task(30, 'Approve the Hebrew release notes', 'done', writable(30), 'In Review', { sourceStatus: { [writable(30).evidenceId]: { rawStatus: 'In Review', category: 'indeterminate', completion: 'open' } } }),
    task(31, 'בדיקת קישורי ההפצה', 'doing', writable(31, newsletter, 'November edition · links'), 'in-progress', {
      schedule: { start: today('09:00'), end: today('10:00'), provenance: { kind: 'source', evidenceId: 'evidence-31' } },
      ownerPriority: 3, due: today('10:00'), blocks: [handoff], mirror: { exists: false, eligible: true },
    }),
    task(32, 'Send proofs to the translators', 'ready', writable(32), 'Open', {
      blockedBy: [handoff], ownerPriority: 0, due: today('10:30'),
    }),
    task(33, 'Review contrast in the email template', 'ready', writable(33), 'Open', {
      ownerPriority: 3, due: today('18:00'), sources: [writable(33), mirror], mirror: { exists: true, handle: mirror.handle },
    }),
    task(34, 'עדכון רשימת התפוצה', 'ready', writable(34), 'Open', { ownerPriority: 0, due: today('18:00') }),
    task(35, 'Estimate RTL test coverage', 'ready', writable(35), 'Open', {
      ownerPriority: 2, due: today('16:00'), effortMinutes: 45, effortIsEstimate: true,
    }),
    task(36, 'Confirm partner sign-off', 'ready', writable(36), 'Open', { due: today('11:00') }),
    task(37, 'Wait for the layout proof', 'waiting', held(37), 'In Review', { ownerPriority: 2, due: today('11:00') }),
    task(38, 'אישור הגרסה הסופית', 'waiting', held(38), 'In Review'),
    task(39, 'Check the print export', 'waiting', { ...ref(39, newsletter, 'November edition · export', 'assignment'),
      statusWrite: { available: false, code: 'held' } }, 'pending'),
    task(40, 'Update the delivery checklist', 'ready', writable(40), 'Open', { planned: civil('2026-12-02') }),
    task(41, 'Archive approved artwork', 'done', writable(41), 'Done', {
      authoritativeCompletion: 'complete', sourceStatus: { 'evidence-41': { rawStatus: 'Done', completion: 'complete' } },
    }),
    task(42, 'גיליון נובמבר', 'waiting', { ...ref(42, newsletter, 'November edition'),
      statusWrite: { available: false, code: 'not-leaf' } }, 'in-progress'),
    task(43, 'Resolve caption dependency', 'ready', writable(43), 'Open', { blocks: [forward], blockedBy: [back] }),
    task(44, 'Resolve layout dependency', 'ready', writable(44), 'Open', { blocks: [back], blockedBy: [forward] }),
    task(45, 'Check image attribution', 'ready', writable(45), 'Open', { ownerPriority: 1 }),
    task(46, 'Normalize print filenames', 'ready', writable(46), 'Open', { ownerPriority: 0 }),
    task(47, 'Verify the cover credit', 'ready', writable(47), 'Open', { due: today('13:00') }),
    task(48, 'בדיקת כותרת המשנה', 'ready', writable(48), 'Open', { ownerPriority: 2 }),
    task(49, 'Verify the acknowledged release', 'waiting', held(49), 'In Review'),
  ];
  const receipt = (n: number, state: HyperHubWriteView['state'], fields: Partial<HyperHubWriteView>): HyperHubWriteView => ({
    operationId: 'op-' + n, taskId: taskId(n), evidenceId: 'evidence-' + n, source: 'jira', state,
    at: today('08:58'), fromName: 'In Review', toName: 'Done', held: false, undoAvailable: false,
    ownerReleaseAvailable: false, readback: 'pending', ...fields,
  });
  const dates = ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
  const at = (i: number, time: string) => instant(dates[i] + 'T' + time + ':00+02:00');
  const coverage = dates.slice(0, 7).map((_, i) => ({
    connectionId: 'outlook', queryId: 'calendar', interval: { start: i === 0 ? clock : at(i, '00:00'), end: at(i + 1, '00:00') },
    completeness: i === 3 ? 'partial' as const : 'complete' as const, lastSuccess: clock,
  }));
  const meeting = (i: number, title: string, readiness: 'planned' | 'prepared' | 'none', viewed = false): HyperHubAgendaItem => ({
    id: 'editorial-' + i, title, interval: { start: at(i, '10:00'), end: at(i, '10:30') },
    private: false, sourceKind: 'outlook-calendar', allDay: false, isMeeting: true, availability: 'busy',
    handle: 'fixture-meeting-' + i, meeting: { verifiedEligible: true, readiness, viewed,
      joinUrl: 'https://meet.example.test/editorial-' + i },
  });
  const agenda = [meeting(0, 'Editorial stand-up', 'prepared', true), calendarOccurrences[1],
    meeting(1, 'בדיקת הגהות', 'planned'), meeting(3, 'Print review', 'none'), meeting(6, 'סיכום שבועי', 'none')];
  const input = { tasks: cards, nowMs: Date.parse(clock.iso), availability: { ...m3Availability, sources: [{
    complete: m3Availability.sources[0].complete, busy: agenda.map(e => ({ ...e.interval, status: 'busy' as const })),
  }] } };
  const ranking = hyperRankTasks({ ...input, weights: HyperHubM3Fixture.settings.weights });
  return { ...HyperHubM2Fixture, tasks: cards, ranking, plan: hyperPlanDay({ ...input, ranking }), agenda,
    cycleTaskIds: [taskId(43), taskId(44)], matrixOverrides: { [taskId(40)]: 'important' },
    meetingWindow: { requested: { start: clock, end: at(7, '00:00') }, coverage },
    settings: { ...HyperHubM2Fixture.settings, writeBack: {
      jira: { enabled: true, available: true }, newsletter: { enabled: true, available: true },
    } },
    writes: [
      receipt(37, 'pending', { held: true }),
      receipt(38, 'unknown', { held: true, ownerReleaseAvailable: true, earliestReconcileAt: today('08:59'),
        observedName: 'In Review', readback: 'verified' }),
      receipt(39, 'unknown', { held: true, source: 'newsletter', fromName: 'pending', toName: 'completed', readback: 'failed', earliestReconcileAt: today('08:59') }),
      receipt(40, 'failed', { fromName: 'Open', code: 'rejected', readback: 'failed' }),
      receipt(41, 'succeeded', { observedName: 'Done', readback: 'verified', undoAvailable: true }),
      receipt(49, 'succeeded', { held: true, readback: 'failed' }),
    ],
  };
}

export const HyperHubM5Fixture = m5Fixture();
