import { hyperCompareFocusOrder, hyperTaskIsPlanCandidate } from './HyperDayPlanner';
import { hyperRankTasks, type HyperHubRankInput } from './HyperPriorityEngine';
import type { HyperHubRankReason, HyperHubTaskView, HyperHubWeights, HyperHubWeightsDiff, HyperHubWeightsDiffRow } from './HyperTaskHub';

export { hyperNormalizeWeights } from './HyperPriorityEngine';

function focusRanks(input: HyperHubRankInput, weights: Readonly<HyperHubWeights>, cohort: readonly HyperHubTaskView[]) {
  const ranking = hyperRankTasks({ ...input, weights });
  const positions = new Map(ranking.map((rank, index) => [rank.taskId, index]));
  return [...cohort].sort((a, b) => hyperCompareFocusOrder(a, b, positions))
    .map(task => ranking[positions.get(task.id)!]);
}

function signalCents(reasons: readonly HyperHubRankReason[]): HyperHubWeights {
  const points = { slack: 0, importance: 0, unblocking: 0, age: 0 };
  for (const reason of reasons) points[reason.signal] = Math.round(reason.points * 100);
  return points;
}

/** Both rankings use the same clock, inputs and Focus membership. */
export function hyperPreviewWeights(
  input: Omit<HyperHubRankInput, 'weights'>, saved: Readonly<HyperHubWeights>, draft: Readonly<HyperHubWeights>,
): HyperHubWeightsDiff {
  const cohort = input.tasks.filter(hyperTaskIsPlanCandidate);
  const savedRanks = focusRanks(input, saved, cohort);
  const draftRanks = focusRanks(input, draft, cohort);
  const savedById = new Map(savedRanks.map((rank, index) => [rank.taskId, { rank, position: index + 1 }]));
  const rows: HyperHubWeightsDiffRow[] = [];
  const topTen: HyperHubWeightsDiffRow[] = [];
  let movedCount = 0;
  for (const [index, rank] of draftRanks.entries()) {
    const before = savedById.get(rank.taskId)!;
    const newPosition = index + 1;
    const moved = newPosition !== before.position;
    const changed = moved || rank.scoreCents !== before.rank.scoreCents;
    if (moved) movedCount++;
    if (!changed && index >= 10) continue;
    const previous = signalCents(before.rank.reasons);
    const next = signalCents(rank.reasons);
    const row: HyperHubWeightsDiffRow = {
      taskId: rank.taskId, oldPosition: before.position, newPosition,
      oldScoreCents: before.rank.scoreCents, newScoreCents: rank.scoreCents,
      signalDeltaCents: {
        slack: next.slack - previous.slack, importance: next.importance - previous.importance,
        unblocking: next.unblocking - previous.unblocking, age: next.age - previous.age,
      },
    };
    if (changed) rows.push(row);
    if (index < 10) topTen.push(row);
  }
  return { rows, topTen, movedCount };
}
