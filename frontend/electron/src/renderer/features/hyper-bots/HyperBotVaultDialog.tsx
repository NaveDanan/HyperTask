import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HyperBotVaultEntry } from '@shared/HyperBots';
import { HyperBotModal, HyperBotModalHeader } from './HyperBotModal';

export function HyperBotVaultDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<HyperBotVaultEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<string>();
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const api = window.hypertask.hyperBots.vault;
  useEffect(() => {
    let alive = true;
    if (api) void api.list().then(result => {
      if (!alive) return;
      if (result.ok) setEntries(result.value);
      else setError(result.message);
    }).catch(() => { if (alive) setError('The password vault could not be opened.'); });
    return () => { alive = false; };
  }, [api, revision]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The vault action failed.'); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    void perform(async () => {
      const result = await api.add({ label: String(data.get('label') ?? ''), username: String(data.get('username') ?? ''), password: String(data.get('password') ?? '') });
      if (!result.ok) throw new Error(result.message);
      form.reset();
      setNotice('Password saved.');
      setRevision(value => value + 1);
    });
  }
  return <HyperBotModal onClose={onClose} className="create-modal settings-modal" label="Password vault">
    <HyperBotModalHeader label="Password vault" onClose={onClose} />
    <div className="create-modal__body !items-stretch text-sm">
      {entries && api && <>
        {entries.length > 0 ? <ul className="grid gap-2">{entries.map(entry => <li key={entry.id} className="panel-card flex flex-wrap items-center justify-between gap-2 p-2">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{entry.label}</p>{entry.username && <p className="break-words text-xs text-muted-foreground">{entry.username}</p>}</div>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void perform(async () => {
            const result = await api.copy({ id: entry.id });
            if (!result.ok) throw new Error(result.message);
            if (result.value) setNotice('Password copied.');
          })}>Copy password</Button>
          {confirm === entry.id ? <><Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(undefined)}>Keep</Button>
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void perform(async () => {
              const result = await api.remove({ id: entry.id });
              if (!result.ok) throw new Error(result.message);
              setConfirm(undefined);
              setRevision(value => value + 1);
            })}>Confirm removal</Button></> : <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(entry.id)}>Remove</Button>}
        </li>)}</ul> : <p className="text-muted-foreground">No passwords saved.</p>}
        <form className="grid gap-2 border-t border-border pt-3" onSubmit={save}>
          <label className="grid gap-1">Label<Input name="label" required maxLength={100} /></label>
          <label className="grid gap-1">Username<Input name="username" autoComplete="off" maxLength={200} /></label>
          <label className="grid gap-1">Password<Input name="password" type="password" autoComplete="new-password" required maxLength={4096} /></label>
          <Button type="submit" size="sm" className="justify-self-end" disabled={busy}>Save password</Button>
        </form>
      </>}
      {!api && <p role="alert">The password vault is unavailable.</p>}
      {api && !entries && !error && <p role="status">Opening vault…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="card__error">{error}</p>}
    </div>
  </HyperBotModal>;
}
