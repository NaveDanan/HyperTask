// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted from lib/channels/use-channel-events.ts and lib/channels/mark-read.ts.
import { HyperOpenBotSocket } from '../socket';
import { hyperOpenBotRequest as request } from '../transport';
import { HyperNoticeChannelEvent, HyperForgetReplies, type HyperChannelActivityEvent } from '../approvals-inbox/HyperReplyNotices';
export function hyperParseChannelEvent(data: unknown): (HyperChannelActivityEvent & { lastMessageAt?: string | null }) | { resync: true } | null {
  if (typeof data !== 'string') return null;
  try { const value = JSON.parse(data); if (!value || typeof value !== 'object' || Array.isArray(value)) return null; if (value.resync === true) return { resync: true }; return typeof value.channelId === 'string' ? value : null; } catch { return null; }
}
export function hyperWatchChannelEvents(onEvent: (event: ReturnType<typeof hyperParseChannelEvent>) => void, open: (id: string) => void) {
  let stopped = false; let generation = 0; let socket: HyperOpenBotSocket; let timer: ReturnType<typeof setTimeout>; let delay = 1000;
  const connect = () => {
    if (stopped) return;
    socket = new HyperOpenBotSocket('wss://hyper-openbot.invalid/api/channels/events');
    socket.onopen = () => { delay = 1000; onEvent({ resync: true }); };
    socket.onmessage = ({ data }) => {
      const parsed = hyperParseChannelEvent(data); if (!parsed) return; onEvent(parsed);
      if ('resync' in parsed) return;
      const current = generation;
      void request<{ agents: { id: string; name: string }[] }>('/api/agents').then(({ agents }) => {
        if (stopped || current !== generation) return;
        HyperNoticeChannelEvent(parsed, {
          attention: async () => { const value = await request<{ bots: { agentId: string; name: string; waitingIn?: string | null }[] }>('/api/bots/attention'); if (stopped) throw new Error('Session ended'); return value.bots; },
          notify: async id => { const value = await request<{ lifecycle: { notify: 'all' | 'needs_input' | 'none' } }>(`/api/bots/${encodeURIComponent(id)}/lifecycle`); if (stopped) throw new Error('Session ended'); return value.lifecycle.notify; },
          agents: () => agents,
        }, open);
      }).catch(() => undefined);
    };
    socket.onclose = () => { if (!stopped) { timer = setTimeout(connect, delay); delay = Math.min(delay * 2, 30_000); } };
  };
  connect();
  return () => { stopped = true; generation++; clearTimeout(timer); socket?.close(); HyperForgetReplies(); };
}
export const hyperMarkChannelRead = (id: string) => request(`/api/channels/${encodeURIComponent(id)}/read`, 'PUT');
