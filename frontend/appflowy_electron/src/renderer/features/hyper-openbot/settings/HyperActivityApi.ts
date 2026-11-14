// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// app/src/lib/audit/queries.ts; components/manage/audit-page.tsx
import { hyperOpenBotRequest, hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN } from '../transport';
import type { AuditEvent } from './HyperActivityCells';
import { CALLS_RECORDED_AS_CHANGES, OPENBOT_WORKING_EVENT_TYPES, COMPUTER_ACTION_EVENT_TYPES, REFUSED_EVENT_TYPES, DID_NOT_HAPPEN_EVENT_TYPES } from './HyperActivityOutcome';
export const HYPER_ACTIVITY_VIEWS = [
  ['Everything', ''], ['Computer actions', COMPUTER_ACTION_EVENT_TYPES.join(',')], ['Blocked', REFUSED_EVENT_TYPES.join(',')], ['Did not happen', DID_NOT_HAPPEN_EVENT_TYPES.join(',')], ['Nobody watching', 'unattended'],
] as const;
export function hyperActivitySearch(view: string, bot?: string) {
  const params = new URLSearchParams();
  if (view === 'unattended') params.set('initiatorKind', 'routine,handoff,responsibility,memory');
  else if (view) params.set('eventType', view);
  if (bot) params.set('bot', bot);
  params.set('excludeEventType', OPENBOT_WORKING_EVENT_TYPES.join(','));
  params.set('excludeCalls', CALLS_RECORDED_AS_CHANGES.join(','));
  return params;
}
export const hyperActivityApi = {
  events: (search: URLSearchParams, cursor?: string) => {
    const params = new URLSearchParams(search); if (cursor) params.set('cursor', cursor);
    return hyperOpenBotRequest<{ events: AuditEvent[]; nextCursor?: string }>(`/api/admin/audit-events?${params}`);
  },
  names: async () => {
    const roster = async (hidden: boolean) => {
      const bots: { id: string; name: string }[] = []; const seen = new Set<string>(); let cursor: string | undefined;
      do {
        const params = new URLSearchParams({ limit: '100', ...(hidden ? { hidden: 'true' } : {}), ...(cursor ? { cursor } : {}) });
        const page = await hyperOpenBotRequest<{ bots: { id: string; name: string }[]; nextCursor?: string }>(`/api/v2/organizations/default/bots?${params}`);
        bots.push(...page.bots); if (cursor) seen.add(cursor); cursor = page.nextCursor;
      } while (cursor && !seen.has(cursor));
      return bots;
    };
    const [shown, hidden, plugins] = await Promise.all([roster(false), roster(true).catch(() => []), hyperOpenBotRequest<{ skills: { slug: string; title: string }[] }>('/api/plugins')]);
    return { bots: Object.fromEntries([...hidden, ...shown].map(bot => [bot.id, bot.name])), skills: Object.fromEntries(plugins.skills.map(skill => [skill.slug, skill.title])) };
  },
  export: async (search: URLSearchParams) => {
    const params = new URLSearchParams(search); params.delete('cursor'); params.delete('limit'); params.set('format', 'csv');
    const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/admin/audit-events?${params}`);
    if (!response.ok) throw new Error('Could not export these events. Try again.');
    return { blob: await response.blob(), capped: Number(response.headers.get('x-audit-export-truncated')) };
  },
};
