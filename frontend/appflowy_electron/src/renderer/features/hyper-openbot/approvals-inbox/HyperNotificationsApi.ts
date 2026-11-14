// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest as request } from "../transport";
export type HyperReachability = {
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

export const HyperTransports = ['push', 'slack', 'teams', 'sms'] as const;
export const HyperKinds = ['progress', 'decision', 'question', 'attention'] as const;
export type HyperTransport = typeof HyperTransports[number];
export type HyperKind = typeof HyperKinds[number];
export type HyperRouting = Record<HyperKind, 'all' | HyperTransport[]>;
export const HyperLoadDelivery = () => request<HyperReachability>('/api/delivery');
export const HyperLoadRouting = async () => (await request<{ routing: HyperRouting }>('/api/bots/routing')).routing;
export const HyperRouteUpdates = (kind: HyperKind, transports: 'all' | HyperTransport[]) => request('/api/bots/routing/' + kind, 'PUT', { transports });
export const HyperRemoveDevice = (id: string) => request('/api/delivery/devices/' + encodeURIComponent(id), 'DELETE');
