import type { HttpResponse } from '@shared/api';
import { JiraConfig, JiraCredentials } from './models/jira-config';
import { JiraIssue, JiraIssueDraft, JiraIssueType, JiraProject, JiraSearchPage, JiraTransition, JiraUser, jsonObject, jsonObjects } from './models/jira-issue';
import { JiraAuthException, JiraNetworkException, JiraNotConfiguredException, JiraNotFoundException, JiraPermissionException,
  JiraRateLimitException, JiraServerException, JiraValidationException } from './jira-exception';
export interface JiraHttpRequest { url: string; method: string; headers: Record<string, string>; body?: string }
/** net.request returns the response headers (lower-case); kept optional for test transports. */
export type JiraHttpResponse = HttpResponse & { headers?: Record<string, string> };
export type JiraHttpTransport = (request: JiraHttpRequest) => Promise<JiraHttpResponse>;
export type JiraSyncProgress = (loaded: number, total: number) => void;
export interface JiraApiClientOptions { config: JiraConfig; credentials: JiraCredentials; transport?: JiraHttpTransport; timeout?: number; maxIssues?: number }
export interface JiraTransitionOptions { transitionId: string; resolutionId?: string | null; comment?: string | null }
/** Server/DC REST v2 client; main-process transport never follows redirects. */
export class HyperJiraApiClient {
  readonly config: JiraConfig;
  readonly timeout: number;
  readonly maxIssues: number;
  private readonly credentials: JiraCredentials;
  private readonly transport: JiraHttpTransport;
  constructor(o: JiraApiClientOptions) {
    this.config = o.config; this.credentials = o.credentials; this.timeout = o.timeout ?? 30_000; this.maxIssues = o.maxIssues ?? 10_000;
    this.transport = o.transport ?? (r => window.appflowy.net.request(r));
  }
  /** IPC transport has no per-client resources to release. */
  close(): void {}
  private redact(s: string): string {
    for (const value of [this.credentials.authorizationHeader(this.config.authType), this.credentials.secret]) {
      if (value) s = s.split(value).join('***');
    }
    return s;
  }
  private async send(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    if (!this.config.isComplete) throw new JiraNotConfiguredException('Set the Jira URL and project key first.');
    if (this.credentials.isEmpty) throw new JiraNotConfiguredException('Enter a Jira personal access token or password.');
    const url = new URL(this.config.baseUrl + '/rest/api/2' + path);
    if (!['http:', 'https:'].includes(url.protocol)) throw new JiraNotConfiguredException('Use an HTTP or HTTPS Jira URL.');
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: JiraHttpResponse;
    try {
      response = await Promise.race([
        this.transport({ url: url.toString(), method, headers: { accept: 'application/json', 'content-type': 'application/json; charset=utf-8',
          authorization: this.credentials.authorizationHeader(this.config.authType), 'X-Atlassian-Token': 'no-check' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeout); }),
      ]);
    } catch (e) {
      const m = e instanceof Error ? e.message.toLowerCase() : '';
      if (/redirect/.test(m)) throw new JiraAuthException('Jira redirected the request, usually to a login or SSO page. Check the base URL/context path and that token authentication is allowed.');
      if (/timeout|timed out|abort/.test(m)) throw new JiraNetworkException('Jira did not respond within ' + this.timeout / 1000 + 's.');
      if (/tls|ssl|certificate|handshake/.test(m)) throw new JiraNetworkException('TLS handshake with ' + url.host + ' failed. If your company uses a private CA, install it in the OS trust store.');
      throw new JiraNetworkException('Cannot connect to ' + url.host + '. Check your network and Jira URL.');
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (!response || typeof response.status !== 'number') throw new JiraNetworkException('Cannot connect to ' + url.host + '. Check your network and Jira URL.');
    return this.decode(response);
  }
  private decode(r: JiraHttpResponse): unknown {
    const status = r.status, headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const contentType = headers['content-type'];
    let json: unknown = null;
    if (contentType === undefined || contentType.includes('json')) { try { json = JSON.parse(r.body); } catch { /* reported below */ } }
    if (status >= 200 && status < 300) {
      if (!r.body || status === 204) return null;
      if (json === null) throw new JiraServerException('Expected JSON. The URL may point to a login/SSO page instead of the Jira REST API.', { statusCode: status });
      return json;
    }
    const o = { statusCode: status };
    if (status >= 300 && status < 400) throw new JiraAuthException('Jira redirected the request (HTTP ' + status + '), usually to a login or SSO page. Check the base URL/context path and that token authentication is allowed.', o);
    const j = jsonObject(json);
    const fieldErrors = Object.fromEntries(Object.entries(jsonObject(j.errors)).map(([k, v]) => [k, this.redact(String(v))]));
    const messages = [...(Array.isArray(j.errorMessages) ? j.errorMessages.map(String) : []), ...Object.entries(fieldErrors).map(([k, v]) => k + ': ' + v),
      ...(typeof j.message === 'string' ? [j.message] : [])].filter(m => m.trim());
    const message = messages.length ? this.redact(messages.join('\n')) : null;
    switch (status) {
      case 400: throw new JiraValidationException(message ?? 'Jira rejected the request.', { ...o, fieldErrors });
      case 401: throw new JiraAuthException(message ?? 'The token or password was rejected. Personal access tokens need the "Bearer" mode; basic auth may be disabled.', o);
      case 403: throw new JiraPermissionException(headers['x-seraph-loginreason']?.includes('AUTHENTICATION_DENIED')
        ? 'Jira requires a CAPTCHA after failed logins. Sign in once in the browser, then retry.' : message ?? 'You do not have permission for this action.', o);
      case 404: throw new JiraNotFoundException(message ?? 'Not found. Check the project key and that it is visible to you.', o);
      case 429: { const retry = headers['retry-after']; throw new JiraRateLimitException(message ?? 'Jira is rate limiting requests. Try again later.',
        { ...o, retryAfter: retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : null }); }
      default: throw new JiraServerException(message ?? 'Jira returned HTTP ' + status + '.', o);
    }
  }
  async getMyself(): Promise<JiraUser> { return JiraUser.fromJson(jsonObject(await this.send('GET', '/myself'))); }
  async getProject(key = this.config.projectKey): Promise<JiraProject> { return JiraProject.fromJson(jsonObject(await this.send('GET', '/project/' + encodeURIComponent(key)))); }
  async getCreatableIssueTypes(): Promise<JiraIssueType[]> {
    const key = this.config.projectKey;
    try {
      const types: JiraIssueType[] = []; let startAt = 0;
      while (true) {
        const j = jsonObject(await this.send('GET', '/issue/createmeta/' + encodeURIComponent(key) + '/issuetypes', { startAt: String(startAt), maxResults: '50' }));
        const values = jsonObjects(j.values).map(JiraIssueType.fromJson); types.push(...values);
        if (!values.length || (typeof j.isLast === 'boolean' ? j.isLast : startAt + values.length >= Number(j.total ?? 0))) break;
        startAt += values.length;
      }
      return types;
    } catch (e) { if (!(e instanceof JiraNotFoundException)) throw e; }
    try {
      const j = jsonObject(await this.send('GET', '/issue/createmeta', { projectKeys: key, expand: 'projects.issuetypes' }));
      const p = jsonObjects(j.projects).find(p => p.key === key); if (p) return jsonObjects(p.issuetypes).map(JiraIssueType.fromJson);
    } catch (e) { if (!(e instanceof JiraNotFoundException)) throw e; }
    return (await this.getProject(key)).issueTypes;
  }
  async getIssue(key: string): Promise<JiraIssue> { return JiraIssue.fromJson(jsonObject(await this.send('GET', '/issue/' + encodeURIComponent(key), { fields: JiraIssue.searchFields.join(',') }))); }
  async search(jql: string, options: { startAt?: number; maxResults?: number } = {}): Promise<JiraSearchPage> {
    const startAt = options.startAt ?? 0;
    const j = jsonObject(await this.send('POST', '/search', undefined, { jql, startAt, maxResults: options.maxResults ?? this.config.pageSize, fields: JiraIssue.searchFields }));
    const issues = jsonObjects(j.issues).map(JiraIssue.fromJson);
    return new JiraSearchPage(issues, Number(j.startAt ?? startAt), Number(j.maxResults ?? issues.length), Number(j.total ?? issues.length));
  }
  async searchAll(jql: string, onProgress?: JiraSyncProgress): Promise<JiraIssue[]> {
    const ordered = jql.toLowerCase().includes('order by') ? jql : jql + ' ORDER BY key ASC';
    const byKey = new Map<string, JiraIssue>(); let startAt = 0;
    while (true) {
      const page = await this.search(ordered, { startAt });
      for (const issue of page.issues) { if (byKey.has(issue.key) || byKey.size < this.maxIssues) byKey.set(issue.key, issue); }
      onProgress?.(byKey.size, page.total);
      if (page.isLast || byKey.size >= this.maxIssues) break;
      const next = page.startAt + page.issues.length;
      if (next <= startAt) break; // Guard a server repeatedly returning the same page.
      startAt = next;
    }
    return [...byKey.values()];
  }
  async getTransitions(key: string): Promise<JiraTransition[]> {
    const j = jsonObject(await this.send('GET', '/issue/' + encodeURIComponent(key) + '/transitions', { expand: 'transitions.fields' }));
    return jsonObjects(j.transitions).map(JiraTransition.fromJson);
  }
  async createIssue(draft: JiraIssueDraft): Promise<string> {
    const j = jsonObject(await this.send('POST', '/issue', undefined, { fields: draft.toFields(this.config.projectKey) }));
    if (typeof j.key !== 'string' || !j.key) throw new JiraServerException('Jira did not return the new issue key.');
    return j.key;
  }
  async updateIssue(key: string, draft: JiraIssueDraft): Promise<void> {
    const fields = draft.toFields(); if (!Object.keys(fields).length) return;
    await this.send('PUT', '/issue/' + encodeURIComponent(key), undefined, { fields });
  }
  async transitionIssue(key: string, o: JiraTransitionOptions): Promise<void> {
    await this.send('POST', '/issue/' + encodeURIComponent(key) + '/transitions', undefined, {
      transition: { id: o.transitionId }, ...(o.resolutionId != null ? { fields: { resolution: { id: o.resolutionId } } } : {}),
      ...(o.comment?.trim() ? { update: { comment: [{ add: { body: o.comment.trim() } }] } } : {}),
    });
  }
}
export { HyperJiraApiClient as JiraApiClient };
