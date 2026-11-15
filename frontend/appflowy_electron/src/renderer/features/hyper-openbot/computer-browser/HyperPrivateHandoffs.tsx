// Adapted from OpenBot lib/computers/control.ts and components/passwords/sign-in-form.tsx.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperSignInForm } from '../vault';
import { hyperVaultApi, type SignInRequest } from '../vault/HyperVaultApi';
import { hyperOpenBotRequest } from '../transport';
import { hyperComputerPath, type HyperControl } from './HyperComputerApi';
import { useHyperComputerControl, type HyperComputerActionGuard, type HyperComputerAuthority } from './HyperComputerControl';
// Fail closed until the separately owned Vault form consumes the mutation guard. The marker is a source contract,
// not an authorization result; the authenticated computer scope still decides every action.
const HyperComputerSignInForm = HyperSignInForm as {
  (props: Parameters<typeof HyperSignInForm>[0] & { computerGuard: HyperComputerActionGuard }): ReturnType<typeof HyperSignInForm>;
  hyperComputerGuard?: 1;
};
export async function hyperSupplyComputerSecret(agentId: string, text: string) {
  try { await hyperOpenBotRequest(`${hyperComputerPath(agentId)}/human/secret`, 'POST', { text }); }
  catch { throw new Error('The value could not be entered. Retype it and try again.'); }
}
export function HyperPrivateHandoffs({ agentId, control: _control, authority: supplied, onOpenBrowser }: { agentId: string; control?: HyperControl; authority?: HyperComputerAuthority; onOpenBrowser(id: string): void }) {
  const authority = useHyperComputerControl(agentId, supplied);
  const control = authority.control;
  const owner = useRef({ agentId, live: true });
  if (owner.current.agentId !== agentId) { owner.current.live = false; owner.current = { agentId, live: true }; }
  const mounted = owner.current;
  const [requests, setRequests] = useState<SignInRequest[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.live = true; let timer: ReturnType<typeof setTimeout>; setRequests([]); setBusy(false); setError(''); async function poll() { try { const next = await hyperVaultApi.pending(); if (mounted.live) setRequests(next.filter(row => row.botId === agentId)); } catch { if (mounted.live) setError('Sign-in requests could not be loaded.'); } finally { if (mounted.live) timer = setTimeout(() => void poll(), 3000); } } void poll(); return () => { mounted.live = false; clearTimeout(timer); }; }, [agentId]);
  const permitted = authority.permits('private');
  return <div className="space-y-3">{error && <p role="alert">{error}</p>}{permitted && control?.secretWanted !== undefined && <form key={authority.key + control.secretWanted} autoComplete="off" className="space-y-2 rounded-lg border p-3" onSubmit={event => {
    event.preventDefault(); const form = event.currentTarget;
    if (busy || !authority.permits('private')) { form.reset(); return; }
    const text = String(new FormData(form).get('secret') || ''); form.reset(); if (!text) return;
    setBusy(true); setError('');
    void authority.run('private', async valid => { if (valid()) await hyperSupplyComputerSecret(agentId, text); })
      .catch(() => { if (mounted.live && owner.current === mounted) setError('The value could not be entered. Retype it and try again.'); })
      .finally(() => { if (mounted.live && owner.current === mounted) setBusy(false); });
  }}><label>{control.secretWanted}<Input name="secret" type="password" autoComplete="off" required disabled={busy} /></label><p className="text-xs text-muted-foreground">Sent directly to the page. The Bot does not receive this value.</p><Button type="submit" disabled={busy}>Enter privately</Button></form>}{permitted && requests.map(row => HyperComputerSignInForm.hyperComputerGuard === 1
    ? <HyperComputerSignInForm key={authority.key + row.id} requestId={row.id} computerGuard={{ current: () => authority.permits('private'), run: work => authority.run('private', work) }} onOpenBrowser={id => { if (id === agentId && authority.permits('private')) onOpenBrowser(id); }} />
    : <p key={row.id} role="status">Sign-in controls are unavailable. Try again later.</p>)}</div>;
}
