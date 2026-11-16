// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { Button } from '@/components/ui/button';
import { HyperListBots, type HyperBotProfile } from '../bots/HyperBotsApi';
import { hyperOpenBotRequest as request } from '../transport';
import { useHyperBotResource } from './HyperBotResource';
interface HyperHandoff { enabled: boolean; canGrant: boolean; grantable: boolean; reachable: string[] }
export function HyperBotHandoffTab({ agentId }: { agentId: string }) {
  const state = useHyperBotResource(async () => {
    const [result, shown, hidden] = await Promise.all([request<{ handoff: HyperHandoff }>(`/api/agents/${encodeURIComponent(agentId)}/handoff`), HyperListBots(false), HyperListBots(true).catch(() => [])]);
    const held = new Set(result.handoff.reachable);
    const bots: Pick<HyperBotProfile, 'id' | 'name'>[] = [...shown, ...hidden.filter(bot => held.has(bot.id) && !shown.some(row => row.id === bot.id))];
    for (const id of held) if (!bots.some(bot => bot.id === id)) bots.push({ id, name: 'Bot no longer available' });
    return { handoff: result.handoff, bots };
  }, agentId);
  const data = state.data?.handoff, bots = state.data?.bots ?? [];
  const change = (ref: string, granted: boolean) => {
    if (!data?.canGrant || granted && (!data.enabled || !data.grantable) || !granted && !data.reachable.includes(ref)) return;
    return state.run(() => granted ? request('/api/plugins/grants', 'POST', { kind: 'bot', ref, agentId }) : request(`/api/plugins/grants?kind=bot&ref=${encodeURIComponent(ref)}&agentId=${encodeURIComponent(agentId)}`, 'DELETE'));
  };
  return <div className="grid gap-3"><h3 className="font-medium">Bots it can ask</h3>
    {state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}<Button variant="outline" disabled={state.pending} onClick={state.refresh}>Refresh</Button>
    {data && <>{!data.enabled && <p>Bot handoff is disabled on this deployment.</p>}{!data.grantable && <p>This Bot cannot be given new handoff permissions.</p>}{!data.canGrant && <p>Only administrators can change these permissions.</p>}
      {bots.filter(bot => bot.id !== agentId && (data.enabled && data.grantable || data.reachable.includes(bot.id))).map(bot => <label key={bot.id} className="flex items-center gap-2 rounded-lg border border-border p-3"><input type="checkbox" disabled={state.pending || !data.canGrant} checked={data.reachable.includes(bot.id)} onChange={event => void change(bot.id, event.target.checked)} />{bot.name}</label>)}
      {!bots.some(bot => bot.id !== agentId) && <p>No other Bots available.</p>}</>}
  </div>;
}
