import { useEffect, useState } from 'react';
import { Brain, Heart, Lightbulb, Plus } from 'lucide-react';
import {
  HYPER_BOT_MEMORY_CATEGORIES, HYPER_BOT_PREFERENCE_LENGTH, HYPER_BOT_SOUL_FIELDS, HyperBotPreferenceDraft,
  type HyperBotPersonalizationUpdate, type HyperBotPersonalizationView, type HyperBotPreference, type HyperBotPreferenceSuggestion,
} from '@shared/HyperBotPersonalization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const categories = { general: 'General', tasks: 'Tasks', calendar: 'Calendar', email: 'Email' };
const fields = { tone: 'Tone', detail: 'Level of detail', format: 'Response format', language: 'Language' };
const examples = { tone: 'Warm and direct', detail: 'Lead with a short answer', format: 'Use checklists for next steps', language: 'Reply in Hebrew' };
const preferenceLabel = (draft: HyperBotPreferenceDraft) => draft.kind === 'soul' ? fields[draft.field] : draft.topic;
const selectClass = 'w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm';

type Editing = { revision: number; draft: HyperBotPreferenceDraft; entry?: HyperBotPreference; suggestion?: HyperBotPreferenceSuggestion };
type Save = (change: HyperBotPersonalizationUpdate['change'], revision?: number) => Promise<boolean>;

function HyperBotPreferenceEditor({ editing, busy, save, close }: { editing: Editing; busy: boolean; save: Save; close: () => void }) {
  const [draft, setDraft] = useState(editing.draft);
  const parsed = HyperBotPreferenceDraft.safeParse(draft);
  return <form className="w-full rounded-lg border border-border bg-card p-3" onSubmit={async event => {
    event.preventDefault();
    if (!parsed.success || busy) return;
    const value = parsed.data;
    const result = await save(editing.suggestion
      ? { type: 'accept', id: editing.suggestion.id, draft: value }
      : { type: 'save', id: editing.entry?.id, draft: value }, editing.revision);
    if (result) close();
  }}>
    <fieldset className="grid min-w-0 gap-3 text-sm" disabled={busy}>
      <legend className="mb-2 font-semibold">{draft.kind === 'soul' ? fields[draft.field] : editing.entry ? 'Edit memory' : 'Save a memory'}</legend>
      {editing.suggestion && <blockquote dir="auto" className="break-words border-s-2 border-border ps-2 text-muted-foreground">{editing.suggestion.source.quote}</blockquote>}
      {draft.kind === 'memory' && <>
        <label className="grid gap-1">Category
          <select className={selectClass} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as typeof draft.category })}>
            {HYPER_BOT_MEMORY_CATEGORIES.map(category => <option key={category} value={category}>{categories[category]}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Topic
          <Input autoFocus dir="auto" required maxLength={60} value={draft.topic} placeholder="Task descriptions" onChange={event => setDraft({ ...draft, topic: event.target.value })} />
        </label>
      </>}
      <label className="grid gap-1">Preference
        <Textarea autoFocus={draft.kind === 'soul'} dir="auto" required rows={3} maxLength={HYPER_BOT_PREFERENCE_LENGTH} value={draft.value}
          placeholder={draft.kind === 'soul' ? examples[draft.field] : 'Include acceptance criteria in task descriptions'}
          onChange={event => setDraft({ ...draft, value: event.target.value })} />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!parsed.success || busy}>{busy ? 'Saving…' : 'Save preference'}</Button>
      </div>
    </fieldset>
  </form>;
}

const sections = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'soul', label: 'Soul', icon: Heart },
  { id: 'review', label: 'Review', icon: Lightbulb },
] as const;

export function HyperBotPersonalization({ botId }: { botId: string }) {
  const [profile, setProfile] = useState<HyperBotPersonalizationView>();
  const [section, setSection] = useState<(typeof sections)[number]['id']>('memory');
  const [editing, setEditing] = useState<Editing>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const api = typeof window === 'undefined' ? undefined : window.hypertask?.hyperBots;
  useEffect(() => {
    let request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        if (!api?.personalization) throw new Error('Personalization is unavailable.');
        const result = await api.personalization({ botId });
        if (id !== request) return;
        if (result.ok) setProfile(current => !current || result.value.revision >= current.revision ? result.value : current);
        else setError(result.message);
      } catch {
        if (id === request) setError('Could not load personalization.');
      }
    };
    void refresh();
    const off = api?.onEvent?.(event => { if (event.type === 'personalization' && event.botId === botId) void refresh(); });
    return () => { request++; off?.(); };
  }, [api, botId, retry]);

  const save: Save = async (change, revision = profile?.revision) => {
    if (!api || !profile || busy) return false;
    setBusy(true);
    setError('');
    try {
      const result = await api.savePersonalization({ botId, revision: revision ?? profile.revision, change });
      if (!result.ok) {
        setError(result.message);
        setRetry(value => value + 1);
        return false;
      }
      setProfile(current => !current || result.value.revision > current.revision ? result.value : current);
      return true;
    } catch {
      setError('Could not save personalization.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const entryActions = (entry: HyperBotPreference) => <div className="flex shrink-0 flex-wrap items-center gap-1">
    {removing === entry.id ? <>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(undefined)}>Keep</Button>
      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={async () => {
        if (await save({ type: 'remove', id: entry.id })) setRemoving(undefined);
      }}>Confirm forget</Button>
    </> : <>
      <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Edit ${preferenceLabel(entry.draft)}`}
        onClick={() => profile && setEditing({ revision: profile.revision, draft: entry.draft, entry })}>Edit</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Forget ${preferenceLabel(entry.draft)}`}
        onClick={() => setRemoving(entry.id)}>Forget</Button>
    </>}
  </div>;
  const sourceLabel = (entry: HyperBotPreference) => entry.source
    ? `From chat · ${new Date(entry.source.at).toLocaleDateString()}` : 'Added in settings';

  return <div className="grid w-full min-w-0 gap-4">
    {error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-destructive">{error}</p>
      {!profile && <Button type="button" size="sm" variant="outline" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</Button>}
    </div>}
    {!profile && !error && <p role="status" className="text-sm text-muted-foreground">Loading personalization…</p>}
    {profile && <>
      <div className="grid gap-2 rounded-lg border border-border bg-muted/35 p-3">
        <label className="grid gap-1.5 text-sm font-medium">Personalization
          <select className={selectClass} value={profile.mode} disabled={busy || !!editing} aria-describedby="hyper-bot-personalization-scope"
            onChange={event => void save({ type: 'mode', mode: event.target.value as HyperBotPersonalizationView['mode'] })}>
            <option value="off">Off</option>
            <option value="manual">Use saved preferences</option>
            <option value="learn">Use and suggest updates</option>
          </select>
        </label>
        <p id="hyper-bot-personalization-scope" className="text-xs leading-relaxed text-muted-foreground">
          This bot uses these preferences in direct conversations across your workspaces. With suggestions on, eligible messages can trigger an extra request to your model endpoint.
        </p>
      </div>
      <div role="group" aria-label="Personalization section" className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
        {sections.map(({ id, label, icon: Icon }) => <Button key={id} type="button" size="sm" aria-pressed={section === id}
          variant={section === id ? 'secondary' : 'ghost'} className="min-w-0 px-1.5" disabled={busy}
          onClick={() => { setSection(id); setEditing(undefined); setRemoving(undefined); }}>
          <Icon aria-hidden="true" />{label}{id === 'review' && profile.suggestions.length > 0 && ` (${profile.suggestions.length})`}
        </Button>)}
      </div>
      {editing ? <HyperBotPreferenceEditor editing={editing} busy={busy} save={save} close={() => setEditing(undefined)} />
        : section === 'memory' ? <section className="grid min-w-0 gap-2" aria-label="Memory">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Recurring preferences and ways you work.</p>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing({ revision: profile.revision, draft: { kind: 'memory', category: 'general', topic: '', value: '' } })}>
              <Plus aria-hidden="true" />Add memory
            </Button>
          </div>
          {profile.entries.every(entry => entry.draft.kind !== 'memory') && <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">No saved memories.</p>}
          {profile.entries.map(entry => entry.draft.kind === 'memory' && <article key={entry.id} className="grid min-w-0 gap-1 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2"><h3 dir="auto" className="min-w-0 break-words text-sm font-medium">{entry.draft.topic}</h3>{entryActions(entry)}</div>
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{entry.draft.value}</p>
            <p className="text-xs text-muted-foreground">{categories[entry.draft.category]} · {sourceLabel(entry)}</p>
          </article>)}
        </section> : section === 'soul' ? <section className="grid min-w-0 gap-2" aria-label="Soul">
          <p className="text-xs text-muted-foreground">How this bot speaks and writes for you.</p>
          {HYPER_BOT_SOUL_FIELDS.map(field => {
            const entry = profile.entries.find(item => item.draft.kind === 'soul' && item.draft.field === field);
            return <article key={field} className="grid min-w-0 gap-1 rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <h3 className="text-sm font-medium">{fields[field]}</h3>
                {entry ? entryActions(entry) : <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Set ${fields[field]}`}
                  onClick={() => setEditing({ revision: profile.revision, draft: { kind: 'soul', field, value: '' } })}>Set</Button>}
              </div>
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry?.draft.value ?? 'Use bot default'}</p>
              {entry && <p className="text-xs text-muted-foreground">{sourceLabel(entry)}</p>}
            </article>;
          })}
        </section> : <section className="grid min-w-0 gap-2" aria-label="Review suggestions">
          <p className="text-xs text-muted-foreground">Review the message behind each suggestion. Saving a suggestion replaces the preference for that topic or Soul setting.</p>
          {!profile.suggestions.length && <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">No suggestions to review.</p>}
          {profile.suggestions.map(suggestion => <article key={suggestion.id} className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3">
            <h3 dir="auto" className="break-words text-sm font-medium">{preferenceLabel(suggestion.draft)}</h3>
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{suggestion.draft.value}</p>
            <blockquote dir="auto" className="break-words border-s-2 border-border ps-2 text-xs text-muted-foreground">{suggestion.source.quote}</blockquote>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{suggestion.source.signal === 'stated' ? 'Stated' : 'Inferred'} · {new Date(suggestion.source.at).toLocaleDateString()}</span>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: 'dismiss', id: suggestion.id })}>Dismiss</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ revision: profile.revision, draft: suggestion.draft, suggestion })}>Review and save</Button>
              </div>
            </div>
          </article>)}
        </section>}
      {(profile.entries.length > 0 || profile.suggestions.length > 0 || profile.mode !== 'off') && !editing &&
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          {confirmClear ? <>
            <p className="w-full text-xs text-muted-foreground">This clears saved preferences and suggestions for this bot and switches personalization off. Past chats remain in your history.</p>
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={async () => {
              if (await save({ type: 'clear' })) setConfirmClear(false);
            }}>Confirm clear</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</Button>
          </> : <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmClear(true)}>Clear personalization</Button>}
        </div>}
    </>}
  </div>;
}
