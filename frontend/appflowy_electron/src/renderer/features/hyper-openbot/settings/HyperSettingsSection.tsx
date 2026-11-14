// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// app/src/routes/_authed/settings/index.tsx and components/settings/{profile,standing-instructions,message-list-preference,settings-sidebar}.tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HYPER_INSTRUCTIONS_LIMIT, hyperSettingsApi, type HyperSettingsUser, type HyperSettingsPreferences } from './HyperSettingsApi';
export const HYPER_SETTINGS_DESTINATIONS = [
  ['Notifications', 'approvals-inbox'], ['Vault and passwords', 'vault'], ['Connected accounts', 'vault'],
  ['Computer and browsers', 'computer-browser'], ['Approvals', 'approvals-inbox'], ['Memory and learning', 'memory'],
  ['Skills', 'skills'], ['Apps', 'connections'], ['Setup', 'onboarding'], ['Components gallery', 'screens'],
] as const;
export function HyperSettingsGeneral({ user, instructions, preferences, onUser, onInstructions, onPreferences }: {
  user: HyperSettingsUser; instructions: string; preferences: HyperSettingsPreferences;
  onUser(value: HyperSettingsUser): void; onInstructions(value: string): void; onPreferences(value: HyperSettingsPreferences): void;
}) {
  const [editor, setEditor] = useState<'name' | 'instructions' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const open = (kind: 'name' | 'instructions') => { setEditor(kind); setDraft(kind === 'name' ? user.needsName ? '' : user.name ?? '' : instructions); setError(''); setSaved(false); };
  const invalid = editor === 'name' ? !draft.trim() || draft.trim().length > 100 : draft.trim().length > HYPER_INSTRUCTIONS_LIMIT;
  async function save() {
    if (busy || invalid) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      if (editor === 'name') { onUser(await hyperSettingsApi.saveName(draft)); setEditor(null); }
      else { const stored = await hyperSettingsApi.saveInstructions(draft); onInstructions(stored); setDraft(stored); setSaved(true); }
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <h2 className="text-sm font-medium">About you</h2>
    <div className="divide-y rounded-lg border bg-card">
      <button className="flex w-full flex-col gap-1 p-4 text-left hover:bg-muted/50" onClick={() => open('name')}><span className="text-sm font-medium">Name</span><span className="text-sm text-muted-foreground">{user.needsName ? 'Not set yet.' : user.name || 'Not set yet.'}</span></button>
      <button className="flex w-full flex-col gap-1 p-4 text-left hover:bg-muted/50" onClick={() => open('instructions')}><span className="text-sm font-medium">Standing instructions</span><span className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{instructions || 'None yet. Tell every Bot how you want things done.'}</span></button>
    </div>
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <label className="text-sm font-medium" htmlFor="hyper-message-emphasis">Message list emphasis</label>
      <p className="text-sm text-muted-foreground">Choose which line stands out in the sidebar.</p>
      <select id="hyper-message-emphasis" className="rounded-md border bg-background p-2 text-sm" value={preferences.messageListEmphasis} disabled={busy} onChange={async event => {
        const messageListEmphasis = event.target.value as 'thread' | 'agent'; setBusy(true); setError('');
        try { onPreferences(await hyperSettingsApi.savePreferences({ messageListEmphasis })); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save preferences.'); } finally { setBusy(false); }
      }}><option value="thread">Conversation title</option><option value="agent">Bot name</option></select>
      <figure aria-label="Message list preview" className="rounded-lg border bg-muted p-3 text-sm"><p className={preferences.messageListEmphasis === 'agent' ? 'font-semibold' : 'text-muted-foreground'}>General Assistant</p><p className={preferences.messageListEmphasis === 'thread' ? 'font-semibold' : 'text-muted-foreground'}>Plan next week</p></figure>
    </div>
    {busy && <p role="status">Saving…</p>}{error && !editor && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">Appearance and keyboard shortcuts follow HyperTask's application settings.</p>
    <Dialog open={editor !== null} onOpenChange={value => { if (!value && !busy) setEditor(null); }}><DialogContent><DialogHeader><DialogTitle>{editor === 'name' ? 'Your name' : 'Standing instructions'}</DialogTitle><DialogDescription>{editor === 'name' ? 'Choose the name OpenBot shows for you.' : "Applies to every Bot in every conversation. A Bot's role says what it does. This says how you want it done, like your writing style."}</DialogDescription></DialogHeader>
      <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        {editor === 'name' ? <Input aria-label="Name" autoComplete="name" maxLength={100} required disabled={busy} value={draft} onChange={event => { setDraft(event.target.value); setError(''); }} /> : <><Textarea aria-label="Standing instructions" className="min-h-40" disabled={busy} value={draft} onChange={event => { setDraft(event.target.value); setSaved(false); }} /><p className="text-xs text-muted-foreground">{draft.trim().length} of {HYPER_INSTRUCTIONS_LIMIT} characters</p></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{saved && <p role="status">Saved</p>}
        <Button type="submit" disabled={busy || invalid || (editor === 'instructions' && draft === instructions)}>{busy ? 'Saving…' : editor === 'name' ? 'Save name' : 'Save'}</Button>
      </form>
    </DialogContent></Dialog>
  </div>;
}
export default function HyperSettingsSection({ context: _context }: { context: HyperOpenBotSectionContext }) {
  const [data, setData] = useState<{ user: HyperSettingsUser; instructions: string; preferences: HyperSettingsPreferences; edition: 'personal' | 'team' }>();
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; setError(''); setData(undefined);
    void Promise.all([hyperSettingsApi.user(), hyperSettingsApi.instructions(), hyperSettingsApi.preferences(), hyperSettingsApi.edition()]).then(([user, instructions, preferences, edition]) => { if (active) setData({ user, instructions, preferences, edition }); }).catch(problem => { if (active) setError(problem instanceof Error ? problem.message : 'Could not load settings.'); });
    return () => { active = false; };
  }, [attempt]);
  return <section className="mx-auto flex h-full w-full max-w-3xl flex-col gap-5 overflow-y-auto px-8 py-6"><h1 className="text-lg font-semibold tracking-tight">General settings</h1>
    {error ? <div><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : !data ? <p role="status">Loading settings…</p> : <HyperSettingsGeneral {...data} onUser={user => setData({ ...data, user })} onInstructions={instructions => setData({ ...data, instructions })} onPreferences={preferences => setData({ ...data, preferences })} />}
    <h2 className="text-sm font-medium">More settings</h2><p className="text-sm text-muted-foreground">Open these sections from the OpenBot navigation.</p><ul className="grid grid-cols-2 gap-2 text-sm">{HYPER_SETTINGS_DESTINATIONS.map(([label, id]) => <li key={label} data-section-id={id}>{label}</li>)}</ul>
  </section>;
}
