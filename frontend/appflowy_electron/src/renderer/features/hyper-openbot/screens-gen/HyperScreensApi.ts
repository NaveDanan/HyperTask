// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { hyperOpenBotRequest as request } from '../transport';
import type { ComponentRecord, DataFunctionSummary, PublishedSandboxed, SandboxedDraftInput, SandboxedRecord } from './HyperScreensTypes';
const path = (name: string) => `/api/components/${encodeURIComponent(name)}`;
export const hyperScreensApi = {
  components: async () => (await request<{components: ComponentRecord[]}>('/api/components')).components ?? [],
  functions: async () => (await request<{functions: DataFunctionSummary[]}>('/api/components/functions')).functions ?? [],
  bots: async () => (await request<{agents: {id: string; name: string}[]}>('/api/agents')).agents ?? [],
  sandboxed: async () => (await request<{components: SandboxedRecord[]}>('/api/sandboxed')).components ?? [],
  published: async () => (await request<{components: PublishedSandboxed[]}>('/api/sandboxed/published')).components ?? [],
  description: (name: string, description: string) => request(`${path(name)}/draft`, 'PUT', {description}),
  publication: (name: string, published: boolean) => request(`${path(name)}/publication`, 'POST', {published}),
  grant: (name: string, agentId: string, granted: boolean) => granted ? request(`${path(name)}/grants`, 'POST', {agentId}) : request(`${path(name)}/grants/${encodeURIComponent(agentId)}`, 'DELETE'),
  functionGrant: (name: string, fn: string, granted: boolean) => granted ? request(`${path(name)}/functions`, 'POST', {function: fn}) : request(`${path(name)}/functions/${encodeURIComponent(fn)}`, 'DELETE'),
  async decision(name: string, agentId: string, functions: readonly string[] = []): Promise<{allowed: boolean; reason?: string}> {
    try { return await request(`${path(name)}/decision`, 'POST', {agentId, functions}); }
    catch { return {allowed: false, reason: 'OpenBot could not check whether this component is allowed.'}; }
  },
  call: (name: string, agentId: string, fn: string, args: Record<string, unknown>) => request(`${path(name)}/call`, 'POST', {agentId, function: fn, args}),
  save: (input: SandboxedDraftInput) => request('/api/sandboxed', 'POST', input),
  async publish(input: SandboxedDraftInput) { await this.save(input); await request(`/api/sandboxed/${encodeURIComponent(`custom_${input.slug}`)}/publish`, 'POST'); },
  delete: (name: string) => request(`/api/sandboxed/${encodeURIComponent(name)}`, 'DELETE'),
};
