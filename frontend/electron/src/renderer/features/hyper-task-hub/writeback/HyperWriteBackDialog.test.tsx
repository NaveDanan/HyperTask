import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HyperHubStatusPreview, HyperHubWriteView } from '@shared/HyperTaskHub';
import { HyperWriteBackBody, hyperWriteEffectText } from './HyperWriteBackDialog';
import { HyperWriteBadge } from './HyperWriteBadge';
import { hyperWriteConflictText, hyperWriteRejectText } from './hyperWriteBackText';

const instant = (iso: string) => ({ kind: 'instant' as const, iso });
const jiraPreview: HyperHubStatusPreview = {
  previewId: 'p1', expiresAt: instant('2026-11-29T09:01:00Z'), source: 'jira', site: 'jira.example', accountLabel: 'Yael Cohen',
  target: { key: 'ENG-317', title: 'אישור migration של טבלת הלקוחות' },
  current: { id: '3', name: 'In Review', category: 'indeterminate' }, versionLabel: 'Updated 5 min ago',
  candidates: [
    { candidateId: 'c-done', actionLabel: 'Resolve issue', to: { id: '5', name: 'Done', category: 'done' }, preselected: true,
      resolution: { values: [{ id: '1', name: 'Fixed' }, { id: '2', name: "Won't fix" }] }, effects: [{ code: 'any-status-transition' }] },
    { candidateId: 'c-progress', actionLabel: 'Back to work', to: { id: '4', name: 'In Progress', category: 'indeterminate' }, preselected: false, effects: [] },
  ],
  unavailable: [{ actionLabel: 'Close', toName: 'Closed', reason: 'required-fields', fields: ['Fix Version'] }],
  permissionCheckedOnConfirm: false,
};
const newsletterPreview: HyperHubStatusPreview = {
  ...jiraPreview, source: 'newsletter', accountLabel: 'Configured Newsletter connection', site: 'newsletter.example',
  target: { key: 't-12', title: 'Proofread Sunday edition', container: 'Sunday edition' },
  current: { id: 'in-progress', name: 'In progress', category: 'indeterminate', progress: 60 },
  candidates: [{ candidateId: 'n-done', actionLabel: 'Completed', to: { id: 'completed', name: 'Completed', category: 'done' }, preselected: true,
    effects: [{ code: 'progress-set', from: 60, to: 100 }, { code: 'chart-normalized' }, { code: 'parent-rollup' }] }],
  unavailable: [], permissionCheckedOnConfirm: true,
};
const body = (preview: HyperHubStatusPreview, candidateId: string | null, resolutionId: string | null = null, notice?: { tone: 'warning'; title: string }) =>
  renderToStaticMarkup(<HyperWriteBackBody state={{ status: 'ready', preview }} source={preview.source} notice={notice} confirming={false}
    candidateId={candidateId} onCandidate={() => {}} resolutionId={resolutionId} onResolution={() => {}} />);

describe('write-back review body', () => {
  it('shows the account, current status, version and every allowed choice', () => {
    const html = body(jiraPreview, 'c-done');
    for (const text of ['Yael Cohen', 'jira.example', 'In Review', 'Updated 5 min ago', 'Resolve issue', 'Back to work', 'Needs a resolution']) expect(html).toContain(text);
    expect(html).toContain('dir="auto"');
  });

  it('discloses the global-transition race and lists steps Task Hub cannot do', () => {
    const html = body(jiraPreview, 'c-done');
    expect(html).toContain('Jira can apply this from any status');
    expect(html).toContain('Not available here (1)');
    expect(html).toContain('Needs Fix Version that Task Hub can');
  });

  it('shows the chosen resolution only after it is picked', () => {
    expect(body(jiraPreview, 'c-done')).not.toContain('Resolution: <bdi');
    expect(body(jiraPreview, 'c-done', '1')).toContain('Fixed');
  });

  it('spells out Newsletter side effects and the permission check on confirm', () => {
    const html = body(newsletterPreview, 'n-done');
    expect(html).toContain('60% done');
    expect(html).toContain('Completion sets progress to 100% (now 60%). Undo restores the status and leaves progress at 100%.');
    expect(html).toContain('Newsletter also normalizes and reschedules the chart.');
    expect(html).toContain('Parent tasks in this chart can recompute');
    expect(html).toContain('Newsletter checks your permission when you confirm.');
  });

  it('shows the conflict notice with the new status', () => {
    const html = body(jiraPreview, null, null, { tone: 'warning', title: hyperWriteConflictText({ ...jiraPreview, current: { ...jiraPreview.current, name: 'Blocked' } }) });
    expect(html).toContain('ENG-317 changed in Jira since you opened this. It&#x27;s now Blocked.');
  });

  it('explains refusals without a preview', () => {
    const html = renderToStaticMarkup(<HyperWriteBackBody state={{ status: 'rejected', message: hyperWriteRejectText('not-leaf', 'newsletter') }} source="newsletter"
      confirming={false} candidateId={null} onCandidate={() => {}} resolutionId={null} onResolution={() => {}} />);
    expect(html).toContain('This is a parent row');
  });
});

describe('write-back messages', () => {
  it('names the write source in every refusal', () => {
    expect(hyperWriteRejectText('forbidden', 'newsletter')).toContain('Newsletter');
    expect(hyperWriteRejectText('reconnect', 'jira')).toBe("You don't have permission. Reconnect Jira in Settings → Connections.");
    expect(hyperWriteRejectText('rejected', 'jira')).toContain('Open it in Jira');
    expect(hyperWriteRejectText('something-new', 'jira')).toBe('Jira could not be updated.');
  });

  it('describes progress kept when leaving Completed', () => {
    expect(hyperWriteEffectText({ code: 'progress-kept', value: 100 })).toBe('Progress stays at 100%.');
  });
});

describe('write badge', () => {
  const write: HyperHubWriteView = {
    operationId: 'op-1', taskId: 't', evidenceId: 'e', source: 'newsletter', state: 'unknown', at: instant('2026-11-29T08:00:00Z'),
    fromName: 'In progress', toName: 'Completed', undoAvailable: false, held: true, ownerReleaseAvailable: false, readback: 'pending',
  };
  it('names the source for pending, unknown and failed writes', () => {
    expect(renderToStaticMarkup(<HyperWriteBadge write={{ ...write, state: 'pending' }} />)).toContain('Updating Newsletter');
    expect(renderToStaticMarkup(<HyperWriteBadge write={write} />)).toContain('Newsletter update unknown');
    expect(renderToStaticMarkup(<HyperWriteBadge write={{ ...write, state: 'failed', held: false }} />)).toContain('Newsletter not updated');
  });
  it('shows an acknowledged write as waiting until readback is verified', () => {
    expect(renderToStaticMarkup(<HyperWriteBadge write={{ ...write, source: 'jira', state: 'succeeded', readback: 'failed' }} />)).toContain('Waiting for Jira to confirm');
    expect(renderToStaticMarkup(<HyperWriteBadge write={{ ...write, state: 'succeeded', readback: 'verified', held: false }} />)).toBe('');
  });
  it('marks an owner-released hold', () => {
    expect(renderToStaticMarkup(<HyperWriteBadge write={{ ...write, ownerReleasedAt: instant('2026-11-29T08:05:00Z') }} />)).toContain('Released by you');
  });
});
