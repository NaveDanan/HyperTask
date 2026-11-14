// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from routes/_authed/_app/channel/new.tsx. See REUSE.md.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperListBots, type HyperBotProfile } from '../bots/HyperBotsApi';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
export default function HyperNewConversationSection({ context }: { context: HyperOpenBotSectionContext }) {
  const [bots, setBots] = useState<HyperBotProfile[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => { let current = true; setError(undefined); void HyperListBots(false).then(value => { if (current) setBots(value); }).catch(error => { if (current) setError(String(error)); }); return () => { current = false; }; }, [revision]);
  return <div className="space-y-4 overflow-y-auto p-6"><h2 className="text-lg font-semibold">New conversation</h2><p className="text-sm text-muted-foreground">Choose Bots in the order they should answer.</p>{error && <div role="alert">{error}<Button onClick={() => setRevision(value => value + 1)}>Retry</Button></div>}{!bots && !error && <p role="status">Loading Bots…</p>}{bots?.length === 0 && <p>No Bots available. Create one in Bots.</p>}<div className="space-y-2">{bots?.map(bot => <label key={bot.id} className="flex items-center gap-3 rounded-lg border p-3"><input type="checkbox" checked={selected.includes(bot.id)} onChange={event => setSelected(value => event.target.checked ? [...value, bot.id] : value.filter(id => id !== bot.id))} /><span>{bot.name} <span className="text-muted-foreground">{bot.title}</span></span>{selected.includes(bot.id) && <span>{selected.indexOf(bot.id) + 1}</span>}</label>)}</div><Button disabled={!selected.length} onClick={() => context.startConversation(selected)}>Start conversation</Button></div>;
}
