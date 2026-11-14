import { expect, it } from 'vitest';
import { hyperActivityIsRoutine, hyperBotRoutinesSummary, type HyperActivityItem } from './HyperBotActivityTab';
const item = (id: string, kind: string) => ({ id, kind } as HyperActivityItem);
it('counts a goal and its scheduled start once and includes enabled check-ins', () => {
  const activity = { inProgress: [], completed: [], scheduled: [item('routine:start', 'routine'), item('goal', 'responsibility'), item('follow', 'follow_up')], onDemand: [item('manual-goal', 'responsibility')] };
  expect(hyperBotRoutinesSummary(activity, new Set(['start']), 2)).toBe('3 scheduled · 1 on demand');
  expect(hyperActivityIsRoutine(item('responsibility-run:run', 'responsibility'))).toBe(false);
  expect(hyperActivityIsRoutine(item('goal', 'responsibility'))).toBe(true);
});
