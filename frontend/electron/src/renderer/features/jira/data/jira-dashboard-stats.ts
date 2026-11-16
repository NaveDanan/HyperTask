import { JiraIssue, JiraStatusCategory } from './models/jira-issue';
export type JiraCategoryCounts = Record<JiraStatusCategory, number>;
const counts = (): JiraCategoryCounts => ({ new: 0, indeterminate: 0, done: 0, undefined: 0 });
export class HyperJiraAssigneeProgress {
  constructor(readonly name: string, readonly displayName: string, readonly byCategory: JiraCategoryCounts) {}
  get total(): number { return Object.values(this.byCategory).reduce((a, b) => a + b, 0); }
  get done(): number { return this.byCategory.done; }
  get inProgress(): number { return this.byCategory.indeterminate; }
  get progress(): number { return this.total ? this.done / this.total : 0; }
}
export interface JiraStatusCount { category: JiraStatusCategory; count: number }
/** Aggregates the categories Jira reports, never guesses from workflow names. */
export class HyperJiraDashboardStats {
  constructor(readonly total: number, readonly byCategory: JiraCategoryCounts, readonly byStatus: Record<string, JiraStatusCount>, readonly byAssignee: HyperJiraAssigneeProgress[]) {}
  static from(issues: Iterable<JiraIssue>): HyperJiraDashboardStats {
    const byCategory = counts(), byStatus: Record<string, JiraStatusCount> = Object.create(null);
    const assignees = new Map<string, HyperJiraAssigneeProgress>(); let total = 0;
    for (const i of issues) {
      total++; byCategory[i.statusCategory]++;
      byStatus[i.statusName] = { category: i.statusCategory, count: (byStatus[i.statusName]?.count ?? 0) + 1 };
      const name = i.assignee?.name ?? '';
      if (!assignees.has(name)) assignees.set(name, new HyperJiraAssigneeProgress(name, i.assignee ? i.assigneeLabel : 'Unassigned', counts()));
      assignees.get(name)!.byCategory[i.statusCategory]++;
    }
    const byAssignee = [...assignees.values()].sort((a, b) => (b.total - b.done) - (a.total - a.done) || (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0));
    return new HyperJiraDashboardStats(total, byCategory, byStatus, byAssignee);
  }
  count(c: JiraStatusCategory): number { return this.byCategory[c]; }
  get open(): number { return this.total - this.byCategory.done; }
  get progress(): number { return this.total ? this.byCategory.done / this.total : 0; }
}
export { HyperJiraDashboardStats as JiraDashboardStats, HyperJiraAssigneeProgress as JiraAssigneeProgress };
