// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest } from '../transport';
export interface HyperCredential { id: string; kind: string; provider: string; keyId: string; revokedAt: string | null }
export interface HyperCredentialDraft { kind: 'model' | 'connector'; provider: string; keyId: string; plaintext: string }
export interface HyperCredentials { credentials: HyperCredential[]; modelKey?: { provider: string; keyId: string } }
export const hyperLoadCredentials = () => hyperOpenBotRequest<HyperCredentials>('/api/admin/credentials');
export function hyperCreateCredential(draft: HyperCredentialDraft) {
  if (!draft.provider.trim() || !draft.plaintext || (draft.kind === 'connector' && !draft.keyId.trim())) throw new Error('Provider, secret and connector key ID are required.');
  return hyperOpenBotRequest('/api/admin/credentials', 'POST', {
    kind: draft.kind, provider: draft.provider.trim(), plaintext: draft.plaintext, metadata: {},
    ...(draft.kind === 'connector' ? { keyId: draft.keyId.trim() } : {}),
  });
}
export const hyperRevokeCredential = (id: string) => hyperOpenBotRequest(`/api/admin/credentials/${encodeURIComponent(id)}/revoke`, 'POST');
export interface HyperModels { provider: string; source: string; exposure: string; default: string; listed: boolean; models: { id: string; label: string; efforts?: string[]; defaultEffort?: string }[] }
export const hyperLoadProvider = () => hyperOpenBotRequest<HyperModels>('/api/models/available');
export interface HyperProviderControls { builtInModel: string | null; settings: { modelAllowlist: { enabled: boolean; models: string[] } } }
export interface HyperModelUsage { summary: { model: string; source: string; runs: number; people: number; refused: number; lastUsedAt: string }[] }
export const hyperLoadProviderControls = () => hyperOpenBotRequest<HyperProviderControls>('/api/admin/enterprise');
export const hyperLoadModelUsage = () => hyperOpenBotRequest<HyperModelUsage>('/api/admin/enterprise/models/usage?days=30');
export function hyperSaveModelAllowlist(value: HyperProviderControls['settings']['modelAllowlist']) {
  if (value.models.some(name => !/^[^\s/]+\/\S+$/.test(name))) throw new Error('Use provider/model names.');
  return hyperOpenBotRequest('/api/admin/enterprise/settings/modelAllowlist', 'PUT', { value });
}

/** Pinned app/lib/enterprise/{queries,mutations} and server/admin/routes.ts. */
export interface HyperMcpAllowlist { enabled: boolean; servers: string[] }
export interface HyperMcpAllowlistOverview {
  settings: { mcpAllowlist: HyperMcpAllowlist };
  mcpServers: { id: string; title: string; url: string }[];
}
export interface HyperMcpAllowlistAccess { user: { id: string; role: string }; edition: 'team' | 'personal' }
function hyperValidMcpAllowlist(value: unknown): value is HyperMcpAllowlist {
  if (!value || typeof value !== 'object') return false;
  const policy = value as HyperMcpAllowlist;
  return typeof policy.enabled === 'boolean' && Array.isArray(policy.servers) && policy.servers.length <= 500 &&
    policy.servers.every(entry => typeof entry === 'string' && entry.length > 0 && entry.length <= 200 && entry === entry.trim());
}
export async function hyperLoadMcpAllowlistAccess(): Promise<HyperMcpAllowlistAccess> {
  const [identity, deployment] = await Promise.all([
    hyperOpenBotRequest<{ user?: { id?: string; role?: string } }>('/api/me'),
    hyperOpenBotRequest<{ edition?: string }>('/api/capabilities'),
  ]);
  const user = identity?.user;
  if (!user || typeof user.id !== 'string' || !user.id.trim() || typeof user.role !== 'string' ||
    !['team', 'personal'].includes(deployment?.edition ?? '')) throw new Error('Administrator access could not be verified.');
  return { user: { id: user.id, role: user.role }, edition: deployment.edition as 'team' | 'personal' };
}
export async function hyperLoadMcpAllowlist(): Promise<HyperMcpAllowlistOverview> {
  const data = await hyperOpenBotRequest<HyperMcpAllowlistOverview>('/api/admin/enterprise');
  if (!hyperValidMcpAllowlist(data?.settings?.mcpAllowlist) || !Array.isArray(data?.mcpServers) ||
    data.mcpServers.some(server => !server || typeof server.id !== 'string' || !server.id || typeof server.title !== 'string' || typeof server.url !== 'string') ||
    new Set(data.mcpServers.map(server => server.id)).size !== data.mcpServers.length) throw new Error('MCP settings could not be read.');
  // Keep only this workflow's fields. Headers and unrelated enterprise settings never enter its UI.
  const { enabled, servers } = data.settings.mcpAllowlist;
  return { settings: { mcpAllowlist: { enabled, servers: [...servers] } }, mcpServers: data.mcpServers.map(({ id, title, url }) => ({ id, title, url })) };
}
export async function hyperSaveMcpAllowlist(value: HyperMcpAllowlist): Promise<void> {
  if (!hyperValidMcpAllowlist(value)) throw new Error('Use at most 500 server approvals of 1 to 200 characters.');
  const submitted = { enabled: value.enabled, servers: [...value.servers] };
  const saved = await hyperOpenBotRequest<{ key: string; value: HyperMcpAllowlist }>('/api/admin/enterprise/settings/mcpAllowlist', 'PUT', { value: submitted });
  if (saved?.key !== 'mcpAllowlist' || !hyperValidMcpAllowlist(saved.value) || saved.value.enabled !== submitted.enabled || JSON.stringify(saved.value.servers) !== JSON.stringify(submitted.servers)) {
    throw new Error('The server did not confirm this MCP setting. Refresh before trying again.');
  }
}
