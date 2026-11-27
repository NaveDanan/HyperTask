// Write-back flow (M5 E1.9, E1.10). Any card, chip or toast asks for a status change through
// useHyperWriteBackRequest; HyperWriteBackController (rendered once by the Hub page) fetches main's preview,
// shows the review dialog and handles each approval outcome. Main's native confirmation, not this dialog,
// authorizes the send.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { HyperHubSourceRef, HyperHubStatusIntent, HyperHubStatusPreview, HyperHubTaskView, HyperHubWriteSource, HyperHubWriteView } from '@shared/HyperTaskHub';
import { useHyperTaskHub } from '../state/useHyperTaskHub';
import { HyperWriteBackDialog, hyperWriteSourceName, type HyperWriteBackDialogState, type HyperWriteBackNotice } from './HyperWriteBackDialog';
import { hyperWriteConflictText, hyperWriteRejectText } from './hyperWriteBackText';

/** The write source for a reference, or null when the reference can never be written. */
export function hyperWriteSourceOf(source: HyperHubSourceRef): HyperHubWriteSource | null {
  if (source.role !== 'origin' && source.role !== 'assignment') return null;
  return source.kind === 'jira' ? 'jira' : source.kind === 'newsletter-task' ? 'newsletter' : null;
}

/** References on a card that may offer a status change (E1.1), primary first. */
export function hyperWritableSources(task: HyperHubTaskView): { source: HyperHubSourceRef; write: HyperHubWriteSource }[] {
  return task.sources.flatMap(source => {
    const write = hyperWriteSourceOf(source);
    return write && source.statusWrite ? [{ source, write }] : [];
  });
}

/** The latest write for a task, if any. */
export function hyperLatestWrite(writes: readonly HyperHubWriteView[] | undefined, taskId: string): HyperHubWriteView | undefined {
  let latest: HyperHubWriteView | undefined;
  for (const write of writes ?? []) if (write.taskId === taskId && (!latest || write.at.iso > latest.at.iso)) latest = write;
  return latest;
}

interface HyperWriteBackRequest {
  key: number;
  title: string;
  writeSource: HyperHubWriteSource;
  /** Absent for a reverse intent: main resolves the operation's recorded target. */
  source?: HyperHubSourceRef;
  intent: HyperHubStatusIntent;
}

interface HyperWriteBackRequestStore {
  request: HyperWriteBackRequest | null;
  open: (request: Omit<HyperWriteBackRequest, 'key'>) => void;
  close: () => void;
}

let hyperWriteRequestKey = 0;
export const useHyperWriteBackRequest = create<HyperWriteBackRequestStore>(set => ({
  request: null,
  open: request => set({ request: { ...request, key: ++hyperWriteRequestKey } }),
  close: () => set({ request: null }),
}));

/** Releases a held task after the owner checked the source (E1.7). */
export async function hyperReleaseHold(write: HyperHubWriteView): Promise<void> {
  const snapshot = useHyperTaskHub.getState().snapshot;
  if (!snapshot) return;
  const result = await useHyperTaskHub.getState().releaseHold({ scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision, operationId: write.operationId });
  if (result.ok) toast(`Released. Task Hub plans with what ${hyperWriteSourceName[write.source]} shows now.`);
  else toast.error(hyperWriteRejectText(result.code, write.source));
}

export function HyperWriteBackController({ onOpenSource }: { onOpenSource: (source: HyperHubSourceRef) => void }) {
  const request = useHyperWriteBackRequest(s => s.request);
  const close = useHyperWriteBackRequest(s => s.close);
  const [state, setState] = useState<HyperWriteBackDialogState>({ status: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<HyperWriteBackNotice | null>(null);
  // The preview id main still holds, so closing the dialog can discard it.
  const live = useRef<string | null>(null);
  const requestKey = request?.key;

  const show = useCallback((preview: HyperHubStatusPreview) => {
    live.current = preview.previewId;
    setState({ status: 'ready', preview });
    setExpired(false);
  }, []);

  const fetchPreview = useCallback(async (current: HyperWriteBackRequest) => {
    const snapshot = useHyperTaskHub.getState().snapshot;
    if (!snapshot) { setState({ status: 'rejected', message: hyperWriteRejectText('unavailable', current.writeSource) }); return; }
    setState({ status: 'loading' }); setNotice(null); setExpired(false);
    const version = { scopeGeneration: snapshot.scopeGeneration, expectedRevision: snapshot.revision };
    const result = await useHyperTaskHub.getState().previewStatus(current.intent.kind === 'reverse'
      ? { ...version, intent: current.intent }
      : { ...version, handle: current.source!.handle, intent: current.intent });
    if (useHyperWriteBackRequest.getState().request?.key !== current.key) {
      if (result.ok) void useHyperTaskHub.getState().discardStatus({ previewId: result.preview.previewId });
      return;
    }
    if (result.ok) show(result.preview);
    else setState({ status: 'rejected', message: hyperWriteRejectText(result.code, current.writeSource) });
  }, [show]);

  useEffect(() => {
    if (!request) return;
    setConfirming(false);
    void fetchPreview(request);
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview lives 60 seconds in main; after that the primary action re-checks (E1.10).
  const expiresAt = state.status === 'ready' ? state.preview.expiresAt.iso : null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  const dismiss = useCallback(() => {
    if (live.current) void useHyperTaskHub.getState().discardStatus({ previewId: live.current });
    live.current = null;
    close();
  }, [close]);

  const approve = useCallback(async (candidateId: string, resolutionId?: string) => {
    if (!request || state.status !== 'ready') return;
    const { preview } = state;
    const sourceName = hyperWriteSourceName[preview.source];
    setConfirming(true); setNotice(null);
    // Approval consumes the preview in main, whatever the outcome.
    live.current = null;
    const result = await useHyperTaskHub.getState().approveStatus({ previewId: preview.previewId, candidateId, ...(resolutionId ? { resolutionId } : {}) });
    if (useHyperWriteBackRequest.getState().request?.key !== request.key) return;
    setConfirming(false);
    switch (result.outcome) {
      case 'cancelled':
        setExpired(true);
        return;
      case 'expired':
        setExpired(true);
        setNotice({ tone: 'info', title: 'This preview expired', description: `Check again to see what ${sourceName} shows now.` });
        return;
      case 'conflict':
        show(result.preview);
        setNotice({ tone: 'warning', title: hyperWriteConflictText(result.preview), description: 'Review the change again.' });
        return;
      case 'failed':
        setExpired(true);
        setNotice({ tone: result.code === 'forbidden' || result.code === 'reconnect' ? 'destructive' : 'warning', title: hyperWriteRejectText(result.code, preview.source) });
        return;
      case 'unknown':
        close();
        toast.warning(`${sourceName} didn't confirm the update`, { description: `Task Hub won't send it again. Check in ${sourceName}.` });
        return;
      case 'succeeded': {
        close();
        const { write } = result;
        const label = preview.target.key ?? preview.target.title;
        const message = write.readback === 'verified' ? `${label} is now ${write.observedName ?? write.toName} in ${sourceName}` : `${sourceName} accepted the update. Checking status.`;
        toast(message, write.undoAvailable ? { action: { label: 'Undo', onClick: () => useHyperWriteBackRequest.getState().open({
          title: preview.target.title, writeSource: write.source, intent: { kind: 'reverse', operationId: write.operationId },
        }) } } : undefined);
        return;
      }
    }
  }, [request, state, show, close]);

  if (!request) return null;
  return <HyperWriteBackDialog key={request.key} open source={request.writeSource} fallbackTitle={request.title} state={state} confirming={confirming} expired={expired} notice={notice}
    onOpenChange={next => { if (!next) dismiss(); }}
    onApprove={(candidateId, resolutionId) => void approve(candidateId, resolutionId)}
    onCheckAgain={() => void fetchPreview(request)}
    onOpenSource={request.source?.openable ? () => onOpenSource(request.source!) : undefined} />;
}
