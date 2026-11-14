// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hyperOpenBotRequest } from '../transport';
import { HyperAgentPath, HyperLifecyclePath, HyperListBots, HyperSaveBot, type HyperBotProfile, type HyperBotInput } from './HyperBotsApi';

import { HyperBotLifecycleStore } from './HyperBotLifecycle';

const HyperEmptyInput: HyperBotInput = { name: '', title: '', roleDescription: '', visibility: 'private' };
export function HyperBotsPanel({ onChat }: { onChat: (botId: string) => void }) {
  const [bots, setBots] = useState<HyperBotProfile[]>([]);
  const [hidden, setHidden] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<HyperBotProfile | 'new' | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const selectionVersion = useRef(0);
  const selection = selectionVersion.current;
  const select = (value: HyperBotProfile | 'new' | null) => { selectionVersion.current++; setSelected(value); };
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    void Promise.all([HyperListBots(hidden), hyperOpenBotRequest<{ capabilities: { builtInAvailable: boolean } }>('/api/agents/capabilities')])
      .then(([rows, result]) => { if (live) { setBots(rows); setAvailable(result.capabilities.builtInAvailable); } })
      .catch(e => { if (live) setError(String(e.message ?? e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [hidden, revision]);
  const refresh = () => setRevision(value => value + 1);
  return <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6">
    <header className="flex flex-wrap items-center gap-3"><Bot className="size-5" /><h1 className="text-lg font-semibold">Bots</h1>
      <Button className="ml-auto" variant="outline" disabled={loading} onClick={refresh}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>
      <Button disabled={loading || !available} onClick={() => select('new')}><Plus />New Bot</Button></header>
    {!loading && !available && <p className="text-sm text-muted-foreground">Native bot creation is unavailable on this deployment.</p>}
    <div className="flex items-center gap-3"><Input aria-label="Search Bots" placeholder="Search Bots" value={search} onChange={e => setSearch(e.target.value)} />
      <label className="flex shrink-0 items-center gap-2 text-sm"><input type="checkbox" checked={hidden} onChange={e => { setHidden(e.target.checked); select(null); }} />Hidden Bots</label></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading Bots…</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-2">{!loading && !error && bots.filter(bot => `${bot.name} ${bot.title}`.toLowerCase().includes(search.toLowerCase())).map(bot => <article key={bot.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0 flex-1"><Button variant="link" className="max-w-full truncate px-0" onClick={() => select(bot)}>{bot.name}</Button><p className="text-xs text-muted-foreground">{bot.title || bot.roleDescription}</p>
          <p className="mt-1 text-xs text-muted-foreground">{bot.mine ? 'Yours' : 'Shared'} · {bot.visibility}{bot.pinned ? ' · Pinned' : ''}{bot.assignedToMe ? ' · Assigned' : ''}</p></div>
        <Button variant="outline" onClick={() => onChat(bot.id)}>Chat</Button></article>)}
        {!loading && !error && bots.length === 0 && <p className="text-sm text-muted-foreground">{hidden ? 'No hidden Bots.' : 'No Bots yet. Create a Bot to get started.'}</p>}</div>
      {selected && <HyperBotEditor key={selected === 'new' ? 'new' : selected.id} bot={selected === 'new' ? undefined : selected} onClose={() => select(null)} onSaved={bot => { if (selection === selectionVersion.current) setSelected(bot); refresh(); }} onRemoved={() => { if (selection === selectionVersion.current) select(null); refresh(); }} />}
    </div>
  </section>;
}

function HyperBotEditor({ bot, onSaved, onRemoved, onClose }: { bot?: HyperBotProfile; onSaved: (bot: HyperBotProfile) => void; onRemoved: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<HyperBotInput>(bot ? { name: bot.name, title: bot.title, roleDescription: bot.roleDescription, visibility: bot.visibility, ...(bot.instructions === undefined ? {} : { instructions: bot.instructions }) } : HyperEmptyInput);
  const [lifecycleStore] = useState(() => new HyperBotLifecycleStore());
  const lifecycleState = useSyncExternalStore(lifecycleStore.subscribe, lifecycleStore.getSnapshot);
  const lifecycleMatches = lifecycleState.botId === bot?.id;
  const lifecyclePending = Boolean(bot) && (!lifecycleMatches || lifecycleState.pending);
  const lifecycle = lifecycleMatches ? lifecycleState.data : undefined;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resetPlan, setResetPlan] = useState<Record<string, number>>();
  const editable = !bot || bot.canManage;
  useEffect(() => {
    if (!bot) return;
    void lifecycleStore.load(bot.id);
    return lifecycleStore.cancel;
  }, [bot?.id, lifecycleStore]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const change = (field: keyof HyperBotInput, value: string) => setDraft(old => ({ ...old, [field]: value }));
  return <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4" aria-label={bot ? `${bot.name} profile` : 'Create Bot'}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{bot ? 'Bot profile' : 'Create Bot'}</h2><Button variant="ghost" disabled={busy} onClick={onClose}>Close</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!editable && <p className="text-sm text-muted-foreground">This Bot is shared with you. Its owner manages the profile.</p>}
    <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void run(async () => { const saved = await HyperSaveBot(draft, bot); onSaved(saved); setNotice('Profile saved.'); }); }}>
      <fieldset disabled={busy || !editable} className="flex min-w-0 flex-col gap-4">
        <label className="grid gap-2 text-sm">Name<Input required maxLength={80} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
        <label className="grid gap-2 text-sm">Title<Input maxLength={120} value={draft.title} onChange={e => change('title', e.target.value)} /></label>
        <label className="grid gap-2 text-sm">Role description<Textarea required maxLength={1000} rows={5} value={draft.roleDescription} onChange={e => change('roleDescription', e.target.value)} /></label>
        {draft.instructions !== undefined && <label className="grid gap-2 text-sm">Instructions<Textarea required maxLength={1000} rows={5} value={draft.instructions} onChange={e => change('instructions', e.target.value)} /></label>}
        {!bot?.systemOwned && <label className="grid gap-2 text-sm">Visibility<Select value={draft.visibility} disabled={busy || !editable} onValueChange={value => { if (value) change('visibility', value); }}><SelectTrigger aria-label="Visibility"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="public">Public · shared with the organization</SelectItem></SelectContent></Select></label>}
        {editable && <Button type="submit">{busy ? 'Saving…' : bot ? 'Save profile' : 'Create Bot'}</Button>}
      </fieldset>
    </form>
    {bot && <fieldset disabled={busy || lifecyclePending} className="flex flex-col gap-3 border-t border-border pt-4"><legend className="text-sm font-medium">Your settings for this Bot</legend>
      {lifecycle ? <><p className="text-xs text-muted-foreground">Pause stops work done in your name. Other people's work continues.</p>
        <Button variant="outline" onClick={() => void lifecycleStore.change(bot.id, lifecycle.paused ? 'resume' : 'pause')}>{lifecycle.paused ? 'Resume' : 'Pause'} for me</Button>
        <label className="grid gap-2 text-sm">Notifications<Select value={lifecycle.notify} disabled={busy || lifecyclePending} onValueChange={notify => { if (notify) void lifecycleStore.change(bot.id, 'notifications', { notify }); }}><SelectTrigger aria-label="Notifications"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Everything</SelectItem><SelectItem value="needs_input">Only when it needs me</SelectItem><SelectItem value="none">Nothing, badges only</SelectItem></SelectContent></Select></label></> : lifecyclePending ? <p role="status" className="text-sm text-muted-foreground">Loading lifecycle settings…</p> : <div className="grid gap-2">
        {lifecycleMatches && lifecycleState.error && <p role="alert" className="text-sm text-destructive">{lifecycleState.error}</p>}
        <Button variant="outline" onClick={() => void lifecycleStore.load(bot.id)}>Retry lifecycle settings</Button>
      </div>}
      {!bot.assignedToMe && <div className="flex flex-wrap gap-2">{[bot.pinned ? 'unpin' : 'pin', bot.hidden ? 'unhide' : 'hide'].map(action => <Button key={action} variant="outline" onClick={() => void run(async () => { await hyperOpenBotRequest(`${HyperAgentPath(bot.id)}/${action}`, 'POST'); onRemoved(); })}>{action === 'unpin' ? 'Unpin' : action === 'pin' ? 'Pin' : action === 'hide' ? 'Hide from my list' : 'Restore to my list'}</Button>)}</div>}
      <Button variant="outline" onClick={() => void run(async () => {
        const result = await hyperOpenBotRequest<{ plan: Record<string, number> }>(`${HyperLifecyclePath(bot.id)}/reset`);
        setResetPlan(result.plan);
      })}>Review reset…</Button>
      {resetPlan && <div className="grid gap-2 rounded-lg border border-border p-3">
        <p className="text-sm">Reset deletes this Bot's data with you. This cannot be undone. Other people's data and memories you told a Bot yourself are kept.</p>
        <ul className="list-disc pl-5 text-sm">{Object.entries(HyperResetLabels).filter(([key]) => (resetPlan[key] ?? 0) > 0).map(([key, label]) => <li key={key}>{resetPlan[key]} {label}</li>)}</ul>
        <p className="text-xs text-muted-foreground">{resetPlan.sharedConversationsKept ?? 0} shared conversations will be kept.</p>
        <Button variant="destructive" disabled={!Object.keys(HyperResetLabels).some(key => (resetPlan[key] ?? 0) > 0)} onClick={() => void run(async () => {
          await hyperOpenBotRequest(`${HyperLifecyclePath(bot.id)}/reset`, 'POST', { confirm: true });
          setResetPlan(undefined); setNotice('Reset complete.');
        })}>Delete my data and reset</Button>
        <Button variant="outline" onClick={() => setResetPlan(undefined)}>Cancel reset</Button>
      </div>}
      {bot.canManage && <>{confirmDelete ? <div className="grid gap-2"><p className="text-sm">Delete {bot.name} for everyone? This cannot be undone. Existing conversations stay readable.</p><Button variant="destructive" onClick={() => void run(async () => { await hyperOpenBotRequest(HyperAgentPath(bot.id), 'DELETE'); onRemoved(); })}>Delete permanently</Button><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button></div> : <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Delete Bot…</Button>}</>}
    </fieldset>}
  </div>;
}

const HyperResetLabels: Record<string, string> = { conversations: 'conversations', memorySources: 'memory sources', memories: 'imported memories', routines: 'routines', responsibilities: 'goals', followUps: 'scheduled follow-ups', formedMemories: 'formed memories', backgroundResearch: 'background research items', standingApprovals: 'standing permissions' };
