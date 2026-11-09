import { expect, it } from 'vitest';
import { JiraCacheSnapshot, JiraLocalStore } from './jira-local-store';
import { JiraConfig } from './models/jira-config';
import { JiraIssue, JiraIssueDraft, parseJiraDate } from './models/jira-issue';
import { HyperFakeKeyValue, issueJson, testConfig } from '../test-utils';
it('reads Flutter config/cache JSON at exact shared-preferences keys', async () => {
  const storage = new HyperFakeKeyValue(), store = new JiraLocalStore('42', storage);
  storage.values['appflowy.jira.42.config'] = JSON.stringify({ baseUrl: 'https://host/jira/', projectKey: 'demo', authType: 'personalAccessToken', username: '', customJql: '', databaseViewId: 'v', pageSize: 100 });
  const c = (await store.readConfig())!;
  expect(c.toJson()).toMatchObject({ baseUrl: 'https://host/jira', projectKey: 'DEMO', databaseViewId: 'v' });
  storage.values['appflowy.jira.42.cache'] = JSON.stringify({ version: 1, scopeId: c.scopeId, jql: c.defaultJql, issues: [issueJson('DEMO-1')],
    lastAttemptAt: '2024-06-01T12:00:00.000Z', lastSuccessAt: '2024-06-01T12:00:00.000Z', lastError: null });
  const s = await store.readCache(c); expect(s.issues[0].updated.toISOString()).toBe('2024-05-01T07:00:00.000Z');
  await store.writeCache(s); expect(JSON.parse(storage.values[store.cacheKey])).toEqual(s.toJson());
  expect((await new JiraLocalStore('other', storage).readCache(c)).issues).toHaveLength(0);
});
it('ignores corrupt config/cache and caches from another scope', async () => {
  const storage = new HyperFakeKeyValue(), store = new JiraLocalStore('1', storage);
  storage.values[store.configKey] = '{bad'; storage.values[store.cacheKey] = '{bad';
  expect(await store.readConfig()).toBeNull(); expect((await store.readCache(testConfig)).issues).toHaveLength(0);
  await store.writeCache(new JiraCacheSnapshot({ scopeId: 'other', jql: '', issues: [JiraIssue.fromJson(issueJson('DEMO-1'))] }));
  expect((await store.readCache(testConfig)).issues).toHaveLength(0); await store.clearCache(); expect(storage.values[store.cacheKey]).toBeUndefined();
});
it('roundtrips REST-shaped issues including optional dates/users and configuration defaults', () => {
  const i = JiraIssue.fromJson({ ...issueJson('DEMO-1', { assignee: 'u' }), fields: { ...issueJson('DEMO-1', { assignee: 'u' }).fields, reporter: { name: 'r' }, resolution: { name: 'Fixed' }, duedate: '2024-05-03' } });
  expect(JiraIssue.fromJson(i.toJson()).toJson()).toEqual(i.toJson());
  expect(parseJiraDate('invalid')).toBeNull(); expect(JiraIssue.fromJson({}).updated.getTime()).toBe(0);
  expect(JiraConfig.fromJson({ authType: 'future' }).authType).toBe('personalAccessToken');
  expect(new JiraIssueDraft({ assigneeName: '', summary: null }).toFields()).toEqual({ assignee: null });
});
