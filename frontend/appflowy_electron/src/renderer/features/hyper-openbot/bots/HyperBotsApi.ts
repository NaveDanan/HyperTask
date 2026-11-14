// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest } from '../transport';
export interface HyperBotProfile {
  id: string; name: string; title: string; roleDescription: string;
  visibility: 'private' | 'public'; canManage: boolean; mine: boolean;
  systemOwned: boolean; pinned: boolean; hidden: boolean; assignedToMe?: boolean;
  instructions?: string; endpoint: string | null;
}
export interface HyperBotInput {
  name: string; title: string; roleDescription: string; visibility: 'private' | 'public'; instructions?: string;
}
export interface HyperBotLifecycle { paused: boolean; notify: 'all' | 'needs_input' | 'none' }
export const HyperAgentPath = (id: string) => `/api/agents/${encodeURIComponent(id)}`;
export const HyperLifecyclePath = (id: string) => `/api/bots/${encodeURIComponent(id)}`;
export function HyperBotValues(input: HyperBotInput): HyperBotInput {
  const value = { ...input, name: input.name.trim(), title: input.title.trim(), roleDescription: input.roleDescription.trim() };
  if (!value.name || value.name.length > 80) throw new Error('Enter a name of 1 to 80 characters.');
  if (value.title.length > 120) throw new Error('Keep the title within 120 characters.');
  if (!value.roleDescription || value.roleDescription.length > 1000) throw new Error('Describe the role in 1 to 1000 characters.');
  if (value.instructions !== undefined) {
    value.instructions = value.instructions.trim();
    if (!value.instructions || value.instructions.length > 1000) throw new Error('Enter instructions of 1 to 1000 characters.');
  }
  // Send only editable fields; never echo credentials or server-derived permissions.
  return { name: value.name, title: value.title, roleDescription: value.roleDescription, visibility: value.visibility,
    ...(value.instructions === undefined ? {} : { instructions: value.instructions }) };
}
export async function HyperSaveBot(input: HyperBotInput, bot?: HyperBotProfile) {
  if (bot && !bot.canManage) throw new Error('You cannot edit this Bot.');
  return (await hyperOpenBotRequest<{ agent: HyperBotProfile }>(bot ? HyperAgentPath(bot.id) : '/api/agents', bot ? 'PATCH' : 'POST', HyperBotValues(input))).agent;
}
export async function HyperListBots(hidden: boolean) {
  return (await hyperOpenBotRequest<{ agents: HyperBotProfile[] }>(`/api/agents${hidden ? '?hidden=true' : ''}`)).agents;
}
