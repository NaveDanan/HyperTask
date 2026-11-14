// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// app/src/components/settings/{check-ins,github-sources}.tsx; app/src/lib/{proactive,responsibilities}.ts
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { hyperSettingsApi, type HyperGithubBinding, type HyperSettingsPreferences } from './HyperSettingsApi';

export function HyperSettingsAutomation({ preferences, onPreferences }: { preferences: HyperSettingsPreferences; onPreferences(value: HyperSettingsPreferences): void }) {
  const [allowed, setAllowed] = useState<boolean>();
  const [bindings, setBindings] = useState<HyperGithubBinding[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [repository, setRepository] = useState('');
  const [secret, setSecret] = useState('');
  const [formError, setFormError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => {
      void hyperSettingsApi.checkInsAllowed().then(value => { if (active) setAllowed(value); }).catch(() => { if (active) setError('Could not load check-in permissions.'); });
      void hyperSettingsApi.repositories().then(value => { if (active) setBindings(value); }).catch(() => { if (active) setError('Could not load repositories.'); });
    };
    setError(''); load();
    const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [attempt]);
  const close = () => { if (!busy) { setAdding(false); setSecret(''); setRepository(''); setFormError(''); } };
  return <div className="flex flex-col gap-4">
    <h2 className="text-sm font-medium">Routines</h2>
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
      <div><p className="text-sm font-medium">Check-ins from all your Bots</p><p className="text-sm text-muted-foreground">{allowed === undefined ? 'Loading check-in permissions…' : !allowed ? 'Turned off by your admin.' : preferences.proactive === 'on' ? 'On. Your Bots check what they can read and tell you when something needs you, at most once an hour.' : 'Off. None of your Bots check in for you.'}</p></div>
      <Switch aria-label="Check-ins for all your Bots" checked={allowed === true && preferences.proactive === 'on'} disabled={allowed !== true || busy} onCheckedChange={async checked => {
        setBusy(true); setError('');
        try { onPreferences(await hyperSettingsApi.savePreferences({ proactive: checked ? 'on' : 'off' })); }
        catch { setError('Could not save check-ins. Try again.'); } finally { setBusy(false); }
      }} />
    </div>
    <div className="flex items-center justify-between"><h2 className="text-sm font-medium">Repositories</h2><Button variant="outline" onClick={() => setAdding(true)}>Add a repository</Button></div>
    <p className="text-sm text-muted-foreground">Add a repository here, then add a webhook in GitHub with the path below on your OpenBot server and the same secret. Events such as issues.opened can start work on a goal.</p>
    {bindings === undefined ? <p role="status">Loading repositories…</p> : bindings.length === 0 ? <p className="text-sm text-muted-foreground">No repositories yet.</p> : <ul className="divide-y rounded-lg border bg-card">{bindings.map(binding => <li key={binding.id} className="flex items-center justify-between gap-4 p-4"><div><p className="text-sm font-medium">{binding.repository}</p><code className="break-all text-xs">{`/api/events/github/${encodeURIComponent(binding.id)}`}</code></div><Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await hyperSettingsApi.disconnectRepository(binding.id); setBindings(await hyperSettingsApi.repositories()); }
      catch { setError('Could not disconnect or refresh repositories. Try again.'); } finally { setBusy(false); }
    }}>Disconnect</Button></li>)}</ul>}
    {busy && <p role="status">Saving…</p>}{error && <div><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>}
    <Dialog open={adding} onOpenChange={open => { if (!open) close(); }}><DialogContent><DialogHeader><DialogTitle>Add a repository</DialogTitle><DialogDescription>Use the same secret when you add the webhook in GitHub.</DialogDescription></DialogHeader>
      <form className="flex flex-col gap-3" onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setFormError('');
        const submittedSecret = secret; setSecret(''); setError('');
        try {
          await hyperSettingsApi.connectRepository(repository, submittedSecret);
          setRepository(''); setAdding(false);
          try { setBindings(await hyperSettingsApi.repositories()); }
          catch { setError('Repository connected, but the list could not be refreshed. Try again.'); }
        }
        catch { setFormError('Could not connect GitHub events. Check the repository, retype the secret and try again.'); }
        finally { setBusy(false); }
      }}><label className="text-sm">Repository<Input required disabled={busy} value={repository} onChange={event => setRepository(event.target.value)} placeholder="owner/repository" /></label><label className="text-sm">Webhook secret<Input type="password" autoComplete="new-password" required disabled={busy} value={secret} onChange={event => setSecret(event.target.value)} /></label>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<Button disabled={busy || !repository.trim() || !secret} type="submit">{busy ? 'Connecting…' : 'Connect events'}</Button><Button variant="outline" disabled={busy} type="button" onClick={close}>Cancel</Button>
      </form></DialogContent></Dialog>
  </div>;
}
