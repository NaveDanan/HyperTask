import { expect, it } from 'vitest';
import { JiraDashboardStats } from './jira-dashboard-stats';
import { JiraIssue, JiraStatusCategory } from './models/jira-issue';
import { issueJson } from '../test-utils';
it('Flutter stats count actual category, status and assignee', () => {
  const s = JiraDashboardStats.from([JiraIssue.fromJson(issueJson('DEMO-1', { assignee: 'a' })),
    JiraIssue.fromJson(issueJson('DEMO-2', { assignee: 'a', status: 'Closed', category: 'done' })),
    JiraIssue.fromJson(issueJson('DEMO-3', { assignee: 'b', status: 'In Review', category: 'indeterminate' })),
    JiraIssue.fromJson(issueJson('DEMO-4', { status: 'Resolved', category: 'done' }))]);
  expect(s.total).toBe(4); expect(s.count(JiraStatusCategory.toDo)).toBe(1); expect(s.count(JiraStatusCategory.inProgress)).toBe(1); expect(s.count(JiraStatusCategory.done)).toBe(2);
  expect(s.progress).toBe(0.5); expect(s.open).toBe(2); expect(s.byStatus.Closed).toEqual({ category: JiraStatusCategory.done, count: 1 });
  const a = s.byAssignee.find(a => a.name === 'a')!; expect([a.total, a.done, a.progress]).toEqual([2, 1, 0.5]);
  const u = s.byAssignee.find(a => a.name === '')!; expect(u.displayName).toBe('Unassigned'); expect(u.progress).toBe(1);
});
it('empty and unknown categories have stable counts', () => {
  expect(JiraDashboardStats.from([]).progress).toBe(0);
  const s = JiraDashboardStats.from([JiraIssue.fromJson(issueJson('DEMO-1', { category: 'other' }))]);
  expect(s.byCategory.undefined).toBe(1); expect(s.open).toBe(1);
});
