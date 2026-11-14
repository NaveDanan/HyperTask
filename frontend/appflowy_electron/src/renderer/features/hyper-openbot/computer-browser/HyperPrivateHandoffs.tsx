// Adapted from OpenBot lib/computers/control.ts and components/passwords/sign-in-form.tsx.
// Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperSignInForm } from '../vault';
import { hyperVaultApi, type SignInRequest } from '../vault/HyperVaultApi';
import { hyperOpenBotRequest } from '../transport';
import { hyperComputerPath, type HyperControl } from './HyperComputerApi';
export async function hyperSupplyComputerSecret(agentId: string, text: string) {
  try { await hyperOpenBotRequest(`${hyperComputerPath(agentId)}/human/secret`, 'POST', { text }); }
  catch { throw new Error('The value could not be entered. Retype it and try again.'); }
}
export function HyperPrivateHandoffs({ agentId, control, onOpenBrowser }: { agentId: string; control?: HyperControl; onOpenBrowser(id: string): void }) {
  const [requests, setRequests] = useState<SignInRequest[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>; setRequests([]); async function poll() { try { const next = await hyperVaultApi.pending(); if (active) setRequests(next.filter(row => row.botId === agentId)); } catch { if (active) setError('Sign-in requests could not be loaded.'); } finally { if (active) timer = setTimeout(() => void poll(), 3000); } } void poll(); return () => { active = false; clearTimeout(timer); }; }, [agentId]);
  return <div className="space-y-3">{error && <p role="alert">{error}</p>}{control?.secretWanted !== undefined && <form autoComplete="off" className="space-y-2 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); if (busy) return; const form = event.currentTarget; const text = String(new FormData(form).get('secret') || ''); form.reset(); if (!text) return; setBusy(true); setError(''); void hyperSupplyComputerSecret(agentId, text).catch(() => setError('The value could not be entered. Retype it and try again.')).finally(() => setBusy(false)); }}><label>{control.secretWanted}<Input key={agentId + control.secretWanted} name="secret" type="password" autoComplete="off" required disabled={busy} /></label><p className="text-xs text-muted-foreground">Sent directly to the page. The Bot does not receive this value.</p><Button disabled={busy}>Enter privately</Button></form>}{requests.map(row => <HyperSignInForm key={row.id} requestId={row.id} onOpenBrowser={onOpenBrowser} />)}</div>;
}
