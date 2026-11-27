// Test and harness support: a realistic bilingual brief built with Sol's engine.
import { hyperBuildMeetingBrief, type HyperMeetingBrief, type HyperMeetingBriefEvidence, type HyperMeetingOccurrence } from '@shared/HyperMeetingBrief';
import type { HyperHubInstant } from '@shared/HyperTaskHub';

const instant = (iso: string): HyperHubInstant => ({ kind: 'instant', iso });
const jira = { instanceId: 'jira-eng', key: 'ENG-317' };
const occurrence: HyperMeetingOccurrence = {
  key: { kind: 'outlook-calendar', connectionId: 'outlook', storeId: 'store', occurrenceId: 'release-review', originalStart: instant('2026-11-29T12:00:00+02:00') },
  id: 'agenda-release-review', revision: 'r3', sourceTime: instant('2026-11-26T09:00:00+02:00'), stale: false,
  subject: 'Release review · סקירת גרסה', interval: { start: instant('2026-11-29T12:00:00+02:00'), end: instant('2026-11-29T12:45:00+02:00') },
  joinUrl: 'https://meet.example/release-review', excerpt: 'Go/no-go for the customer migration.',
  accessible: true, isMeeting: true, sensitivity: 'normal', cancelled: false, organizerIsOwner: false, response: 'accepted',
  organizer: { name: 'Dana Levi', verifiedIdentityId: 'dana' }, attendees: [{ name: 'יעל כהן', verifiedIdentityId: 'yael' }, { name: 'Amir Levi', verifiedIdentityId: 'amir' }],
  jiraKeys: [jira], projectIds: ['jira:jira-eng:ENG'], trustedDocumentIds: ['page:release-notes'], verifiedSeriesId: 'release-series',
};
const source = (id: string, subject: string, iso: string, excerpt?: string) => ({ id, revision: 'r1', sourceTime: instant(iso), stale: false, accessible: true, subject, excerpt });
const evidence: HyperMeetingBriefEvidence[] = [
  { ...source('task-migration', 'אישור migration של טבלת הלקוחות', '2026-11-27T08:00:00+02:00', 'Approve the customer-table migration before go-live.'), kind: 'action', open: true, ownerAssigned: true, jiraKeys: [jira], due: { kind: 'civil-date', date: '2026-11-29', zone: 'Asia/Jerusalem' } },
  { ...source('issue-timeout', 'ENG-335 Review API timeout defaults', '2026-11-25T11:00:00+02:00'), kind: 'blocker', open: true, jiraKeys: [{ instanceId: 'jira-eng', key: 'ENG-317' }] },
  { ...source('mail-1', 'RE: ENG-317 migration plan · תוכנית', '2026-11-28T17:30:00+02:00', 'Dana: can we confirm the rollback window before Sunday?'), kind: 'mail', connectionId: 'outlook', storeId: 'store', messageId: 'mail-1', verifiedThreadId: 'thread-1', jiraKeys: [jira], projectIds: ['jira:jira-eng:ENG'], verifiedIdentityIds: ['dana'], attachmentNames: ['rollback-plan.pdf'] },
  { ...source('mail-2', 'RE: ENG-317 migration plan · תוכנית', '2026-11-28T18:10:00+02:00', 'Amir: rollback takes 20 minutes.'), kind: 'mail', connectionId: 'outlook', storeId: 'store', messageId: 'mail-2', verifiedThreadId: 'thread-1', jiraKeys: [jira], projectIds: ['jira:jira-eng:ENG'], verifiedIdentityIds: ['amir'] },
  { ...source('doc-notes', 'Release notes', '2026-11-27T10:00:00+02:00', 'Draft notes for 0.12.'), kind: 'document', documentId: 'page:release-notes', document: { kind: 'hypertask-page' } },
];

export const HyperMeetingBriefSample: Extract<HyperMeetingBrief, { eligible: true }> = (() => {
  const brief = hyperBuildMeetingBrief({
    now: instant('2026-11-29T11:35:00+02:00'), requestedOccurrence: occurrence.key, occurrence, evidence,
    configuredJiraInstanceId: 'jira-eng', configuredNewsletterConnectionIds: ['newsletter'],
    preparation: { blocks: [{ start: instant('2026-11-29T11:45:00+02:00'), end: instant('2026-11-29T12:00:00+02:00') }] },
  });
  if (!brief.eligible) throw new Error('The sample meeting should be eligible.');
  return brief;
})();

