// Adapted from OpenBot components/passwords/sign-in-form.tsx.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperVaultApi, type SignInRequest } from './HyperVaultApi';
const FINAL = ['signed_in', 'failed', 'cancelled', 'expired'];
export interface HyperSignInFormProps {
  requestId: string;
  /** Lead integration supplies the native computer-browser navigation. No remote URL is opened here. */
  onOpenBrowser?: (botId: string) => void;
}
export function HyperSignInForm({ requestId, onOpenBrowser }: HyperSignInFormProps) {
  const [data, setData] = useState<SignInRequest>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try { const value = await hyperVaultApi.readSignIn(requestId); if (!live) return; setData(value); setError(''); if (!FINAL.includes(value.status)) timer = setTimeout(read, 3000); }
      catch { if (live) { setError('Could not load this sign-in request. Access may be refused.'); timer = setTimeout(read, 3000); } }
    }
    void read(); return () => { live = false; clearTimeout(timer); };
  }, [requestId]);
  async function answer(action: Parameters<typeof hyperVaultApi.answerSignIn>[1], body?: unknown) {
    if (busy) return; setBusy(true); setError('');
    try { setData(await hyperVaultApi.answerSignIn(requestId, action, body)); }
    catch { setError('Sign-in operation failed. Retype any secret and try again.'); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border border-border p-4 text-sm">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!data ? <p>Loading sign-in request…</p> : FINAL.includes(data.status) ? <><h3>{data.status === 'signed_in' ? 'Signed in' : 'Closed'}</h3><p>{data.outcome ?? 'This sign-in has ended.'}</p></> : <>
    <h3 className="font-medium">{data.origin}</h3>{data.reason && <p>{data.reason}</p>}{data.outcome && <p>{data.outcome}</p>}
    {data.status === 'taken_over' ? <><p>Sign in by hand in the Bot's browser, then choose I've signed in.</p>{onOpenBrowser && <Button variant="outline" onClick={() => onOpenBrowser(data.botId)}>Open the Bot's browser</Button>}<Button disabled={busy} onClick={() => void answer('finish')}>I've signed in</Button></> : <>
      {data.status !== 'code_required' && data.savedLogins.map(login => <div key={login.id}>{login.username}<Button disabled={busy} onClick={() => void answer('use-saved', {loginId: login.id})}>Confirm and sign in</Button></div>)}
      <form key={data.status === 'code_required' ? 'code' : 'login'} autoComplete="off" className="space-y-3" onSubmit={event => {
        event.preventDefault(); if (busy) return;
        const form = event.currentTarget;
        const values = new FormData(form); form.reset();
        if (data.status === 'code_required') { const code = String(values.get('code') ?? '').trim(); if (code) void answer('code', {code}); }
        else { const password = String(values.get('password') ?? ''); if (password) void answer('submit', {...(values.get('username') ? {username: String(values.get('username'))} : {}), password, save: values.get('save') === 'on'}); }
      }}>
      {data.status === 'code_required' ? <label className="block">Verification code<Input required name="code" autoComplete="one-time-code" inputMode="numeric" /></label> : <><p>This goes straight into the Bot's browser. The Bot only learns whether it worked.</p><label className="block">Username or email<Input name="username" autoComplete="username" /></label><label className="block">Password<Input name="password" required type="password" autoComplete="current-password" /></label>{data.passwordManager && <label><input name="save" type="checkbox" /> Save to Vault</label>}</>}
      <Button disabled={busy} type="submit">{busy ? 'Checking…' : data.status === 'code_required' ? 'Finish signing in' : 'Sign in'}</Button></form>
      <Button variant="outline" disabled={busy} onClick={() => void answer('take-over')}>Take over to sign in</Button>
    </>}<Button variant="ghost" disabled={busy} onClick={() => void answer('cancel')}>{data.status === 'pending' ? 'Decline' : 'Cancel'}</Button>
    </>}
  </section>;
}
