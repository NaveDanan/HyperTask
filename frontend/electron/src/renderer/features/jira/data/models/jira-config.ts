/** Serialized enum names match Flutter. */
export enum JiraAuthType { personalAccessToken = 'personalAccessToken', basic = 'basic' }
export const jiraAuthLabels: Record<JiraAuthType, string> = { personalAccessToken: 'Personal access token (Bearer)', basic: 'Username + password/token (Basic)' };
export interface JiraConfigInput {
  baseUrl: string; projectKey: string; authType?: JiraAuthType; username?: string;
  customJql?: string; databaseViewId?: string; pageSize?: number;
}
/** Non-secret settings, compatible with Flutter JSON and dataset scopes. */
export class HyperJiraConfig {
  readonly baseUrl: string; readonly projectKey: string; readonly authType: JiraAuthType;
  readonly username: string; readonly customJql: string; readonly databaseViewId: string; readonly pageSize: number;
  constructor(i: JiraConfigInput) {
    this.baseUrl = i.baseUrl; this.projectKey = i.projectKey; this.authType = i.authType ?? JiraAuthType.personalAccessToken;
    this.username = i.username ?? ''; this.customJql = i.customJql ?? ''; this.databaseViewId = i.databaseViewId ?? ''; this.pageSize = i.pageSize ?? 100;
  }
  static fromJson(j: Record<string, unknown>): HyperJiraConfig {
    return new HyperJiraConfig({ baseUrl: this.normalizeBaseUrl(String(j.baseUrl ?? '')), projectKey: String(j.projectKey ?? '').trim().toUpperCase(),
      authType: j.authType === JiraAuthType.basic ? JiraAuthType.basic : JiraAuthType.personalAccessToken, username: String(j.username ?? ''),
      customJql: String(j.customJql ?? ''), databaseViewId: String(j.databaseViewId ?? ''), pageSize: typeof j.pageSize === 'number' ? Math.trunc(j.pageSize) : 100 });
  }
  static fromUserUrl(url: string, options: Partial<Omit<JiraConfigInput, 'baseUrl'>> = {}): HyperJiraConfig {
    const p = this.parseJiraUrl(url);
    return new HyperJiraConfig({ ...options, baseUrl: p.baseUrl, projectKey: options.projectKey?.trim().toUpperCase() || p.projectKey || '' });
  }
  static normalizeBaseUrl(url: string): string {
    const v = url.trim(); if (!v) return '';
    try { const u = new URL(v.includes('://') ? v : 'https://' + v);
      return u.hostname ? u.protocol + '//' + u.host + u.pathname.replace(/\/+$/, '') : ''; } catch { return ''; }
  }
  static parseJiraUrl(url: string): { baseUrl: string; projectKey: string | null } {
    const n = this.normalizeBaseUrl(url); if (!n) return { baseUrl: '', projectKey: null };
    const u = new URL(n), segments = u.pathname.split('/').filter(Boolean);
    const markers = new Set(['projects', 'browse', 'secure', 'rest', 'issues', 'plugins', 'login.jsp']);
    const index = segments.findIndex(s => markers.has(s)); let projectKey: string | null = null;
    const next = segments[index + 1];
    if (index >= 0 && next) {
      if (segments[index] === 'projects') projectKey = next.toUpperCase();
      if (segments[index] === 'browse') projectKey = /^([A-Za-z][A-Za-z0-9_]*)(-\d+)?$/.exec(next)?.[1]?.toUpperCase() ?? null;
    }
    const context = index < 0 ? segments : segments.slice(0, index);
    return { baseUrl: u.protocol + '//' + u.host + (context.length ? '/' + context.join('/') : ''), projectKey };
  }
  get isComplete(): boolean { return !!this.baseUrl && !!this.projectKey; }
  get scopeId(): string { return this.baseUrl + '|' + this.projectKey; }
  get defaultJql(): string { return 'project = "' + this.projectKey + '"'; }
  get effectiveJql(): string { return this.customJql.trim() || this.defaultJql; }
  get projectUrl(): string { return this.baseUrl + '/projects/' + this.projectKey; }
  browseUrl(key: string): string { return this.baseUrl + '/browse/' + key; }
  copyWith(i: Partial<JiraConfigInput>): HyperJiraConfig {
    return new HyperJiraConfig({ ...this.toJson(), ...i, baseUrl: i.baseUrl === undefined ? this.baseUrl : HyperJiraConfig.normalizeBaseUrl(i.baseUrl),
      projectKey: i.projectKey === undefined ? this.projectKey : i.projectKey.trim().toUpperCase() });
  }
  toJson(): Required<JiraConfigInput> { return { baseUrl: this.baseUrl, projectKey: this.projectKey, authType: this.authType,
    username: this.username, customJql: this.customJql, databaseViewId: this.databaseViewId, pageSize: this.pageSize }; }
  encode(): string { return JSON.stringify(this.toJson()); }
}
/** Secrets never enter config/cache; accidental string/JSON logging is redacted. */
export class HyperJiraCredentials {
  readonly secret: string; readonly username: string;
  constructor(i: { secret: string; username?: string }) { this.secret = i.secret; this.username = i.username ?? ''; }
  get isEmpty(): boolean { return !this.secret; }
  authorizationHeader(type: JiraAuthType): string {
    if (type === JiraAuthType.personalAccessToken) return 'Bearer ' + this.secret;
    return 'Basic ' + btoa(Array.from(new TextEncoder().encode(this.username + ':' + this.secret), b => String.fromCharCode(b)).join(''));
  }
  toString(): string { return 'JiraCredentials(username: ' + this.username + ', secret: ***)'; }
  toJSON(): string { return this.toString(); }
}
// Jira aliases preserve source integration terminology, while product classes use Hyper.
export { HyperJiraConfig as JiraConfig, HyperJiraCredentials as JiraCredentials };
