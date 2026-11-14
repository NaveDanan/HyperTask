// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { Button } from '@/components/ui/button';
import { hyperOpenBotRequest as request } from '../transport';
import { HyperAgentPath, type HyperBotProfile } from '../bots/HyperBotsApi';
import { useHyperBotResource } from './HyperBotResource';
export function HyperBotSetupTab({ agentId }: { agentId: string }) {
  const state = useHyperBotResource(async () => {
    const [result, capabilities, mine] = await Promise.all([
      request<{ agent: HyperBotProfile }>(HyperAgentPath(agentId)),
      request<{ capabilities: { isolationAvailable: boolean } }>('/api/agents/capabilities'),
      request<{ capabilities: { isolatedComputers?: boolean } }>('/api/admin/enterprise/me'),
    ]);
    return { bot: result.agent, available: capabilities.capabilities.isolationAvailable, allowed: mine.capabilities.isolatedComputers !== false };
  }, agentId);
  const bot = state.data?.bot;
  return <section className="grid gap-3"><h3>Setup</h3>{state.pending && <p role="status">Loading…</p>}{state.error && <p role="alert" className="text-destructive">{state.error}</p>}<Button variant="outline" disabled={state.pending} onClick={state.refresh}>Refresh</Button>
    {bot && <><p>{bot.builtIn ? 'Built in' : bot.endpoint ? `Runs at ${bot.endpoint}` : 'Built in'}</p><p className="text-sm text-muted-foreground">Profile and instructions can be edited above. External endpoint settings are on External agents.</p>
      <label className="flex gap-2"><input type="checkbox" checked={Boolean(bot.isolated)} disabled={state.pending || !bot.canManage || bot.systemOwned || (!bot.isolated && !(state.data?.available && state.data.allowed))} onChange={e => { const isolated = e.target.checked; void state.run(() => request(HyperAgentPath(agentId), 'PATCH', { name: bot.name, title: bot.title, roleDescription: bot.roleDescription, visibility: bot.visibility, endpoint: bot.builtIn ? '' : bot.endpoint ?? '', isolated })); }} />Computer of its own</label>
      <p>{bot.systemOwned ? 'This included Bot runs on the computer of whoever is using it.' : bot.isolated ? bot.isolationActive ? 'Isolation is active.' : `Isolation is requested but unavailable: ${bot.isolationOffReason ?? 'waiting for deployment'}.` : !state.data?.available ? 'This deployment cannot create isolated computers.' : !state.data.allowed ? 'An administrator has disabled isolated computers for you.' : 'Runs on a shared computer.'}</p>
    </>}
  </section>;
}
