// Connects the meeting brief sheet to the renderer store: loads the brief for the requested occurrence,
// reloads it after each snapshot revision (main invalidates on moves, cancellations and evidence changes),
// opens cited sources, sends prep feedback and runs the optional, consented summary.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { HyperHubFeedbackEvent, HyperHubRejectCode } from '@shared/HyperTaskHub';
import { useHyperTaskHub } from '../state/useHyperTaskHub';
import { HyperMeetingBriefSheet, type HyperMeetingBriefState, type HyperMeetingSummaryState } from './HyperMeetingBriefSheet';
import { useHyperHubBriefRequest } from './useHyperHubBriefRequest';

const hyperBriefRejections: Record<HyperHubRejectCode, string> = {
  'scope-changed': 'Your account or workspace changed.',
  'revision-conflict': 'The meeting changed. The brief was reloaded.',
  unavailable: 'The brief is unavailable right now.',
  'access-denied': 'This meeting or source is no longer available to you.',
  invalid: 'There is no brief for this meeting.',
};

export function HyperMeetingBriefController({ zone, nowMs, onFeedback }: {
  zone: string;
  nowMs: number;
  /** The page's feedback path (toasts and Undo). */
  onFeedback: (event: HyperHubFeedbackEvent) => void;
}) {
  const meetingId = useHyperHubBriefRequest(s => s.meetingId);
  const revision = useHyperTaskHub(s => s.snapshot ? `${s.snapshot.scopeGeneration}:${s.snapshot.revision}` : null);
  const [state, setState] = useState<HyperMeetingBriefState>({ status: 'loading' });
  const [summariesAvailable, setSummariesAvailable] = useState(false);
  const [summary, setSummary] = useState<HyperMeetingSummaryState>({ status: 'idle' });

  useEffect(() => { setSummary({ status: 'idle' }); }, [meetingId]);
  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    setState(current => current.status === 'ready' ? current : { status: 'loading' });
    void useHyperTaskHub.getState().getBrief(meetingId).then(result => {
      if (cancelled) return;
      if (result.ok) { setState({ status: 'ready', brief: result.brief }); setSummariesAvailable(result.summariesAvailable); }
      else setState({ status: 'error', error: hyperBriefRejections[result.code] });
    }, error => { if (!cancelled) setState({ status: 'error', error: error instanceof Error ? error.message : 'The brief is unavailable right now.' }); });
    return () => { cancelled = true; };
  }, [meetingId, revision]);

  const version = () => {
    const snapshot = useHyperTaskHub.getState().snapshot;
    return { scopeGeneration: snapshot?.scopeGeneration ?? 0, expectedRevision: snapshot?.revision ?? 0 };
  };
  const subject = state.status === 'ready' && state.brief.eligible ? state.brief.meeting.subject : 'the meeting';

  return <HyperMeetingBriefSheet open={!!meetingId} onOpenChange={open => { if (!open) useHyperHubBriefRequest.getState().close(); }}
    state={state} zone={zone} nowMs={nowMs} summary={summary}
    onOpenEvidence={evidenceId => {
      if (!meetingId) return;
      void useHyperTaskHub.getState().openBriefEvidence(meetingId, evidenceId).then(result => { if (!result.ok) toast.error(hyperBriefRejections[result.code]); });
    }}
    onMarkPrepared={meetingId ? () => onFeedback({ type: 'mark-prepared', meetingId, ...version() }) : undefined}
    onAddPrepTask={meetingId ? () => onFeedback({ type: 'add-prep-task', meetingId, title: `Prepare for ${subject}`.slice(0, 1024), ...version() }) : undefined}
    onBlockBefore={meetingId ? () => onFeedback({ type: 'block-before', meetingId, ...version() }) : undefined}
    onSummarize={meetingId && summariesAvailable ? evidenceIds => {
      setSummary({ status: 'running' });
      void useHyperTaskHub.getState().summarizeBrief(meetingId, evidenceIds).then(
        result => setSummary(result.ok ? { status: 'done', text: result.text, citations: result.citations } : { status: 'failed', error: hyperBriefRejections[result.code] + ' The brief below is unchanged.' }),
        () => setSummary({ status: 'failed', error: 'The summary failed. The brief below is unchanged.' }),
      );
    } : undefined} />;
}
