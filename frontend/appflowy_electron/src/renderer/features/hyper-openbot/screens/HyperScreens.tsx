// Derived from OpenBot. Copyright (c) 2026 CopilotKit. MIT License; see REUSE.md.
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HyperConversationTitle, HyperGrantSummary, HyperGroupRoster, HyperSortConnections } from './HyperScreenModels';
import type { HyperBot, HyperConnection, HyperConversation, HyperSkill } from './HyperScreenModels';

export interface HyperScreenState {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}
function HyperStatus({ loading, error, onRetry }: HyperScreenState) {
  return <>{loading && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}{error && <div role="alert" className="text-sm text-destructive">{error}{onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}</div>}</>;
}
function HyperPage({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-background p-4 text-foreground"><header className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">{title}</h1>{action}</header>{children}</section>;
}
const rowClass = 'flex w-full items-center justify-between gap-3 rounded-md p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-ring';
function HyperSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <Input aria-label={label} placeholder={label} type="search" value={value} onChange={event => onChange(event.target.value)} />;
}

export interface HyperConversationsScreenProps extends HyperScreenState {
  conversations: readonly HyperConversation[];
  selectedId?: string;
  pendingId?: string;
  onOpen: (id: string) => void;
  onNew?: () => void;
  onSetPinned?: (id: string, pinned: boolean) => void | Promise<unknown>;
  /** Caller must leave the active conversation before deleting it. */
  onDelete?: (id: string) => void | Promise<unknown>;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
}
export function HyperConversationsScreen(props: HyperConversationsScreenProps) {
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<HyperConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const rows = props.conversations.filter(row => `${row.name} ${HyperConversationTitle(row)}`.toLowerCase().includes(search.toLowerCase()));
  async function remove() {
    if (!deleting || !props.onDelete) return;
    setBusy(true); setActionError(null);
    try { await props.onDelete(deleting.id); setDeleting(null); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not delete conversation.'); }
    finally { setBusy(false); }
  }
  async function pin(row: HyperConversation) {
    setActionError(null);
    try { await props.onSetPinned?.(row.id, !row.pinned); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update pin.'); }
  }
  return <HyperPage title="Conversations" action={props.onNew && <Button onClick={props.onNew}>New conversation</Button>}>
    <HyperSearch value={search} onChange={setSearch} label="Search conversations" /><HyperStatus {...props} />
    {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    {!props.loading && !props.error && !rows.length && <p className="text-sm text-muted-foreground">{search ? 'No matching conversations.' : 'No conversations yet.'}</p>}
    {([true, false] as const).map(pinned => <div key={String(pinned)}>{rows.some(row => !!row.pinned === pinned) && <h2 className="text-xs font-medium text-muted-foreground">{pinned ? 'Pinned' : 'Recent'}</h2>}{rows.filter(row => !!row.pinned === pinned).map(row => <div key={row.id} className="flex items-center border-b border-border">
      <button type="button" className={rowClass} aria-current={props.selectedId === row.id ? 'page' : undefined} onClick={() => props.onOpen(row.id)}><span className="min-w-0"><span className="block truncate font-medium">{HyperConversationTitle(row) || 'New conversation'}</span><span className="block truncate text-xs text-muted-foreground">{row.name}</span></span>{!!row.unreadCount && <span aria-label={`${row.unreadCount} unread`}>{row.unreadCount}</span>}</button>
      {props.onSetPinned && <Button variant="ghost" disabled={props.pendingId === row.id} onClick={() => void pin(row)} aria-label={`${row.pinned ? 'Unpin' : 'Pin'} ${HyperConversationTitle(row)}`}>{row.pinned ? 'Unpin' : 'Pin'}</Button>}
      {props.onDelete && <Button variant="destructive" disabled={props.pendingId === row.id} onClick={() => { setActionError(null); setDeleting(row); }}>Delete…</Button>}
    </div>)}</div>)}
    {props.loadMoreError && <p role="alert" className="text-sm text-destructive">{props.loadMoreError}</p>}
    {props.hasMore && props.onLoadMore && <Button variant="outline" disabled={props.loadingMore} onClick={props.onLoadMore}>{props.loadingMore ? 'Loading older conversations…' : 'Load older conversations'}</Button>}
    <Dialog open={!!deleting} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Delete conversation?</DialogTitle><DialogDescription>{HyperConversationTitle(deleting ?? {}) || 'This conversation'} will be permanently deleted.</DialogDescription></DialogHeader>{actionError && <p role="alert" className="text-destructive text-sm">{actionError}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete'}</Button></DialogFooter></DialogContent></Dialog>
  </HyperPage>;
}

export interface HyperBotRosterScreenProps extends HyperScreenState {
  bots: readonly HyperBot[];
  hiddenBots?: readonly HyperBot[];
  onOpen: (id: string) => void;
  onNew?: () => void;
  personal?: boolean;
  needsYou?: ReactNode;
}
export function HyperBotRosterScreen(props: HyperBotRosterScreenProps) {
  const [showHidden, setShowHidden] = useState(false);
  const groups = HyperGroupRoster(props.bots);
  const sections: [string, readonly HyperBot[]][] = [['Pinned', groups.pinned], ['Yours', groups.yours], [props.personal ? 'Included with HyperTask' : 'Shared with you', groups.shared]];
  const renderBot = (bot: HyperBot) => <button type="button" key={bot.id} className={rowClass} onClick={() => props.onOpen(bot.id)}><span><span className="block font-medium">{bot.name}</span><span className="block text-muted-foreground">{[bot.paused ? 'Paused' : '', bot.title].filter(Boolean).join(' · ')}</span></span>{!!bot.waitingCount && <span aria-label={`${bot.waitingCount} waiting on you`} className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{bot.waitingCount}</span>}</button>;
  return <HyperPage title="Bots" action={props.onNew && <Button onClick={props.onNew}>New Bot</Button>}><HyperStatus {...props} />{props.needsYou}
    {sections.filter(([, bots]) => bots.length).map(([title, bots]) => <section key={title} aria-label={title}><h2 className="text-sm font-medium">{title}</h2>{bots.map(renderBot)}</section>)}
    {!props.loading && !props.error && !props.bots.length && <p className="text-sm text-muted-foreground">{props.hiddenBots?.length ? 'No Bots on your list. The Bots you hid are below.' : 'No Bots yet. Create a Bot for a specific job.'}</p>}
    {!!props.hiddenBots?.length && <section><Button variant="ghost" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Hide' : 'Show'} hidden Bots ({props.hiddenBots.length})</Button>{showHidden && props.hiddenBots.map(renderBot)}</section>}
  </HyperPage>;
}

export type HyperBotNotify = 'all' | 'needs_input' | 'none';
export interface HyperBotProfileScreenProps extends HyperScreenState {
  bot: HyperBot;
  paused: boolean;
  notify: HyperBotNotify;
  pending?: boolean;
  onSetPaused: (paused: boolean) => void;
  onSetNotify: (notify: HyperBotNotify) => void;
  onChat: () => void;
  needsYou?: ReactNode;
  activity?: ReactNode;
  settings?: ReactNode;
  manage?: ReactNode;
}
export function HyperBotProfileScreen(props: HyperBotProfileScreenProps) {
  return <HyperPage title={props.bot.name} action={<Button onClick={props.onChat}>Start conversation</Button>}><p className="text-sm text-muted-foreground">{props.bot.title}</p><p className="text-sm">{props.bot.roleDescription}</p><HyperStatus {...props} />{props.needsYou}
    <section className="grid gap-4" aria-label="For you"><h2 className="text-sm font-medium">For you</h2><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Active</p><p className="text-sm text-muted-foreground">{props.paused ? 'Paused. Nothing runs for you until you turn it back on.' : 'Works on its goals, routines, hand-offs and follow-ups for you.'}</p></div><Switch aria-label="Active" checked={!props.paused} disabled={props.pending || props.loading} onCheckedChange={active => props.onSetPaused(!active)} /></div>
    <label className="grid gap-2 text-sm">Notifications<select className="rounded-lg border border-border bg-background p-2" value={props.notify} disabled={props.pending || props.loading} onChange={event => props.onSetNotify(event.target.value as HyperBotNotify)}><option value="all">Everything</option><option value="needs_input">Only when it needs me</option><option value="none">Nothing (badges only)</option></select></label></section>{props.activity}{props.settings}{props.manage}
  </HyperPage>;
}

export interface HyperSkillsScreenProps extends HyperScreenState {
  skills: readonly HyperSkill[];
  /** Include hidden holder Bots so grant counts agree with the detail screen. */
  bots: readonly HyperBot[];
  onOpen: (slug: string) => void;
  onNew?: () => void;
}
export function HyperSkillsScreen(props: HyperSkillsScreenProps) {
  const [search, setSearch] = useState('');
  const skills = props.skills.filter(skill => `${skill.title} ${skill.summary ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <HyperPage title="Skills" action={props.onNew && <Button onClick={props.onNew}>New skill</Button>}><p className="text-sm text-muted-foreground">Write instructions a Bot follows when someone picks a skill from the / menu. A skill only uses what a Bot can already do, and you choose which Bots offer it.</p><HyperSearch value={search} onChange={setSearch} label="Search skills" /><HyperStatus {...props} />
    {!props.loading && !props.error && !skills.length && <p className="text-sm text-muted-foreground">{search ? 'No matching skills.' : 'No skills yet. Write one, then choose which Bots offer it.'}</p>}
    {skills.map(skill => { const held = new Set(props.bots.filter(bot => skill.grantedTo.includes(bot.id)).map(bot => bot.id)).size; return <button key={skill.slug} type="button" className={rowClass} onClick={() => props.onOpen(skill.slug)}><span><span className="block font-medium">{skill.title}</span><span className="block text-muted-foreground">{skill.summary}</span></span><span className="shrink-0 text-xs text-muted-foreground">{HyperGrantSummary(held, new Set(props.bots.map(bot => bot.id)).size)}</span></button>; })}
  </HyperPage>;
}

export interface HyperConnectionsScreenProps extends HyperScreenState {
  connections: readonly HyperConnection[];
  pendingKey?: string;
  onOpen: (key: string) => void;
  /** Connect/add may perform authorization. Setup always opens the detail screen. */
  onAction?: (key: string, action: 'connect' | 'add') => void;
  onAddServer?: () => void;
  notice?: string | null;
}
export function HyperConnectionsScreen(props: HyperConnectionsScreenProps) {
  const [search, setSearch] = useState('');
  const rows = HyperSortConnections(props.connections).filter(row => `${row.title} ${row.summary}`.toLowerCase().includes(search.toLowerCase()));
  return <HyperPage title="Connections" action={props.onAddServer && <Button variant="outline" onClick={props.onAddServer}>Add server</Button>}><HyperSearch value={search} onChange={setSearch} label="Search connections" /><HyperStatus {...props} />{props.notice && <p role="status" className="text-sm">{props.notice}</p>}
    {!props.loading && !props.error && !rows.length && <p className="text-sm text-muted-foreground">{search ? 'No matching connections.' : 'No connections available.'}</p>}
    {rows.map(row => <div className="flex items-center gap-2 border-b border-border" key={row.key}><button className={rowClass} type="button" onClick={() => props.onOpen(row.key)}><span><span className="block font-medium">{row.title}</span><span className="block text-muted-foreground">{row.summary}</span></span><span className={`shrink-0 text-xs ${row.state === 'needs_reconnect' ? 'text-warning' : 'text-muted-foreground'}`}>{row.state === 'needs_reconnect' ? 'Reconnect needed' : row.state === 'team' ? 'Team account' : row.state === 'connected' ? row.noAccount ? 'On' : 'Connected' : row.notConnected ? 'Not connected' : 'Available'}</span></button>
    {row.state === 'available' && row.action && <Button variant="outline" disabled={props.pendingKey === row.key} onClick={() => { if (row.action === 'setup' || !props.onAction) props.onOpen(row.key); else props.onAction(row.key, row.action!); }}>{props.pendingKey === row.key ? 'Connecting…' : row.action === 'setup' ? 'Set up' : row.action === 'add' ? 'Add' : 'Connect'}</Button>}</div>)}
  </HyperPage>;
}
