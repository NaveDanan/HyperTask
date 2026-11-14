// Adapted from OpenBot app/src/lib/proactive.ts, MIT Copyright (c) 2026 CopilotKit.
import { hyperOpenBotRequest } from '../transport';
export interface HyperCheckInSetting { id: string; agentId: string; channelId: string; focus: string; subject?: string; sourceLink?: string | null; enabled: boolean; intervalMinutes: number; nextRunAt: string; lastRunAt: string | null; lastStatus: string; lastError: string | null; lastRun?: { outcome: string; trigger: string; skipReason: string | null; why: string | null; itemsRaised: number; startedAt: string; finishedAt: string | null } | null }
export interface HyperCheckInSuggestion { id: string; agentId: string; title: string; detail: string; sourceApp: string | null; sourceRef: string | null; sourceLink: string | null; createdAt: string }
export const hyperLoadCheckIns = () => hyperOpenBotRequest<{ settings: HyperCheckInSetting[]; allowed: boolean }>('/api/proactive/settings');
export const hyperLoadSuggestions = () => hyperOpenBotRequest<{ suggestions: HyperCheckInSuggestion[] }>('/api/proactive/suggestions');
export const hyperCreateCheckIn = (input: { agentId: string; channelId: string; focus: string; subject?: string; sourceLink?: string; intervalMinutes: number }) => { hyperValidateCheckIn(input); return hyperOpenBotRequest('/api/proactive/settings?refuseExisting=true', 'POST', input); };
export const hyperUpdateCheckIn = (id: string, input: { enabled?: boolean; intervalMinutes?: number; focus?: string }) => { hyperValidateCheckIn(input); return hyperOpenBotRequest(`/api/proactive/settings/${encodeURIComponent(id)}`, 'PATCH', input); };
export const hyperDeleteCheckIn = (id: string) => hyperOpenBotRequest(`/api/proactive/settings/${encodeURIComponent(id)}`, 'DELETE');
export const hyperRunCheckIn = (id: string) => hyperOpenBotRequest<{ queued: true } | { queued: false; skipped: string; why: string }>(`/api/proactive/settings/${encodeURIComponent(id)}/run`, 'POST');
export const hyperResolveSuggestion = (id: string, action: 'start' | 'dismiss') => hyperOpenBotRequest(`/api/proactive/suggestions/${encodeURIComponent(id)}/${action}`, 'POST');

export function hyperValidateCheckIn(input: { intervalMinutes?: number; focus?: string; subject?: string; sourceLink?: string }) {
  if (input.intervalMinutes !== undefined && (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 60 || input.intervalMinutes > 1440)) throw new Error('Interval must be a whole number from 60 to 1440 minutes.');
  if ((input.focus?.trim().length ?? 0) > 1000 || (input.subject?.trim().length ?? 0) > 120) throw new Error('Focus or subject is too long.');
  if (input.sourceLink && (!/^https?:\/\//.test(input.sourceLink) || !URL.canParse(input.sourceLink) || input.sourceLink.length > 2000)) throw new Error('Enter a web source link.');
}
