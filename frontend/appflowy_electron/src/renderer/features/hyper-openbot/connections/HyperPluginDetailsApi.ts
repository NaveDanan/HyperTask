// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest } from '../transport';
import { hyperServerPath } from './HyperConnectionsApi';
export interface HyperPluginTool { name: string; description: string; ref: string; inputSchema: Record<string, unknown>; effect: 'read' | 'write'; destructive: boolean; grantedTo: string[] }
export interface HyperPluginBot { id: string; name: string; mine?: boolean; hidden?: boolean; hasCallbackToken?: boolean }
export interface HyperSharedApproval { audience: 'owner' | 'people' | 'team'; outsideInput: boolean; members: { kind: 'user' | 'group'; value: string }[] }
export interface HyperModePreview { mode: 'personal' | 'shared'; wouldRevoke: { holder: 'person' | 'deployment'; count: number }; bots: { botId: string; exposure: HyperSharedApproval }[] }
export interface HyperBrokerField { name: string; label: string; help: string; required: boolean; secret: boolean; default?: string }
export interface HyperBrokerApp { slug: string; name: string; description: string; categories: string[]; actionCount: number; classifiedCount: number | null; permissionCount: number | null; scopedActionCount: number | null; connection: { kind: 'consent' | 'self-registering' | 'fields' | 'no-auth' | 'unsupported' }; enabled: boolean }
export interface HyperAccount { id: string; identity: string | null; label: string; isDefault: boolean; connectedAt: string | null }
export type HyperConnectionSelection = { page: 'list' } | { page: 'browse'; provider?: 'arcade' | 'composio' } | { page: 'new' } | { page: 'app'; key: string } | { page: 'tool'; key: string; tool: string } | { page: 'bot'; key: string; agentId: string };
export interface HyperConnectionNavigationProps { selection?: HyperConnectionSelection; onSelectionChange?: (selection: HyperConnectionSelection) => void; /** Parent main callback supplies only app id after consuming provider callback credentials. */ onConnectionStarted?: (serverId: string) => void }
export const hyperBrowseApps = (query: string) => hyperOpenBotRequest<{ apps: HyperBrokerApp[] }>(`/api/plugins/composio/apps?q=${encodeURIComponent(query)}`);
export const hyperEnableBrokerApp = (slug: string) => hyperOpenBotRequest<{ server: { id: string } }>('/api/plugins/composio/apps', 'POST', { slug });
export async function hyperLoadPluginBots() {
  const [visible, hidden] = await Promise.all([hyperOpenBotRequest<{ agents: HyperPluginBot[] }>('/api/agents'), hyperOpenBotRequest<{ agents: HyperPluginBot[] }>('/api/agents?hidden=true')]);
  return [...new Map([...visible.agents, ...hidden.agents.map(b => ({ ...b, hidden: true }))].map(b => [b.id, b])).values()];
}
export function hyperPluginGrant(ref: string, agentId: string, granted: boolean, approval?: HyperSharedApproval) {
  const body = { kind: 'mcp', ref, agentId };
  return granted ? hyperOpenBotRequest('/api/plugins/grants', 'POST', { ...body, ...(approval ? { approval } : {}) }) : hyperOpenBotRequest(`/api/plugins/grants?${new URLSearchParams(body)}`, 'DELETE');
}
export const hyperPreviewMode = (id: string, mode: 'personal' | 'shared') => hyperOpenBotRequest<{ preview: HyperModePreview }>(`${hyperServerPath(id)}/account-mode`, 'PUT', { mode, confirm: false });
export const hyperCommitMode = (id: string, preview: HyperModePreview) => hyperOpenBotRequest(`${hyperServerPath(id)}/account-mode`, 'PUT', { mode: preview.mode, confirm: true, approvals: Object.fromEntries(preview.bots.map(b => [b.botId, b.exposure])) });
export const hyperOwnerGrants = (id: string, ownerGrants: 'any' | 'admin') => hyperOpenBotRequest(`${hyperServerPath(id)}/owner-grants`, 'PUT', { ownerGrants });
export const hyperLoadAccounts = (id: string) => hyperOpenBotRequest<{ accounts: HyperAccount[]; canAddAnother: boolean }>(`${hyperServerPath(id)}/accounts`);
export const hyperAccountDefault = (id: string, account: string) => hyperOpenBotRequest(`${hyperServerPath(id)}/accounts/${encodeURIComponent(account)}/default`, 'POST');
export const hyperDisconnectAccount = (id: string, account: string) => hyperOpenBotRequest(`${hyperServerPath(id)}/accounts/${encodeURIComponent(account)}`, 'DELETE');
export const hyperConnectionSiblings = (id: string) => hyperOpenBotRequest<{ siblings: string[]; unanswered: number }>(`${hyperServerPath(id)}/connection/siblings`);
export const hyperConfirmConnection = (id: string) => hyperOpenBotRequest<{ connected: boolean }>(`${hyperServerPath(id)}/connection/confirm`, 'POST');
export async function hyperConnectFields(id: string, values: Record<string, string>) {
  try { return await hyperOpenBotRequest<{ connected: boolean; verified: boolean; probe: string | null }>(`${hyperServerPath(id)}/connect`, 'POST', { values }); }
  finally { for (const key of Object.keys(values)) delete values[key]; }
}
export async function hyperRegisterOAuth(id: string, clientId: string, clientSecret: string) {
  try { return await hyperOpenBotRequest(`${hyperServerPath(id)}/oauth-client`, 'POST', { clientId, clientSecret }); }
  finally { clientSecret = ''; }
}
/** Recognizes upstream native destinations without retaining query credentials or callback data. */
export function hyperConnectionSelectionFromPath(path: string): HyperConnectionSelection | undefined {
  const pathname = path.split(/[?#]/)[0] ?? '';
  const match = /^\/(?:admin\/plugins|connections)(?:\/(.*))?$/.exec(pathname);
  if (!match) return undefined;
  const tail = match[1] ?? '';
  if (!tail) return { page: 'list' };
  if (tail === 'new') return { page: 'new' };
  if (/^(?:browse\/)?(arcade|composio)$/.test(tail)) return { page: 'browse', provider: tail.endsWith('arcade') ? 'arcade' : 'composio' };
  try {
    const [key, kind, value, extra] = tail.split('/').map(decodeURIComponent);
    if (!key || extra !== undefined) return undefined;
    if (!kind) return { page: 'app', key };
    if (kind === 'tools' && value) return { page: 'tool', key, tool: value };
    if (kind === 'bots' && value) return { page: 'bot', key, agentId: value };
  } catch { return undefined; }
  return undefined;
}
