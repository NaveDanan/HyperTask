// Adapted from OpenBot routes/_authed/_app/bot.tsx and bots.$agentId.index.tsx.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HyperBotEditor } from '../bots/HyperBotsPanel';
import { HyperAgentPath, HyperListBots, type HyperBotProfile } from '../bots/HyperBotsApi';
import { hyperOpenBotRequest as request } from '../transport';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { useHyperBotResource } from './HyperBotResource';
export default function HyperBotSection({ context }: { context: HyperOpenBotSectionContext }) {
  const state = useHyperBotResource(() => HyperListBots(false), 'bot-roster');
  const [selected, setSelected] = useState<HyperBotProfile>();
  const [lookup, setLookup] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const bot = selected ?? state.data?.find(row => row.id === 'picked-harness') ?? state.data?.[0];
  return <section className="grid h-full gap-4 overflow-y-auto p-6"><header className="flex flex-wrap gap-3"><h2>Bot</h2><select aria-label="Bot" value={bot?.id ?? ''} onChange={event => { setSelected(state.data?.find(row => row.id === event.target.value)); setError(''); }}><option value="" disabled>Choose a Bot</option>{state.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><Button variant="outline" disabled={state.pending} onClick={state.refresh}>Refresh</Button></header>
    {state.pending && <p role="status">Loading Bots…</p>}{state.error && <p role="alert">{state.error}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); void request<{ agent: HyperBotProfile }>(HyperAgentPath(lookup.trim())).then(result => setSelected(result.agent)).catch(() => setError('Could not open this Bot. It may not exist or may not be shared with you.')).finally(() => setBusy(false)); }}><Input aria-label="Bot ID" value={lookup} onChange={e => setLookup(e.target.value)} placeholder="Open a Bot by ID" /><Button disabled={busy || !lookup.trim()}>Open Bot</Button></form>
    {!state.pending && !state.error && !bot && <p>There are no Bots yet. Create one on Bots.</p>}
    {bot && <><Button disabled={busy} onClick={() => { setBusy(true); setError(''); void context.startConversation([bot.id]).catch(() => setError('The conversation could not be started.')).finally(() => setBusy(false)); }}>Chat with {bot.name}</Button><HyperBotEditor key={bot.id} bot={bot} onOpenConversation={context.openConversation} onSaved={value => { setSelected(value); state.refresh(); }} onRemoved={() => { setSelected(undefined); state.refresh(); }} onClose={() => context.navigate?.('bots')} /></>}
  </section>;
}
