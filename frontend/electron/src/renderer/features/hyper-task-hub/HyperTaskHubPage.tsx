// HyperTaskHub page: connects HyperTaskHubView to the renderer store (Astra's useHyperTaskHub) and adds
// setup, the saved view choice, undo toasts and readable rejections. Actions change local Hub state only
// (spec D10).
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { HyperHubFeedbackEvent, HyperHubRejectCode, HyperHubSetupScope, HyperHubSourceRef } from '@shared/HyperTaskHub';
import type { UserProfilePB } from '@shared/protobuf/hyper-user/user_profile_pb';
import { getHyperJiraStore } from '@/features/jira/logic/HyperJiraRegistry';
import { openSettings } from '@/features/home/notifiers';
import { KeyValueStorage } from '@/startup/kv';
import { useTabsStore } from '@/features/tabs/tabs-store';
import { hyperHubStateLabels } from './board/HyperHubCard';
import { HyperMeetingBriefController } from './brief/HyperMeetingBriefController';
import { HyperTaskHubView, hyperIsTaskHubViewId, type HyperTaskHubViewId } from './HyperTaskHubView';
import { HyperTaskHubSetupSheet } from './setup/HyperTaskHubSetupSheet';
import { useHyperTaskHubNavigation } from './HyperTaskHubNavigation';
import { HyperMirrorController } from './mirror/HyperMirrorFlow';
import { hyperMatrixTitle } from './matrix/HyperMatrixView';
import { hyperWriteSourceName } from './writeback/HyperWriteBackDialog';
import { HyperWriteBackController, hyperLatestWrite, hyperWritableSources, useHyperWriteBackRequest } from './writeback/useHyperWriteBackFlow';
import { HyperTaskHubClient } from './state/HyperTaskHubClient';
import { useHyperTaskHub } from './state/useHyperTaskHub';

const hyperHubRejections: Record<HyperHubRejectCode, string> = {
  'scope-changed': 'Your account or workspace changed. Task Hub reloaded.',
  'revision-conflict': 'Task Hub changed while you were working. Try again.',
  unavailable: 'Task Hub is unavailable right now.',
  'access-denied': 'That source is no longer available to you.',
  invalid: 'That change is not allowed.',
};

/** What a toast says after a local action; undo has no toast of its own. */
function hyperHubFeedbackDone(event: HyperHubFeedbackEvent): string | null {
  switch (event.type) {
    case 'accept': return 'Accepted into Next';
    case 'dismiss': return 'Dismissed';
    case 'pin': return 'Pinned to the top';
    case 'unpin': return 'Unpinned';
    case 'snooze': return 'Snoozed';
    case 'not-today': return 'Moved out of today';
    case 'set-state': return event.state === 'done' ? 'Done for you' : event.state === 'doing' ? 'Started' : `Moved to ${hyperHubStateLabels[event.state]}`;
    case 'reorder': return 'Order updated';
    case 'reschedule': return 'Block fixed at the new time';
    case 'link': return 'Linked';
    case 'unlink': return 'Unlinked';
    case 'merge': return 'Merged';
    case 'split': return 'Split';
    case 'declare-availability': return 'Free window added';
    case 'clear-availability': return 'Free windows cleared';
    case 'undo': return null;
    default: return event.type === 'edit' ? 'Updated'
      : event.type === 'reject-match' ? 'Kept separate'
      : event.type === 'mark-prepared' ? 'Marked as prepared'
      : event.type === 'add-prep-task' ? 'Prep task added'
      : event.type === 'block-before' ? 'Blocked 15 minutes before the meeting'
      : event.type === 'set-matrix-quadrant' ? `Moved to ${hyperMatrixTitle(event.quadrant)}`
      : 'Saved';
  }
}

/**
 * After a local Start, Done or move (M5 E1.9), the toast may offer to review the same change in the source.
 * Nothing is fetched until the owner clicks; dismissing the toast changes nothing.
 */
function hyperHubSourceOffer(event: HyperHubFeedbackEvent): { label: string; onClick: () => void } | undefined {
  if (event.type !== 'set-state' || (event.state !== 'ready' && event.state !== 'doing' && event.state !== 'done')) return undefined;
  const snapshot = useHyperTaskHub.getState().snapshot;
  const task = snapshot?.tasks.find(item => item.id === event.targetId);
  if (!snapshot || !task) return undefined;
  const write = hyperLatestWrite(snapshot.writes, task.id);
  if (write?.held && !write.ownerReleasedAt) return undefined;
  const target = hyperWritableSources(task).find(({ source, write: writeSource }) => source.statusWrite?.available && snapshot.settings.writeBack?.[writeSource]?.enabled);
  if (!target) return undefined;
  const state = event.state;
  return { label: `Also update ${hyperWriteSourceName[target.write]}…`, onClick: () => useHyperWriteBackRequest.getState().open({ title: task.title, writeSource: target.write, source: target.source, intent: { kind: 'state', state } }) };
}

/** Re-renders each minute so relative times, "today" and the now line stay current. */
function useHyperHubNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return now;
}

const hyperHubViewKey = (userId: string) => `hyperTaskHubView:${userId}`;

export function HyperTaskHubPage({ userProfile }: { userProfile?: UserProfilePB | null }) {
  const snapshot = useHyperTaskHub(s => s.snapshot);
  const loading = useHyperTaskHub(s => s.loading);
  const error = useHyperTaskHub(s => s.error);
  const nowMs = useHyperHubNow();
  const userId = userProfile ? String(userProfile.id) : 'local';
  const [view, setView] = useState<HyperTaskHubViewId>(() => { const saved = KeyValueStorage.get(hyperHubViewKey(userId)); return hyperIsTaskHubViewId(saved) ? saved : 'focus'; });
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupScope, setSetupScope] = useState<HyperHubSetupScope | null>(null);
  useEffect(() => { void useHyperTaskHub.getState().load(); }, []);
  // Focus visibility drives main's once-a-minute availability refresh (spec D3.5): Focus must be the view,
  // the Task Hub tab active, and the window visible.
  const tabActive = useTabsStore(s => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:taskhub');
  const [windowVisible, setWindowVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setWindowVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const focusVisible = view === 'focus' && tabActive && windowVisible;
  useEffect(() => {
    void useHyperTaskHub.getState().setFocusVisible(focusVisible);
    return () => { void useHyperTaskHub.getState().setFocusVisible(false); };
  }, [focusVisible]);

  const changeView = useCallback((next: HyperTaskHubViewId) => {
    setView(next);
    void KeyValueStorage.set(hyperHubViewKey(userId), next).catch(() => {});
  }, [userId]);
  // HyperHome and the command palette can open the Hub on a chosen view.
  const requestedView = useHyperTaskHubNavigation(s => s.view);
  useEffect(() => {
    if (!requestedView) return;
    changeView(requestedView);
    useHyperTaskHubNavigation.getState().clear();
  }, [requestedView, changeView]);
  const onFeedback = useCallback(async (event: HyperHubFeedbackEvent) => {
    const send = (next: HyperHubFeedbackEvent) => useHyperTaskHub.getState().sendFeedback(next);
    const result = await send(event);
    if (!result.ok) { toast.error(hyperHubRejections[result.code]); return; }
    const done = hyperHubFeedbackDone(event);
    if (!done) return;
    const ledgerEntryId = result.ledgerEntryId;
    const undo: HyperHubFeedbackEvent | null = event.type === 'set-matrix-quadrant'
      ? { type: 'undo', targetId: event.taskId, ledgerEntryId, scopeGeneration: result.scopeGeneration, expectedRevision: result.revision }
      : 'targetId' in event
      ? { type: 'undo', targetId: event.targetId, ledgerEntryId, scopeGeneration: result.scopeGeneration, expectedRevision: result.revision }
      : 'day' in event ? { type: 'undo', day: event.day, ledgerEntryId, scopeGeneration: result.scopeGeneration, expectedRevision: result.revision }
      : 'meetingId' in event ? { type: 'undo', meetingId: event.meetingId, ledgerEntryId, scopeGeneration: result.scopeGeneration, expectedRevision: result.revision }
      : null;
    const offer = hyperHubSourceOffer(event);
    toast(done, undo ? { cancel: offer, action: { label: 'Undo', onClick: () => {
      const latest = useHyperTaskHub.getState().snapshot;
      const current = latest ? { ...undo, scopeGeneration: latest.scopeGeneration, expectedRevision: latest.revision } as HyperHubFeedbackEvent : undo;
      void send(current).then(outcome => { if (!outcome.ok) toast.error(hyperHubRejections[outcome.code]); });
    } } } : offer ? { cancel: offer } : undefined);
  }, []);
  const onOpenSource = useCallback(async (source: HyperHubSourceRef) => {
    const result = await useHyperTaskHub.getState().openSource(source.handle);
    if (!result.ok) toast.error(hyperHubRejections[result.code]);
  }, []);
  // The gear runs first-run setup until setup is complete, then opens Settings → Task Hub (M5 E5).
  const openSetup = useCallback(() => {
    if (useHyperTaskHub.getState().snapshot?.settings.setupComplete) { openSettings.emit('taskhub'); return; }
    void HyperTaskHubClient.getSetupScope().then(setup => setSetupScope(setup.scope), () => setSetupScope(null)).finally(() => setSetupOpen(true));
  }, []);
  const saveSetup = useCallback(async (scope: HyperHubSetupScope) => {
    await useHyperTaskHub.getState().setSetupScope(scope);
    const failure = useHyperTaskHub.getState().error;
    if (failure) throw new Error(failure in hyperHubRejections ? hyperHubRejections[failure as HyperHubRejectCode] : failure);
    toast('Task Hub is importing your tasks');
  }, []);
  const onOpenHandle = useCallback(async (handle: string) => {
    const result = await useHyperTaskHub.getState().openSource(handle);
    if (!result.ok) toast.error(hyperHubRejections[result.code]);
  }, []);
  const loadSetupOptions = useCallback(() => useHyperTaskHub.getState().getSetupOptions(), []);
  const defaultJiraProject = userProfile ? getHyperJiraStore(userId).getState().config?.projectKey : undefined;
  const errorText = error && error in hyperHubRejections ? hyperHubRejections[error as HyperHubRejectCode] : error;

  return <>
    <HyperTaskHubView snapshot={snapshot} loading={loading && !snapshot} refreshing={loading && !!snapshot} error={errorText} nowMs={nowMs}
      view={view} onViewChange={changeView}
      onRefresh={() => void useHyperTaskHub.getState().refresh()} onRetry={() => void useHyperTaskHub.getState().load()}
      onFeedback={event => void onFeedback(event)} onOpenSource={source => void onOpenSource(source)} onOpenHandle={handle => void onOpenHandle(handle)} onSetup={openSetup} />
    <HyperTaskHubSetupSheet open={setupOpen} onOpenChange={setSetupOpen} initial={setupScope} defaultJiraProject={defaultJiraProject} loadOptions={loadSetupOptions} onSave={saveSetup} />
    <HyperWriteBackController onOpenSource={source => void onOpenSource(source)} />
    <HyperMirrorController onOpenHandle={handle => void onOpenHandle(handle)} />
    <HyperMeetingBriefController zone={snapshot?.settings.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} nowMs={nowMs} onFeedback={event => void onFeedback(event)} />
  </>;
}
