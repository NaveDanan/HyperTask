import { KeyValueStorage } from '@/startup/kv';
import { JiraConfig } from './models/jira-config';
import { JiraIssue, jsonObject, jsonObjects, parseJiraDate } from './models/jira-issue';
export interface JiraCacheInput { scopeId: string; jql: string; issues: JiraIssue[]; lastAttemptAt?: Date | null; lastSuccessAt?: Date | null; lastError?: string | null }
export class HyperJiraCacheSnapshot {
  readonly scopeId: string; readonly jql: string; readonly issues: JiraIssue[];
  readonly lastAttemptAt: Date | null; readonly lastSuccessAt: Date | null; readonly lastError: string | null;
  constructor(i: JiraCacheInput) { this.scopeId = i.scopeId; this.jql = i.jql; this.issues = i.issues; this.lastAttemptAt = i.lastAttemptAt ?? null; this.lastSuccessAt = i.lastSuccessAt ?? null; this.lastError = i.lastError ?? null; }
  static empty(c: JiraConfig): HyperJiraCacheSnapshot { return new HyperJiraCacheSnapshot({ scopeId: c.scopeId, jql: c.effectiveJql, issues: [] }); }
  static fromJson(j: Record<string, unknown>): HyperJiraCacheSnapshot {
    return new HyperJiraCacheSnapshot({ scopeId: String(j.scopeId ?? ''), jql: String(j.jql ?? ''), issues: jsonObjects(j.issues).map(JiraIssue.fromJson),
      lastAttemptAt: parseJiraDate(j.lastAttemptAt), lastSuccessAt: parseJiraDate(j.lastSuccessAt), lastError: typeof j.lastError === 'string' ? j.lastError : null });
  }
  get hasSynced(): boolean { return this.lastSuccessAt !== null; }
  copyWith(i: Partial<JiraCacheInput>): HyperJiraCacheSnapshot { return new HyperJiraCacheSnapshot({ ...this, ...i }); }
  upsert(issue: JiraIssue): HyperJiraCacheSnapshot {
    const issues = [...this.issues], index = issues.findIndex(i => i.key === issue.key || i.id === issue.id);
    if (index < 0) issues.push(issue); else issues[index] = issue; return this.copyWith({ issues });
  }
  toJson() { return { version: 1, scopeId: this.scopeId, jql: this.jql, issues: this.issues.map(i => i.toJson()), lastAttemptAt: this.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null, lastError: this.lastError }; }
}
export interface JiraKeyValueStorage { get(key: string): string | null | Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
/** Same device-local shared-preferences keys as Dart; no support files or cloud writes. */
export class HyperJiraLocalStore {
  constructor(readonly userId: string, private readonly storage: JiraKeyValueStorage = KeyValueStorage) {}
  get configKey(): string { return 'appflowy.jira.' + this.userId + '.config'; }
  get cacheKey(): string { return 'appflowy.jira.' + this.userId + '.cache'; }
  async readConfig(): Promise<JiraConfig | null> {
    const raw = await this.storage.get(this.configKey); if (raw == null) return null;
    try { const p: unknown = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? JiraConfig.fromJson(jsonObject(p)) : null; } catch { return null; }
  }
  writeConfig(c: JiraConfig): Promise<void> { return this.storage.set(this.configKey, c.encode()); }
  async readCache(c: JiraConfig): Promise<HyperJiraCacheSnapshot> {
    const raw = await this.storage.get(this.cacheKey); if (raw == null) return HyperJiraCacheSnapshot.empty(c);
    try { const s = HyperJiraCacheSnapshot.fromJson(jsonObject(JSON.parse(raw))); return s.scopeId === c.scopeId ? s : HyperJiraCacheSnapshot.empty(c); } catch { return HyperJiraCacheSnapshot.empty(c); }
  }
  writeCache(s: HyperJiraCacheSnapshot): Promise<void> { return this.storage.set(this.cacheKey, JSON.stringify(s.toJson())); }
  clearCache(): Promise<void> { return this.storage.remove(this.cacheKey); }
}
export { HyperJiraLocalStore as JiraLocalStore, HyperJiraCacheSnapshot as JiraCacheSnapshot };
