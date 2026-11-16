import { describe, expect, it } from 'vitest';
import { JiraApiClient, type JiraHttpTransport } from './jira-api-client';
import { JiraAuthType, JiraConfig, JiraCredentials } from './models/jira-config';
import { JiraTransition, pickCloseTransition } from './models/jira-issue';
import { JiraAuthException, JiraNetworkException, JiraNotConfiguredException, JiraPermissionException, JiraRateLimitException, JiraServerException, JiraValidationException } from './jira-exception';
import { issueJson, jsonResponse, resolutionField, testConfig, testToken, transitionJson } from '../test-utils';
const client = (transport: JiraHttpTransport, config = testConfig, credentials = new JiraCredentials({ secret: testToken })) => new JiraApiClient({ transport, config, credentials });
describe('Flutter API client cases', () => {
  it('parses project and browse URLs with context paths', () => {
    expect(JiraConfig.fromUserUrl('https://jira.example.com/projects/DEMO/').toJson()).toMatchObject({ baseUrl: 'https://jira.example.com', projectKey: 'DEMO' });
    expect(JiraConfig.fromUserUrl('https://host:8443/jira/browse/ABC-12?x=1').toJson()).toMatchObject({ baseUrl: 'https://host:8443/jira', projectKey: 'ABC' });
    expect(JiraConfig.fromUserUrl('host/jira/', { projectKey: 'demo' }).toJson()).toMatchObject({ baseUrl: 'https://host/jira', projectKey: 'DEMO' });
  });
  it('never prints or JSON serializes the secret', () => {
    const c = new JiraCredentials({ secret: testToken, username: 'u' });
    expect(c.toString()).not.toContain(testToken); expect(JSON.stringify(c)).not.toContain(testToken);
  });
  it('uses context path and bearer auth', async () => {
    const api = client(async r => {
      expect(r.url).toBe('https://host/jira/rest/api/2/myself'); expect(r.headers.authorization).toBe('Bearer ' + testToken);
      return jsonResponse({ name: 'nave', displayName: 'Nave' });
    }, testConfig.copyWith({ baseUrl: 'https://host/jira/' }));
    expect((await api.getMyself()).displayName).toBe('Nave');
  });
  it('uses basic auth and UTF-8 encoding', async () => {
    await client(async r => { expect(r.headers.authorization).toBe('Basic dTpwdw=='); return jsonResponse({ name: 'u' }); },
      testConfig.copyWith({ authType: JiraAuthType.basic }), new JiraCredentials({ secret: 'pw', username: 'u' })).getMyself();
    expect(new JiraCredentials({ username: 'é', secret: '密' }).authorizationHeader(JiraAuthType.basic)).toBe('Basic w6k65a+G');
  });
  it('rejects missing credentials before transport', async () => {
    let calls = 0; const api = client(async () => { calls++; return jsonResponse({}); }, testConfig, new JiraCredentials({ secret: '' }));
    await expect(api.getMyself()).rejects.toBeInstanceOf(JiraNotConfiguredException); expect(calls).toBe(0);
  });
  it('pages using actual server-capped results and reports progress', async () => {
    const issues = Array.from({ length: 5 }, (_, i) => issueJson('DEMO-' + (i + 1))), bodies: Record<string, unknown>[] = [], progress: number[] = [];
    const api = client(async r => { expect(r.method).toBe('POST'); const body = JSON.parse(r.body!); bodies.push(body);
      return jsonResponse({ startAt: body.startAt, maxResults: 2, total: 5, issues: issues.slice(body.startAt, body.startAt + 2) }); });
    expect((await api.searchAll('project = "DEMO"', n => progress.push(n))).map(i => i.key)).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5']);
    expect(bodies.map(b => b.startAt)).toEqual([0, 2, 4]); expect(bodies[0]).toMatchObject({ jql: 'project = "DEMO" ORDER BY key ASC', maxResults: 100 });
    expect(progress).toEqual([2, 4, 5]);
  });
  it('stops on empty page with inconsistent total', async () => {
    let calls = 0; const api = client(async () => jsonResponse({ startAt: 0, maxResults: 50, total: 10, issues: ++calls === 1 ? [issueJson('DEMO-1')] : [] }));
    expect(await api.searchAll('project = DEMO ORDER BY rank')).toHaveLength(1); expect(calls).toBe(2);
  });
  it('de-duplicates shifted pages and enforces the cap', async () => {
    const api = new JiraApiClient({ config: testConfig, credentials: new JiraCredentials({ secret: testToken }), maxIssues: 2,
      transport: async () => jsonResponse({ startAt: 0, total: 10, issues: [issueJson('DEMO-1'), issueJson('DEMO-1'), issueJson('DEMO-2'), issueJson('DEMO-3')] }) });
    expect((await api.searchAll('project = DEMO')).map(i => i.key)).toEqual(['DEMO-1', 'DEMO-2']);
  });
  it('401 maps to auth and redacts echoed token', async () => {
    await expect(client(async () => jsonResponse({ errorMessages: [testToken] }, 401)).getMyself()).rejects.toMatchObject({ kind: 'auth', statusCode: 401, message: '***' });
  });
  it('400 retains field errors', async () => {
    await expect(client(async () => jsonResponse({ errors: { summary: 'You must specify a summary.' } }, 400)).getMyself()).rejects.toMatchObject({ fieldErrors: { summary: 'You must specify a summary.' } });
  });
  it('403 with CAPTCHA explains lock-out', async () => {
    const error = await client(async () => jsonResponse(null, 403, { 'x-seraph-loginreason': 'AUTHENTICATION_DENIED' })).getMyself().catch(e => e);
    expect(error).toBeInstanceOf(JiraPermissionException); expect(error.message).toContain('CAPTCHA');
  });
  it('HTML login page is rejected even without IPC headers', async () => {
    await expect(client(async () => ({ status: 200, body: '<html>login</html>' })).getMyself()).rejects.toBeInstanceOf(JiraServerException);
  });
  it('redirects are reported without a second request', async () => {
    let calls = 0; await expect(client(async () => { calls++; return jsonResponse(null, 302); }).getMyself()).rejects.toBeInstanceOf(JiraAuthException); expect(calls).toBe(1);
  });
  it('5xx and rate-limit responses retain kind and retry duration', async () => {
    await expect(client(async () => jsonResponse({ message: 'boom' }, 503)).getMyself()).rejects.toBeInstanceOf(JiraServerException);
    const error = await client(async () => jsonResponse(null, 429, { 'retry-after': '30' })).getMyself().catch(e => e);
    expect(error).toBeInstanceOf(JiraRateLimitException); expect(error.retryAfter).toBe(30_000);
  });
  it('a missing response is a network error, not an unexpected failure', async () => {
    await expect(client(async () => null as never).getMyself()).rejects.toBeInstanceOf(JiraNetworkException);
  });
  it('IPC status/body works without headers and no retry hint remains null', async () => {
    expect((await client(async () => ({ status: 200, body: '{"name":"u"}' })).getMyself()).name).toBe('u');
    await expect(client(async () => ({ status: 429, body: '' })).getMyself()).rejects.toMatchObject({ retryAfter: null });
  });
  it('socket and TLS failures become network errors without leaking details', async () => {
    await expect(client(async () => { throw new Error('Connection refused ' + testToken); }).getMyself()).rejects.toBeInstanceOf(JiraNetworkException);
    await expect(client(async () => { throw new Error('TLS certificate ' + testToken); }).getMyself()).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('TLS handshake') });
  });
  it('times out the complete IPC request', async () => {
    const api = new JiraApiClient({ config: testConfig, credentials: new JiraCredentials({ secret: testToken }), timeout: 5, transport: () => new Promise(() => {}) });
    await expect(api.getMyself()).rejects.toBeInstanceOf(JiraNetworkException);
  });
  it('createmeta falls back to legacy including subtask metadata', async () => {
    const paths: string[] = [];
    const types = await client(async r => { const p = new URL(r.url).pathname; paths.push(p);
      return p.endsWith('/issuetypes') ? jsonResponse({}, 404) : jsonResponse({ projects: [{ key: 'DEMO', issuetypes: [{ id: '1', name: 'Bug' }, { id: '5', name: 'Sub-task', subtask: true }] }] }); }).getCreatableIssueTypes();
    expect(types.map(t => t.name)).toEqual(['Bug', 'Sub-task']); expect(paths.at(-1)).toBe('/rest/api/2/issue/createmeta');
  });
  it('modern createmeta pages using actual counts', async () => {
    const types = await client(async r => { const n = Number(new URL(r.url).searchParams.get('startAt'));
      return jsonResponse({ total: 3, isLast: n >= 2, values: n === 0 ? [{ id: '1', name: 'Bug' }, { id: '2', name: 'Task' }] : [{ id: '3', name: 'Story' }] }); }).getCreatableIssueTypes();
    expect(types.map(t => t.id)).toEqual(['1', '2', '3']);
  });
  it('falls back to project issue types when both metadata routes are missing', async () => {
    const types = await client(async r => new URL(r.url).pathname.includes('createmeta') ? jsonResponse({}, 404)
      : jsonResponse({ issueTypes: [{ id: '1', name: 'Bug' }] })).getCreatableIssueTypes();
    expect(types[0].name).toBe('Bug');
  });
  it('fetches transitions per issue with expanded fields', async () => {
    const transitions = await client(async r => {
      expect(new URL(r.url).pathname).toBe('/rest/api/2/issue/DEMO-7/transitions'); expect(new URL(r.url).searchParams.get('expand')).toBe('transitions.fields');
      return jsonResponse({ transitions: [transitionJson('31', 'Close', 'Closed', 'done', resolutionField(), true)] });
    }).getTransitions('DEMO-7');
    expect(transitions[0].resolutionField?.allowedValues).toHaveLength(3); expect(transitions[0].hasScreen).toBe(true);
  });
  it('chooses close over cancellation and avoids unsupported required fields', () => {
    const t = (id: string, name: string, cat: string, fields = {}) => JiraTransition.fromJson(transitionJson(id, name, name, cat, fields));
    expect(pickCloseTransition([t('5', "Won't Do", 'done'), t('11', 'Start', 'indeterminate'), t('41', 'Close', 'done')])?.id).toBe('41');
    expect(pickCloseTransition([t('41', 'Close', 'done', { customfield_1: { required: true, name: 'Root cause' } }), t('51', 'Done', 'done')])?.id).toBe('51');
    expect(pickCloseTransition([t('11', 'Start', 'indeterminate')])).toBeNull();
  });
  it('validation exception exposes a stable title', () => { expect(new JiraValidationException('no').title).toBe('Jira rejected the request'); });
});

it('maps main-process redirect rejection to auth when its error identifies the redirect', async () => {
  await expect(client(async () => { throw new Error('Cannot follow redirect'); }).getMyself()).rejects.toBeInstanceOf(JiraAuthException);
});
it('rejects missing config and handles empty updates without transport', async () => {
  let calls = 0;
  const transport: JiraHttpTransport = async () => { calls++; return jsonResponse({}); };
  await expect(client(transport, new JiraConfig({ baseUrl: '', projectKey: '' })).getMyself()).rejects.toBeInstanceOf(JiraNotConfiguredException);
  const { JiraIssueDraft } = await import('./models/jira-issue');
  await client(transport).updateIssue('DEMO-1', new JiraIssueDraft()); expect(calls).toBe(0);
});
