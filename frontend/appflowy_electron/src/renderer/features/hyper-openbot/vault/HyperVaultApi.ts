// Adapted from OpenBot, Copyright (c) 2026 CopilotKit. MIT licensed.
import { hyperOpenBotRequest } from '../transport';
export type SignInStatus =
  | "pending"
  | "filling"
  /** The site took the password and sent a verification code; the form asks for only that now. */
  | "code_required"
  | "taken_over"
  | "signed_in"
  | "failed"
  | "cancelled"
  | "expired";

export type SignInRequest = {
  id: string;
  botId: string;
  origin: string;
  reason: string | null;
  status: SignInStatus;
  method: "typed" | "saved" | "takeover" | null;
  /** The last thing that happened, e.g. why a submitted login did not work. */
  outcome: string | null;
  /** The open chat's tool call that asked, so its card can find this request. */
  toolCallId: string | null;
  controlRequestId: string | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  passwordManager: boolean;
  savedLogins: { id: string; username: string }[];
};

export type SavedLogin = {
  id: string;
  origin: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};


export type HyperCredential = { id: string; kind: string; provider: string; keyId: string; revokedAt: string | null };
export type HyperKeys = { credentials: HyperCredential[]; modelKey?: { provider: string; keyId: string } | null };
// Never surface a server error body from a secret-bearing operation.
async function hyperRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try { return await hyperOpenBotRequest<T>(path, method, body); }
  catch { throw new Error('Vault request failed. Access may be refused or the service unavailable. Try again.'); }
}
export const hyperVaultApi = {
  capabilities: () => hyperRequest<{ edition?: string }>('/api/capabilities'),
  logins: () => hyperRequest<{ passwordManager: boolean; logins: SavedLogin[] }>('/api/passwords'),
  removeLogin: (id: string) => hyperRequest('/api/passwords/' + encodeURIComponent(id), 'DELETE'),
  keys: () => hyperRequest<HyperKeys>('/api/admin/credentials'),
  createKey: (body: { kind: 'model' | 'connector'; provider: string; keyId?: string; plaintext: string; metadata: Record<string, unknown> }) => hyperRequest('/api/admin/credentials', 'POST', body),
  revokeKey: (id: string) => hyperRequest('/api/admin/credentials/' + encodeURIComponent(id) + '/revoke', 'POST'),
  pending: async () => (await hyperRequest<{requests: SignInRequest[]}>('/api/sign-in-requests')).requests,
  readSignIn: (id: string) => hyperRequest<SignInRequest>('/api/sign-in-requests/' + encodeURIComponent(id)),
  answerSignIn: (id: string, action: 'submit' | 'code' | 'use-saved' | 'take-over' | 'finish' | 'cancel', body?: unknown) => hyperRequest<SignInRequest>('/api/sign-in-requests/' + encodeURIComponent(id) + '/' + action, 'POST', body),
  requestSignIn: (body: {botId: string; site: string; reason?: string; toolCallId?: string}) => hyperRequest<SignInRequest>('/api/sign-in-requests', 'POST', body),
};
