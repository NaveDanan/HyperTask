import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Database, MoreHorizontal, PencilLine, Plus, RefreshCw, RotateCw, Search, Settings, SquareArrowOutUpRight, SquareCheckBig, X } from 'lucide-react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/reui/badge';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { createHyperJiraStore, JiraStatusCategory, jiraStatusCategoryLabels, type JiraDashboardStats, type JiraIssue } from '..';
import { HyperJiraSettingsDialog } from './dialogs/JiraSettingsDialog';
import { HyperJiraIssueDialog } from './dialogs/JiraIssueDialog';
import { HyperJiraTransitionDialog } from './dialogs/JiraTransitionDialog';
import { HyperJiraStatusBadge } from './JiraStatusBadge';
import { formatHyperJiraRelative, HyperJiraAvatar, HyperJiraError, HyperJiraIconButton, HyperJiraNotice, openHyperJiraUrl, type HyperJiraStoreHook } from './jira-ui';

export function HyperJiraDashboardPage({ userProfile }: { userProfile?: UserProfilePB | null }) {
  const userId = userProfile?.id.toString();
  const store = useMemo(() => userId ? createHyperJiraStore({ userId }) : null, [userId]);
  return store ? <HyperJiraDashboardView key={userId} store={store} /> : null;
}

type HyperJiraDialog = { kind: 'settings' } | { kind: 'issue'; issue: JiraIssue | null } | { kind: 'transition'; issue: JiraIssue };

export function HyperJiraDashboardView({ store }: { store: HyperJiraStoreHook }) {
  const loading = store(s => s.isLoading);
  const configured = store(s => s.isConfigured);
  const config = store(s => s.config);
  const [dialog, setDialog] = useState<HyperJiraDialog | null>(null);
  useEffect(() => { void store.getState().load(); }, [store]);
  const openSettings = () => setDialog({ kind: 'settings' });
  return <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto px-8 py-6 text-foreground">
    {loading ? <div className="flex flex-1 items-center justify-center"><Spinner className="size-5 text-muted-foreground" /></div> : <>
      <HyperJiraHeader store={store} onSettings={openSettings} onCreate={() => setDialog({ kind: 'issue', issue: null })} />
      <HyperJiraBanners store={store} onSettings={openSettings} />
      {!configured ? <HyperJiraEmptyState onConnect={openSettings} /> : <>
        <HyperJiraStatsSection store={store} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <HyperJiraIssueList store={store} onEdit={issue => setDialog({ kind: 'issue', issue })} onTransition={issue => setDialog({ kind: 'transition', issue })} />
          <HyperJiraSidePanel store={store} />
        </div>
      </>}
    </>}
    {dialog?.kind === 'settings' && <HyperJiraSettingsDialog store={store} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'issue' && <HyperJiraIssueDialog store={store} issue={dialog.issue} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'transition' && <HyperJiraTransitionDialog store={store} issue={dialog.issue} browseUrl={config?.browseUrl(dialog.issue.key)} onClose={() => setDialog(null)} />}
  </div>;
}

function HyperJiraHeader({ store, onSettings, onCreate }: { store: HyperJiraStoreHook; onSettings: () => void; onCreate: () => void }) {
  const config = store(s => s.config);
  const configured = store(s => s.isConfigured);
  const credentials = store(s => s.hasCredentials);
  const canSync = store(s => s.canSync);
  const syncing = store(s => s.isSyncing);
  const loaded = store(s => s.syncLoaded);
  const total = store(s => s.syncTotal);
  const snapshot = store(s => s.snapshot);
  const databaseSyncing = store(s => s.isDatabaseSyncing);
  const syncLabel = syncing ? total > 0 ? `Syncing ${loaded}/${total}…` : 'Syncing…' : 'Sync';
  return <header className="flex flex-wrap items-center gap-3">
    <div className="flex size-9 items-center justify-center rounded-lg bg-muted"><SquareCheckBig className="size-4 text-muted-foreground" aria-hidden="true" /></div>
    <div className="min-w-0"><h1 className="text-lg font-semibold tracking-tight">{configured ? `Jira · ${config!.projectKey}` : 'Jira'}</h1>
      {configured && <p className="text-xs text-muted-foreground">{new URL(config!.baseUrl).host} · synced {formatHyperJiraRelative(snapshot.lastSuccessAt)}</p>}
    </div>
    <div className="ml-auto flex items-center gap-2">
      {configured && <>
        <Button type="button" size="sm" data-testid="jira-new-issue" disabled={!credentials} onClick={onCreate}><Plus className="size-4" />New issue</Button>
        <Button type="button" variant="outline" size="sm" data-testid="jira-sync" disabled={!canSync} onClick={() => void store.getState().sync(!snapshot.hasSynced)}><RefreshCw aria-hidden="true" className={cn('size-4', syncing && 'animate-spin')} /><span aria-live="polite">{syncLabel}</span></Button>
        <DropdownMenu>
          <Tooltip><TooltipTrigger render={<DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="More actions" />} />}><MoreHorizontal className="size-4" /></TooltipTrigger><TooltipContent>More actions</TooltipContent></Tooltip>
          <DropdownMenuContent align="end" className={cn(floatingSurfaceClass, 'w-56')}>
            <DropdownMenuItem disabled={!canSync} onClick={() => void store.getState().fullRefresh()}><RotateCw className="size-4 text-muted-foreground" />Full refresh</DropdownMenuItem>
            {config!.databaseViewId && <DropdownMenuItem disabled={databaseSyncing || !snapshot.issues.length} onClick={() => void store.getState().updateDatabase()}><Database className="size-4 text-muted-foreground" />{databaseSyncing ? 'Updating database…' : 'Update database'}</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => openHyperJiraUrl(config!.projectUrl)}><SquareArrowOutUpRight className="size-4 text-muted-foreground" />Open project in Jira</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
      <HyperJiraIconButton label="Jira settings" data-testid="jira-settings" onClick={onSettings}><Settings className="size-4" /></HyperJiraIconButton>
    </div>
  </header>;
}

function HyperJiraBanners({ store, onSettings }: { store: HyperJiraStoreHook; onSettings: () => void }) {
  const error = store(s => s.error);
  const snapshot = store(s => s.snapshot);
  const message = store(s => s.message);
  const configured = store(s => s.isConfigured);
  const credentials = store(s => s.hasCredentials);
  const settings = <Button type="button" variant="outline" size="sm" onClick={onSettings}>Open settings</Button>;
  return <>
    {error ? <HyperJiraError error={error} onDismiss={() => store.getState().dismissMessage()} actions={['auth', 'notConfigured', 'notFound'].includes(error.kind) ? settings : undefined} /> :
      snapshot.lastError ? <HyperJiraNotice variant="destructive" title={`Last sync failed ${formatHyperJiraRelative(snapshot.lastAttemptAt)}`} message={`${snapshot.lastError}\nShowing cached data from ${formatHyperJiraRelative(snapshot.lastSuccessAt)}.`} actions={settings} /> :
        message ? <HyperJiraNotice variant="success" message={message} onDismiss={() => store.getState().dismissMessage()} /> : null}
    {configured && !credentials && <HyperJiraNotice title="Connect to sync" message={snapshot.hasSynced ? 'Showing cached issues. Enter your Jira token to refresh and make changes.' : 'Enter your Jira personal access token to load issues.'} actions={<Button type="button" size="sm" onClick={onSettings}>Enter token</Button>} />}
  </>;
}

export function HyperJiraEmptyState({ onConnect }: { onConnect: () => void }) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><SquareCheckBig className="size-5" /></EmptyMedia><EmptyTitle>Connect a Jira project</EmptyTitle><EmptyDescription>Sync issues from Jira Server / Data Center, track progress and create, edit or close issues without leaving HyperTask.</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" data-testid="jira-connect" onClick={onConnect}>Connect to Jira</Button></EmptyContent></Empty>;
}

const categoryDot: Record<JiraStatusCategory, string> = { new: 'bg-muted-foreground/50', indeterminate: 'bg-info', done: 'bg-success', undefined: 'bg-warning' };
const categories = [JiraStatusCategory.toDo, JiraStatusCategory.inProgress, JiraStatusCategory.done];
function HyperJiraStatsSection({ store }: { store: HyperJiraStoreHook }) {
  const stats = store(s => s.stats), selected = store(s => s.categoryFilter);
  return <HyperJiraStats stats={stats} selected={selected} onCategory={category => store.getState().setFilters({ category })} onTotal={() => store.getState().clearFilters()} />;
}

export function HyperJiraStats({ stats, selected, onCategory, onTotal }: { stats: JiraDashboardStats; selected: JiraStatusCategory | null; onCategory: (category: JiraStatusCategory) => void; onTotal: () => void }) {
  const available = [...categories, ...(stats.count(JiraStatusCategory.unknown) ? [JiraStatusCategory.unknown] : [])];
  const percent = Math.round(stats.progress * 100);
  const tiles = [{ label: 'Total', value: stats.total, category: null }, ...available.map(category => ({ label: jiraStatusCategoryLabels[category], value: stats.count(category), category }))];
  return <section className="flex flex-col gap-3" aria-label="Issue statistics">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map(tile => <button type="button" key={tile.label} data-testid={tile.category ? `jira-stat-${tile.category}` : undefined} aria-label={`${tile.label}: ${tile.value}`} aria-pressed={selected === tile.category} onClick={() => tile.category === null ? onTotal() : onCategory(tile.category)} className={cn('rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring', selected === tile.category && 'border-primary')}>
      <div className="text-2xl font-semibold tabular-nums">{tile.value}</div><div className="flex items-center gap-1.5 text-xs text-muted-foreground">{tile.category && <span className={cn('size-2 rounded-full', categoryDot[tile.category])} />}{tile.label}</div>
    </button>)}</div>
    <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Issues done" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      {[JiraStatusCategory.done, JiraStatusCategory.inProgress, JiraStatusCategory.toDo, JiraStatusCategory.unknown].filter(category => stats.count(category) > 0).map(category => <div key={category} className={categoryDot[category]} style={{ width: `${stats.count(category) / stats.total * 100}%` }} />)}
    </div>
    <p className="text-xs text-muted-foreground">{stats.total === 0 ? 'No issues yet' : `${percent}% done · ${stats.open} open of ${stats.total}`}</p>
  </section>;
}

export function HyperJiraFilterChips({ category, assignee, assigneeLabel, onCategory, onAssignee, onClear, hasQuery }: {
  category: JiraStatusCategory | null; assignee: string | null; assigneeLabel: string; onCategory: () => void; onAssignee: () => void; onClear: () => void; hasQuery: boolean;
}) {
  const chips = [...(category === null ? [] : [{ label: jiraStatusCategoryLabels[category], onRemove: onCategory }]), ...(assignee === null ? [] : [{ label: assigneeLabel, onRemove: onAssignee }])];
  return <>{chips.map(chip => <Badge key={chip.label} variant="secondary" size="sm" className="h-auto gap-1 rounded-md pr-0.5 text-xs"><span>{chip.label}</span><HyperJiraIconButton label={`Remove ${chip.label} filter`} size="icon-xs" onClick={chip.onRemove}><X className="size-3" /></HyperJiraIconButton></Badge>)}
    {(chips.length > 0 || hasQuery) && <Button type="button" variant="link" size="sm" onClick={onClear}>Clear filters</Button>}
  </>;
}

function HyperJiraIssueList({ store, onEdit, onTransition }: { store: HyperJiraStoreHook; onEdit: (issue: JiraIssue) => void; onTransition: (issue: JiraIssue) => void }) {
  const issues = store(s => s.visibleIssues), snapshot = store(s => s.snapshot);
  const category = store(s => s.categoryFilter), assignee = store(s => s.assigneeFilter), query = store(s => s.query);
  const stats = store(s => s.stats), credentials = store(s => s.hasCredentials), config = store(s => s.config), syncing = store(s => s.isSyncing);
  return <section className="flex min-w-0 flex-col gap-3" aria-label="Jira issues">
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="min-w-40 flex-1"><InputGroupAddon><Search aria-hidden="true" className="size-4" /></InputGroupAddon><InputGroupInput data-testid="jira-search" aria-label="Search key, summary, status or assignee" placeholder="Search key, summary, status or assignee" value={query} onChange={event => store.getState().setQuery(event.target.value)} /></InputGroup>
      <span className="text-xs tabular-nums text-muted-foreground">{issues.length} of {snapshot.issues.length}</span>
      <HyperJiraFilterChips category={category} assignee={assignee} assigneeLabel={stats.byAssignee.find(a => a.name === assignee)?.displayName ?? (assignee || 'Unassigned')} onCategory={() => { if (category !== null) store.getState().setFilters({ category }); }} onAssignee={() => { if (assignee !== null) store.getState().setFilters({ assignee }); }} onClear={() => store.getState().clearFilters()} hasQuery={query.length > 0} />
    </div>
    {syncing && !snapshot.issues.length ? <div aria-label="Loading issues…" className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div> :
      <div className="divide-y rounded-lg border">{issues.length ? issues.map(issue => <HyperJiraIssueRow key={issue.key} issue={issue} canEdit={credentials} browseUrl={config?.browseUrl(issue.key)} onEdit={() => onEdit(issue)} onTransition={() => onTransition(issue)} />) :
        <p className="p-8 text-center text-sm text-muted-foreground">{snapshot.issues.length ? 'No issues match the current filters.' : 'No issues synced yet.'}</p>}</div>}
  </section>;
}

export function HyperJiraIssueRow({ issue, canEdit, browseUrl, onEdit, onTransition }: { issue: JiraIssue; canEdit: boolean; browseUrl?: string; onEdit: () => void; onTransition: () => void }) {
  const meta = [issue.issueTypeName, issue.priorityName, `updated ${formatHyperJiraRelative(issue.updated)}`].filter(Boolean).join(' · ');
  return <div data-testid={`jira-issue-${issue.key}`} className="group/issue flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
    <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{issue.key}</span>
    <div className="min-w-0 flex-1"><p className="truncate text-sm">{issue.summary}</p><p className="truncate text-xs text-muted-foreground">{meta}</p></div>
    <div className="hidden min-w-0 items-center gap-2 md:flex"><HyperJiraAvatar name={issue.assigneeLabel} /><span className="max-w-28 truncate text-xs text-muted-foreground">{issue.assigneeLabel}</span></div>
    <HyperJiraStatusBadge label={issue.statusName} category={issue.statusCategory} />
    <div className="flex gap-1 opacity-0 group-hover/issue:opacity-100 group-focus-within/issue:opacity-100">
      <HyperJiraIconButton label={issue.isDone ? 'Change status' : 'Close / change status'} data-testid={`jira-transition-${issue.key}`} size="icon-xs" disabled={!canEdit} onClick={onTransition}><ArrowRightLeft className="size-4" /></HyperJiraIconButton>
      <HyperJiraIconButton label="Edit" data-testid={`jira-edit-${issue.key}`} size="icon-xs" disabled={!canEdit} onClick={onEdit}><PencilLine className="size-4" /></HyperJiraIconButton>
      {browseUrl && <HyperJiraIconButton label="Open in Jira" size="icon-xs" onClick={() => openHyperJiraUrl(browseUrl)}><SquareArrowOutUpRight className="size-4" /></HyperJiraIconButton>}
    </div>
  </div>;
}

function HyperJiraSidePanel({ store }: { store: HyperJiraStoreHook }) {
  const stats = store(s => s.stats), assignee = store(s => s.assigneeFilter);
  return <aside className="flex flex-col gap-4 self-start rounded-lg border bg-card p-4">
    <section className="flex flex-col gap-2"><h2 className="text-xs font-medium text-muted-foreground">Assignees</h2>
      {!stats.byAssignee.length && <p className="text-xs text-muted-foreground">No issues</p>}
      {stats.byAssignee.map(person => <button type="button" key={person.name} data-testid={`jira-assignee-${person.name}`} aria-pressed={assignee === person.name} onClick={() => store.getState().setFilters({ assignee: person.name })} className={cn('flex flex-col gap-2 rounded-md p-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring', assignee === person.name && 'bg-accent')}>
        <span className="flex w-full items-center gap-2"><HyperJiraAvatar name={person.displayName} /><span className="min-w-0 truncate text-sm">{person.displayName}</span><span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{person.done}/{person.total} done</span></span>
        <span className="flex h-1 w-full overflow-hidden rounded-full bg-muted"><span className="bg-success" style={{ width: `${person.progress * 100}%` }} /></span>
      </button>)}
    </section>
    <section className="flex flex-col gap-2"><h2 className="text-xs font-medium text-muted-foreground">Statuses</h2>
      {Object.entries(stats.byStatus).sort((a, b) => b[1].count - a[1].count).map(([name, count]) => <div key={name} className="flex items-center gap-2"><HyperJiraStatusBadge label={name} category={count.category} /><span className="ml-auto text-xs tabular-nums text-muted-foreground">{count.count}</span></div>)}
    </section>
  </aside>;
}
export { HyperJiraDashboardPage as JiraDashboardPage };
