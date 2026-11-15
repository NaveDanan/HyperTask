// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest as request } from '../transport';
const segment = encodeURIComponent;
export interface HyperBotApp {
  account?: 'personal' | 'shared' | 'deployment'; key: string; displayName: string; state: string; accountHolder: 'you' | 'owner' | null;
  asksFirst: boolean; givenByOwner: boolean; needsConnect: boolean;
  requestKind: string | null; request: { id: string } | null;
}
export interface HyperTeamBot { id: string; audience: 'team' | 'people'; people?: string[]; groups?: string[]; assignments?: string[]; visibleToTeam: boolean }
export interface HyperTeamBots { teamBots: HyperTeamBot[]; publishable: { id: string }[] }
export const HyperBotTabsApi = {
  apps: async (id: string) => (await request<{ apps: HyperBotApp[] }>(`/api/plugins/for/${segment(id)}/apps`)).apps,
  give: (id: string, app: string, remove = false) => request(`/api/plugins/for/${segment(id)}/apps/${segment(app)}/give`, remove ? 'DELETE' : 'POST'),
  request: (agentId: string, app: string) => request('/api/plugins/access-requests', 'POST', { agentId, app }),
  cancelRequest: (id: string) => request(`/api/plugins/access-requests/${segment(id)}`, 'DELETE'),
  team: () => request<HyperTeamBots>('/api/team-bots'),
  publish: (id: string, audience: 'team' | 'people', emails: string[], groups: string[]) => request(`/api/team-bots/${segment(id)}/publication`, 'PUT', { audience, emails: audience === 'people' ? emails : [], groups: audience === 'people' ? groups : [] }),
  assign: (id: string, group: string, remove = false) => request(`/api/team-bots/${segment(id)}/assignments${remove ? `/${segment(group)}` : ''}`, remove ? 'DELETE' : 'POST', remove ? undefined : { group }),
  unpublish: (id: string) => request(`/api/team-bots/${segment(id)}/publication`, 'DELETE'),
};
/** Native renderer has no web origin. The server's OAuth redirect is projected from publicUrl. */
export function hyperTeamBotShareLink(redirectUri: string | null | undefined, agentId: string) {
  if (!redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname.endsWith('.invalid')) return null;
    return `${url.origin}/channel/new?agent=${encodeURIComponent(agentId)}`;
  } catch { return null; }
}
