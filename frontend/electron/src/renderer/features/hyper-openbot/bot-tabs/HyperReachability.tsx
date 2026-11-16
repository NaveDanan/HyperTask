// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { HyperReachabilityApi } from './HyperBotWorkflowApi';
import { HyperListBots } from '../bots/HyperBotsApi';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
interface HyperDestination { id: string; transport: string; agentId: string; address: string; enabled: boolean; optedOutAt?: string }
interface HyperDelivery { bindings: HyperDestination[]; devices: { id: string; platform: string; enabled: boolean }[]; deliveries: { id: string; transport: string; state: string; kind: string; createdAt: string }[]; available: Record<string, boolean> }
interface HyperConversation { active: boolean; id: string; name: string; summary?: string; agentIds: string[] }
interface HyperSmsScope { key: string; active: boolean; generation: number }
export function HyperReachability({ agentId }: { agentId?: string }) {
  const state = useHyperBotResource(async () => {
    const delivery = await request<HyperDelivery>('/api/delivery');
    const channels: HyperConversation[] = []; const seen = new Set<string>(); let cursor = '';
    do { const page = await request<{ channels: HyperConversation[]; nextCursor?: string }>(`/api/channels${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); channels.push(...page.channels); if (cursor) seen.add(cursor); cursor = page.nextCursor ?? ''; } while (cursor && !seen.has(cursor));
    const bots = await HyperListBots(false).catch(() => []);
    return { delivery, bots, channels: channels.filter(row => row.active && (!agentId || row.agentIds.includes(agentId))) };
  }, agentId ?? 'all', 10000);
  const [channelId, setChannel] = useState(''); const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [challenge, setChallenge] = useState<{ id: string; owner: HyperSmsScope; generation: number }>();
  const [pickedBot, setPickedBot] = useState('');
  const [copyError, setCopyError] = useState('');
  const [links, setLinks] = useState<Record<string, { command: string; expiresAt: number; platform: string; conversation: string }>>({});
  const selected = state.data?.channels.find(row => row.id === channelId);
  const targetBot = agentId ? selected?.agentIds.includes(agentId) ? agentId : undefined : selected?.agentIds.includes(pickedBot) ? pickedBot : undefined;
  const smsKey = JSON.stringify([agentId, channelId, targetBot, !!selected?.active, !!state.data?.delivery.available.sms]);
  const currentSms = useRef<HyperSmsScope>({ key: smsKey, active: true, generation: 0 });
  if (currentSms.current.key !== smsKey || !currentSms.current.active) currentSms.current = { key: smsKey, active: true, generation: 0 };
  const smsOwner = currentSms.current;
  const issuing = useRef<{ owner: HyperSmsScope; generation: number } | undefined>(undefined);
  const phoneLocked = state.pending && issuing.current?.owner === smsOwner && issuing.current.generation === smsOwner.generation;
  const validSms = () => currentSms.current === smsOwner && smsOwner.active;
  const invalidateSms = () => { smsOwner.active = false; smsOwner.generation++; setChallenge(undefined); setCode(''); };
  useEffect(() => { smsOwner.active = true; smsOwner.generation++; setChallenge(undefined); setCode(''); return () => { smsOwner.active = false; smsOwner.generation++; }; }, [smsOwner]);
  return <section className="grid gap-3"><h3>Reaching you</h3>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}<Button disabled={state.pending} variant="outline" onClick={state.refresh}>Refresh</Button>
    {state.data && <><h4>Connected destinations</h4>{state.data.delivery.bindings.filter(row => row.enabled && (!agentId || row.agentId === agentId)).map(row => <article key={row.id} className="grid gap-2 rounded-lg border border-border p-3"><p>{row.transport} · {row.address}{row.optedOutAt ? ' · Texts stopped. Reply START to resume.' : ''}</p><Button disabled={state.pending} variant="outline" onClick={() => void state.run(() => HyperReachabilityApi.disconnect(row.id))}>Disconnect</Button></article>)}
      {!state.data.delivery.bindings.some(row => row.enabled && (!agentId || row.agentId === agentId)) && <p>No connected destinations.</p>}
      <label>Conversation<select className="w-full rounded border border-border bg-background p-2" value={channelId} onChange={e => { if (!validSms()) return; invalidateSms(); setChannel(e.target.value); setPickedBot(''); }}><option value="">Choose a conversation</option>{state.data.channels.map(row => <option key={row.id} value={row.id}>{row.summary || row.name}</option>)}</select></label>
      {!agentId && selected && <label>Bot<select className="w-full rounded border border-border bg-background p-2" value={pickedBot} onChange={e => { if (!validSms()) return; invalidateSms(); setPickedBot(e.target.value); }}><option value="">Choose a Bot</option>{selected.agentIds.map(id => <option key={id} value={id}>{state.data?.bots.find(bot => bot.id === id)?.name ?? id}</option>)}</select></label>}
      {state.data.channels.length === 0 && <p>Start a conversation with this Bot before connecting a destination.</p>}
      {['slack', 'teams'].map(platform => <div key={platform}>{state.data!.delivery.available[platform] ? <Button disabled={state.pending || !selected || !targetBot} onClick={() => void state.run(async () => { const value = await HyperReachabilityApi.chat(channelId, targetBot!, platform); setLinks(old => ({ ...old, [platform]: { command: value.command, platform, conversation: selected?.summary || selected?.name || channelId, expiresAt: Date.now() + value.expiresInMinutes * 60000 } })); })}>Link {platform === 'teams' ? 'Microsoft Teams' : 'Slack'}</Button> : <p>{platform} is unavailable on this deployment.</p>}</div>)}
      {copyError && <p role="alert">{copyError}</p>}{Object.entries(links).map(([platform, link]) => <div key={platform}><p role="status">{Date.now() < link.expiresAt ? <>For {link.conversation}, send <code>{link.command}</code> to OpenTag in {link.platform}. Expires at {new Date(link.expiresAt).toLocaleTimeString()}.</> : `${link.platform} link expired. Request a new link.`}</p>{Date.now() < link.expiresAt && <Button variant="outline" onClick={() => { setCopyError(''); void navigator.clipboard.writeText(link.command).catch(() => setCopyError('The link message could not be copied.')); }}>Copy {platform} link message</Button>}</div>)}
      {state.data.delivery.available.sms ? <form className="grid gap-2" onSubmit={e => { e.preventDefault(); if (!validSms() || !selected || !targetBot || !state.data?.delivery.available.sms) return; const generation = smsOwner.generation; void state.run(async () => { if (!validSms() || smsOwner.generation !== generation) return; const issue = { owner: smsOwner, generation }; issuing.current = issue; try { const value = await HyperReachabilityApi.sms(channelId, targetBot, phone); if (validSms() && smsOwner.generation === generation) { setChallenge({ id: value.challengeId, owner: smsOwner, generation }); setPhone(''); } } catch (error) { if (validSms() && smsOwner.generation === generation) throw error; } finally { if (issuing.current === issue) issuing.current = undefined; } }); }}><label>Phone<Input disabled={phoneLocked} type="tel" pattern="\+[1-9][0-9]{7,14}" placeholder="+15551234567" required value={phone} onChange={e => { if (!phoneLocked) setPhone(e.target.value); }} /></label><Button type="submit" disabled={state.pending || !selected || !targetBot}>Send verification code</Button></form> : <p>SMS is unavailable on this deployment.</p>}
      {challenge?.owner === smsOwner && challenge.generation === smsOwner.generation && <form className="grid gap-2" onSubmit={e => { e.preventDefault(); if (!validSms() || challenge.owner !== smsOwner || challenge.generation !== smsOwner.generation) return; void state.run(async () => { if (!validSms() || challenge.generation !== smsOwner.generation) return; try { await HyperReachabilityApi.confirm(challenge.id, code); if (validSms() && challenge.generation === smsOwner.generation) { setChallenge(undefined); setCode(''); } } catch (error) { if (validSms() && challenge.generation === smsOwner.generation) throw error; } }); }}><label>Verification code<Input required autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label><Button type="submit" disabled={state.pending}>Confirm phone</Button></form>}
      {!agentId && <><h4>Push devices</h4>{state.data.delivery.devices.map(device => <div key={device.id}>{device.platform} · {device.enabled ? 'Enabled' : 'Disabled'}<Button disabled={state.pending} variant="outline" onClick={() => void state.run(() => HyperReachabilityApi.removeDevice(device.id))}>Remove device</Button></div>)}<h4>Recent deliveries</h4>{state.data.delivery.deliveries.map(row => <p key={row.id}>{row.transport} · {row.kind} · {row.state} · {new Date(row.createdAt).toLocaleString()}</p>)}</>}
    </>}
  </section>;
}
export default function HyperReachabilitySection(_: { context: HyperOpenBotSectionContext }) { return <div className="h-full overflow-y-auto p-6"><HyperReachability /></div>; }
