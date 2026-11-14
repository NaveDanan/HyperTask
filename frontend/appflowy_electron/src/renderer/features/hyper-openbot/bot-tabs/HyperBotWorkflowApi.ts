// Adapted from OpenBot lib/delivery.ts, lib/agents/{form,queries,mutations}.ts and lib/app-grants.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest as request } from '../transport';
import { HyperAgentPath, HyperBotValues, type HyperBotInput, type HyperBotProfile } from '../bots/HyperBotsApi';
export interface HyperExternalInput extends HyperBotInput { endpoint: string; key: string; harness: string }
export function hyperExternalInput(input: HyperExternalInput, creating: boolean) {
  const endpoint = input.endpoint.trim();
  if (!/^https?:\/\/\S+$/.test(endpoint)) throw new Error('Enter an address starting with http:// or https://.');
  return { ...HyperBotValues(input), endpoint, ...(input.key.trim() ? { auth: { header: 'Authorization', value: input.key.trim() } } : {}), ...(creating && input.harness !== 'byo-url' ? { harness: input.harness } : {}) };
}
export function hyperSaveExternalAgent(input: HyperExternalInput, bot?: HyperBotProfile) {
  if (bot && !bot.canManage) throw new Error('You cannot edit this Bot.');
  return request<{ agent: HyperBotProfile }>(bot ? HyperAgentPath(bot.id) : '/api/agents', bot ? 'PATCH' : 'POST', hyperExternalInput(input, !bot));
}
export function hyperTestExternalAgent(endpoint: string, key: string) {
  if (!/^https?:\/\/\S+$/.test(endpoint.trim())) throw new Error('Enter an address starting with http:// or https://.');
  return request<{ ok: boolean }>('/api/agents/test-connection', 'POST', { endpoint: endpoint.trim(), ...(key.trim() ? { headers: { Authorization: key.trim() } } : {}) });
}
export const HyperReachabilityApi = {
  chat: (channelId: string, agentId: string, platform: string) => request<{ command: string; expiresInMinutes: number }>('/api/delivery/opentag/start', 'POST', { channelId, agentId, platform }),
  sms: (channelId: string, agentId: string, phone: string) => request<{ challengeId: string }>('/api/delivery/sms/start', 'POST', { channelId, agentId, phone }),
  confirm: (challengeId: string, code: string) => request('/api/delivery/sms/confirm', 'POST', { challengeId, code }),
  disconnect: (id: string) => request(`/api/delivery/bindings/${encodeURIComponent(id)}`, 'DELETE'),
  removeDevice: (id: string) => request(`/api/delivery/devices/${encodeURIComponent(id)}`, 'DELETE'),
};
export function hyperBotGrantsPath(agentId: string, app: string) { return `/api/plugins/for/${encodeURIComponent(agentId)}/apps/${encodeURIComponent(app)}/grants`; }
export const HyperBotGrantApi = {
  translate: <T>(agentId: string, app: string, text: string) => request<T>(`${hyperBotGrantsPath(agentId, app)}/translate`, 'POST', { text }),
  replay: <T>(agentId: string, app: string, grants: string[]) => request<T>(`${hyperBotGrantsPath(agentId, app)}/replay`, 'POST', { grants }),
  save: (agentId: string, app: string, input: { add: string[]; remove: string[]; authoring?: { source: 'english'; text: string }; approval?: { audience: string; outsideInput: boolean; members: { kind: string; value: string }[] } }) => request(hyperBotGrantsPath(agentId, app), 'POST', input),
};
export async function hyperReadExplicitBot(agentId: string): Promise<HyperBotProfile> {
  const value = await request<unknown>(HyperAgentPath(agentId));
  const bot = value && typeof value === 'object' && 'agent' in value ? value.agent : undefined;
  if (!bot || typeof bot !== 'object' || !('id' in bot) || typeof bot.id !== 'string' || !('name' in bot) || typeof bot.name !== 'string') throw new Error('Could not load this Bot.');
  return bot as HyperBotProfile;
}
