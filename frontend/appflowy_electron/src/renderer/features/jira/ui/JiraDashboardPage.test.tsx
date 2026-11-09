import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHyperJiraStore, JiraAuthType, JiraCacheSnapshot, JiraConfig, JiraConflictException, JiraDashboardStats, JiraIssue, JiraStatusCategory, JiraUser, type HyperJiraStore } from '..';
import { HyperJiraDashboardView, HyperJiraEmptyState, HyperJiraFilterChips, HyperJiraIssueRow, HyperJiraStats } from './JiraDashboardPage';
import { buildHyperJiraDraft, HyperJiraConflictAlert, HyperJiraIssueDialog } from './dialogs/JiraIssueDialog';
import { HyperJiraSettingsForm } from './dialogs/JiraSettingsDialog';
import { HyperJiraStatusBadge } from './JiraStatusBadge';
import { formatHyperJiraRelative } from './jira-ui';

vi.mock('@/ui', () => ({ showToast: vi.fn() }));
// Base UI portals do not render on the server. Keep real fields/buttons and
// replace only the modal host so its form can be checked with the repo's SSR approach.
vi.mock('./jira-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('./jira-ui')>();
  return { ...actual, HyperJiraModal: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) => createElement('section', { 'aria-label': title }, children, footer) };
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const markup = (element: ReactElement) => renderToStaticMarkup(element);
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(nodes)];
}
function action(node: ReactNode, label: string) {
  const element = nodes(node).find(element => element.props.label === label || element.props.children === label);
  if (!element || typeof element.props.onClick !== 'function') throw new Error('Action not found: ' + label);
  return element.props.onClick as () => void;
}
const issue = (category = JiraStatusCategory.toDo, key = 'DEMO-1') => new JiraIssue({
  id: key, key, summary: 'A real issue summary', description: 'Existing description',
  statusName: category === JiraStatusCategory.done ? 'Closed' : 'Open', statusCategory: category, issueTypeName: 'Task',
  assignee: new JiraUser('alice', 'Alice Example'), updated: new Date('2026-11-09T08:00:00Z'),
});
const config = new JiraConfig({ baseUrl: 'https://jira.example.com', projectKey: 'DEMO' });
function readyStore() {
  const store = createHyperJiraStore({ userId: 'test-ui', databaseMapper: null });
  const issues = [issue(), issue(JiraStatusCategory.done, 'DEMO-2')];
  store.setState({ isLoading: false, config, isConfigured: true, hasCredentials: true, canSync: true,
    snapshot: new JiraCacheSnapshot({ scopeId: config.scopeId, jql: config.defaultJql, issues }),
    stats: JiraDashboardStats.from(issues), visibleIssues: issues });
  // Bound Zustand hooks close over their original SSR snapshot. Select the
  // real prepared store state here without requiring a browser renderer.
  function useSnapshot(): HyperJiraStore;
  function useSnapshot<T>(selector: (state: HyperJiraStore) => T): T;
  function useSnapshot<T>(selector?: (state: HyperJiraStore) => T): T | HyperJiraStore {
    return selector ? selector(store.getState()) : store.getState();
  }
  return Object.assign(useSnapshot, store);
}

describe('Jira dashboard', () => {
  it('renders the first-run connection state and preserves its action', () => {
    const connect = vi.fn();
    const element = HyperJiraEmptyState({ onConnect: connect });
    const html = markup(element);
    expect(html).toContain('Connect a Jira project');
    expect(html).toContain('Sync issues from Jira Server / Data Center, track progress');
    expect(html).toContain('Connect to Jira');
    action(element, 'Connect to Jira')();
    expect(connect).toHaveBeenCalledOnce();
  });

  it('renders totals and the done share from unfiltered statistics', () => {
    const stats = JiraDashboardStats.from([issue(), issue(JiraStatusCategory.inProgress, 'DEMO-2'), issue(JiraStatusCategory.done, 'DEMO-3')]);
    const category = vi.fn(), total = vi.fn();
    const element = HyperJiraStats({ stats, selected: JiraStatusCategory.done, onCategory: category, onTotal: total });
    const html = markup(element);
    expect(html).toContain('Total: 3');
    expect(html).toContain('In Progress: 1');
    expect(html).toContain('33% done · 2 open of 3');
    expect(html).toContain('aria-valuenow="33"');
    const tiles = nodes(element).filter(node => node.type === 'button');
    (tiles[0].props.onClick as () => void)();
    (tiles[3].props.onClick as () => void)();
    expect(total).toHaveBeenCalledOnce();
    expect(category).toHaveBeenCalledWith(JiraStatusCategory.done);
  });

  it('handles empty stats and the additional unknown category', () => {
    const props = { selected: null, onCategory: vi.fn(), onTotal: vi.fn() };
    expect(markup(createElement(HyperJiraStats, { ...props, stats: JiraDashboardStats.from([]) }))).toContain('No issues yet');
    expect(markup(createElement(HyperJiraStats, { ...props, stats: JiraDashboardStats.from([issue(JiraStatusCategory.unknown)]) }))).toContain('No category: 1');
  });

  it('renders sync progress, issues, assignee progress and workflow statuses', () => {
    const store = readyStore();
    store.setState({ isSyncing: true, canSync: false, syncLoaded: 12, syncTotal: 40 });
    const html = markup(createElement(HyperJiraDashboardView, { store }));
    for (const text of ['Jira · DEMO', 'Syncing 12/40…', 'A real issue summary', 'Assignees', 'Statuses', '1/2 done', 'Closed']) expect(html).toContain(text);
    expect(html).toContain('data-testid="jira-sync"');
  });

  it('keeps cached issues visible with missing credentials and sync errors', () => {
    const store = readyStore();
    store.setState({ hasCredentials: false, canSync: false, snapshot: new JiraCacheSnapshot({
      scopeId: config.scopeId, jql: config.defaultJql, issues: [issue()], lastError: 'The server is unavailable.',
      lastSuccessAt: new Date(), lastAttemptAt: new Date(),
    }) });
    const html = markup(createElement(HyperJiraDashboardView, { store }));
    for (const text of ['Last sync failed', 'Showing cached data from', 'Open settings', 'Connect to sync', 'Enter token', 'A real issue summary']) expect(html).toContain(text);
  });

  it('renders five loading rows while the initial search runs', () => {
    const store = readyStore();
    store.setState({ isSyncing: true, snapshot: new JiraCacheSnapshot({ scopeId: '', jql: '', issues: [] }), visibleIssues: [] });
    const html = markup(createElement(HyperJiraDashboardView, { store }));
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(5);
    expect(html).toContain('Loading issues…');
  });

  it('renders active filter chips, including unassigned, and routes removals independently', () => {
    const category = vi.fn(), assignee = vi.fn(), clear = vi.fn();
    const element = HyperJiraFilterChips({ category: JiraStatusCategory.done, assignee: '', assigneeLabel: 'Unassigned',
      onCategory: category, onAssignee: assignee, onClear: clear, hasQuery: true });
    const html = markup(element);
    expect(html).toContain('Remove Done filter');
    expect(html).toContain('Remove Unassigned filter');
    expect(html).toContain('Clear filters');
    action(element, 'Remove Done filter')(); action(element, 'Remove Unassigned filter')(); action(element, 'Clear filters')();
    expect(category).toHaveBeenCalledOnce(); expect(assignee).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
    const none = markup(createElement(HyperJiraFilterChips, { category: null, assignee: null, assigneeLabel: '', onCategory: category, onAssignee: assignee, onClear: clear, hasQuery: false }));
    expect(none).not.toContain('Clear filters');
  });

  it('preserves row actions and uses the desktop shell for Jira links', () => {
    const edit = vi.fn(), transition = vi.fn(), openExternal = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { appflowy: { shell: { openExternal } } });
    const element = HyperJiraIssueRow({ issue: issue(), canEdit: true, browseUrl: config.browseUrl('DEMO-1'), onEdit: edit, onTransition: transition });
    const html = markup(element);
    for (const label of ['Close / change status', 'Edit', 'Open in Jira']) expect(html).toContain('aria-label="' + label + '"');
    action(element, 'Edit')(); action(element, 'Close / change status')(); action(element, 'Open in Jira')();
    expect(edit).toHaveBeenCalledOnce(); expect(transition).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://jira.example.com/browse/DEMO-1');
  });

  it('disables writes without credentials and labels a done issue correctly', () => {
    const element = HyperJiraIssueRow({ issue: issue(JiraStatusCategory.done), canEdit: false, onEdit: vi.fn(), onTransition: vi.fn() });
    const actions = nodes(element).filter(node => node.props.label === 'Edit' || node.props.label === 'Change status');
    expect(actions).toHaveLength(2); expect(actions.every(node => node.props.disabled)).toBe(true);
    expect(markup(element)).not.toContain('Open in Jira');
  });
});

describe('Jira dialogs', () => {
  it.each([JiraAuthType.personalAccessToken, JiraAuthType.basic])('shows Username only for Basic authentication (%s)', authType => {
    const html = markup(createElement(HyperJiraSettingsForm, { config: config.copyWith({ authType, username: authType === JiraAuthType.basic ? 'alice' : '' }),
      hasCredentials: true, credentialsPersist: true, actions: { testConnection: vi.fn(), saveSettings: vi.fn() }, onClose: vi.fn() }));
    expect(html.includes('autoComplete="username"')).toBe(authType === JiraAuthType.basic);
    expect(html).toContain(authType === JiraAuthType.basic ? 'Password or token' : 'Personal access token');
    expect(html).toContain('type="password"');
    expect(html).toContain('placeholder="••••••••"');
    expect(html).toContain('Leave empty to keep the current one.');
    expect(html).toContain('Stored in the OS secure storage.');
    expect(html).toContain('Test connection');
  });

  it('shows session-only credential help and the default connection values', () => {
    const html = markup(createElement(HyperJiraSettingsForm, { config: null, hasCredentials: false, credentialsPersist: false,
      actions: { testConnection: vi.fn(), saveSettings: vi.fn() }, onClose: vi.fn() }));
    expect(html).toContain('value="https://jira.example.com"');
    expect(html).toContain('value="DEMO"');
    expect(html).toContain('Kept in memory for this session only; re-enter after restarting HyperTask.');
  });

  it('renders the edit fields and preserves the six-line description', () => {
    const html = markup(createElement(HyperJiraIssueDialog, { store: readyStore(), issue: issue(), onClose: vi.fn() }));
    for (const text of ['Edit DEMO-1', 'Summary', 'Description', 'Jira wiki markup is supported.', 'Clear to unassign. Leave unchanged to keep.', 'rows="6"', 'Existing description']) expect(html).toContain(text);
    expect(html).not.toContain('data-slot="toggle-group"');
  });

  it('renders both conflict choices, the remote version, and their callbacks', () => {
    const remote = new JiraIssue({ ...issue(), summary: 'The remote summary', statusName: 'In Review' });
    const conflict = new JiraConflictException('Remote fields changed.', { local: issue(), remote });
    const useRemote = vi.fn(), overwrite = vi.fn();
    const element = HyperJiraConflictAlert({ conflict, saving: false, onUseRemote: useRemote, onOverwrite: overwrite });
    const html = markup(element);
    for (const text of ['Changed in Jira since you opened it', 'The remote summary', 'In Review', 'Alice Example', 'Use Jira version', 'Overwrite with mine', 'bg-warning']) expect(html).toContain(text);
    // Actions live in the notice's actions slot.
    const actions = element.props.actions;
    action(actions, 'Use Jira version')(); action(actions, 'Overwrite with mine')();
    expect(useRemote).toHaveBeenCalledOnce(); expect(overwrite).toHaveBeenCalledOnce();
  });

  it('sends only changed fields, preserves unassign, and omits blank create fields', () => {
    expect(buildHyperJiraDraft(issue(), issue().summary, issue().description, 'alice').toFields()).toEqual({});
    expect(buildHyperJiraDraft(issue(), 'Changed', '', '').toFields()).toEqual({ summary: 'Changed', description: '', assignee: null });
    expect(buildHyperJiraDraft(null, ' New ', '', '', 'task').toFields()).toEqual({ summary: 'New', issuetype: { id: 'task' } });
  });

  it.each([
    [JiraStatusCategory.toDo, 'bg-secondary'],
    [JiraStatusCategory.inProgress, 'bg-info/10'],
    [JiraStatusCategory.done, 'bg-success/10'],
  ])('uses the specified status badge for %s', (category, token) => {
    expect(markup(createElement(HyperJiraStatusBadge, { category, label: '' }))).toContain(token);
  });

  it('keeps the Dart relative-time strings', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(formatHyperJiraRelative(null, now)).toBe('never');
    expect(formatHyperJiraRelative(new Date(now.getTime() - 10_000), now)).toBe('just now');
    expect(formatHyperJiraRelative(new Date(now.getTime() - 120_000), now)).toBe('2 min ago');
    expect(formatHyperJiraRelative(new Date(now.getTime() - 7_200_000), now)).toBe('2 h ago');
    expect(formatHyperJiraRelative(new Date(now.getTime() - 172_800_000), now)).toBe('2 d ago');
  });
});
