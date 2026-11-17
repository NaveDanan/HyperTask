import type { HyperOutlookPresenceState } from '@shared/HyperOutlookPresence';
export const HyperOutlookStartupGrace = 5000;
export const HyperOutlookConnectWait = 90000;
export interface HyperOutlookNoticeState {
  startedAt: number; now: number; presence: HyperOutlookPresenceState | null; seenRunning: boolean;
  silenced: boolean; visible: boolean; openingUntil: number | null; error: string | null;
}
export type HyperOutlookNoticeAction =
  | { type: 'presence'; presence: HyperOutlookPresenceState; now: number }
  | { type: 'tick' | 'dismiss' | 'launch'; now: number }
  | { type: 'failure'; deadline: number; error: string; now: number };
export function createHyperOutlookNotice(now: number): HyperOutlookNoticeState {
  return { startedAt: now, now, presence: null, seenRunning: false, silenced: false, visible: false, openingUntil: null, error: null };
}
export function hyperOutlookNoticeUpdate(previous: HyperOutlookNoticeState, action: HyperOutlookNoticeAction): HyperOutlookNoticeState {
  const state = { ...previous, now: action.now };
  if (state.openingUntil !== null && action.now >= state.openingUntil) {
    state.openingUntil = null; state.error = 'Outlook is taking longer to connect. Check its profile window, then try again.';
  }
  if (action.type === 'presence') {
    if (!state.presence?.installed && action.presence.installed && !state.seenRunning) state.startedAt = action.now;
    state.presence = action.presence;
    if (action.presence.running) { state.seenRunning = true; state.silenced = false; }
  }
  if (action.type === 'dismiss') { state.silenced = true; state.visible = false; state.openingUntil = null; state.error = null; return state; }
  if (state.presence?.connected || !state.presence?.installed) { state.visible = false; state.openingUntil = null; state.error = null; return state; }
  if (!state.presence.running && !state.silenced && (state.seenRunning || action.now >= state.startedAt + HyperOutlookStartupGrace)) state.visible = true;
  if (action.type === 'launch' && state.visible && state.openingUntil === null) { state.openingUntil = action.now + HyperOutlookConnectWait; state.error = null; }
  if (action.type === 'failure' && state.openingUntil === action.deadline) { state.openingUntil = null; state.error = action.error; }
  return state;
}
export function hyperOutlookNoticeDeadline(state: HyperOutlookNoticeState): number | null {
  const grace = state.startedAt + HyperOutlookStartupGrace;
  return state.now < grace ? Math.min(grace, state.openingUntil ?? Infinity) : state.openingUntil;
}
