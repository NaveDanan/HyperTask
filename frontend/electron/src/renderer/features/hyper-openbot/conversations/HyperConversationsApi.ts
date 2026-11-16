// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask by NaveDanan. See REUSE.md.
import { hyperOpenBotRequest as request } from '../transport';
/** One line of a group conversation: a person's message (`agentId` null) or one Bot's reply. */
export type GroupMessage = {
  id: string;
  channelId: string;
  /** Who sent it, for a person's line; whose run it was, for a Bot's. */
  ownerUserId: string;
  agentId: string | null;
  text: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  createdAt: string;
  /** Why a waiting Bot is waiting, when it is. */
  reason?: string;
  /** For an answer relayed from another Bot through `message_bot`: which Bot answered. */
  answeredBy?: string;
  /** A Team Bot asking the person whose turn it was to use their own account. */
  consent?: { botId: string; serverId: string };
};
export type GroupPerson = {
  userId: string;
  email: string;
  name: string | null;
  /** Made the group; the one who may take others out of it. */
  creator: boolean;
};
export type GroupBot = { id: string; name: string };
export type GroupConversation = {
  bots: GroupBot[];
  people: GroupPerson[];
  messages: GroupMessage[];
};


export function hyperGroupPolling(data: GroupConversation | undefined, now = Date.now()) {
  const last = data?.messages.at(-1);
  return !!data?.messages.some(message => message.status === 'running' || message.status === 'queued') ||
    !!(last && last.agentId === null && now - Date.parse(last.createdAt) < 10 * 60_000);
}
export const hyperGroupPath = (id: string) => `/api/groups/${encodeURIComponent(id)}`;
export const hyperReadGroup = (id: string) => request<GroupConversation>(hyperGroupPath(id));
export const hyperSendGroup = (channelId: string, input: { id: string; text: string; agentId: string | null }) => request(hyperGroupPath(channelId), 'POST', input);
export const hyperAddGroupMember = (id: string, email: string) => request(`${hyperGroupPath(id)}/members`, 'POST', { email: email.trim() });
export const hyperRemoveGroupMember = (id: string, userId: string) => request(`${hyperGroupPath(id)}/members/${encodeURIComponent(userId)}`, 'DELETE');
export async function hyperStartGroup<T extends { id: string }>(agentIds: string[], text?: string, agentId: string | null = null): Promise<T> {
  const { channel } = await request<{ channel: T }>('/api/groups', 'POST', { agentIds });
  if (text !== undefined) {
    try { await hyperSendGroup(channel.id, { id: crypto.randomUUID(), text, agentId }); }
    catch (error) { await request(`/api/channels/${encodeURIComponent(channel.id)}?discardFailedStart=true`, 'DELETE').catch(() => undefined); throw error; }
  }
  return channel;
}
export type HyperConsentDecision = 'allow_once' | 'allow_always' | 'allow_all_team_bots' | 'skip';
export const hyperTeamConsent = (botId: string, serverId: string, decision: HyperConsentDecision) => request(`/api/team-bots/${encodeURIComponent(botId)}/consents`, 'POST', { serverId, decision });
export const hyperRenameConversation = (id: string, title: string) => request(`/api/channels/${encodeURIComponent(id)}/title`, 'PUT', { title: title.trim() || null });
