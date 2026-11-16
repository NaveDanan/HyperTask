// Native destination for a published OpenBot screen. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useState } from 'react';
import { HyperInteractiveResult } from './HyperInteractiveResult';
import { hyperScreensApi } from './HyperScreensApi';
export interface HyperGeneratedScreenProps {name: string; agentId?: string; args: Record<string, unknown>}
export function HyperGeneratedScreen({name, agentId, args}: HyperGeneratedScreenProps) {
  const [bot, setBot] = useState(agentId ?? '');
  const [bots, setBots] = useState<{id: string; name: string}[]>();
  const [failed, setFailed] = useState(false);
  const load = () => {setFailed(false); void hyperScreensApi.bots().then(setBots).catch(() => setFailed(true));};
  useEffect(load, []);
  return <section className="h-full space-y-4 overflow-auto p-6"><h1 className="text-lg font-semibold">{name}</h1>
    <label className="block">Bot<select className="ml-2 rounded-md border border-border bg-background p-2" value={bot} onChange={event => setBot(event.target.value)}><option value="">Choose a Bot</option>{bots?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {failed ? <p role="alert">Bots could not be loaded. <button onClick={load}>Retry</button></p> : !bots ? <p role="status">Loading Bots…</p> : bots.length === 0 ? <p>No Bots yet.</p> : null}
    {bot ? <HyperInteractiveResult key={bot} name={name} agentId={bot} args={args} /> : <p>Choose which Bot's component permissions to use.</p>}
  </section>;
}
