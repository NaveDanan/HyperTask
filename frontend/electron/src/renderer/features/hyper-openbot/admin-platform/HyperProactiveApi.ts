// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest } from '../transport';
type CheckInSkipReason = 'off_admin' | 'off_person' | 'paused' | 'capped' | 'no_sources' | 'unreachable' | 'busy';
export type HyperBotCheckInMetrics = {
  agentId: string;
  name: string;
  avatarSeed: string;
  /** People whose check-ins with this Bot are on now. */
  peopleOn: number;
  runs: {
    quiet: number;
    raised: number;
    failed: number;
    skipped: Record<CheckInSkipReason, number>;
  };
  items: {
    raised: number;
    started: number;
    hidden: number;
    cleared: number;
    open: number;
  };
  acceptance: number | null;
  /** This Bot's items that a ping carried. */
  pinged: number;
};

export type HyperCheckInMetrics = {
  days: 7 | 30;
  /** The daily cap in force. */
  dailyRuns: number;
  bots: HyperBotCheckInMetrics[];
  /** One ping folds every Bot's items for a person, so pings are counted for everybody at once. */
  pings: { sent: number; itemsPerPing: number | null };
};


export interface HyperCheckInOverview { settings: { proactiveDailyRuns: number }; capabilities: { capability: string; organization: boolean | null; default: boolean; roles: Record<string, boolean>; groups: Record<string, boolean> }[] }
export const hyperLoadCheckInMetrics = (days: 7 | 30) => hyperOpenBotRequest<HyperCheckInMetrics>(`/api/admin/proactive?days=${days}`);
export const hyperLoadCheckInOverview = () => hyperOpenBotRequest<HyperCheckInOverview>('/api/admin/enterprise');
export const hyperLoadEdition = () => hyperOpenBotRequest<{ edition?: string }>('/api/capabilities');
export const hyperSetCheckIns = (allowed: boolean) => hyperOpenBotRequest('/api/admin/enterprise/capabilities', 'PUT', { scopeKind: 'organization', scopeId: '', capability: 'proactive', allowed });
export function hyperSetCheckInLimit(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error('Enter a whole number from 1 to 1440.');
  return hyperOpenBotRequest('/api/admin/enterprise/settings/proactiveDailyRuns', 'PUT', { value });
}
