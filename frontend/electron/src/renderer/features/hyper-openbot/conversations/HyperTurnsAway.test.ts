import { expect, it, vi } from 'vitest';
import { turnsLeftRunning, turnsNoLongerAway, turnsGoingAway, onTurnFinishedAway, turnFinishedAway, onTurnsAwayChanged } from './HyperTurnsAway';
it('tracks turns across native navigation without double counting and notifies the reopened view', () => {
  const token = {}; const changed = vi.fn(); const finished = vi.fn();
  const off = onTurnsAwayChanged('channel', changed); const offFinished = onTurnFinishedAway('channel', finished);
  turnsLeftRunning('channel', [token]); turnsLeftRunning('channel', [token]); expect(turnsGoingAway('channel')).toBe(1); expect(changed).toHaveBeenCalledOnce();
  turnsNoLongerAway('channel', [token]); turnFinishedAway('channel'); expect(turnsGoingAway('channel')).toBe(0); expect(finished).toHaveBeenCalledOnce();
  off(); offFinished(); turnFinishedAway('channel'); expect(finished).toHaveBeenCalledOnce();
});
