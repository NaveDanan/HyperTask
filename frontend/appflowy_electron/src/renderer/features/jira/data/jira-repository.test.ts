import { beforeEach, describe, expect, it } from 'vitest';
import { JiraRepository, jiraCredentialAccountId, stripOrderBy } from './jira-repository';
import { JiraCacheSnapshot, JiraLocalStore } from './jira-local-store';
import { SessionJiraCredentialStore } from './jira-credential-store';
import { JiraAuthType } from './models/jira-config';
import { JiraIssue, JiraIssueDraft, JiraTransition } from './models/jira-issue';
import { JiraAuthException, JiraConflictException, JiraNotConfiguredException, JiraTransitionUnsupportedException, JiraValidationException } from './jira-exception';
import { HyperFakeJira, HyperFakeKeyValue, configuredRepository, issueJson, jsonResponse, resolutionField, testConfig, testToken, transitionJson } from '../test-utils';
let jira: HyperFakeJira, storage: HyperFakeKeyValue;
beforeEach(() => { jira = new HyperFakeJira(); storage = new HyperFakeKeyValue(); });
describe('Flutter repository cases', () => {
  it('full sync persists sorted issues and time, fresh offline repo reads cache without token', async () => {
    const now = new Date('2024-06-01T12:00:00Z'); jira.serveSearch([issueJson('DEMO-10'), issueJson('DEMO-2', { category: 'done', status: 'Closed' }), issueJson('DEMO-3')]);
    const repo = await configuredRepository(jira, storage, () => now), result = await repo.sync();
    expect(result.added).toBe(3); expect(result.snapshot.issues.map(i => i.key)).toEqual(['DEMO-2', 'DEMO-3', 'DEMO-10']);
    expect(result.snapshot.lastSuccessAt).toEqual(now); expect(result.snapshot.lastError).toBeNull();
    const reopened = new JiraRepository({ store: new JiraLocalStore('1', storage), credentialStore: new SessionJiraCredentialStore(), transport: async () => { throw new Error('offline'); } });
    expect((await reopened.loadCache()).issues).toHaveLength(3); expect((await reopened.loadCache()).issues[0].isDone).toBe(true);
    expect(await reopened.hasCredentials()).toBe(false); expect(Object.values(storage.values).join()).not.toContain(testToken);
  });
  it('failed sync keeps cache and records error, queue remains usable', async () => {
    jira.serveSearch([issueJson('DEMO-1')]); const repo = await configuredRepository(jira, storage); await repo.sync();
    const previous = (await repo.loadCache()).lastSuccessAt;
    jira.on('POST', '/rest/api/2/search', async () => jsonResponse({ errorMessages: ['Token expired'] }, 401));
    await expect(repo.sync()).rejects.toBeInstanceOf(JiraAuthException);
    const cache = await repo.loadCache(); expect(cache.issues[0].key).toBe('DEMO-1'); expect(cache.lastError).toBe('Token expired'); expect(cache.lastSuccessAt).toEqual(previous); expect(cache.lastAttemptAt).not.toBeNull();
    jira.serveSearch([]); await repo.sync(); expect((await repo.loadCache()).lastError).toBeNull();
  });
  it('incremental sync merges updates with a 5 minute overlap', async () => {
    let now = new Date('2024-06-01T12:00:00Z'); jira.serveSearch([issueJson('DEMO-1'), issueJson('DEMO-2')]);
    const repo = await configuredRepository(jira, storage, () => now); await repo.sync();
    now = new Date('2024-06-01T12:30:00Z'); let jql = '';
    jira.on('POST', '/rest/api/2/search', async r => { jql = JSON.parse(r.body!).jql; return jsonResponse({ startAt: 0, total: 2,
      issues: [issueJson('DEMO-2', { summary: 'Renamed', updated: '2024-06-01T15:20:00.000+0300' }), issueJson('DEMO-3', { updated: '2024-06-01T15:21:00.000+0300' })] }); });
    const result = await repo.sync({ full: false }); expect(result).toMatchObject({ incremental: true, added: 1, updated: 1, removed: 0 });
    expect(jql).toBe('(project = "DEMO") AND updated >= -35m ORDER BY key ASC');
    expect(result.snapshot.issues.map(i => i.key + ':' + i.summary)).toEqual(['DEMO-1:Summary of DEMO-1', 'DEMO-2:Renamed', 'DEMO-3:Summary of DEMO-3']);
  });
  it('incremental does not replace newer cached versions with stale results', async () => {
    jira.serveSearch([issueJson('DEMO-1', { summary: 'Newer', updated: '2025-01-01T00:00:00Z' })]);
    const repo = await configuredRepository(jira); await repo.sync(); jira.serveSearch([issueJson('DEMO-1')]);
    expect((await repo.sync({ full: false })).snapshot.issues[0].summary).toBe('Newer');
  });
  it('full refresh reports removed issues', async () => {
    jira.serveSearch([issueJson('DEMO-1'), issueJson('DEMO-2')]); const repo = await configuredRepository(jira); await repo.sync();
    jira.serveSearch([issueJson('DEMO-2')]); const result = await repo.sync(); expect(result.removed).toBe(1); expect(result.snapshot.issues).toHaveLength(1);
  });
  it('server/project changes drop cache and require a separate secret', async () => {
    jira.serveSearch([issueJson('DEMO-1')]); const repo = await configuredRepository(jira, storage); await repo.sync();
    await repo.saveConfig(testConfig.copyWith({ baseUrl: 'https://other.example.com' }));
    expect((await repo.loadCache()).issues).toHaveLength(0); expect(await repo.hasCredentials()).toBe(false); await expect(repo.sync()).rejects.toBeInstanceOf(JiraNotConfiguredException);
  });
  it('same-account settings keep token, changed auth or username cannot carry it', async () => {
    const repo = await configuredRepository(jira); await repo.saveConfig(testConfig.copyWith({ customJql: 'project = DEMO' })); expect(await repo.hasCredentials()).toBe(true);
    await repo.saveConfig(testConfig.copyWith({ authType: JiraAuthType.basic })); expect(await repo.hasCredentials()).toBe(false);
    await repo.saveConfig(testConfig.copyWith({ username: 'another' })); expect(await repo.hasCredentials()).toBe(false);
  });
  it('fresh repository scope change cannot retain loaded Flutter cache', async () => {
    jira.serveSearch([issueJson('DEMO-1')]); await (await configuredRepository(jira, storage)).sync();
    const repo = new JiraRepository({ store: new JiraLocalStore('1', storage), credentialStore: new SessionJiraCredentialStore() });
    await repo.saveConfig(testConfig.copyWith({ projectKey: 'OTHER' })); expect((await repo.loadCache()).issues).toHaveLength(0);
  });
  it('conflict blocks PUT and overwrite sends only edited field', async () => {
    const base = JiraIssue.fromJson(issueJson('DEMO-5', { summary: 'Old', updated: '2024-05-01T10:00:00Z' }));
    jira.on('GET', '/rest/api/2/issue/DEMO-5', async () => jsonResponse(issueJson('DEMO-5', { summary: 'Theirs', updated: '2024-05-02T10:00:00Z' })));
    jira.on('PUT', '/rest/api/2/issue/DEMO-5', async () => jsonResponse(null, 204)); const repo = await configuredRepository(jira);
    await expect(repo.updateIssue(base, new JiraIssueDraft({ summary: 'Mine' }))).rejects.toBeInstanceOf(JiraConflictException);
    expect(jira.where('PUT', '/rest/api/2/issue/DEMO-5')).toHaveLength(0);
    await repo.updateIssue(base, new JiraIssueDraft({ summary: 'Mine' }), { overwrite: true });
    expect(JSON.parse(jira.where('PUT', '/rest/api/2/issue/DEMO-5')[0].body!)).toEqual({ fields: { summary: 'Mine' } });
  });
  it('unrelated remote status changes permit description edit and cache server version', async () => {
    const base = JiraIssue.fromJson(issueJson('DEMO-5', { summary: 'Old', updated: '2024-05-01T10:00:00Z' }));
    jira.on('GET', '/rest/api/2/issue/DEMO-5', async () => jsonResponse(issueJson('DEMO-5', { summary: 'Old', status: 'In Progress', updated: '2024-05-02T10:00:00Z' })));
    jira.on('PUT', '/rest/api/2/issue/DEMO-5', async () => jsonResponse(null, 204)); const repo = await configuredRepository(jira);
    expect((await repo.updateIssue(base, new JiraIssueDraft({ description: 'More detail' }))).statusName).toBe('In Progress');
    expect(JSON.parse(jira.where('PUT', '/rest/api/2/issue/DEMO-5')[0].body!)).toEqual({ fields: { description: 'More detail' } }); expect((await repo.loadCache()).issues[0].key).toBe('DEMO-5');
  });
  it('create sends project/type/summary and caches returned issue', async () => {
    jira.on('POST', '/rest/api/2/issue', async () => jsonResponse({ key: 'DEMO-99' }, 201));
    jira.on('GET', '/rest/api/2/issue/DEMO-99', async () => jsonResponse(issueJson('DEMO-99', { summary: 'New' })));
    const repo = await configuredRepository(jira); expect((await repo.createIssue(new JiraIssueDraft({ summary: 'New', issueTypeId: '10002' }))).key).toBe('DEMO-99');
    expect(JSON.parse(jira.where('POST', '/rest/api/2/issue')[0].body!)).toEqual({ fields: { project: { key: 'DEMO' }, issuetype: { id: '10002' }, summary: 'New' } });
    expect((await repo.loadCache()).issues[0].summary).toBe('New');
  });
  it('validates summary and type locally', async () => {
    const repo = await configuredRepository(jira);
    await expect(repo.createIssue(new JiraIssueDraft({ summary: ' ', issueTypeId: '1' }))).rejects.toBeInstanceOf(JiraValidationException);
    await expect(repo.createIssue(new JiraIssueDraft({ summary: 'New' }))).rejects.toBeInstanceOf(JiraValidationException); expect(jira.requests).toHaveLength(0);
  });
  it('posts selected transition/resolution and caches done issue', async () => {
    jira.on('POST', '/rest/api/2/issue/DEMO-7/transitions', async () => jsonResponse(null, 204));
    jira.on('GET', '/rest/api/2/issue/DEMO-7', async () => jsonResponse(issueJson('DEMO-7', { status: 'Closed', category: 'done' })));
    const repo = await configuredRepository(jira), issue = JiraIssue.fromJson(issueJson('DEMO-7'));
    const transition = JiraTransition.fromJson(transitionJson('731', 'Close', 'Closed', 'done', resolutionField()));
    expect((await repo.transitionIssue(issue, transition, { resolutionId: '10000' })).isDone).toBe(true);
    expect(JSON.parse(jira.where('POST', '/rest/api/2/issue/DEMO-7/transitions')[0].body!)).toEqual({ transition: { id: '731' }, fields: { resolution: { id: '10000' } } });
  });
  it('requires resolution and blocks unsupported transition fields before HTTP', async () => {
    const repo = await configuredRepository(jira), issue = JiraIssue.fromJson(issueJson('DEMO-7'));
    await expect(repo.transitionIssue(issue, JiraTransition.fromJson(transitionJson('1', 'Close', 'Closed', 'done', resolutionField())))).rejects.toBeInstanceOf(JiraValidationException);
    await expect(repo.transitionIssue(issue, JiraTransition.fromJson(transitionJson('2', 'Close', 'Closed', 'done', { customfield_1: { required: true, name: 'Root cause' } })))).rejects.toBeInstanceOf(JiraTransitionUnsupportedException);
    expect(jira.requests).toHaveLength(0);
  });
  it('sends comments only on transition screens and trims them', async () => {
    jira.on('POST', '/rest/api/2/issue/DEMO-7/transitions', async () => jsonResponse(null, 204));
    jira.on('GET', '/rest/api/2/issue/DEMO-7', async () => jsonResponse(issueJson('DEMO-7')));
    const repo = await configuredRepository(jira), issue = JiraIssue.fromJson(issueJson('DEMO-7'));
    await repo.transitionIssue(issue, JiraTransition.fromJson(transitionJson('1', 'Close', 'Closed', 'done', {}, true)), { comment: ' hi ' });
    expect(JSON.parse(jira.requests[0].body!)).toEqual({ transition: { id: '1' }, update: { comment: [{ add: { body: 'hi' } }] } });
    await repo.transitionIssue(issue, JiraTransition.fromJson(transitionJson('1', 'Close', 'Closed', 'done')), { comment: 'hi' });
    expect(JSON.parse(jira.where('POST', '/rest/api/2/issue/DEMO-7/transitions')[1].body!)).toEqual({ transition: { id: '1' } });
  });
  it('read-only connection check and forget credentials', async () => {
    jira.on('GET', '/rest/api/2/myself', async () => jsonResponse({ name: 'u' }));
    jira.on('GET', '/rest/api/2/project/DEMO', async () => jsonResponse({ key: 'DEMO' }));
    const repo = await configuredRepository(jira); expect((await repo.testConnection(testConfig)).project.key).toBe('DEMO');
    expect(jira.requests.map(r => r.method)).toEqual(['GET', 'GET']); await repo.forgetCredentials(); expect(await repo.hasCredentials()).toBe(false);
  });
  it('account id matches Dart exactly and stripOrderBy preserves base JQL', () => {
    expect(jiraCredentialAccountId('1', testConfig)).toBe('1|https://jira.example.com|DEMO|personalAccessToken|');
    expect(stripOrderBy('project = X ORDER BY rank DESC')).toBe('project = X'); expect(stripOrderBy('project = X')).toBe('project = X');
  });
  it('cache upsert matches numeric ID when issue moves projects', () => {
    const s = new JiraCacheSnapshot({ scopeId: '', jql: '', issues: [JiraIssue.fromJson(issueJson('DEMO-1'))] });
    expect(s.upsert(JiraIssue.fromJson(issueJson('OTHER-1'))).issues.map(i => i.key)).toEqual(['OTHER-1']);
  });
});

it('serializes sync/cache mutations so a concurrent create is not lost', async () => {
  let release!: () => void, started!: () => void, createdFetched!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; }), fetched = new Promise<void>(r => { createdFetched = r; });
  jira.on('POST', '/rest/api/2/search', async () => { started(); await gate; return jsonResponse({ startAt: 0, total: 1, issues: [issueJson('DEMO-1')] }); });
  jira.on('POST', '/rest/api/2/issue', async () => jsonResponse({ key: 'DEMO-2' }, 201));
  jira.on('GET', '/rest/api/2/issue/DEMO-2', async () => { createdFetched(); return jsonResponse(issueJson('DEMO-2')); });
  const repo = await configuredRepository(jira), syncing = repo.sync(); await ready;
  const creating = repo.createIssue(new JiraIssueDraft({ summary: 'New', issueTypeId: '1' })); await fetched;
  release(); await Promise.all([syncing, creating]);
  expect((await repo.loadCache()).issues.map(i => i.key)).toEqual(['DEMO-1', 'DEMO-2']);
});
it('does not insert an in-flight mutation into a newly configured account cache', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; });
  jira.on('POST', '/rest/api/2/issue', async () => { started(); await gate; return jsonResponse({ key: 'DEMO-2' }, 201); });
  jira.on('GET', '/rest/api/2/issue/DEMO-2', async r => { expect(new URL(r.url).host).toBe('jira.example.com'); return jsonResponse(issueJson('DEMO-2')); });
  const repo = await configuredRepository(jira), creating = repo.createIssue(new JiraIssueDraft({ summary: 'New', issueTypeId: '1' })); await ready;
  await repo.saveConfig(testConfig.copyWith({ baseUrl: 'https://other.example.com' })); release();
  expect((await creating).key).toBe('DEMO-2'); expect((await repo.loadCache()).issues).toHaveLength(0);
});
