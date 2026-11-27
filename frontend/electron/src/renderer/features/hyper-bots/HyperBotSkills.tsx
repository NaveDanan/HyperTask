import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Wrench } from 'lucide-react';
import { HYPER_BOTS_TOOLS, type HyperBotsToolName } from '@shared/HyperBots';
import { HyperBotAssetUpdate, hyperBotUsesAsset, type HyperBotAsset, type HyperBotSkillLibrary } from '@shared/HyperBotSkills';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Save = (input: HyperBotAssetUpdate) => Promise<string | undefined>;

function HyperBotSkillEditor({ asset, bots, onSave, onBack }: {
  asset: HyperBotAsset; bots: HyperBotSkillLibrary['bots']; onSave: Save; onBack: () => void;
}) {
  const [draft, setDraft] = useState(asset);
  const [botsPicked, setBotsPicked] = useState(asset.scope.kind === 'dedicated' ? asset.scope.botIds : []);
  const [global, setGlobal] = useState(asset.scope.kind === 'global');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const label = asset.kind === 'skill' ? 'skill' : 'tool';
  const save = async (remove = false) => {
    if (busy) return;
    const { id, revision, scope: _scope, ...values } = draft;
    const scope = global ? { kind: 'global' as const } : { kind: 'dedicated' as const, botIds: botsPicked };
    const parsed = HyperBotAssetUpdate.safeParse(remove ? { id, revision, delete: true } : { id, revision, scope, draft: values });
    if (!parsed.success) { setError('Enter a name, description, and instructions.'); return; }
    setError('');
    setBusy(true);
    try {
      const problem = await onSave(parsed.data);
      if (problem) setError(problem);
      else onBack();
    } finally { setBusy(false); }
  };

  return <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={busy} className="-ms-2">
        <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />Skills
      </Button>
      <h3 className="min-w-0 break-words font-semibold">Edit {label}</h3>
    </div>
    <fieldset disabled={busy} className="grid min-w-0 gap-3 text-sm">
      <label className="grid gap-1.5">Name<Input autoFocus required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="grid gap-1.5">Description<Textarea required rows={2} maxLength={500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="grid gap-1.5">Instructions<Textarea required rows={8} maxLength={8000} className="font-mono leading-relaxed" value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></label>
      {draft.kind === 'tool' && <label className="grid gap-1.5">Connector tool
        <select className="min-w-0 rounded-md border border-input bg-background p-2" value={draft.connectorTool} onChange={event => setDraft({ ...draft, connectorTool: event.target.value as HyperBotsToolName })}>
          {Object.entries(HYPER_BOTS_TOOLS).map(([name, tool]) => <option key={name} value={name}>{tool.label}</option>)}
        </select>
      </label>}
      <label className="grid gap-1.5">Availability
        <select className="rounded-md border border-input bg-background p-2" value={global ? 'global' : 'dedicated'} onChange={event => setGlobal(event.target.value === 'global')}>
          <option value="global">Global</option>
          <option value="dedicated">Dedicated</option>
        </select>
      </label>
      {!global && <fieldset className="grid gap-1 rounded-lg border border-border p-3">
        <legend className="px-1 font-medium">Assigned bots</legend>
        {bots.map(bot => <label key={bot.id} className="flex min-h-7 items-center gap-2">
          <input type="checkbox" checked={botsPicked.includes(bot.id)} onChange={event => setBotsPicked(event.target.checked ? [...botsPicked, bot.id] : botsPicked.filter(id => id !== bot.id))} />
          <span className="break-words">{bot.name}</span>
        </label>)}
      </fieldset>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      {confirmDelete ? <>
        <Button type="button" size="sm" variant="destructive" onClick={() => void save(true)} disabled={busy}>Confirm delete</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep {label}</Button>
      </> : <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete {label}</Button>}
      <Button type="submit" size="sm" className="ms-auto" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </div>
  </form>;
}

function useHyperBotSkillLibrary() {
  const [library, setLibrary] = useState<HyperBotSkillLibrary>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    const api = window.hypertask?.hyperBots;
    const refresh = async () => {
      const id = ++request.current;
      try {
        if (!api?.skills) throw new Error('The Skills library is unavailable.');
        const result = await api.skills();
        if (id !== request.current) return;
        if (result.ok) { setLibrary(result.value); setError(''); }
        else setError(result.message);
      } catch (cause) {
        if (id === request.current) setError(cause instanceof Error ? cause.message : 'Could not load Skills.');
      }
    };
    void refresh();
    const off = api?.onEvent?.(event => { if (event.type === 'skills' || event.type === 'settings') void refresh(); });
    return () => { ++request.current; off?.(); };
  }, [retry]);

  return {
    library, error,
    retry: () => { setError(''); setRetry(value => value + 1); },
    replace: (next: HyperBotSkillLibrary) => { ++request.current; setLibrary(next); setError(''); },
  };
}

export function HyperBotDedicatedAssets({ botId }: { botId: string }) {
  const { library, error, retry } = useHyperBotSkillLibrary();
  if (error) return <div>
    <p className="panel-empty" role="alert">{error}</p>
    <Button type="button" variant="ghost" size="sm" onClick={retry}>Retry</Button>
  </div>;
  if (!library) return <p className="panel-empty" role="status">Loading skills and tools…</p>;
  const assets = library.assets.filter(asset => asset.scope.kind === 'dedicated' && asset.scope.botIds.includes(botId));
  if (!assets.length) return <p className="panel-empty">No dedicated skills or tools.</p>;
  return <ul className="grid gap-0.5">{assets.map(asset => {
    const Icon = asset.kind === 'tool' ? Wrench : BookOpen;
    return <li key={asset.id} className="panel-row" title={asset.description}>
      <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{asset.kind === 'tool' ? 'Tool' : 'Skill'} </span>
      <span className="min-w-0 break-words text-sm" dir="auto">{asset.name}</span>
    </li>;
  })}</ul>;
}

export function HyperBotSkills({ botId }: { botId?: string }) {
  const { library, error, retry, replace } = useHyperBotSkillLibrary();
  const [editing, setEditing] = useState<HyperBotAsset>();
  const save: Save = async input => {
    try {
      const result = await window.hypertask.hyperBots.saveSkill(input);
      if (!result.ok) return result.message;
      replace(result.value);
    } catch (cause) { return cause instanceof Error ? cause.message : 'Could not save the entry.'; }
  };

  if (library && editing) {
    return <HyperBotSkillEditor key={editing.id} asset={editing} bots={library.bots} onSave={save} onBack={() => setEditing(undefined)} />;
  }
  const visible = library?.assets.filter(asset => !botId || hyperBotUsesAsset(asset, botId)) ?? [];
  return <div className="grid w-full gap-4">
    <p className="text-sm text-muted-foreground">To add a skill or custom tool, send <code>/create-skill</code> or <code>/create-tool</code> in a bot chat.</p>
    {error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-destructive">{error}</p>
      <Button type="button" size="sm" variant="outline" onClick={retry}>Retry</Button></div>}
    {!library && !error && <p role="status" className="text-sm text-muted-foreground">Loading skills…</p>}
    {library && (['global', 'dedicated'] as const).map(kind => {
      const entries = visible.filter(asset => asset.scope.kind === kind);
      return <section key={kind} className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 py-2">
          <h3 className="text-sm font-medium">{kind === 'global' ? 'Global' : 'Dedicated'}</h3>
          <p className="text-xs text-muted-foreground">{kind === 'global' ? 'Available to every bot.' : 'Available to assigned bots.'}</p>
        </div>
        {entries.length ? <ul className="divide-y divide-border">{entries.map(asset => {
          const Icon = asset.kind === 'tool' ? Wrench : BookOpen;
          const { scope } = asset;
          const assigned = scope.kind === 'dedicated' && library.bots.filter(bot => scope.botIds.includes(bot.id)).map(bot => bot.name);
          return <li key={asset.id}>
            <button type="button" onClick={() => setEditing(asset)} className="flex w-full items-start gap-3 px-3 py-3 text-start hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="break-words text-sm font-medium">{asset.name}</span>
                <span className="line-clamp-2 break-words text-xs text-muted-foreground">{asset.description}</span>
                {assigned && <span className="break-words text-xs text-muted-foreground">{assigned.join(', ') || 'No bots assigned'}</span>}
              </span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
            </button>
          </li>;
        })}</ul> : <p className="px-3 py-3 text-sm text-muted-foreground">No {kind} skills or tools yet.</p>}
      </section>;
    })}
  </div>;
}
