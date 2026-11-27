import {
  hyperBuildTaskGraph, hyperCompareTaskIds, hyperResolveAvailability, hyperTaskDeadline, hyperTaskFeasibility,
  hyperTaskHasKnownEffort,
  type HyperHubAvailability, type HyperHubHoldInput,
} from './HyperDayPlanner';
import type { HyperHubRanked, HyperHubRankReason, HyperHubSignal, HyperHubTaskView, HyperHubWeights } from './HyperTaskHub';

export interface HyperHubRankInput extends HyperHubHoldInput {
  nowMs: number;
  tasks: readonly HyperHubTaskView[];
  weights?: Readonly<HyperHubWeights>;
  availability?: HyperHubAvailability;
}

const balancedWeights: Readonly<HyperHubWeights> = { slack: 45, importance: 25, unblocking: 20, age: 10 };
const priorityValues = [0, 0.33, 0.67, 1] as const;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function hyperNormalizeWeights({ slack, importance, unblocking, age }: Readonly<HyperHubWeights>): HyperHubWeights {
  const configured = [slack, importance, unblocking, age];
  const largest = Math.max(...configured);
  if (configured.some(weight => !Number.isFinite(weight) || weight < 0) || largest === 0) {
    throw new RangeError('HyperTaskHub weights must be finite and nonnegative, with at least one positive weight.');
  }
  const scaled = configured.map(weight => weight / largest);
  const sum = scaled.reduce((total, weight) => total + weight, 0);
  return { slack: scaled[0] / sum, importance: scaled[1] / sum, unblocking: scaled[2] / sum, age: scaled[3] / sum };
}

/** Scores every task against the same four weights. Pins and actual readiness are independent. */
export function hyperRankTasks({ nowMs, tasks, weights = balancedWeights, availability, ...holds }: HyperHubRankInput): HyperHubRanked[] {
  const normalized = hyperNormalizeWeights(weights);
  const points = [normalized.slack, normalized.importance, normalized.unblocking, normalized.age].map(weight => 100 * weight);
  const graph = hyperBuildTaskGraph(tasks, holds);
  const observedSuccessors = graph.heldTaskIds.size ? hyperBuildTaskGraph(tasks).successors : graph.successors;
  const slackBefore = hyperResolveAvailability(nowMs, availability).slackBefore(tasks, graph.heldTaskIds);
  const deadlines = new Map(tasks.map(task => [task.id, hyperTaskDeadline(task)]));

  const ranked = tasks.map(task => {
    const reasons: HyperHubRankReason[] = [];
    const unknown: HyperHubSignal[] = [];
    let urgency = 0;
    let importance = 0;
    let provisionalSlack = false;
    const deadline = deadlines.get(task.id);
    const effort = task.effortMinutes;

    if (deadline && deadline.ms <= nowMs) {
      urgency = 1;
      reasons.push({
        signal: 'slack', points: points[0], evidenceId: deadline.evidenceId,
        facts: { minutesUntilDue: (deadline.ms - nowMs) / 60_000, deadline: new Date(deadline.ms).toISOString() },
      });
    } else if (deadline && hyperTaskHasKnownEffort(task)) {
      const coverage = slackBefore(deadline.ms);
      if (coverage) {
        const slackMinutes = coverage.freeMinutes - effort;
        urgency = clamp(1 - slackMinutes / 480);
        provisionalSlack = coverage.provisional;
        reasons.push({
          signal: 'slack', points: points[0] * urgency, evidenceId: deadline.evidenceId,
          facts: { minutesUntilDue: (deadline.ms - nowMs) / 60_000, slackMinutes, deadline: new Date(deadline.ms).toISOString() },
        });
      } else unknown.push('slack');
    } else unknown.push('slack');

    const jiraPriority = task.sourcePriority;
    const jiraEvidence = jiraPriority && task.sources.find(source =>
      source.kind === 'jira' && source.evidenceId === jiraPriority.evidenceId);
    const priority = task.ownerPriority ?? (jiraEvidence ? jiraPriority?.mapped : undefined);
    if (priority === undefined) unknown.push('importance');
    else {
      importance = priorityValues[priority];
      reasons.push({
        signal: 'importance', points: points[1] * importance,
        facts: { priority, source: task.ownerPriority === undefined ? 'jira-priority' : 'owner' },
        ...(task.ownerPriority === undefined && { evidenceId: jiraEvidence?.evidenceId }),
      });
    }

    let successors = 0;
    for (const id of observedSuccessors.get(task.id) ?? []) {
      if (graph.byId.get(id)!.authoritativeCompletion === 'open') successors++;
    }
    reasons.push({ signal: 'unblocking', points: points[2] * (Math.min(successors, 5) / 5), facts: { successors } });

    const created = task.createdAt ? Date.parse(task.createdAt.iso) : NaN;
    const ageDays = (nowMs - (Number.isFinite(created) ? created : Date.parse(task.firstSeenAt.iso))) / 86_400_000;
    if (Number.isFinite(ageDays)) reasons.push({ signal: 'age', points: points[3] * clamp(ageDays / 28), facts: { ageDays } });
    else unknown.push('age');

    const scoreCents = Math.round(reasons.reduce((total, reason) => total + reason.points, 0) * 100);
    const result: HyperHubRanked = {
      taskId: task.id, score: scoreCents / 100, scoreCents, urgency, importance, reasons, unknown,
      pinned: task.pinned, feasibility: hyperTaskFeasibility(task, graph, nowMs),
    };
    if (provisionalSlack) result.provisionalSlack = true;
    return result;
  });

  return ranked.sort((a, b) => b.scoreCents - a.scoreCents ||
    ((deadlines.get(a.taskId)?.ms ?? Infinity) - (deadlines.get(b.taskId)?.ms ?? Infinity)) ||
    hyperCompareTaskIds(a.taskId, b.taskId));
}
