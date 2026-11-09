import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { JiraDashboardStats } from '../data/jira-dashboard-stats';
import { JiraDatabaseMapper, type JiraDatabaseSyncReport } from '../data/jira-database-mapper';
import { JiraException, asJiraException } from '../data/jira-exception';
import { JiraCacheSnapshot, JiraLocalStore } from '../data/jira-local-store';
import { JiraRepository, type JiraConnectionResult, type JiraIssueTransitionOptions } from '../data/jira-repository';
import { JiraConfig, JiraCredentials } from '../data/models/jira-config';
import { JiraIssue, JiraIssueDraft, type JiraIssueType, JiraStatusCategory, type JiraTransition } from '../data/models/jira-issue';
export interface HyperJiraState {
  /** True until initial settings, credential availability, and cached issues load. */
  isLoading: boolean;
  /** Non-secret connection settings for this AppFlowy user, or null on first run. */
  config: JiraConfig | null;
  /** Whether credentials exist for the exact configured account. */
  hasCredentials: boolean;
  /** Whether the platform credential adapter survives app restart. */
  credentialsPersist: boolean;
  /** Last cached issues and sync attempt/success/error metadata. */
  snapshot: JiraCacheSnapshot;
  /** True while fetching a full or incremental Jira search. */
  isSyncing: boolean;
  /** Unique issue count loaded in the current search. */
  syncLoaded: number;
  /** Jira's reported total for the current search. */
  syncTotal: number;
  /** Typed failure from the most recent user action, including conflict versions. */
  error: JiraException | null;
  /** Transient success/info banner text. */
  message: string | null;
  /** Selected status category, or null for all categories. */
  categoryFilter: JiraStatusCategory | null;
  /** Assignee username filter; empty string means unassigned, null means all. */
  assigneeFilter: string | null;
  /** Case-insensitive search over key, summary, status, and assignee label. */
  query: string;
  /** True while mirroring cached issues to the configured database view. */
  isDatabaseSyncing: boolean;
  /** Whether both Jira URL and project key are present. */
  isConfigured: boolean;
  /** Whether settings/credentials permit sync and no sync is running. */
  canSync: boolean;
  /** Category, workflow-status, and assignee aggregates over all cached issues. */
  stats: JiraDashboardStats;
  /** Cached issues after category, assignee, and search filters. */
  visibleIssues: JiraIssue[];
}
export interface HyperJiraActions {
  /** Loads cache/settings and performs incremental background sync when connected. */
  load(): Promise<void>;
  /** Syncs incrementally by default; full=true replaces the entire JQL result. */
  sync(full?: boolean): Promise<void>;
  /** Fetches the complete JQL result and reports cache removals. */
  fullRefresh(): Promise<void>;
  /** Saves non-secret config and optional credentials, reloads, then full-syncs when connected. */
  saveSettings(config: JiraConfig, credentials?: JiraCredentials | null): Promise<void>;
  /** Read-only check of myself and project, without persisting settings. */
  testConnection(config: JiraConfig, credentials?: JiraCredentials | null): Promise<JiraConnectionResult>;
  /** Deletes the current account's secret and updates credential availability. */
  forgetCredentials(): Promise<void>;
  /** Loads live creatable issue types; subtask entries are excluded for the UI. */
  getCreatableIssueTypes(): Promise<JiraIssueType[]>;
  /** Fetches a fresh issue for an editor without changing the cache. */
  getIssue(key: string): Promise<JiraIssue>;
  /** Creates one issue, caches the server result, and emits a success banner. */
  createIssue(draft: JiraIssueDraft): Promise<JiraIssue>;
  /** Edits changed fields, rejecting conflicting remote edits unless overwrite=true. */
  updateIssue(base: JiraIssue, draft: JiraIssueDraft, options?: { overwrite?: boolean }): Promise<JiraIssue>;
  /** Loads live per-issue transitions and screen fields. */
  getTransitions(key: string): Promise<JiraTransition[]>;
  /** Applies a live transition with optional resolution/comment and caches the result. */
  transitionIssue(issue: JiraIssue, transition: JiraTransition, options?: JiraIssueTransitionOptions): Promise<JiraIssue>;
  /** Reloads persisted cache after an externally completed repository mutation. */
  issueChanged(issue: JiraIssue, message?: string): Promise<void>;
  /** Mirrors cached issues to the configured database and returns its report. */
  updateDatabase(): Promise<JiraDatabaseSyncReport | null>;
  /** Applies provided filters; selecting the active category/assignee toggles it off. */
  setFilters(filters: { category?: JiraStatusCategory; assignee?: string; query?: string }): void;
  /** Sets search text while preserving category and assignee filters. */
  setQuery(query: string): void;
  /** Clears category, assignee, and search filters together. */
  clearFilters(): void;
  /** Clears transient error and message banners without clearing cache failure metadata. */
  dismissMessage(): void;
}
export type HyperJiraStore = HyperJiraState & HyperJiraActions;
export interface HyperJiraStoreOptions { userId?: string; repository?: JiraRepository; databaseMapper?: JiraDatabaseMapper | null }
type Derived = Pick<HyperJiraState, 'isConfigured' | 'canSync' | 'stats' | 'visibleIssues'>;
function derive(s: Omit<HyperJiraState, keyof Derived>): Derived {
  const isConfigured = s.config?.isComplete ?? false, q = s.query.trim().toLowerCase();
  return { isConfigured, canSync: isConfigured && s.hasCredentials && !s.isSyncing,
    stats: JiraDashboardStats.from(s.snapshot.issues), visibleIssues: s.snapshot.issues.filter(i =>
      (s.categoryFilter === null || i.statusCategory === s.categoryFilter) &&
      (s.assigneeFilter === null || (i.assignee?.name ?? '') === s.assigneeFilter) &&
      (!q || [i.key, i.summary, i.statusName, i.assigneeLabel].some(v => v.toLowerCase().includes(q)))) };
}
/**
 * Create one hook per AppFlowy user/dashboard, after KeyValueStorage startup.
 * Keep the returned hook stable and select individual fields in React.
 * Dialog actions return values and rethrow typed errors; load/sync/settings/database
 * actions report errors in state. On conflict, use error.remote as the new editor
 * base or call updateIssue(base, draft, { overwrite: true }).
 */
export function createHyperJiraStore(options: HyperJiraStoreOptions): UseBoundStore<StoreApi<HyperJiraStore>> {
  if (!options.repository && !options.userId) throw new Error('HyperJiraStore requires userId or repository.');
  const repository = options.repository ?? new JiraRepository({ store: new JiraLocalStore(options.userId!) });
  const mapper = options.databaseMapper === undefined ? new JiraDatabaseMapper() : options.databaseMapper;
  return create<HyperJiraStore>((set, get) => {
    const patch = (p: Partial<HyperJiraState>) => set(s => {
      const next = { ...s, ...p };
      // Preserve aggregate/list references on progress and banner-only changes.
      const dataChanged = p.snapshot !== undefined;
      const filtersChanged = p.query !== undefined || p.categoryFilter !== undefined || p.assigneeFilter !== undefined;
      const derived = dataChanged || filtersChanged ? derive(next) : null;
      const isConfigured = next.config?.isComplete ?? false;
      return { ...p, isConfigured, canSync: isConfigured && next.hasCredentials && !next.isSyncing,
        stats: dataChanged ? derived!.stats : s.stats, visibleIssues: dataChanged || filtersChanged ? derived!.visibleIssues : s.visibleIssues };
    });
    const reload = async () => {
      const config = await repository.loadConfig();
      const [hasCredentials, snapshot, credentialsPersist] = await Promise.all([repository.hasCredentials(), repository.loadCache(), repository.credentialsPersist()]);
      patch({ isLoading: false, config, hasCredentials, snapshot, credentialsPersist });
    };
    const dialog = async <T,>(run: () => Promise<T>): Promise<T> => {
      patch({ error: null });
      try { return await run(); } catch (e) { const error = asJiraException(e); patch({ error }); throw error; }
    };
    let loading: Promise<void> | null = null;
    const initial = { isLoading: true, config: null, hasCredentials: false, credentialsPersist: false,
      snapshot: new JiraCacheSnapshot({ scopeId: '', jql: '', issues: [] }), isSyncing: false, syncLoaded: 0, syncTotal: 0,
      error: null, message: null, categoryFilter: null, assigneeFilter: null, query: '', isDatabaseSyncing: false };
    return { ...initial, ...derive(initial),
      load: () => {
        if (loading) return loading;
        loading = (async () => { try { await reload(); if (get().canSync) await get().sync(false); }
          catch (e) { patch({ isLoading: false, error: asJiraException(e) }); } })().finally(() => { loading = null; });
        return loading;
      },
      sync: async (full = false) => {
        if (get().isSyncing) return;
        patch({ isSyncing: true, syncLoaded: 0, syncTotal: 0, error: null });
        try {
          const result = await repository.sync({ full, onProgress: (syncLoaded, syncTotal) => patch({ syncLoaded, syncTotal }) });
          patch({ isSyncing: false, snapshot: result.snapshot, message: 'Synced ' + result.snapshot.issues.length + ' issues (' + result.added + ' new, ' + result.updated + ' updated' + (result.removed ? ', ' + result.removed + ' no longer matched' : '') + ')' });
        } catch (e) {
          let snapshot = get().snapshot; try { snapshot = await repository.loadCache(); } catch { /* keep visible cache */ }
          patch({ isSyncing: false, snapshot, error: asJiraException(e) });
        }
      },
      fullRefresh: () => get().sync(true),
      saveSettings: async (config, credentials) => {
        try { await repository.saveConfig(config, credentials); await reload(); patch({ error: null, message: 'Settings saved' }); if (get().canSync) await get().fullRefresh(); }
        catch (e) { patch({ error: asJiraException(e) }); }
      },
      testConnection: (c, credentials) => dialog(() => repository.testConnection(c, credentials)),
      forgetCredentials: () => dialog(async () => { await repository.forgetCredentials(); patch({ hasCredentials: await repository.hasCredentials() }); }),
      getCreatableIssueTypes: () => dialog(async () => (await repository.getCreatableIssueTypes()).filter(t => !t.subtask)),
      getIssue: key => dialog(() => repository.getIssue(key)),
      createIssue: draft => dialog(async () => { const issue = await repository.createIssue(draft); await get().issueChanged(issue, issue.key + ' created'); return issue; }),
      updateIssue: (base, draft, o) => dialog(async () => { const issue = await repository.updateIssue(base, draft, o); await get().issueChanged(issue, issue.key + ' updated'); return issue; }),
      getTransitions: key => dialog(() => repository.getTransitions(key)),
      transitionIssue: (issue, transition, o) => dialog(async () => {
        const updated = await repository.transitionIssue(issue, transition, o); await get().issueChanged(updated, updated.key + ' is now ' + updated.statusName); return updated;
      }),
      issueChanged: async (_issue, message) => patch({ snapshot: await repository.loadCache(), error: null, message: message ?? null }),
      updateDatabase: async () => {
        const { config, snapshot, isDatabaseSyncing } = get(); if (!mapper || !config || isDatabaseSyncing) return null;
        patch({ isDatabaseSyncing: true, error: null });
        try { const report = await mapper.sync({ viewId: config.databaseViewId, config, issues: snapshot.issues });
          patch({ isDatabaseSyncing: false, message: 'Database updated: ' + report.summary }); return report; }
        catch (e) { patch({ isDatabaseSyncing: false, error: asJiraException(e) }); return null; }
      },
      setFilters: f => { const s = get(); patch({
        ...(f.category === undefined ? {} : { categoryFilter: s.categoryFilter === f.category ? null : f.category }),
        ...(f.assignee === undefined ? {} : { assigneeFilter: s.assigneeFilter === f.assignee ? null : f.assignee }),
        ...(f.query === undefined ? {} : { query: f.query }),
      }); },
      setQuery: query => patch({ query }),
      clearFilters: () => patch({ categoryFilter: null, assigneeFilter: null, query: '' }),
      dismissMessage: () => patch({ error: null, message: null }),
    };
  });
}
export { createHyperJiraStore as createJiraStore };
export type { HyperJiraState as JiraState, HyperJiraActions as JiraActions };
