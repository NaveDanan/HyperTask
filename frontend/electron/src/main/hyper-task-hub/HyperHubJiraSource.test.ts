import { expect, it, vi } from 'vitest';
import { HyperHubJiraSource, hyperHubJql } from './HyperHubJiraSource';
import { scope } from './HyperTaskHub.test-support';

it('strips only the top-level ordering and applies one stable order after the ownership filter', () => {
  expect(hyperHubJql('ENG', 'summary ~ "order by" OR filter = 12 oRdEr BY priority DESC')).toBe(
    'project = "ENG" AND (summary ~ "order by" OR filter = 12) AND statusCategory != Done AND (assignee = currentUser() OR reporter = currentUser()) ORDER BY updated ASC, key ASC');
  expect(hyperHubJql('ENG', 'ORDER BY key')).toBe(hyperHubJql('ENG'));
  expect(() => hyperHubJql('ENG', 'project = "foo')).toThrow();
});
it('reads the Jira account, pages with its credentials, and distinguishes assigned and reported work', async () => {
  const baseUrl = 'https://jira.example/company';
  const user = { accountId: 'own' };
  function issue(id: number) {
    return { id: String(id), key: 'ENG-' + id, fields: { summary: 'Title', updated: '2026-11-01', duedate: '2026-11-29',
      assignee: id === 1 ? user : null, reporter: user, status: { name: 'Open' }, priority: { id: '22' } } };
  }
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test' });
    expect(init?.redirect).toBe('manual');
    if (String(url).endsWith('/myself')) return Response.json(user);
    const { startAt } = JSON.parse(String(init?.body));
    return Response.json({ startAt, total: 2, issues: [issue(startAt + 1)] });
  });
  const source = new HyperHubJiraSource('jira', 'ENG', '', 'Asia/Jerusalem', async () => ({ userId: '1', username: '',
    authType: 'personalAccessToken', authorization: 'Bearer test', baseUrl, projectKey: 'ENG' }), fetcher);
  const batch = await source.read(scope, new AbortController().signal);
  expect(batch.completeness).toBe('complete');
  expect(batch.records.map(r => r.initialState)).toEqual(['ready', 'waiting']);
  expect(batch.records[1]).toMatchObject({ key: { kind: 'jira', instanceId: baseUrl, issueId: '2' }, priorityId: '22',
    due: { kind: 'civil-date', date: '2026-11-29', zone: 'Asia/Jerusalem' } });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
