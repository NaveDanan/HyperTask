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
