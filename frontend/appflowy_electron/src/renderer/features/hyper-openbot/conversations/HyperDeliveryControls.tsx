import { hyperOpenBotRequest } from '../transport';
// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/components/delivery/reaching-you.tsx. See REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperReadDelivery, hyperStartChatLink, hyperStartSms, hyperConfirmSms, hyperRemoveBinding, hyperRemoveDevice, type Reachability, type ChatLink } from './HyperDeliveryApi';
export function HyperDeliveryControls({ channelId, bots, enabled }: { channelId: string; bots: { id: string; name: string }[]; enabled: boolean }) {
  const [data, setData] = useState<Reachability>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [agentId, setAgentId] = useState(bots[0]?.id ?? '');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const owner = useRef<string | undefined>(undefined);
  const [challenge, setChallenge] = useState('');
  const holdChallenge = (id: string) => { setChallenge(id); try { if (owner.current) { const key = `hyper-openbot.delivery.pendingSms.${encodeURIComponent(owner.current)}`; if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } } catch {} };
  useEffect(() => { if (!enabled) return; let current = true; void hyperOpenBotRequest<{ user: { id: string } }>('/api/me').then(value => { if (!current) return; owner.current = value.user.id; try { setChallenge(sessionStorage.getItem(`hyper-openbot.delivery.pendingSms.${encodeURIComponent(value.user.id)}`) ?? ''); } catch {} }).catch(() => {}); return () => { current = false; }; }, [enabled]);
  const [links, setLinks] = useState<Partial<Record<'slack' | 'teams', ChatLink & { expiresAt: number }>>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    async function read() { try { const next = await hyperReadDelivery(); if (current) { setData(next); setError(false); setNow(Date.now()); } } catch { if (current) setError(true); } }
    void read(); const timer = setInterval(() => void read(), 10_000);
    return () => { current = false; clearInterval(timer); };
  }, [enabled, revision]);
  async function act(action: () => Promise<unknown>) {
    setPending(true); setError(false);
    try { await action(); setRevision(value => value + 1); } catch { setError(true); } finally { setPending(false); }
  }
  return <details className="border-b p-3"><summary>Continue elsewhere</summary><div className="space-y-3 py-3">
    <p>Each account or phone works with one conversation at a time. Linking it here moves it from its previous conversation. In shared Slack or Teams channels, the Bot replies in a direct message.</p>
    {error && <p role="alert">Delivery request failed. <Button variant="ghost" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}
    {!data ? <p role="status">Loading destinations…</p> : <>
      <label>Bot <select aria-label="Delivery Bot" value={agentId} disabled={pending} onChange={event => { setAgentId(event.target.value); setLinks({}); }}>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <p>Connected destinations</p>
      {!data.bindings.some(binding => binding.enabled && binding.channelId === channelId) && <p>No destinations connected.</p>}
      {data.bindings.filter(binding => binding.enabled && binding.channelId === channelId).map(binding => <div key={binding.id} className="flex items-center gap-2"><span>{binding.transport} · {binding.address} · {bots.find(bot => bot.id === binding.agentId)?.name ?? 'Bot'}{binding.optedOutAt ? ' · You texted STOP. Text START to resume.' : ''}</span><Button disabled={!enabled || pending} variant="outline" onClick={() => void act(() => hyperRemoveBinding(binding.id))}>Disconnect</Button></div>)}
      {(['slack', 'teams'] as const).map(platform => <div key={platform} className="space-y-1"><Button type="button" disabled={!enabled || pending || !agentId || !data.available[platform]} onClick={() => void act(async () => { const result = await hyperStartChatLink({ channelId, agentId, platform }); setLinks(value => ({ ...value, [platform]: { ...result, expiresAt: Date.now() + result.expiresInMinutes * 60_000 } })); })}>Link {platform === 'teams' ? 'Microsoft Teams' : 'Slack'}</Button>{!data.available[platform] && <p>An admin must turn on Slack and Teams first.</p>}{links[platform] && links[platform]!.expiresAt > now && <div><p>Send this message to the OpenBot app in a direct message within {Math.ceil((links[platform]!.expiresAt - now) / 60_000)} minutes.</p><code>{links[platform]!.command}</code><Button variant="ghost" onClick={() => void act(() => navigator.clipboard.writeText(links[platform]!.command))}>Copy</Button></div>}</div>)}
      {!data.available.sms && <p>Text messages are not set up. An admin must turn them on first.</p>}
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void act(async () => { holdChallenge(await hyperStartSms({ channelId, agentId, phone })); setPhone(''); }); }}><Input aria-label="Phone number" type="tel" pattern="\+[1-9][0-9]{7,14}" required placeholder="+15551234567" value={phone} onChange={event => setPhone(event.target.value)} /><Button disabled={!enabled || pending || !agentId || !data.available.sms}>Send verification code</Button></form>
      {challenge && <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void act(async () => { await hyperConfirmSms(challenge, code); holdChallenge(''); setCode(''); }); }}><Input aria-label="Verification code" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} /><Button disabled={!enabled || pending}>Confirm phone</Button></form>}
      {!!data.devices.length && <><p>Push devices</p>{data.devices.map(device => <div key={device.id}>{device.platform} · {device.enabled ? 'Enabled' : 'Disabled'}<Button disabled={!enabled || pending} variant="outline" onClick={() => void act(() => hyperRemoveDevice(device.id))}>Remove device</Button></div>)}</>}
      {!!data.deliveries.length && <><p>Recent deliveries</p>{data.deliveries.map(delivery => <p key={delivery.id}>{delivery.transport} · {delivery.kind} · {delivery.state} · {delivery.createdAt}</p>)}</>}
    </>}
  </div></details>;
}
