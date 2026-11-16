import { JiraApiClient, type JiraHttpTransport, type JiraSyncProgress } from './jira-api-client';
import { HyperJiraCredentialStore, type JiraCredentialStore } from './jira-credential-store';
import { JiraCacheSnapshot, JiraLocalStore } from './jira-local-store';
import { JiraConfig, JiraCredentials } from './models/jira-config';
import { JiraIssue, JiraIssueDraft, JiraIssueType, JiraProject, JiraTransition, JiraUser } from './models/jira-issue';
import { JiraConflictException, JiraException, JiraNotConfiguredException, JiraTransitionUnsupportedException, JiraValidationException } from './jira-exception';
export interface JiraSyncResult { snapshot: JiraCacheSnapshot; added: number; updated: number; removed: number; incremental: boolean }
export interface JiraRepositoryOptions { store: JiraLocalStore; credentialStore?: JiraCredentialStore; transport?: JiraHttpTransport; clock?: () => Date }
export interface JiraConnectionResult { user: JiraUser; project: JiraProject }
export interface JiraSyncOptions { full?: boolean; onProgress?: JiraSyncProgress }
export interface JiraIssueTransitionOptions { resolutionId?: string | null; comment?: string | null }
/** Exact Dart account scope; the main process derives the credential file name. */
export function jiraCredentialAccountId(userId: string, config: JiraConfig): string {
  return userId + '|' + config.scopeId + '|' + config.authType + '|' + config.username;
}
export function stripOrderBy(jql: string): string { const m = /\border\s+by\b/i.exec(jql); return (m ? jql.slice(0, m.index) : jql).trim(); }
export function compareIssueKeys(a: JiraIssue, b: JiraIssue): number {
  const pa = a.key.split('-'), pb = b.key.split('-');
  return (pa[0] < pb[0] ? -1 : pa[0] > pb[0] ? 1 : 0) || (Number(pa.at(-1)) || 0) - (Number(pb.at(-1)) || 0);
}
/** Serializes cache mutations and isolates every request/cache write to its captured account. */
export class HyperJiraRepository {
  private readonly store: JiraLocalStore;
  private readonly credentialStore: JiraCredentialStore;
  private readonly transport?: JiraHttpTransport;
  private readonly clock: () => Date;
  private currentConfig: JiraConfig | null = null;
  private snapshot: JiraCacheSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(o: JiraRepositoryOptions) { this.store = o.store; this.credentialStore = o.credentialStore ?? new HyperJiraCredentialStore(); this.transport = o.transport; this.clock = o.clock ?? (() => new Date()); }
  get config(): JiraConfig | null { return this.currentConfig; }
  credentialsPersist(): Promise<boolean> { return this.credentialStore.isPersistent(); }
  private locked<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result;
  }
  async loadConfig(): Promise<JiraConfig | null> { return this.currentConfig ??= await this.store.readConfig(); }
  async hasCredentials(): Promise<boolean> {
    const c = await this.loadConfig(); if (!c) return false;
    const creds = await this.credentialStore.read(jiraCredentialAccountId(this.store.userId, c)); return !!creds && !creds.isEmpty;
  }
  saveConfig(c: JiraConfig, credentials?: JiraCredentials | null): Promise<void> {
    return this.locked(async () => {
      const previous = await this.loadConfig();
      if (credentials && !credentials.isEmpty) await this.credentialStore.write(jiraCredentialAccountId(this.store.userId, c), credentials);
      if (previous && previous.scopeId !== c.scopeId) { await this.store.clearCache(); this.snapshot = null; }
      await this.store.writeConfig(c); this.currentConfig = c;
    });
  }
  async forgetCredentials(): Promise<void> { const c = await this.loadConfig(); if (c) await this.credentialStore.delete(jiraCredentialAccountId(this.store.userId, c)); }
  async testConnection(c: JiraConfig, credentials?: JiraCredentials | null): Promise<JiraConnectionResult> {
    const creds = credentials && !credentials.isEmpty ? credentials : await this.credentialStore.read(jiraCredentialAccountId(this.store.userId, c));
    const client = new JiraApiClient({ config: c, credentials: creds ?? new JiraCredentials({ secret: '' }), transport: this.transport });
    try { const user = await client.getMyself(); const project = await client.getProject(); return { user, project }; } finally { client.close(); }
  }
  private async withClient<T>(run: (client: JiraApiClient, config: JiraConfig) => Promise<T>): Promise<T> {
    const c = await this.loadConfig(); if (!c?.isComplete) throw new JiraNotConfiguredException('Open Jira settings and enter the server URL and project key.');
    const creds = await this.credentialStore.read(jiraCredentialAccountId(this.store.userId, c));
    if (!creds || creds.isEmpty) throw new JiraNotConfiguredException('Enter your Jira token in settings to connect.');
    const client = new JiraApiClient({ config: c, credentials: creds, transport: this.transport });
    try { return await run(client, c); } finally { client.close(); }
  }
  async loadCache(): Promise<JiraCacheSnapshot> {
    const c = await this.loadConfig(); if (!c) return new JiraCacheSnapshot({ scopeId: '', jql: '', issues: [] });
    return this.snapshot ??= await this.store.readCache(c);
  }
  private async saveSnapshot(s: JiraCacheSnapshot): Promise<void> { await this.store.writeCache(s); this.snapshot = s; }
  sync(o: JiraSyncOptions = {}): Promise<JiraSyncResult> {
    return this.locked(async () => {
      const c = await this.loadConfig(), current = await this.loadCache(), now = this.clock(), baseJql = stripOrderBy(c?.effectiveJql ?? '');
      const incremental = o.full === false && current.hasSynced && current.jql === baseJql && current.issues.length > 0;
      try {
        const minutes = Math.trunc((now.getTime() - (current.lastSuccessAt?.getTime() ?? 0)) / 60_000) + 5;
        const fetched = await this.withClient(client => client.searchAll(incremental ? '(' + baseJql + ') AND updated >= -' + minutes + 'm' : baseJql, o.onProgress));
        const previous = new Map(current.issues.map(i => [i.key, i])), next = new Map(incremental ? previous : []);
        let added = 0, updated = 0;
        for (const issue of fetched) {
          const old = next.get(issue.key) ?? previous.get(issue.key);
          if (!old) { added++; next.set(issue.key, issue); }
          else if (!incremental || old.updated <= issue.updated) { if (old.updated.getTime() !== issue.updated.getTime()) updated++; next.set(issue.key, issue); }
        }
        const fetchedKeys = new Set(fetched.map(i => i.key));
        const removed = incremental ? 0 : [...previous.keys()].filter(k => !fetchedKeys.has(k)).length;
        const snapshot = current.copyWith({ issues: [...next.values()].sort(compareIssueKeys), jql: baseJql, lastAttemptAt: now, lastSuccessAt: now, lastError: null });
        await this.saveSnapshot(snapshot); return { snapshot, added, updated, removed, incremental };
      } catch (e) {
        if (e instanceof JiraException) await this.saveSnapshot(current.copyWith({ lastAttemptAt: now, lastError: e.message }));
        throw e;
      }
    });
  }
  getCreatableIssueTypes(): Promise<JiraIssueType[]> { return this.withClient(c => c.getCreatableIssueTypes()); }
  getIssue(key: string): Promise<JiraIssue> { return this.withClient(c => c.getIssue(key)); }
  getTransitions(key: string): Promise<JiraTransition[]> { return this.withClient(c => c.getTransitions(key)); }
  private async cacheIssue(issue: JiraIssue, scopeId: string): Promise<void> {
    await this.locked(async () => { if ((await this.loadConfig())?.scopeId === scopeId) await this.saveSnapshot((await this.loadCache()).upsert(issue)); });
  }
  async createIssue(draft: JiraIssueDraft): Promise<JiraIssue> {
    if (!draft.summary?.trim()) throw new JiraValidationException('Summary is required.', { fieldErrors: { summary: 'Summary is required.' } });
    if (!draft.issueTypeId) throw new JiraValidationException('Choose an issue type.', { fieldErrors: { issuetype: 'Choose an issue type.' } });
    const result = await this.withClient(async (client, c) => ({ issue: await client.getIssue(await client.createIssue(draft)), scopeId: c.scopeId }));
    await this.cacheIssue(result.issue, result.scopeId); return result.issue;
  }
  async updateIssue(base: JiraIssue, draft: JiraIssueDraft, options: { overwrite?: boolean } = {}): Promise<JiraIssue> {
    const result = await this.withClient(async (client, c) => {
      const remote = await client.getIssue(base.key);
      if (!options.overwrite && remote.updated > base.updated) {
        const conflicts = [draft.summary != null && remote.summary !== base.summary ? 'summary' : '',
          draft.description != null && remote.description !== base.description ? 'description' : '',
          draft.assigneeName != null && remote.assignee?.name !== base.assignee?.name ? 'assignee' : ''].filter(Boolean);
        if (conflicts.length) throw new JiraConflictException(base.key + ' was changed in Jira after you opened it (' + conflicts.join(', ') + ').', { local: base, remote });
      }
      await client.updateIssue(base.key, draft); return { issue: await client.getIssue(base.key), scopeId: c.scopeId };
    });
    await this.cacheIssue(result.issue, result.scopeId); return result.issue;
  }
  async transitionIssue(issue: JiraIssue, transition: JiraTransition, o: JiraIssueTransitionOptions = {}): Promise<JiraIssue> {
    if (transition.unsupportedRequiredFields.length) throw new JiraTransitionUnsupportedException('"' + transition.name + '" requires ' + transition.unsupportedRequiredFields.map(f => f.name).join(', ') + '. Complete it in Jira.');
    const resolution = transition.resolutionField;
    if (resolution?.required && o.resolutionId == null) throw new JiraValidationException('Choose a resolution.', { fieldErrors: { resolution: 'Choose a resolution.' } });
    const result = await this.withClient(async (client, c) => {
      await client.transitionIssue(issue.key, { transitionId: transition.id, resolutionId: resolution ? o.resolutionId : null, comment: transition.hasScreen ? o.comment : null });
      return { issue: await client.getIssue(issue.key), scopeId: c.scopeId };
    });
    await this.cacheIssue(result.issue, result.scopeId); return result.issue;
  }
}
export { HyperJiraRepository as JiraRepository };
