import { expect, it } from 'vitest';
import { createHyperOutlookNotice, hyperOutlookNoticeDeadline, hyperOutlookNoticeUpdate as update, HyperOutlookConnectWait } from './HyperOutlookNoticeState';
const closed = { installed: true, running: false, connected: false };
const loading = { installed: true, running: true, connected: false };
const connected = { ...loading, connected: true };
const presence = (value: typeof closed, now = 0) => ({ type: 'presence' as const, presence: value, now });
const startup = () => update(createHyperOutlookNotice(0), presence(closed));
it('waits five seconds at startup and stays silent when classic Outlook is absent', () => {
  const state = startup(); expect(state.visible).toBe(false); expect(hyperOutlookNoticeDeadline(state)).toBe(5000);
  expect(update(state, { type: 'tick', now: 4999 }).visible).toBe(false);
  expect(update(state, { type: 'tick', now: 5000 }).visible).toBe(true);
  const absent = update(createHyperOutlookNotice(0), presence({ installed: false, running: false, connected: false }));
  expect(update(absent, { type: 'tick', now: 100000 }).visible).toBe(false);
});
it('does not interrupt startup when Outlook auto-starts or is loading its profile', () => {
  const starting = update(startup(), presence(loading, 4500));
  expect(update(starting, { type: 'tick', now: 5000 }).visible).toBe(false);
  const done = update(starting, presence(connected, 6000)); expect(done.visible).toBe(false); expect(done.seenRunning).toBe(true);
});
it('shows immediately after running becomes closed, even during startup grace', () => {
  const state = update(createHyperOutlookNotice(0), presence(connected, 100));
  expect(update(state, presence(closed, 500)).visible).toBe(true);
});
it('Not now silences closure until Outlook has run again, without persistent storage', () => {
  let state = update(startup(), { type: 'tick', now: 5000 }); state = update(state, { type: 'dismiss', now: 5001 });
  state = update(state, presence(closed, 60000)); expect(state.visible).toBe(false); expect(state.silenced).toBe(true);
  state = update(state, presence(loading, 60001)); expect(state.visible).toBe(false); expect(state.silenced).toBe(false);
  expect(update(state, presence(closed, 60002)).visible).toBe(true);
  expect(update(startup(), { type: 'tick', now: 5000 }).visible).toBe(true);
});
it('keeps the existing notice while a manually opened Outlook connects, then hides without success nagging', () => {
  let state = update(startup(), { type: 'tick', now: 5000 }); state = update(state, presence(loading, 5001)); expect(state.visible).toBe(true);
  state = update(state, presence(connected, 7000)); expect(state).toMatchObject({ visible: false, openingUntil: null, error: null });
  expect(update(state, presence(connected, 90000)).visible).toBe(false);
});
it('holds Opening Outlook until connected, and allows a new notice after the next closure', () => {
  let state = update(startup(), { type: 'tick', now: 5000 }); state = update(state, { type: 'launch', now: 5001 });
  const deadline = state.openingUntil; expect(deadline).toBe(5001 + HyperOutlookConnectWait);
  state = update(state, presence(loading, 6000)); expect(state.openingUntil).toBe(deadline);
  state = update(state, presence(connected, 7000)); expect(state).toMatchObject({ visible: false, openingUntil: null, error: null });
  expect(update(state, presence(closed, 8000)).visible).toBe(true);
});
it('times out at ninety seconds, shows inline recovery, and lets the user retry', () => {
  let state = update(startup(), { type: 'tick', now: 5000 }); state = update(state, { type: 'launch', now: 6000 });
  expect(update(state, { type: 'tick', now: 95999 }).openingUntil).toBe(96000);
  state = update(state, { type: 'tick', now: 96000 }); expect(state.openingUntil).toBe(null); expect(state.error).toContain('profile window'); expect(state.visible).toBe(true);
  state = update(state, { type: 'launch', now: 100000 }); expect(state.openingUntil).toBe(190000); expect(state.error).toBe(null);
  expect(update(state, presence(connected, 101000))).toMatchObject({ visible: false, openingUntil: null });
});
it('surfaces launch errors and ignores stale errors after a later attempt or a successful manual connection', () => {
  let state = update(startup(), { type: 'tick', now: 5000 }); state = update(state, { type: 'launch', now: 6000 }); const deadline = state.openingUntil!;
  state = update(state, { type: 'failure', deadline, error: 'Could not open Outlook', now: 6001 }); expect(state).toMatchObject({ openingUntil: null, error: 'Could not open Outlook' });
  state = update(state, { type: 'launch', now: 7000 }); expect(update(state, { type: 'failure', deadline, error: 'old', now: 7001 }).error).toBe(null);
  state = update(state, presence(connected, 8000)); expect(update(state, { type: 'failure', deadline, error: 'old', now: 8001 })).toMatchObject({ visible: false, error: null });
});
it('allows Not now while launching and cannot launch an invisible or uninstalled notice', () => {
  expect(update(startup(), { type: 'launch', now: 1 }).openingUntil).toBe(null);
  let state = update(startup(), { type: 'tick', now: 5000 }); state = update(state, { type: 'launch', now: 6000 });
  state = update(state, { type: 'dismiss', now: 6001 }); expect(state).toMatchObject({ silenced: true, openingUntil: null, visible: false });
  expect(update(state, { type: 'launch', now: 6002 }).openingUntil).toBe(null);
});

it('starts the grace period after installation is known, allowing a full process poll before startup notice', () => {
  let state = update(createHyperOutlookNotice(0), presence({ installed: false, running: false, connected: false }, 500));
  state = update(state, presence(closed, 2000)); expect(hyperOutlookNoticeDeadline(state)).toBe(7000);
  expect(update(state, { type: 'tick', now: 5000 }).visible).toBe(false);
  state = update(state, presence(loading, 6500)); expect(update(state, { type: 'tick', now: 7000 }).visible).toBe(false);
});
