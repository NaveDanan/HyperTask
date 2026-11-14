// Adapted from OpenBot lib/copilot/bot-offer.ts. Copyright (c) 2026 CopilotKit. MIT.
import type { AbstractAgent } from '@copilotkit/react-core/v2';
import { defer, mergeMap } from 'rxjs';
import { hyperOpenBotRequest } from './transport';
import { hyperFilterRuntimeTools, hyperRuntimeBotOf, type HyperRuntimeFacts } from './runtime';
export async function hyperResolveRuntimeFacts(botId: string): Promise<HyperRuntimeFacts> {
  const [profile, capabilities] = await Promise.all([
    hyperOpenBotRequest<{ agent: { visibility: string; canManage: boolean } }>(`/api/agents/${encodeURIComponent(botId)}`),
    hyperOpenBotRequest<{ capabilities: HyperRuntimeFacts['capabilities'] }>('/api/admin/enterprise/me'),
  ]);
  return { profile: profile.agent, capabilities: capabilities.capabilities };
}
const prepared = new WeakSet<AbstractAgent>();
export function hyperPrepareRuntimeAgent(agent: AbstractAgent) {
  if (prepared.has(agent)) return;
  prepared.add(agent);
  agent.use((input, next) => defer(async () => {
    const botId = hyperRuntimeBotOf(agent);
    let facts: HyperRuntimeFacts = {};
    if (botId) { try { facts = await hyperResolveRuntimeFacts(botId); } catch { /* Unknown identity denies computer offers. */ } }
    return { ...input, tools: hyperFilterRuntimeTools(input.tools, facts) };
  }).pipe(mergeMap(input => next.run(input))));
}
