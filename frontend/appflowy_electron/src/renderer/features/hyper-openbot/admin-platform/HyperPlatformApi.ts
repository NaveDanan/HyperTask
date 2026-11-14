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
