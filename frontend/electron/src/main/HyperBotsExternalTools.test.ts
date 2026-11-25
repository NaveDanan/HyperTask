import { expect, it, vi } from 'vitest';
import { HYPER_BOTS_TOOLS } from '@shared/HyperBots';
import { HyperBotsTools, type HyperBotsJiraAccess } from './HyperBotsConnectors';
import { hyperBotsJiraTools } from './HyperBotsJiraTools';
import { hyperBotsNewsletterTools } from './HyperBotsNewsletterTools';

const signal = new AbortController().signal;
const jira: HyperBotsJiraAccess = {
  baseUrl: 'https://jira.example/jira', projectKey: 'OPS', authType: 'personalAccessToken',
  username: '', userId: '42', authorization: 'Bearer jira-test-token',
};
const newsletter = { baseUrl: 'https://newsletter.example', fingerprint: 'first', authorization: 'Bearer newsletter-test-token' };
const response = (value: unknown) => Response.json(value);

it('registers the external catalog with the intended read and write permissions', () => {
  const tools = new HyperBotsTools([
    ...hyperBotsJiraTools({ access: async () => jira }),
    ...hyperBotsNewsletterTools({ access: async () => newsletter }),
  ]);
  const catalog = Object.entries(HYPER_BOTS_TOOLS).filter(([, tool]) => tool.group === 'jira' || tool.group === 'newsletter');
  for (const [name, entry] of catalog) expect(tools.get(name)?.access).toBe(entry.access);
  expect(tools.specs(catalog.map(([name]) => name))).toHaveLength(catalog.length);
});

it('uses the right Jira search pagination, including projects outside the default', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response({ issues: [] }));
  let access = jira;
  const search = hyperBotsJiraTools({ access: async () => access, fetch }).find(tool => tool.name === 'jira_search_issues')!;
  await search.run(search.parse({ jql: 'project = OTHER', startAt: 10 }), signal);
  expect(fetch.mock.calls[0]?.[0]).toBe(jira.baseUrl + '/rest/api/2/search');
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ jql: 'project = OTHER', startAt: 10 });
  access = { ...jira, baseUrl: 'https://example.atlassian.net' };
  await search.run(search.parse({ nextPageToken: 'page-two' }), signal);
  expect(fetch.mock.calls[1]?.[0]).toBe(access.baseUrl + '/rest/api/2/search/jql');
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ jql: 'project = "OPS"', nextPageToken: 'page-two' });
});

it('reads and edits Jira issues by key, and binds creation to the explicit project', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response({ key: 'OTHER-1', fields: { description: 'Example' } }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(response({ key: 'OTHER-2' }));
  const tools = new HyperBotsTools(hyperBotsJiraTools({ access: async () => jira, fetch }));
  const get = tools.get('jira_get_issue')!;
  const edit = tools.get('jira_update_issue')!;
  const create = tools.get('jira_create_issue')!;
  expect(await get.run(get.parse({ issueKey: 'other-1', fields: ['description'] }), signal)).toMatchObject({ key: 'OTHER-1' });
  expect(fetch.mock.calls[0]?.[0]).toBe(jira.baseUrl + '/rest/api/2/issue/OTHER-1?fields=description');
  expect(() => edit.parse({ issueKey: '../projects', fields: { summary: 'x' } })).toThrow();
  const update = edit.parse({ issueKey: 'OTHER-1', fields: { summary: 'Updated', customfield_12345: { id: '7' } } });
  expect(await edit.run(update, signal)).toMatchObject({ issueKey: 'OTHER-1', updated: true });
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', body: '{"fields":{"summary":"Updated","customfield_12345":{"id":"7"}}}' });
  const input = create.parse({ projectKey: 'other', summary: 'New', fields: { parent: { key: 'OTHER-1' } } });
  const target = await create.bind!(input, signal);
  expect(target.destination).toContain('Jira project OTHER at');
  expect(await create.run(input, signal, target.fingerprint)).toMatchObject({ key: 'OTHER-2' });
  expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({ fields: { project: { key: 'OTHER' }, parent: { key: 'OTHER-1' } } });
});

it('uses the documented Newsletter routes and verifies the approved token before sending', async () => {
  let current = newsletter;
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response({ id: 'article', content: 'newsletter-test-token', nextContentOffset: null }))
    .mockResolvedValueOnce(response({ id: 'article', status: 'draft' }))
    .mockResolvedValueOnce(response({ id: 'project' }))
    .mockResolvedValueOnce(response({ id: 'subtask' }));
  const tools = new HyperBotsTools(hyperBotsNewsletterTools({ access: async () => current, fetch }));
  const get = tools.get('newsletter_get_article')!;
  const edit = tools.get('newsletter_update_article')!;
  const chart = tools.get('newsletter_update_gantt')!;
  const task = tools.get('newsletter_create_gantt_task')!;
  expect(await get.run(get.parse({ articleId: 'article', contentOffset: 20 }), signal)).toMatchObject({ content: '[redacted]' });
  expect(fetch.mock.calls[0]?.[0]).toBe(newsletter.baseUrl + '/api/newsletters/article?contentOffset=20');
  const changes = edit.parse({ articleId: 'article', changes: { title: 'New title' } });
  const target = await edit.bind!(changes, signal);
  current = { ...current, fingerprint: 'replacement' };
  await expect(edit.run(changes, signal, target.fingerprint)).rejects.toMatchObject({ kind: 'refused' });
  expect(fetch).toHaveBeenCalledTimes(1);
  current = newsletter;
  await edit.run(changes, signal, target.fingerprint);
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', redirect: 'manual', credentials: 'omit',
    headers: { authorization: newsletter.authorization }, body: '{"title":"New title"}' });
  const gantt = { tasks: [], resources: [], roles: [], zoom: 'week' };
  expect(() => chart.parse({ projectId: 'project', changes: { gantt } })).toThrow();
  await chart.run(chart.parse({ projectId: 'project', expectedUpdatedAt: 'a timestamp', changes: { gantt } }), signal);
  expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({ gantt, expectedUpdatedAt: 'a timestamp' });
  await task.run(task.parse({ projectId: 'project', parentTaskId: 'parent', name: 'Subtask' }), signal);
  expect(fetch.mock.calls[3]?.[0]).toBe(newsletter.baseUrl + '/api/projects/project/tasks/parent/subtasks');
});
