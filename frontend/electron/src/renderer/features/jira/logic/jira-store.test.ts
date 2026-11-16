import { describe, expect, it } from 'vitest';
import { createHyperJiraStore } from './jira-store';
import { JiraLocalStore } from '../data/jira-local-store';
import { JiraRepository } from '../data/jira-repository';
import { SessionJiraCredentialStore } from '../data/jira-credential-store';
import { JiraCredentials } from '../data/models/jira-config';
import { JiraIssueDraft, JiraStatusCategory, pickCloseTransition } from '../data/models/jira-issue';
import { HyperFakeJira, HyperFakeKeyValue, configuredRepository, issueJson, jsonResponse, resolutionField, testConfig, testToken, transitionJson } from '../test-utils';
function pageJira() {
  const jira = new HyperFakeJira(); jira.serveSearch([issueJson('DEMO-1', { assignee: 'alice' }), issueJson('DEMO-2', { status: 'Closed', category: 'done' }),
    issueJson('DEMO-3', { assignee: 'alice', status: 'In Progress', category: 'indeterminate' })]); return jira;
}
describe('Flutter dashboard behavior as store contract (UI rendering deferred)', () => {
  it('syncs on open, aggregates progress and toggles category/assignee/search filters', async () => {
    const jira = pageJira(), store = createHyperJiraStore({ repository: await configuredRepository(jira) }); await store.getState().load();
    const s = store.getState(); expect(s.isLoading).toBe(false); expect(s.config?.projectKey).toBe('DEMO');
    expect(s.visibleIssues).toHaveLength(3); expect(s.stats.progress).toBeCloseTo(1 / 3); expect(s.stats.open).toBe(2);
    expect(s.stats.byAssignee.find(a => a.name === 'alice')?.done).toBe(0); expect(s.syncLoaded).toBe(3); expect(s.syncTotal).toBe(3); expect(s.canSync).toBe(true);
    s.setFilters({ category: JiraStatusCategory.done }); expect(store.getState().visibleIssues.map(i => i.key)).toEqual(['DEMO-2']);
    s.setFilters({ category: JiraStatusCategory.done, assignee: 'alice' }); expect(store.getState().visibleIssues).toHaveLength(2);
    s.setQuery('progress'); expect(store.getState().visibleIssues.map(i => i.key)).toEqual(['DEMO-3']);
    s.clearFilters(); s.setFilters({ assignee: '' }); expect(store.getState().visibleIssues.map(i => i.key)).toEqual(['DEMO-2']); s.clearFilters(); expect(store.getState().visibleIssues).toHaveLength(3);
  });
  it('loads live done transition, applies selected resolution and updates stats/banner', async () => {
    const jira = pageJira();
    jira.on('GET', '/rest/api/2/issue/DEMO-1/transitions', async () => jsonResponse({ transitions: [transitionJson('11', 'Start', 'In Progress', 'indeterminate'),
      transitionJson('21', "Won't Do", "Won't Do", 'done'), transitionJson('31', 'Close Issue', 'Closed', 'done', resolutionField())] }));
    jira.on('POST', '/rest/api/2/issue/DEMO-1/transitions', async () => jsonResponse(null, 204));
    jira.on('GET', '/rest/api/2/issue/DEMO-1', async () => jsonResponse(issueJson('DEMO-1', { status: 'Closed', category: 'done' })));
    const store = createHyperJiraStore({ repository: await configuredRepository(jira) }); await store.getState().load();
    const t = pickCloseTransition(await store.getState().getTransitions('DEMO-1'))!; expect(t.id).toBe('31');
    await store.getState().transitionIssue(store.getState().snapshot.issues[0], t, { resolutionId: t.resolutionField!.allowedValues[0].id });
    expect(JSON.parse(jira.where('POST', '/rest/api/2/issue/DEMO-1/transitions')[0].body!)).toEqual({ transition: { id: '31' }, fields: { resolution: { id: '1' } } });
    expect(store.getState().message).toBe('DEMO-1 is now Closed'); expect(store.getState().stats.progress).toBeCloseTo(2 / 3);
  });
  it('authentication failure exposes title/status and keeps cached failure metadata after banner dismissal', async () => {
    const jira = pageJira(); jira.on('POST', '/rest/api/2/search', async () => jsonResponse({}, 401));
    const store = createHyperJiraStore({ repository: await configuredRepository(jira) }); await store.getState().load();
    expect(store.getState().error).toMatchObject({ title: 'Authentication failed', statusCode: 401 }); expect(store.getState().snapshot.issues).toHaveLength(0);
    const lastError = store.getState().snapshot.lastError; store.getState().dismissMessage(); expect(store.getState().error).toBeNull(); expect(store.getState().snapshot.lastError).toBe(lastError);
  });
  it('first run loads disconnected; saving token triggers full sync', async () => {
    const jira = pageJira(), repo = new JiraRepository({ store: new JiraLocalStore('1', new HyperFakeKeyValue()), credentialStore: new SessionJiraCredentialStore(), transport: jira.transport });
    const store = createHyperJiraStore({ repository: repo }); await store.getState().load(); expect(store.getState().config).toBeNull(); expect(store.getState().canSync).toBe(false);
    await store.getState().saveSettings(testConfig); expect(store.getState().hasCredentials).toBe(false); expect(jira.requests).toHaveLength(0);
    await store.getState().saveSettings(testConfig, new JiraCredentials({ secret: testToken })); expect(store.getState().visibleIssues).toHaveLength(3);
    expect(jira.requests[0].headers.authorization).toBe('Bearer ' + testToken);
  });
  it('edit conflict exposes Jira version, overwrite sends only changed summary', async () => {
    const jira = pageJira(); jira.on('GET', '/rest/api/2/issue/DEMO-1', async () => jsonResponse(issueJson('DEMO-1', { summary: 'Changed by someone else', updated: '2024-06-01T10:00:00+0300' })));
    jira.on('PUT', '/rest/api/2/issue/DEMO-1', async () => jsonResponse(null, 204));
    const store = createHyperJiraStore({ repository: await configuredRepository(jira) }); await store.getState().load();
    const base = store.getState().snapshot.issues[0], draft = new JiraIssueDraft({ summary: 'My summary' });
    await expect(store.getState().updateIssue(base, draft)).rejects.toMatchObject({ kind: 'conflict', remote: { summary: 'Changed by someone else' } });
    expect(jira.where('PUT', '/rest/api/2/issue/DEMO-1')).toHaveLength(0); expect(store.getState().error?.kind).toBe('conflict');
    await store.getState().updateIssue(base, draft, { overwrite: true });
    expect(JSON.parse(jira.where('PUT', '/rest/api/2/issue/DEMO-1')[0].body!)).toEqual({ fields: { summary: 'My summary' } }); expect(store.getState().error).toBeNull();
  });
  it('preserves derived references during progress and ignores duplicate sync calls', async () => {
    const jira = pageJira(), repo = await configuredRepository(jira), store = createHyperJiraStore({ repository: repo }); await store.getState().load();
    const stats = store.getState().stats, visible = store.getState().visibleIssues;
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    jira.on('POST', '/rest/api/2/search', async () => { calls++; await pending; return jsonResponse({ startAt: 0, total: 0, issues: [] }); });
    const syncing = store.getState().sync(); await store.getState().sync(); expect(store.getState().isSyncing).toBe(true);
    expect(store.getState().stats).toBe(stats); expect(store.getState().visibleIssues).toBe(visible);
    release(); await syncing; expect(calls).toBe(1); expect(store.getState().isSyncing).toBe(false);
  });
  it('full refresh reports removals and credential deletion disables sync', async () => {
    const jira = pageJira(), store = createHyperJiraStore({ repository: await configuredRepository(jira) }); await store.getState().load();
    jira.serveSearch([issueJson('DEMO-2')]); await store.getState().fullRefresh(); expect(store.getState().message).toContain('2 no longer matched');
    await store.getState().forgetCredentials(); expect(store.getState().canSync).toBe(false);
  });
  it('metadata excludes subtasks and reports database configuration errors', async () => {
    const jira = pageJira(), store = createHyperJiraStore({ repository: await configuredRepository(jira) }); await store.getState().load();
    jira.on('GET', '/rest/api/2/issue/createmeta/DEMO/issuetypes', async () => jsonResponse({ isLast: true, values: [{ id: '1', name: 'Bug' }, { id: '2', name: 'Sub-task', subtask: true }] }));
    expect((await store.getState().getCreatableIssueTypes()).map(t => t.name)).toEqual(['Bug']);
    expect(await store.getState().updateDatabase()).toBeNull(); expect(store.getState().error?.kind).toBe('notConfigured'); expect(store.getState().isDatabaseSyncing).toBe(false);
  });
});
