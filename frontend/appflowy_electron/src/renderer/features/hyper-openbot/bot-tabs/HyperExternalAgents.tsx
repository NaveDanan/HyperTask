// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperSaveExternalAgent, hyperTestExternalAgent } from './HyperBotWorkflowApi';
import { HYPER_EXTERNAL_HARNESSES } from './HyperHarnesses';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { HyperListBots, HyperAgentPath, type HyperBotProfile } from '../bots/HyperBotsApi';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
export function HyperExternalAgents({ onChat }: { onChat: (id: string) => void }) {
  const state = useHyperBotResource(() => HyperListBots(false), 'external');
  const [selected, setSelected] = useState<HyperBotProfile | 'new'>();
  return <section className="grid gap-4"><header className="flex gap-3"><h2 className="font-semibold">External agents</h2><Button onClick={() => setSelected('new')}>Connect agent</Button><Button variant="outline" disabled={state.pending} onClick={state.refresh}>Refresh</Button></header>
    {state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    {state.data?.filter(bot => bot.endpoint && !bot.builtIn).map(bot => <article key={bot.id} className="flex items-center gap-3 rounded-lg border border-border p-3"><div className="flex-1"><h3>{bot.name}</h3><p>{bot.title}</p></div><Button variant="outline" onClick={() => onChat(bot.id)}>Chat</Button>{bot.canManage && <Button onClick={() => setSelected(bot)}>Edit connection</Button>}</article>)}
    {state.data && !state.data.some(bot => bot.endpoint && !bot.builtIn) && <p>No external agents connected.</p>}
    {selected && <HyperExternalAgentForm key={selected === 'new' ? 'new' : selected.id} bot={selected === 'new' ? undefined : selected} onClose={() => setSelected(undefined)} onSaved={() => { setSelected(undefined); state.refresh(); }} />}
  </section>;
}
function HyperExternalAgentForm({ bot, onSaved, onClose }: { bot?: HyperBotProfile; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(bot?.name ?? ''); const [title, setTitle] = useState(bot?.title ?? ''); const [roleDescription, setRole] = useState(bot?.roleDescription ?? '');
  const [endpoint, setEndpoint] = useState(bot?.endpoint ?? ''); const [key, setKey] = useState(''); const [visibility, setVisibility] = useState<'private' | 'public'>(bot?.visibility ?? 'private');
  const [harness, setHarness] = useState('byo-url');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [tested, setTested] = useState(Boolean(bot)); const [confirm, setConfirm] = useState(false);
  const locked = useRef(false);
  async function test() {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try {
      if (!/^https?:\/\/\S+$/.test(endpoint.trim())) throw new Error();
      const result = await hyperTestExternalAgent(endpoint, key);
      setTested(result.ok); if (!result.ok) setError('The endpoint could not be reached.');
    } catch { setTested(false); setError('The endpoint could not be reached. Check its address and credentials.'); } finally { locked.current = false; setBusy(false); }
  }
  return <form className="grid gap-3 rounded-lg border border-border p-4" onSubmit={async event => { event.preventDefault(); if (!tested || locked.current || (bot && !bot.canManage)) return; locked.current = true; setBusy(true); setError(''); try { await hyperSaveExternalAgent({ name, title, roleDescription, visibility, endpoint, key, harness }, bot); setKey(''); onSaved(); } catch { setError('The agent could not be saved. Check the fields and your permissions.'); } finally { locked.current = false; setBusy(false); } }}>
    <fieldset disabled={busy} className="grid min-w-0 gap-3"><h3>{bot ? 'Edit agent' : 'Connect agent'}</h3>{error && <p role="alert" className="text-destructive">{error}</p>}
    <label>Name<Input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><label>Title<Input maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Role description<Textarea required maxLength={1000} value={roleDescription} onChange={e => setRole(e.target.value)} /></label>
    {!bot && <label>Framework<select value={harness} onChange={event => setHarness(event.target.value)}>{HYPER_EXTERNAL_HARNESSES.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    <label>AG-UI endpoint<Input required type="url" value={endpoint} onChange={e => { setEndpoint(e.target.value); setTested(false); }} /></label><label>Authorization key<Input type="password" autoComplete="off" value={key} onChange={e => { setKey(e.target.value); setTested(false); }} placeholder={bot ? 'Leave empty to keep current key' : ''} /></label>
    <label><input type="checkbox" checked={visibility === 'public'} onChange={e => setVisibility(e.target.checked ? 'public' : 'private')} />Public</label>
    <Button disabled={busy} variant="outline" type="button" onClick={() => void test()}>{tested ? 'Connection verified' : 'Test connection'}</Button><Button type="submit" disabled={busy || !tested}>Save agent</Button><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
    {bot && (confirm ? <><p>Delete this agent for everyone? Existing conversations stay readable.</p><Button type="button" disabled={busy} variant="destructive" onClick={async () => { if (locked.current) return; locked.current = true; setBusy(true); try { await request(HyperAgentPath(bot.id), 'DELETE'); onSaved(); } catch { setError('The agent could not be deleted.'); } finally { locked.current = false; setBusy(false); } }}>Delete permanently</Button><Button type="button" variant="outline" onClick={() => setConfirm(false)}>Cancel deletion</Button></> : <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>Delete agent…</Button>)}
  </fieldset></form>;
}
export default function HyperExternalAgentsSection({ context }: { context: HyperOpenBotSectionContext }) { return <div className="h-full overflow-y-auto p-6"><HyperExternalAgents onChat={id => context.startConversation([id])} /></div>; }
