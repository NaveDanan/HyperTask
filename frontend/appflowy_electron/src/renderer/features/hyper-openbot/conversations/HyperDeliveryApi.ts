// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from app/src/lib/delivery.ts. See REUSE.md.
import { hyperOpenBotRequest as request } from '../transport';
export type Reachability = {
  bindings: {
    id: string;
    transport: "slack" | "teams" | "sms";
    channelId: string;
    agentId: string;
    address: string;
    mentionId?: string | null;
    enabled: boolean;
    /** SMS only: the number replied STOP; texts resume after START. */
    optedOutAt?: string | null;
  }[];
  devices: { id: string; platform: "ios" | "android"; enabled: boolean }[];
  /** The server's `delivery_outbox` rows (server/src/delivery/types.ts), newest first. */
  deliveries: {
    id: string;
    transport: "slack" | "teams" | "sms" | "push";
    kind: "reply" | "question" | "approval" | "attention";
    state:
      | "queued"
      | "running"
      | "accepted"
      | "sent"
      | "delivered"
      | "failed"
      | "unknown"
      | "opted_out";
    error: string | null;
    createdAt: string;
  }[];
  available: { slack: boolean; teams: boolean; sms: boolean; push: boolean };
};
export type ChatLink = {
  platform: "slack" | "teams";
  code: string;
  command: string;
  expiresInMinutes: number;
};

export const hyperReadDelivery = () => request<Reachability>('/api/delivery');
export const hyperStartChatLink = (target: { channelId: string; agentId: string; platform: 'slack' | 'teams' }) => request<ChatLink>('/api/delivery/opentag/start', 'POST', target);
export const hyperStartSms = async (target: { channelId: string; agentId: string; phone: string }) => (await request<{ challengeId: string }>('/api/delivery/sms/start', 'POST', target)).challengeId;
export const hyperConfirmSms = (challengeId: string, code: string) => request('/api/delivery/sms/confirm', 'POST', { challengeId, code });
export const hyperRemoveBinding = (id: string) => request(`/api/delivery/bindings/${encodeURIComponent(id)}`, 'DELETE');
export const hyperRemoveDevice = (id: string) => request(`/api/delivery/devices/${encodeURIComponent(id)}`, 'DELETE');
