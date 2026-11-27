import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { hyperPlanningHeldTaskIds, type HyperHubHoldInput } from './HyperDayPlanner';
import type { HyperHubCompletion, HyperHubDate, HyperHubInstant, HyperHubInterval, HyperHubNativeKey } from './HyperTaskHub';

export type HyperMeetingOccurrenceKey = Readonly<Extract<HyperHubNativeKey, { kind: 'outlook-calendar' }> & {
  connectionId: string;
}>;

export type HyperMeetingReadiness = 'prepared' | 'planned' | 'none';

export interface HyperMeetingPreparation {
  readonly ownerConfirmed?: boolean;
  readonly viewed?: boolean;
  /** Explicit prep tasks and current scheduled prep blocks for this occurrence only. */
  readonly tasks?: readonly { readonly id: string; readonly completion: HyperHubCompletion }[];
  readonly blocks?: readonly Readonly<HyperHubInterval & { taskId?: string }>[];
}

export interface HyperMeetingBriefSource {
  /** Unique, scoped citation id. Revision changes when display content or matching inputs change. */
  readonly id: string;
  readonly revision: string;
  readonly sourceTime: Readonly<HyperHubInstant>;
  readonly stale: boolean;
  /** Bounded, authorized excerpt supplied by the adapter. */
  readonly excerpt?: string;
}

export interface HyperMeetingJiraKey {
  readonly instanceId: string;
  readonly key: string;
}

export interface HyperMeetingMatchContext {
  /** Resolved Jira mentions, scoped by instance. */
  readonly jiraKeys?: readonly HyperMeetingJiraKey[];
  /** Canonical scoped identities of trusted, resolved document links. */
  readonly trustedDocumentIds?: readonly string[];
  /** Canonical scoped project identities. */
  readonly projectIds?: readonly string[];
}

export interface HyperMeetingHistoryOccurrence {
  /** Verified against the calendar store, including original start. */
  readonly key: HyperMeetingOccurrenceKey;
  readonly revision: string;
  readonly interval: Readonly<HyperHubInterval>;
  readonly verifiedSeriesId?: string;
  readonly accessible: boolean;
  readonly sensitivity: 'normal' | 'personal' | 'private' | 'confidential' | 'unknown';
  readonly cancelled: boolean;
}

export interface HyperMeetingPerson {
  readonly name: string;
  readonly verifiedIdentityId?: string;
}

export interface HyperMeetingOccurrence extends HyperMeetingHistoryOccurrence, HyperMeetingBriefSource, HyperMeetingMatchContext {
  readonly isMeeting: boolean;
  readonly organizerIsOwner: boolean;
  readonly response: 'accepted' | 'declined' | 'tentative' | 'not-responded' | 'unknown';
  readonly subject: string;
  readonly joinUrl?: string;
  readonly organizer?: HyperMeetingPerson;
  readonly attendees: readonly HyperMeetingPerson[];
}

export type HyperMeetingDocument =
  | { readonly kind: 'jira'; readonly jiraKey: HyperMeetingJiraKey }
  | { readonly kind: 'hypertask-page' | 'hypertask-row' }
  | { readonly kind: 'newsletter-project'; readonly connectionId: string }
  | { readonly kind: 'newsletter-article'; readonly connectionId: string; readonly ownerSelected: boolean };

type HyperMeetingWorkKind = 'action' | 'decision' | 'issue' | 'blocker';

export type HyperMeetingBriefEvidence = HyperMeetingBriefSource & HyperMeetingMatchContext & {
  /** The active scope can still read the source, including workspace access for HyperTask documents. */
  readonly accessible: boolean;
  readonly subject: string;
  readonly verifiedIdentityIds?: readonly string[];
  /** An independently verified join to a historical occurrence. */
  readonly priorOccurrenceKey?: HyperMeetingOccurrenceKey;
} & (
  | {
      readonly kind: 'mail';
      readonly connectionId: string;
      readonly storeId: string;
      readonly messageId: string;
      readonly verifiedThreadId?: string;
      /** Attachment references open through the parent message citation. */
      readonly attachmentNames?: readonly string[];
    }
  | { readonly kind: HyperMeetingWorkKind; readonly open: boolean; readonly ownerAssigned?: boolean; readonly due?: Readonly<HyperHubDate> }
  | { readonly kind: 'prior-decision' }
  | { readonly kind: 'document'; readonly documentId: string; readonly document: HyperMeetingDocument }
);

export interface HyperMeetingBriefInput extends HyperHubHoldInput {
  readonly now: Readonly<HyperHubInstant>;
  readonly requestedOccurrence: HyperMeetingOccurrenceKey;
  /** The independently resolved current record in the active scope. */
  readonly occurrence?: HyperMeetingOccurrence;
  readonly evidence: readonly HyperMeetingBriefEvidence[];
  readonly history?: readonly HyperMeetingHistoryOccurrence[];
  /** Authorized manual links for the exact requested occurrence. */
  readonly manualEvidenceIds?: readonly string[];
  readonly configuredJiraInstanceId?: string;
  readonly configuredNewsletterConnectionIds?: readonly string[];
  readonly preparation?: HyperMeetingPreparation;
}

export type HyperMeetingBriefReason =
  | { readonly code: 'accepted-meeting' | 'owner-organized' | 'manual-link'; readonly points: 0; readonly facts: Record<string, never> }
  | { readonly code: 'jira-key'; readonly points: 60; readonly facts: HyperMeetingJiraKey }
  | { readonly code: 'document-link'; readonly points: 60; readonly facts: { readonly documentId: string } }
  | { readonly code: 'series-history'; readonly points: 35; readonly facts: { readonly start: string; readonly ageDays: number } }
  | { readonly code: 'subject-terms'; readonly points: 20; readonly facts: { readonly terms: readonly string[] } }
  | { readonly code: 'meeting-person'; readonly points: 15; readonly facts: { readonly identityId: string; readonly name: string } }
  | { readonly code: 'recent'; readonly points: 5; readonly facts: { readonly ageDays: number } }
  | { readonly code: 'shared-project'; readonly points: 0; readonly facts: { readonly projectId: string } };

export interface HyperMeetingBriefItem extends HyperMeetingBriefSource {
  readonly subject: string;
  readonly manual: boolean;
  readonly score: number;
  readonly reasons: readonly HyperMeetingBriefReason[];
}

export interface HyperMeetingBriefWork extends HyperMeetingBriefItem {
  readonly kind: HyperMeetingWorkKind;
  readonly due?: Readonly<HyperHubDate>;
}

export interface HyperMeetingBriefThread {
  readonly id: string;
  /** Best matching message first. The group ranks by that message. */
  readonly messages: readonly (HyperMeetingBriefItem & { readonly attachmentNames?: readonly string[] })[];
}

export type HyperMeetingBrief = { readonly briefVersion: string } & (
  | { readonly eligible: false }
  | {
      readonly eligible: true;
      readonly meeting: HyperMeetingBriefItem & {
        readonly interval: Readonly<HyperHubInterval>;
        readonly joinUrl?: string;
        readonly organizer?: HyperMeetingPerson;
        readonly attendees: readonly HyperMeetingPerson[];
      };
      readonly readiness: HyperMeetingReadiness;
      readonly viewed: boolean;
      readonly prewarmAt: Readonly<HyperHubInstant>;
      readonly refreshAt: Readonly<HyperHubInstant>;
      readonly openActions: readonly HyperMeetingBriefWork[];
      readonly decisionsDue: readonly HyperMeetingBriefWork[];
      readonly relatedIssues: readonly HyperMeetingBriefWork[];
      readonly blockers: readonly HyperMeetingBriefWork[];
      readonly openWithAttendees: readonly HyperMeetingBriefWork[];
      readonly threads: readonly HyperMeetingBriefThread[];
      readonly priorDecisions: readonly HyperMeetingBriefItem[];
      readonly linkedDocuments: readonly (HyperMeetingBriefItem & { readonly document: HyperMeetingDocument })[];
    }
);

export interface HyperMeetingBriefSummaryRequest {
  readonly source: 'hyper-meeting-brief';
  readonly untrusted_data: readonly { readonly id: string; readonly excerpt: string }[];
}

const dayMs = 86_400_000;
const jiraKeyPattern = /^[A-Z][A-Z0-9_]*-\d+$/;
const stopwords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'our', 'the',
  'this', 'to', 'we', 'will', 'with', 'you', 'your', 'fw', 'fwd', 're', 'meeting', 'invite', 'invitation', 'agenda',
  'אבל', 'או', 'אז', 'אין', 'אל', 'אם', 'אני', 'אנחנו', 'את', 'גם', 'הוא', 'היא', 'הם', 'הן', 'זה', 'זאת',
  'יש', 'כי', 'כל', 'לא', 'מה', 'מי', 'על', 'עם', 'של', 'שלום', 'פגישה', 'ישיבה', 'הזמנה',
]);

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function occurrenceId(key: HyperMeetingOccurrenceKey): string | undefined {
  const { connectionId, storeId, occurrenceId, originalStart } = key;
  if (!connectionId || !storeId || !occurrenceId) return;
  const start = originalStart.kind === 'instant' ? Date.parse(originalStart.iso) : Date.parse(originalStart.date);
  if (!Number.isFinite(start)) return;
  return JSON.stringify([key.kind, connectionId, storeId, occurrenceId, originalStart.kind, start,
    originalStart.kind === 'civil-date' ? originalStart.zone : null]);
}

function intervalTimes(interval: Readonly<HyperHubInterval>): [number, number] {
  return [Date.parse(interval.start.iso), Date.parse(interval.end.iso)];
}

function canReadOccurrence(occurrence: HyperMeetingHistoryOccurrence): boolean {
  return occurrence.accessible && !occurrence.cancelled &&
    (occurrence.sensitivity === 'normal' || occurrence.sensitivity === 'personal');
}

function topicTokens(subject: string): Set<string> {
  const normalized = subject.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+-\d+(?![\p{L}\p{N}_])|[\p{L}\p{N}_]+/gu) ?? [];
  return new Set(words.filter(word => word.length >= 2 && /\p{L}/u.test(word) && !stopwords.has(word)));
}

function sortedIntersection(left: ReadonlySet<string>, right: Iterable<string>): string[] {
  return [...new Set(right)].filter(value => left.has(value)).sort();
}

function scopedJiraKeys(instanceId: string | undefined, keys: readonly HyperMeetingJiraKey[] = []): string[] {
  return keys.filter(ref => instanceId && ref.instanceId === instanceId)
    .map(ref => ref.key.toUpperCase()).filter(key => jiraKeyPattern.test(key));
}

function seriesHistory(input: HyperMeetingBriefInput, meeting: HyperMeetingOccurrence, now: number, start: number) {
  const currentId = occurrenceId(meeting.key);
  const history = (input.history ?? []).flatMap(prior => {
    if (!meeting.verifiedSeriesId || prior.verifiedSeriesId !== meeting.verifiedSeriesId || !canReadOccurrence(prior) ||
      prior.key.connectionId !== meeting.key.connectionId || prior.key.storeId !== meeting.key.storeId) return [];
    const id = occurrenceId(prior.key);
    const [priorStart, priorEnd] = intervalTimes(prior.interval);
    return id && id !== currentId && priorStart < priorEnd && priorEnd <= Math.min(now, start)
      ? [{ id, priorStart, iso: prior.interval.start.iso }]
      : [];
  });
  history.sort((a, b) => b.priorStart - a.priorStart || compareIds(a.id, b.id));
  const selected = new Map<string, typeof history[number]>();
  for (const prior of history) {
    if (!selected.has(prior.id)) selected.set(prior.id, prior);
    if (selected.size === 2) break;
  }
  return selected;
}

function briefVersion(input: HyperMeetingBriefInput): string {
  const { occurrence, preparation } = input;
  const occurrenceRevision = (event: HyperMeetingHistoryOccurrence) => [occurrenceId(event.key), event.revision,
    ...intervalTimes(event.interval), event.accessible, event.sensitivity, event.cancelled, event.verifiedSeriesId];
  const version = JSON.stringify([
    'hyper-meeting-brief-v1', occurrenceId(input.requestedOccurrence),
    occurrence && [...occurrenceRevision(occurrence), occurrence.id, occurrence.isMeeting, occurrence.organizerIsOwner,
      occurrence.response, occurrence.stale],
    input.evidence.map(item => JSON.stringify([item.id, item.revision, item.accessible, item.stale])).sort(),
    (input.history ?? []).map(event => JSON.stringify(occurrenceRevision(event))).sort(),
    [...new Set(input.manualEvidenceIds)].sort(), input.configuredJiraInstanceId,
    [...new Set(input.configuredNewsletterConnectionIds)].sort(),
    preparation?.ownerConfirmed ?? false, preparation?.viewed ?? false,
    (preparation?.tasks ?? []).map(task => JSON.stringify([task.id, task.completion])).sort(),
    (preparation?.blocks ?? []).map(block => JSON.stringify(intervalTimes(block))).sort(),
  ]);
  return bytesToHex(sha256(version));
}

function readiness(preparation: HyperMeetingPreparation | undefined, now: number, meetingStart: number): HyperMeetingReadiness {
  if (preparation?.ownerConfirmed ||
    (preparation?.tasks?.length && preparation.tasks.every(task => task.completion === 'complete'))) return 'prepared';
  if (preparation?.blocks?.some(block => {
    const [start, end] = intervalTimes(block);
    return start < end && end > now && end <= meetingStart;
  })) return 'planned';
  return 'none';
}

function briefItem(source: HyperMeetingBriefSource & { readonly subject: string }, reasons: readonly HyperMeetingBriefReason[]): HyperMeetingBriefItem {
  const { id, revision, sourceTime, stale, excerpt, subject } = source;
  return { id, revision, sourceTime, stale, excerpt, subject, reasons,
    manual: reasons.some(reason => reason.code === 'manual-link'),
    score: reasons.reduce((total, reason) => total + reason.points, 0) };
}

function compareItems(a: HyperMeetingBriefItem, b: HyperMeetingBriefItem): number {
  return Number(b.manual) - Number(a.manual) || b.score - a.score ||
    Date.parse(b.sourceTime.iso) - Date.parse(a.sourceTime.iso) || compareIds(a.id, b.id);
}

function documentAllowed(doc: HyperMeetingDocument, manual: boolean, input: HyperMeetingBriefInput): boolean {
  switch (doc.kind) {
    case 'jira': return doc.jiraKey.instanceId === input.configuredJiraInstanceId;
    case 'hypertask-page':
    case 'hypertask-row': return true; // The evidence access flag guards workspace access.
    case 'newsletter-project':
      return input.configuredNewsletterConnectionIds?.includes(doc.connectionId) === true;
    case 'newsletter-article':
      return (manual || doc.ownerSelected) && input.configuredNewsletterConnectionIds?.includes(doc.connectionId) === true;
  }
}

function matchEvidence(input: HyperMeetingBriefInput, meeting: HyperMeetingOccurrence, now: number, start: number) {
  const history = seriesHistory(input, meeting, now, start);
  const manualIds = new Set(input.manualEvidenceIds);
  const meetingJiraKeys = new Set(scopedJiraKeys(input.configuredJiraInstanceId, meeting.jiraKeys));
  const meetingDocumentIds = new Set(meeting.trustedDocumentIds);
  const meetingProjects = new Set(meeting.projectIds);
  const meetingTerms = topicTokens(meeting.subject);
  const people = new Map<string, string>();
  for (const person of [...meeting.attendees, meeting.organizer]) {
    if (person?.verifiedIdentityId) people.set(person.verifiedIdentityId, person.name);
  }
  const personIds = new Set(people.keys());

  return input.evidence.flatMap(evidence => {
    const sourceTime = Date.parse(evidence.sourceTime.iso);
    if (!evidence.accessible || !Number.isFinite(sourceTime)) return [];
    const manual = manualIds.has(evidence.id);
    const document = evidence.kind === 'document' ? evidence.document : undefined;
    if (document && !documentAllowed(document, manual, input)) return [];
    const jiraKeys = scopedJiraKeys(input.configuredJiraInstanceId, evidence.jiraKeys);
    if (document?.kind === 'jira') jiraKeys.push(...scopedJiraKeys(input.configuredJiraInstanceId, [document.jiraKey]));
    const [jiraKey] = sortedIntersection(meetingJiraKeys, jiraKeys);
    const documentIds = evidence.trustedDocumentIds ?? [];
    const [documentId] = sortedIntersection(meetingDocumentIds,
      evidence.kind === 'document' ? [...documentIds, evidence.documentId] : documentIds);
    const priorId = evidence.priorOccurrenceKey && occurrenceId(evidence.priorOccurrenceKey);
    const prior = priorId ? history.get(priorId) : undefined;
    const terms = sortedIntersection(meetingTerms, topicTokens(evidence.subject));
    const [projectId] = sortedIntersection(meetingProjects, evidence.projectIds ?? []);
    const [identityId] = sortedIntersection(personIds, evidence.verifiedIdentityIds ?? []);
    const topical = Boolean(projectId) || terms.length >= 2;
    const direct = Boolean(jiraKey || documentId);
    const related = manual || direct || prior !== undefined || topical;
    if (evidence.kind === 'mail' && !manual && !topical) return [];
    if (evidence.kind === 'prior-decision' && (!prior || !evidence.excerpt?.trim())) return [];
    if (document && !manual && !direct && document.kind !== 'newsletter-article') return [];
    const attendeeOnly = !related && Boolean(identityId) && 'open' in evidence && evidence.open;
    if (!related && !attendeeOnly) return [];

    const reasons: HyperMeetingBriefReason[] = [];
    if (manual) reasons.push({ code: 'manual-link', points: 0, facts: {} });
    if (jiraKey && input.configuredJiraInstanceId) {
      reasons.push({ code: 'jira-key', points: 60, facts: { instanceId: input.configuredJiraInstanceId, key: jiraKey } });
    } else if (documentId) reasons.push({ code: 'document-link', points: 60, facts: { documentId } });
    if (prior) reasons.push({ code: 'series-history', points: 35, facts: {
      start: prior.iso, ageDays: Math.floor((now - prior.priorStart) / dayMs),
    } });
    if (terms.length >= 2) reasons.push({ code: 'subject-terms', points: 20, facts: { terms } });
    if (identityId) reasons.push({ code: 'meeting-person', points: 15, facts: { identityId, name: people.get(identityId)! } });
    const ageDays = (now - sourceTime) / dayMs;
    if (ageDays >= 0 && ageDays < 7) reasons.push({ code: 'recent', points: 5, facts: { ageDays: Math.floor(ageDays) } });
    if (projectId) reasons.push({ code: 'shared-project', points: 0, facts: { projectId } });
    return [{ evidence, attendeeOnly, item: briefItem(evidence, reasons) }];
  }).sort((a, b) => compareItems(a.item, b.item));
}

/** Builds a brief from the active scope's immutable evidence without reading the clock or a connector. */
export function hyperBuildMeetingBrief(input: HyperMeetingBriefInput): HyperMeetingBrief {
  const { occurrence } = input;
  const held = hyperPlanningHeldTaskIds(input.writes);
  let preparation = input.preparation;
  if (preparation && held.size) {
    preparation = {
      ...preparation,
      tasks: preparation.tasks?.map(task => held.has(task.id) ? { ...task, completion: 'unknown' } : task),
      blocks: preparation.blocks?.filter(block => block.taskId === undefined || !held.has(block.taskId)),
    };
  }
  const briefVersionId = briefVersion({ ...input, preparation });
  const requestedId = occurrenceId(input.requestedOccurrence);
  const ineligible = { eligible: false, briefVersion: briefVersionId } as const;
  if (!requestedId || !occurrence || requestedId !== occurrenceId(occurrence.key) || !canReadOccurrence(occurrence) ||
    !occurrence.isMeeting || occurrence.response === 'declined' || !(occurrence.organizerIsOwner || occurrence.response === 'accepted')) return ineligible;
  const now = Date.parse(input.now.iso);
  const [start, end] = intervalTimes(occurrence.interval);
  if (!Number.isFinite(now) || !(start < end)) return ineligible;

  const openActions: HyperMeetingBriefWork[] = [];
  const decisionsDue: HyperMeetingBriefWork[] = [];
  const relatedIssues: HyperMeetingBriefWork[] = [];
  const blockers: HyperMeetingBriefWork[] = [];
  const openWithAttendees: HyperMeetingBriefWork[] = [];
  const priorDecisions: HyperMeetingBriefItem[] = [];
  const linkedDocuments: (HyperMeetingBriefItem & { document: HyperMeetingDocument })[] = [];
  const threads = new Map<string, HyperMeetingBriefThread['messages'][number][]>();
  for (const { evidence, attendeeOnly, item } of matchEvidence(input, occurrence, now, start)) {
    switch (evidence.kind) {
      case 'mail': {
        const { connectionId, storeId, verifiedThreadId, messageId, attachmentNames } = evidence;
        const id = JSON.stringify([connectionId, storeId, verifiedThreadId ? 'thread' : 'message', verifiedThreadId || messageId]);
        let messages = threads.get(id);
        if (!messages) {
          if (threads.size >= 5) break;
          messages = [];
          threads.set(id, messages);
        }
        messages.push({ ...item, attachmentNames });
        break;
      }
      case 'prior-decision':
        priorDecisions.push(item);
        break;
      case 'document':
        linkedDocuments.push({ ...item, document: evidence.document });
        break;
      default: {
        const { kind, due, open, ownerAssigned } = evidence;
        const work = { ...item, kind, due };
        if (attendeeOnly) {
          if (openWithAttendees.length < 3) openWithAttendees.push(work);
        } else if (kind === 'action' && open && ownerAssigned) openActions.push(work);
        else if (kind === 'decision' && open && ownerAssigned && due) decisionsDue.push(work);
        else if (kind === 'issue') relatedIssues.push(work);
        else if (kind === 'blocker' && open) blockers.push(work);
      }
    }
  }
  const { interval, joinUrl, organizer, attendees } = occurrence;
  const meeting = { ...briefItem(occurrence, [{ code: occurrence.organizerIsOwner ? 'owner-organized' : 'accepted-meeting',
    points: 0, facts: {} }]), interval, joinUrl, organizer, attendees };
  return { eligible: true, briefVersion: briefVersionId, meeting, readiness: readiness(preparation, now, start),
    viewed: preparation?.viewed ?? false,
    prewarmAt: { kind: 'instant', iso: new Date(start - dayMs).toISOString() },
    refreshAt: { kind: 'instant', iso: new Date(start - 30 * 60_000).toISOString() },
    openActions, decisionsDue, relatedIssues, blockers, openWithAttendees, priorDecisions, linkedDocuments,
    threads: [...threads].map(([id, messages]) => ({ id, messages })),
  };
}

/** Main revalidates access and revisions before transport and before accepting a reply. */
export function hyperBriefSummaryRequest(brief: HyperMeetingBrief, selectedEvidenceIds: readonly string[]): HyperMeetingBriefSummaryRequest {
  const selected = new Set(selectedEvidenceIds);
  const items = brief.eligible ? [brief.meeting, ...brief.openActions, ...brief.decisionsDue, ...brief.relatedIssues,
    ...brief.blockers, ...brief.openWithAttendees, ...brief.threads.flatMap(thread => thread.messages),
    ...brief.priorDecisions, ...brief.linkedDocuments] : [];
  const excerpts = items.flatMap(({ id, excerpt }) => selected.has(id) && excerpt?.trim() ? [{ id, excerpt }] : []);
  return { source: 'hyper-meeting-brief', untrusted_data: excerpts };
}
