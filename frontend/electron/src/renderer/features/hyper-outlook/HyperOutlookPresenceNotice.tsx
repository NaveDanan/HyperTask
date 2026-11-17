import { useEffect, useId } from 'react';
import { createStore, useStore } from 'zustand';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { createHyperOutlookNotice, hyperOutlookNoticeDeadline, hyperOutlookNoticeUpdate, type HyperOutlookNoticeAction } from './HyperOutlookNoticeState';

// Session memory and one IPC subscription survive shell remounts, including sign-out. Only the signed-in shell renders it.
const hyperOutlookNotice = createStore(() => createHyperOutlookNotice(Date.now()));
let hyperOutlookNoticeStarted = false;
let hyperOutlookNoticeTimer: ReturnType<typeof setTimeout> | null = null;
function hyperOutlookNoticeDispatch(action: HyperOutlookNoticeAction) {
  const state = hyperOutlookNoticeUpdate(hyperOutlookNotice.getState(), action);
  hyperOutlookNotice.setState(state, true);
  if (hyperOutlookNoticeTimer) clearTimeout(hyperOutlookNoticeTimer);
  const deadline = hyperOutlookNoticeDeadline(state);
  hyperOutlookNoticeTimer = deadline === null ? null : setTimeout(() => hyperOutlookNoticeDispatch({ type: 'tick', now: Date.now() }), Math.max(0, deadline - Date.now()));
}
function hyperOutlookNoticeStart() {
  if (hyperOutlookNoticeStarted || !window.hypertask?.outlook?.onPresence) return;
  hyperOutlookNoticeStarted = true;
  let received = false;
  window.hypertask.outlook.onPresence(presence => { received = true; hyperOutlookNoticeDispatch({ type: 'presence', presence, now: Date.now() }); });
  void window.hypertask.outlook.presence().then(result => { if (!received && result.ok) hyperOutlookNoticeDispatch({ type: 'presence', presence: result.value, now: Date.now() }); }).catch(() => {});
  hyperOutlookNoticeDispatch({ type: 'tick', now: Date.now() });
}
async function hyperOutlookNoticeLaunch() {
  if (hyperOutlookNotice.getState().openingUntil !== null) return;
  hyperOutlookNoticeDispatch({ type: 'launch', now: Date.now() });
  const deadline = hyperOutlookNotice.getState().openingUntil;
  if (deadline === null) return;
  try {
    const result = await window.hypertask.outlook.launch();
    if (!result.ok) hyperOutlookNoticeDispatch({ type: 'failure', deadline, error: result.message, now: Date.now() });
  } catch { hyperOutlookNoticeDispatch({ type: 'failure', deadline, error: 'Could not open Outlook. Open it from the Start menu, then try again.', now: Date.now() }); }
}
export function HyperOutlookPresenceNotice() {
  const state = useStore(hyperOutlookNotice), title = useId(), description = useId();
  useEffect(hyperOutlookNoticeStart, []);
  if (!state.visible) return null;
  const opening = state.openingUntil !== null;
  return (
    <section role="region" aria-labelledby={title} aria-describedby={description} className={`fixed bottom-32 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] max-h-[calc(100dvh-12rem)] overflow-y-auto p-4 ${floatingSurfaceClass}`}>
      <div role="status" aria-live="polite">
        <h2 id={title} className="text-sm font-semibold">Outlook is closed</h2>
        <p id={description} className="mt-2 text-sm leading-relaxed text-muted-foreground">HyperTask uses Outlook for your calendar, mail and Hyper-Bot tools. Keep Outlook open to get the full HyperTask experience — minimize its window instead of closing it.</p>
      </div>
      {state.error && <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" disabled={opening} aria-busy={opening} onClick={() => void hyperOutlookNoticeLaunch()}>
          {opening && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
          {opening ? 'Opening Outlook…' : 'Open Outlook'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => hyperOutlookNoticeDispatch({ type: 'dismiss', now: Date.now() })}>Not now</Button>
      </div>
    </section>
  );
}
