import { z } from 'zod';

/** Instants on the wire are ISO 8601 with a UTC offset. Civil deadlines end at the next local midnight. */
export type HyperHubInstant = { kind: 'instant'; iso: string };
export type HyperHubCivilDate = { kind: 'civil-date'; date: string; zone: string };
export type HyperHubDate = HyperHubCivilDate | HyperHubInstant;
export interface HyperHubInterval { start: HyperHubInstant; end: HyperHubInstant }

export interface HyperHubMeetingAgendaDetails {
  verifiedEligible: true;
  joinUrl?: string;
  readiness: import('./HyperMeetingBrief').HyperMeetingReadiness;
  viewed: boolean;
}

/** Cancelled and declined occurrences are omitted before projection. */
export type HyperHubAgendaItem = {
  id: string;
  interval: HyperHubInterval;
  allDay: boolean;
  availability: 'busy' | 'tentative' | 'oof' | 'free' | 'working-elsewhere';
  sourceKind: 'outlook-calendar' | 'hypertask';
} & (
  // Sensitive and unclassified occurrences expose only the interval that reserves time.
  | { private: true; meeting?: never; title?: never; handle?: never; isMeeting: false; organizerIsOwner?: never }
  | { private: false; meeting?: HyperHubMeetingAgendaDetails; title?: string; handle?: string; isMeeting: boolean; organizerIsOwner?: boolean }
);

export interface HyperHubDay {
  date: HyperHubCivilDate;
  working: HyperHubInterval[];
  /** Combined coverage across all enabled availability sources. */
  coverage: { interval: HyperHubInterval; basis: 'complete' | 'stale-complete' | 'owner' | 'missing' }[];
  ownerWindows: HyperHubInterval[];
}

export interface HyperHubReadScope {
  accountId: string;
  workspaceId: string;
  connectionId: string;
  generation: number;
}

/** Always indexed within the connector account and active partition. Mutable navigation aliases live outside the key. */
export type HyperHubNativeKey =
  | { kind: 'jira'; instanceId: string; issueId: string } // decimal issue id, never the display key
  | { kind: 'hypertask'; workspaceId: string; pageId: string; databaseId?: never; rowId?: never }
  | { kind: 'hypertask'; workspaceId: string; databaseId: string; rowId: string }
  | { kind: 'newsletter-task'; connectionId: string; projectId: string; taskId?: string }
  | { kind: 'newsletter-article'; connectionId: string; articleId: string }
  | { kind: 'outlook-mail'; storeId: string; entryId: string; actionSpan?: string }
  | { kind: 'outlook-calendar'; storeId: string; occurrenceId: string; originalStart: HyperHubDate };

export type HyperHubSourceKind = HyperHubNativeKey['kind'];
export type HyperHubObservationRole = 'origin' | 'mirror' | 'mentions' | 'assignment';
/** Main derives these targets from identity and trusted connector configuration. */
export type HyperHubOpenTarget =
  | (Extract<HyperHubNativeKey, { kind: 'hypertask' }> & { viewId: string })
  | Exclude<HyperHubNativeKey, { kind: 'hypertask' }>;

export type HyperHubState = 'review' | 'ready' | 'doing' | 'waiting' | 'done' | 'dismissed';
export type HyperHubCompletion = 'open' | 'complete' | 'unknown';
export interface HyperHubSourceStatus {
  category?: HyperHubStatusCategory;
  rawStatus?: string;
  completion: HyperHubCompletion;
}

export interface HyperHubObservation extends HyperHubSourceStatus {
  id: string;
  scope: HyperHubReadScope;
  key: HyperHubNativeKey;
  revision: string;
  observedAt: HyperHubInstant;
  role: HyperHubObservationRole;
  openTarget?: HyperHubOpenTarget;
  title?: string;
  due?: HyperHubDate;
  planned?: HyperHubDate;
  effortMinutes?: number;
  priorityId?: string;
}

export type HyperHubProvenance = { kind: 'owner' } | { kind: 'source'; evidenceId: string };
export interface HyperHubDependency {
  predecessorId: string;
  successorId: string;
  provenance: HyperHubProvenance;
  verified: boolean;
  resolvedByOwner: boolean;
}
/** Personal ledger record. Source field values and statuses survive independently in observations. */
export interface HyperHubAction {
  id: string; // durable local UUID
  state: HyperHubState;
  firstSeenAt: HyperHubInstant;
  stateChangedAt: HyperHubInstant;
  evidenceIds: string[];
  authority: HyperHubProvenance;
  authoritativeCompletion: HyperHubCompletion;
  titleOverride?: string;
  personalDue?: HyperHubDate;
  personalPlanned?: HyperHubDate;
  personalEffortMinutes?: number;
  ownerPriority?: HyperHubPriority;
  pinned: boolean;
  snoozeUntil?: HyperHubInstant;
  manualOrder?: number;
  fixedBlocks?: HyperHubInterval[];
}

export type HyperHubWriteSource = 'jira' | 'newsletter';
export type HyperHubStatusIntent =
  | { kind: 'state'; state: 'ready' | 'doing' | 'done' }   // from a toast offer or chip
  | { kind: 'choose' }                                      // from the card menu
  | { kind: 'reverse'; operationId: string };               // source Undo
export type HyperHubStatusCategory = 'new' | 'indeterminate' | 'done' | 'unknown';
export type HyperHubStatusEffect =
  | { code: 'progress-set'; from: number | null; to: 100 }      // Newsletter completed
  | { code: 'progress-kept'; value: number }                     // leaving completed: progress stays
  | { code: 'parent-rollup' }                                    // Newsletter may recompute parents
  | { code: 'chart-normalized' }                                 // Newsletter normalizes and reschedules the chart
  | { code: 'resolution-set'; valueName: string }                // Jira exception, after a choice
  | { code: 'any-status-transition' }                            // Jira global transition: can apply after an intervening status change
  | { code: 'workflow-effects' };                                // Jira post-functions may do more
export interface HyperHubStatusCandidate {
  candidateId: string;
  actionLabel: string;              // Jira workflow action name, or the Newsletter status label
  to: { id: string; name: string; category: HyperHubStatusCategory };
  preselected: boolean;
  resolution?: { values: { id: string; name: string }[] };   // present only when required (E1.5)
  effects: HyperHubStatusEffect[];
}
export interface HyperHubStatusUnavailable { actionLabel: string; toName: string; reason: 'required-fields' | 'metadata' | 'self'; fields?: string[] }
export interface HyperHubStatusPreview {
  previewId: string; expiresAt: HyperHubInstant;       // single use, 60 s
  source: HyperHubWriteSource; site: string;
  accountLabel: string;   // Jira: the verified principal from /myself; Newsletter: "Configured Newsletter connection"
  target: { key?: string; title: string; container?: string };   // bounded plain text; Newsletter: container = project, key = task id
  current: { id: string; name: string; category: HyperHubStatusCategory; progress?: number | null };
  versionLabel: string;                                   // e.g. Jira `updated` or project `updated`
  candidates: HyperHubStatusCandidate[]; unavailable: HyperHubStatusUnavailable[];
  permissionCheckedOnConfirm: boolean;                    // Newsletter: true
}
export type HyperHubStatusRejectCode = 'disabled' | 'offline' | 'forbidden' | 'reconnect' | 'not-found' | 'not-leaf'
  | 'unsupported' | 'held' | 'no-actions' | 'scope-changed' | 'revision-conflict' | 'invalid'
  | 'access-denied' | 'unavailable';   // IPC guard failures are mapped into these unions, never a bare { ok: false }
export type HyperHubStatusPreviewResult = HyperHubVersion & ({ ok: true; preview: HyperHubStatusPreview } | { ok: false; code: HyperHubStatusRejectCode });
export type HyperHubStatusApproveResult = HyperHubVersion & (
  | { outcome: 'cancelled' } | { outcome: 'expired' }
  | { outcome: 'succeeded'; write: HyperHubWriteView }
  | { outcome: 'conflict'; preview: HyperHubStatusPreview }      // fresh preview with the new values
  | { outcome: 'failed'; code: HyperHubStatusRejectCode | 'rejected'; write?: HyperHubWriteView }
  | { outcome: 'unknown'; write: HyperHubWriteView });
export interface HyperHubWriteView {
  operationId: string; taskId: string; evidenceId: string; source: HyperHubWriteSource;
  state: 'pending' | 'succeeded' | 'failed' | 'unknown';
  at: HyperHubInstant; fromName: string; toName: string; observedName?: string; code?: string;
  undoAvailable: boolean;
  held: boolean;
  ownerReleaseAvailable: boolean;
  readback: 'pending' | 'verified' | 'failed';
  earliestReconcileAt?: HyperHubInstant;
  ownerReleasedAt?: HyperHubInstant; // planning resumes, further writes still require reconciliation
}

export type HyperHubReleaseHoldResult = HyperHubVersion & (
  | { ok: true; write: HyperHubWriteView }
  | { ok: false; code: HyperHubStatusRejectCode }
);
export type HyperHubMatrixQuadrant = 'urgent-important' | 'important' | 'urgent' | 'neither';
export type HyperHubWeights = Record<HyperHubSignal, number>;
export interface HyperHubWeightsDiffRow {
  taskId: string;
  oldPosition: number; newPosition: number; // one-based
  oldScoreCents: number; newScoreCents: number;
  signalDeltaCents: Record<HyperHubSignal, number>;
}
export interface HyperHubWeightsDiff {
  rows: HyperHubWeightsDiffRow[];
  topTen: HyperHubWeightsDiffRow[];
  movedCount: number;
}
export type HyperHubWeightsPreviewResult = HyperHubVersion & (
  | { ok: true; seq: number; diff: HyperHubWeightsDiff }
  | { ok: false; code: HyperHubRejectCode }
);
export interface HyperHubMirrorPreview {
  token: string; destination: string; audience: string; title: string; link: string;
}
export type HyperHubMirrorPreviewResult = HyperHubVersion & (
  | { ok: true; preview: HyperHubMirrorPreview }
  | { ok: false; code: HyperHubRejectCode }
);
export type HyperHubMirrorApplyResult = HyperHubVersion & (
  | { ok: true; handle: string }
  | { ok: false; code: HyperHubRejectCode }
);
export interface HyperHubSourceRef {
  statusWrite?: { available: boolean; code?: HyperHubStatusRejectCode };
  evidenceId: string;
  connectionId: string;
  kind: HyperHubSourceKind;
  role: HyperHubObservationRole;
  label: string;
  /** Opaque token main binds to this evidence, scope generation and snapshot revision. */
  handle: string;
  /** Each name cites this parent source through its handle. */
  attachmentNames?: string[];
  openable: boolean;
  stale: boolean;
}
export interface HyperHubPerson {
  id: string;
  name: string;
  role: 'owner' | 'assignee' | 'reporter' | 'requester' | 'participant';
}
export type HyperHubLanguageCohort = 'en' | 'he' | 'mixed';
export const HyperHubPrecisionGate = 0.90;
export function hyperHubCohortIsPreview(accepted: number, dismissed: number, fixturePrecision: number) {
  const reviewed = accepted + dismissed;
  return reviewed < 20 || accepted / reviewed < HyperHubPrecisionGate || fixturePrecision < HyperHubPrecisionGate;
}
export interface HyperHubCohortPrecision { accepted: number; dismissed: number; preview: boolean }
export interface HyperHubReviewSpan {
  excerpt: string; rule: string; confidence: number; evidenceId: string;
  /** Half-open UTF-16 offsets into the original plain-text message. */
  start?: number; end?: number; inferredOwner?: string; resolvedDate?: HyperHubDate;
  fingerprint?: string; cohort?: HyperHubLanguageCohort;
}
export interface HyperHubLinkSuggestion { targetId: string; otherTaskId: string; facts: string[] }
export type HyperHubPriority = 0 | 1 | 2 | 3;
export interface HyperHubTaskView {
  id: string;
  title: string;
  state: HyperHubState;
  stateChangedAt: HyperHubInstant;
  firstSeenAt: HyperHubInstant;
  createdAt?: HyperHubInstant;
  authoritativeCompletion: HyperHubCompletion;
  /** Keyed by evidenceId. A merged card can have several statuses even within one connection. */
  sourceStatus: Record<string, HyperHubSourceStatus>;
  /** Primary reference first. An owner-authored task may survive with no accessible references. */
  sources: HyperHubSourceRef[];
  projectId?: string;
  /** Verified, paired schedule endpoints. End is exclusive. */
  schedule?: HyperHubInterval & { provenance: Extract<HyperHubProvenance, { kind: 'source' }> };
  mirror?: { exists: true; handle: string } | { exists: false; eligible: boolean };
  due?: HyperHubDate;
  planned?: HyperHubDate;
  sourceDue?: Record<string, HyperHubDate>;
  fieldOrigins?: Partial<Record<'due' | 'planned' | 'effortMinutes' | 'release' | 'prepDeadline' | 'chunkMinutes', HyperHubProvenance>>;
  prepDeadline?: HyperHubDate;
  release?: HyperHubInstant;
  /** The provisional placement default is 45. It cannot establish slack while effortIsEstimate is true. */
  effortMinutes: number;
  effortIsEstimate: boolean;
  chunkMinutes?: number;
  fixedBlocks?: HyperHubInterval[];
  ownerPriority?: HyperHubPriority;
  sourcePriority?: { priorityId: string; mapped?: HyperHubPriority; evidenceId: string };
  people: HyperHubPerson[];
  meetingIds: string[];
  blocks: HyperHubDependency[];
  blockedBy: HyperHubDependency[];
  reviewSpan?: HyperHubReviewSpan;
  mergeEntryIds?: string[];
  pinned: boolean;
  snoozeUntil?: HyperHubInstant;
  manualOrder?: number;
}

export interface HyperHubCoverage {
  connectionId: string;
  queryId: string;
  interval?: HyperHubInterval;
  completeness: 'complete' | 'partial';
  lastSuccess: HyperHubInstant | null;
}
export interface HyperHubConnectionStatus {
  connectionId: string;
  kind: HyperHubSourceKind;
  label: string;
  status: 'fresh' | 'syncing' | 'partial' | 'stale' | 'error' | 'unconfigured';
  lastSuccess: HyperHubInstant | null;
  coverage: HyperHubCoverage[];
}

export type HyperHubSignal = 'slack' | 'importance' | 'unblocking' | 'age';
export type HyperHubFacts = Record<string, number | string>;
export interface HyperHubRankReason {
  signal: HyperHubSignal;
  points: number; // raw contribution before rounding the total
  facts: HyperHubFacts;
  evidenceId?: string;
}
export type HyperHubBlockerCode = 'waiting' | 'cycle' | 'no-window' | 'fixed-conflict' | 'no-coverage';
export type HyperHubFeasibility =
  | { ready: true }
  | { ready: false; code: HyperHubBlockerCode; facts: HyperHubFacts };
export interface HyperHubRanked {
  taskId: string;
  score: number;
  scoreCents: number; // integer hundredths
  /** Unknown axis values use zero and are identified by their signal in unknown. */
  urgency: number;
  importance: number;
  reasons: HyperHubRankReason[];
  unknown: HyperHubSignal[];
  pinned: boolean;
  feasibility: HyperHubFeasibility;
  provisionalSlack?: boolean;
}

export type HyperHubPlacementCode = HyperHubBlockerCode | 'earliest-fit' | 'fits-before-meeting'
  | 'after-predecessor' | 'fixed-block' | 'late' | 'owner-availability' | 'stale-coverage';
export interface HyperHubPlacementReason { code: HyperHubPlacementCode; facts: HyperHubFacts }
export interface HyperHubPlanBlock extends HyperHubInterval {
  taskId: string;
  fixed: boolean;
  provisional: boolean;
  reasons: HyperHubPlacementReason[];
}
export interface HyperHubUnscheduled { taskId: string; code: HyperHubBlockerCode; facts: HyperHubFacts }
export interface HyperHubRecommendation {
  kind: 'start-now' | 'start-later';
  taskId: string;
  start: HyperHubInstant;
  reasons: HyperHubPlacementReason[];
}
export interface HyperHubPlan {
  pass: 'score-first' | 'due-first';
  blocks: HyperHubPlanBlock[];
  unscheduled: HyperHubUnscheduled[];
  recommendation?: HyperHubRecommendation;
  provisional: boolean;
}

const id = z.string().trim().min(1).max(2048);
const counter = z.number().int().nonnegative();
const version = { scopeGeneration: counter, expectedRevision: counter };
const instant = z.strictObject({ kind: z.literal('instant'), iso: z.iso.datetime({ offset: true }) });
const interval = z.strictObject({ start: instant, end: instant })
  .refine(v => Date.parse(v.start.iso) < Date.parse(v.end.iso), 'End must be after start.');
const target = { ...version, targetId: z.uuid() };
const state = z.enum(['review', 'ready', 'doing', 'waiting', 'done', 'dismissed'] satisfies HyperHubState[]);
const taskFeedback = z.discriminatedUnion('type', [
  z.strictObject({ ...target, type: z.literal('pin') }),
  z.strictObject({ ...target, type: z.literal('unpin') }),
  // Move relative to a visible task, append, or clear this task's explicit order.
  z.strictObject({ ...target, type: z.literal('reorder'), position: z.union([
    z.strictObject({ beforeId: z.uuid() }), z.literal('end'), z.literal('reset'),
  ]) }),
  z.strictObject({ ...target, type: z.literal('snooze'), until: instant }),
  z.strictObject({ ...target, type: z.literal('not-today') }),
  z.strictObject({ ...target, type: z.literal('set-state'), state }),
  z.strictObject({ ...target, type: z.literal('reschedule'), block: interval }),
  z.strictObject({ ...target, type: z.literal('accept') }),
  z.strictObject({ ...target, type: z.literal('dismiss') }),
  z.strictObject({ ...target, type: z.literal('edit'), title: z.string().trim().min(1).max(1024) }),
  z.strictObject({ ...target, type: z.literal('reject-match'), otherTaskId: z.uuid() }),
  z.strictObject({ ...target, type: z.literal('link'), handle: id }),
  z.strictObject({ ...target, type: z.literal('unlink'), handle: id }),
  z.strictObject({ ...target, type: z.literal('merge'), otherTaskId: z.uuid() }),
  z.strictObject({ ...target, type: z.literal('split'), mergeEntryId: id }),
  z.strictObject({ ...target, type: z.literal('undo'), ledgerEntryId: id }),
]);
/** Feedback supported by the M1 task ledger and Board. */
export type HyperHubFeedback = z.infer<typeof taskFeedback>;

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const dailyWindow = z.strictObject({ start: time, end: time }).refine(v => v.start < v.end);
const zone = z.string().min(1).max(128).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}, 'Unknown time zone.');
const day = z.strictObject({ kind: z.literal('civil-date'), date: z.iso.date(), zone });
const declareAvailability = z.strictObject({
  ...version, type: z.literal('declare-availability'), day, windows: z.array(interval).min(1),
}).refine(value => {
  if (!day.safeParse(value.day).success) return false;
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: value.day.zone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return value.windows.every(({ start, end }) => {
    const first = Date.parse(start.iso), last = Date.parse(end.iso) - 1;
    return Number.isFinite(first) && Number.isFinite(last) &&
      local.format(first) === value.day.date && local.format(last) === value.day.date;
  });
}, 'Each window must fall within the declared civil day.');
export const HyperHubFeedbackSchema = z.union([
  taskFeedback,
  z.strictObject({ ...version, type: z.literal('set-matrix-quadrant'), taskId: z.uuid(),
    quadrant: z.enum(['urgent-important', 'important', 'urgent', 'neither'] satisfies HyperHubMatrixQuadrant[]) }),
  z.strictObject({ ...version, meetingId: id, type: z.literal('mark-prepared') }),
  z.strictObject({ ...version, meetingId: id, type: z.literal('block-before') }),
  z.strictObject({ ...version, meetingId: id, type: z.literal('add-prep-task'), title: z.string().trim().min(1).max(1024).optional() }),
  z.strictObject({ ...version, meetingId: id, type: z.literal('undo'), ledgerEntryId: id }),
  declareAvailability,
  z.strictObject({ ...version, type: z.literal('clear-availability'), day }),
  z.strictObject({ ...version, type: z.literal('undo'), day, ledgerEntryId: id }),
]);
export type HyperHubFeedbackEvent = z.infer<typeof HyperHubFeedbackSchema>;

const nativeView = z.strictObject({ databaseId: id, viewId: id });
/** Explicit import selections. Authentication, active account and workspace are derived in main. */
export const HyperHubSetupScopeSchema = z.strictObject({
  writeBack: z.strictObject({ jira: z.boolean(), newsletter: z.boolean() }).default({ jira: false, newsletter: false }),
  jiraProjects: z.array(z.strictObject({ connectionId: id, projectId: id })).max(500),
  nativeViews: z.array(nativeView).max(500),
  mail: z.strictObject({
    enabled: z.boolean(), folders: z.array(z.enum(['inbox', 'sent'])).max(2).refine(f => new Set(f).size === f.length),
    retentionDays: z.number().int().min(1).max(30).default(30), confirmedAt: instant.optional(),
    importFlags: z.boolean().optional(),
  }).nullable().default(null),
  ai: z.strictObject({ summaries: z.boolean(), confirmedAt: instant.optional() }).nullable().default(null),
  newsletterArticles: z.array(z.strictObject({ connectionId: z.literal('newsletter'), articleId: z.string().regex(/^[\w-]{1,128}$/), meetingId: id.optional() })).max(100).default([]),
  meetingLinks: z.array(z.strictObject({ meetingId: id, evidenceId: id })).max(1000).default([]),
  nativePages: z.array(z.strictObject({ viewId: id, meetingId: id.optional() })).max(100).default([]),
  outlookCalendar: z.boolean().default(false),
  nativeCalendars: z.array(nativeView).max(500).default([]),
  newsletterProjects: z.array(z.strictObject({ connectionId: id, projectId: id, resourceId: id })).max(500).default([]),
  aliases: z.array(z.string().trim().min(1).max(256)).max(100),
  zone,
  workdays: z.array(z.number().int().min(0).max(6)).max(7).refine(days => new Set(days).size === days.length),
  hours: dailyWindow,
  breaks: z.array(dailyWindow).max(24),
  daysOff: z.array(z.iso.date()).max(366),
});
export type HyperHubSetupScope = z.input<typeof HyperHubSetupScopeSchema>;
export type HyperHubMailScope = NonNullable<z.output<typeof HyperHubSetupScopeSchema>['mail']>;
export interface HyperHubMailboxAvailability { available: boolean; flagsVerified: boolean }
export interface HyperHubSetupOptions {
  jira: { configured: boolean; defaultProjectKey?: string };
  mailbox?: HyperHubMailboxAvailability;
  outlook: { available: boolean; reason?: string };
  newsletter: {
    configured: boolean;
    gantt: boolean;
    projects: { id: string; name: string; resources: { id: string; name: string }[] }[];
  };
}
export interface HyperHubSettingsSummary {
  writeBack?: Record<HyperHubWriteSource, { enabled: boolean; available: boolean; code?: HyperHubStatusRejectCode }>;
  setupComplete: boolean;
  zone: string;
  workdays: number[]; // Sunday = 0
  /** M1 snapshots can omit calendar settings. */
  hours?: HyperHubSetupScope['hours'];
  breaks?: HyperHubSetupScope['breaks'];
  outlookAvailability?: boolean;
  cohortPrecision?: Record<HyperHubLanguageCohort, HyperHubCohortPrecision>;
  weights: Record<HyperHubSignal, number>;
}
export interface HyperHubVersion { scopeGeneration: number; revision: number }
export interface HyperHubSnapshot extends HyperHubVersion {
  asOf: HyperHubInstant;
  tasks: HyperHubTaskView[];
  ranking: HyperHubRanked[];
  linkSuggestions?: HyperHubLinkSuggestion[];
  writes?: HyperHubWriteView[];
  meetingWindow?: { requested: HyperHubInterval; coverage: HyperHubCoverage[] };
  matrixOverrides?: Record<string, HyperHubMatrixQuadrant>;
  cycleTaskIds?: string[];
  plan?: HyperHubPlan;
  agenda?: HyperHubAgendaItem[];
  day?: HyperHubDay;
  sources: HyperHubConnectionStatus[];
  settings: HyperHubSettingsSummary;
}
export interface HyperHubSetup extends HyperHubVersion { scope: HyperHubSetupScope | null }
export type HyperHubRejectCode = 'scope-changed' | 'revision-conflict' | 'unavailable' | 'access-denied' | 'invalid';
export type HyperHubFeedbackResult = HyperHubVersion & (
  | { ok: true; ledgerEntryId: string }
  | { ok: false; code: HyperHubRejectCode }
);
export type HyperHubOpenResult = HyperHubVersion & (
  | { ok: true }
  | { ok: false; code: HyperHubRejectCode }
);

const opaqueId = z.string().min(1).max(2048).regex(/^[a-zA-Z0-9._~-]+$/);
const weight = z.number().nonnegative();
export const HyperHubWeightsSchema = z.strictObject({ slack: weight, importance: weight, unblocking: weight, age: weight })
  .refine(w => Object.values(w).some(value => value > 0));
export const HyperTaskHubArgs = {
  previewStatus: z.union([
    z.strictObject({ ...version, handle: opaqueId, intent: z.union([
      z.strictObject({ kind: z.literal('choose') }),
      z.strictObject({ kind: z.literal('state'), state: z.enum(['ready', 'doing', 'done']) }),
    ]) }),
    z.strictObject({ ...version, intent: z.strictObject({ kind: z.literal('reverse'), operationId: opaqueId }) }),
  ]),
  approveStatus: z.strictObject({ previewId: opaqueId, candidateId: opaqueId, resolutionId: opaqueId.optional() }),
  discardStatus: z.strictObject({ previewId: opaqueId }),
  releaseHold: z.strictObject({ ...version, operationId: opaqueId }),
  previewWeights: z.strictObject({ ...version, seq: counter, draft: HyperHubWeightsSchema }),
  saveWeights: z.strictObject({ ...version, weights: HyperHubWeightsSchema }),
  previewMirror: z.strictObject({ ...version, taskId: z.uuid() }),
  applyMirror: z.strictObject({ token: opaqueId }),
  // Bootstrap reads capture the active generation at entry and recheck before returning.
  getBrief: z.strictObject({ ...version, meetingId: id }),
  openBriefEvidence: z.strictObject({ ...version, meetingId: id, evidenceId: id }),
  summarizeBrief: z.strictObject({ ...version, meetingId: id, evidenceIds: z.array(id).min(1).max(32).refine(ids => new Set(ids).size === ids.length) }),
  getSnapshot: z.undefined(),
  refresh: z.strictObject({ ...version, automatic: z.boolean().optional() }),
  sendFeedback: HyperHubFeedbackSchema,
  getSetupOptions: z.undefined(),
  setFocusVisible: z.boolean(),
  openSource: id,
  getSetupScope: z.undefined(),
  setSetupScope: z.strictObject({ ...version, scope: HyperHubSetupScopeSchema }),
};
export const HyperTaskHubChannel = {
  PreviewStatus: 'hyper-task-hub:preview-status',
  ApproveStatus: 'hyper-task-hub:approve-status',
  DiscardStatus: 'hyper-task-hub:discard-status',
  ReleaseHold: 'hyper-task-hub:release-hold',
  PreviewWeights: 'hyper-task-hub:preview-weights',
  SaveWeights: 'hyper-task-hub:save-weights',
  PreviewMirror: 'hyper-task-hub:preview-mirror',
  ApplyMirror: 'hyper-task-hub:apply-mirror',
  GetBrief: 'hyper-task-hub:get-brief',
  OpenBriefEvidence: 'hyper-task-hub:open-brief-evidence',
  SummarizeBrief: 'hyper-task-hub:summarize-brief',
  GetSnapshot: 'hyper-task-hub:get-snapshot',
  GetSetupOptions: 'hyper-task-hub:get-setup-options',
  SetFocusVisible: 'hyper-task-hub:set-focus-visible',
  Refresh: 'hyper-task-hub:refresh',
  SendFeedback: 'hyper-task-hub:send-feedback',
  OpenSource: 'hyper-task-hub:open-source',
  Snapshot: 'hyper-task-hub:snapshot',
  GetSetupScope: 'hyper-task-hub:get-setup-scope',
  SetSetupScope: 'hyper-task-hub:set-setup-scope',
} as const;
export const HyperTaskHubChannels = HyperTaskHubChannel;
export const HyperTaskHubM2Channel = HyperTaskHubChannel;
export const HyperTaskHubM2Args = HyperTaskHubArgs;
export type HyperHubBriefResult = HyperHubVersion & (
  | { ok: true; brief: import('./HyperMeetingBrief').HyperMeetingBrief; summariesAvailable: boolean }
  | { ok: false; code: HyperHubRejectCode }
);
export type HyperHubSummaryResult = HyperHubVersion & (
  | { ok: true; text: string; citations: string[] }
  | { ok: false; code: HyperHubRejectCode }
);
export interface HyperTaskHubBriefApi {
  getBrief(request: z.infer<typeof HyperTaskHubArgs.getBrief>): Promise<HyperHubBriefResult>;
  openBriefEvidence(request: z.infer<typeof HyperTaskHubArgs.openBriefEvidence>): Promise<HyperHubOpenResult>;
  summarizeBrief(request: z.infer<typeof HyperTaskHubArgs.summarizeBrief>): Promise<HyperHubSummaryResult>;
}
export type HyperTaskHubM4Api = HyperTaskHubM3Api & HyperTaskHubBriefApi;
export interface HyperTaskHubM5Actions {
  previewStatus(request: z.infer<typeof HyperTaskHubArgs.previewStatus>): Promise<HyperHubStatusPreviewResult>;
  approveStatus(request: z.infer<typeof HyperTaskHubArgs.approveStatus>): Promise<HyperHubStatusApproveResult>;
  discardStatus(request: z.infer<typeof HyperTaskHubArgs.discardStatus>): Promise<HyperHubOpenResult>;
  releaseHold(request: z.infer<typeof HyperTaskHubArgs.releaseHold>): Promise<HyperHubReleaseHoldResult>;
  previewWeights(request: z.infer<typeof HyperTaskHubArgs.previewWeights>): Promise<HyperHubWeightsPreviewResult>;
  saveWeights(request: z.infer<typeof HyperTaskHubArgs.saveWeights>): Promise<HyperHubOpenResult>;
  previewMirror(request: z.infer<typeof HyperTaskHubArgs.previewMirror>): Promise<HyperHubMirrorPreviewResult>;
  applyMirror(request: z.infer<typeof HyperTaskHubArgs.applyMirror>): Promise<HyperHubMirrorApplyResult>;
}
export type HyperTaskHubM5Api = HyperTaskHubM4Api & HyperTaskHubM5Actions;
export interface HyperTaskHubApi extends Partial<HyperTaskHubBriefApi>, Partial<HyperTaskHubM5Actions> {
  getSnapshot(): Promise<HyperHubSnapshot>;
  refresh(request: z.infer<typeof HyperTaskHubArgs.refresh>): Promise<HyperHubSnapshot>;
  sendFeedback(event: HyperHubFeedbackEvent): Promise<HyperHubFeedbackResult>;
  openSource(handle: string): Promise<HyperHubOpenResult>;
  onSnapshot(listener: (snapshot: HyperHubSnapshot) => void): () => void;
  getSetupScope(): Promise<HyperHubSetup>;
  setFocusVisible?(visible: boolean): Promise<void>;
  getSetupOptions?(): Promise<HyperHubSetupOptions>;
  setSetupScope(request: z.input<typeof HyperTaskHubArgs.setSetupScope>): Promise<HyperHubSetup>;
}

export interface HyperTaskHubM2Api extends HyperTaskHubApi {
  setFocusVisible(visible: boolean): Promise<void>;
  sendFeedback(event: HyperHubFeedbackEvent): Promise<HyperHubFeedbackResult>;
  getSetupOptions(): Promise<HyperHubSetupOptions>;
}

export interface HyperTaskHubM3Api extends HyperTaskHubM2Api {
  getSetupOptions(): Promise<HyperHubSetupOptions & { mailbox: HyperHubMailboxAvailability }>;
}
