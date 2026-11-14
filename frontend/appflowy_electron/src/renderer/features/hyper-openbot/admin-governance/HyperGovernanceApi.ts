// Adapted from OpenBot app/src/lib/{people,enterprise,identity-providers,audit,what-if,reviewer-guidance}.
// Copyright (c) 2026 CopilotKit. MIT licensed. HyperTask developed by NaveDanan.
import { hyperOpenBotRequest } from '../transport';
import { hyperValidateGovernanceResponse } from './HyperGovernanceContracts';
export async function hyperGovernanceRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const value = await hyperOpenBotRequest<T>(path, method, body);
  hyperValidateGovernanceResponse(path, method, value);
  return value;
}
export interface HyperPerson {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  providers: string[];
  revoked: boolean;
  configuredAdmin: boolean;
  lastSignedInAt: string | null;
}
export interface HyperPolicy {
  mode: 'dry-run' | 'enforce';
  deny: string[];
  allow: string[];
  labels?: Record<string, {
    name: string;
    description: string;
  }>;
}
export interface HyperCapability {
  capability: string;
  title: string;
  description: string;
  default: boolean;
  organization: boolean | null;
  roles: Record<string, boolean>;
  groups: Record<string, boolean>;
}
export interface HyperEnterprise {
  capabilities: HyperCapability[];
  groups: string[];
  settings: Record<string, unknown>;
}
export interface HyperProvider {
  providerId: string;
  issuer: string;
  domain: string;
  protocol: string;
  registeredBy: string | null;
}
export const hyperPeople = (search = '', cursor = '') => {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (cursor) params.set('cursor', cursor);
  return hyperOpenBotRequest<{
    people: HyperPerson[];
    nextCursor: string | null;
  }>('/api/admin/people' + (params.size ? `?${params}` : ''));
};
export const hyperSetPersonRole = (id: string, role: 'admin' | 'user') => hyperOpenBotRequest(`/api/admin/people/${encodeURIComponent(id)}/role`, 'POST', {
  role
});
export const hyperSetPersonAccess = (id: string, revoked: boolean) => hyperOpenBotRequest(`/api/admin/people/${encodeURIComponent(id)}/access`, 'POST', {
  revoked
});
export function hyperProviderBody(input: Record<string, string>) {
  const {
    providerId,
    issuer,
    domain
  } = input;
  return {
    providerId,
    issuer,
    domain,
    ...(input.protocol === 'saml' ? {
      samlConfig: {
        entryPoint: input.entryPoint,
        idpMetadata: {
          metadata: input.metadata
        }
      }
    } : {
      oidcConfig: {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        discoveryEndpoint: `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
      }
    })
  };
}
export function hyperAuditExportPath(search: string) {
  const params = new URLSearchParams(search);
  params.delete('cursor');
  params.delete('limit');
  params.set('format', 'csv');
  return `/api/admin/audit-events?${params}`;
}
