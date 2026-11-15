import * as React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import HyperPluginsSection from './HyperPluginsSection';
import * as api from './HyperPlatformApi';
import { hyperOpenBotRequest } from '../transport';
import { hyperOpenBotPathAllowed } from '@shared/hyper-openbot-policy';
import { hyperMcpListedAddress, hyperMcpWithdrawServer } from './HyperMcpAllowlistPolicy';

vi.stubGlobal('React', React);
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('../connections/HyperNativeConnections', () => ({ default: () => null }));

function find(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, match); if (result) return result; } }
  else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    return match(element) ? element : find(element.props.children as ReactNode, match);
  }
}
const context = { openConversation: vi.fn(), startConversation: vi.fn(), navigate: vi.fn(), isCurrentNavigation: () => true };
beforeEach(() => vi.mocked(hyperOpenBotRequest).mockReset());

it('mounts the MCP policy workflow beside the existing admin connections list', () => {
  const tree = HyperPluginsSection({ context, path: '/admin/plugins' });
  expect(find(tree, element => typeof element.type === 'function' && element.type.name === 'HyperMcpAllowlistSection')).toBeDefined();
});

it('reads the pinned enterprise approval policy and server roster through the actual adapter', async () => {
  const load = (api as Record<string, unknown>).hyperLoadMcpAllowlist as () => Promise<unknown>;
  expect(load).toBeTypeOf('function');
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ settings: { mcpAllowlist: { enabled: true, servers: ['opaque:id'] } }, mcpServers: [] });
  await expect(load()).resolves.toEqual({ settings: { mcpAllowlist: { enabled: true, servers: ['opaque:id'] } }, mcpServers: [] });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/enterprise');
});

it('writes only the pinned mcpAllowlist setting envelope', async () => {
  const save = (api as Record<string, unknown>).hyperSaveMcpAllowlist as (value: unknown) => Promise<unknown>;
  expect(save).toBeTypeOf('function');
  const value = { enabled: false, servers: ['opaque:id', 'https://example.test/mcp'] };
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ key: 'mcpAllowlist', value });
  await save(value);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/enterprise/settings/mcpAllowlist', 'PUT', { value });
});

it('uses paths already reachable through the current native policy without widening it', () => {
  for (const path of ['/api/me', '/api/capabilities', '/api/admin/enterprise', '/api/admin/enterprise/settings/mcpAllowlist']) expect(hyperOpenBotPathAllowed(path), path).toBe(true);
});

it.each([undefined, {}, { settings: { mcpAllowlist: { enabled: true, servers: [] } } },
  { settings: { mcpAllowlist: { enabled: 'true', servers: [] } }, mcpServers: [] },
  { settings: { mcpAllowlist: { enabled: true, servers: [] } }, mcpServers: [{ id: 'one', title: 'One' }] },
  { settings: { mcpAllowlist: { enabled: true, servers: [] } }, mcpServers: [{ id: 'one', title: 'One', url: '' }, { id: 'one', title: 'Duplicate', url: '' }] },
])('rejects malformed or ambiguous policy/roster responses: %j', async value => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce(value);
  await expect(api.hyperLoadMcpAllowlist()).rejects.toThrow('MCP settings could not be read.');
});

it('projects unrelated enterprise and header fields out of the response', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ settings: { mcpAllowlist: { enabled: false, servers: ['opaque:id'], extra: 'synthetic-secret' }, other: 'synthetic-secret' }, mcpServers: [{ id: 'id', title: 'Server', url: 'https://server.test/mcp', headers: { Authorization: 'synthetic-secret' } }], credentials: 'synthetic-secret' });
  expect(await api.hyperLoadMcpAllowlist()).toEqual({ settings: { mcpAllowlist: { enabled: false, servers: ['opaque:id'] } }, mcpServers: [{ id: 'id', title: 'Server', url: 'https://server.test/mcp' }] });
});

it.each([{ enabled: true, servers: [''] }, { enabled: true, servers: [' id '] }, { enabled: true, servers: ['x'.repeat(201)] }, { enabled: true, servers: Array.from({ length: 501 }, () => 'id') }, { enabled: 'true', servers: [] }])('validates pinned setting bounds before transport: %j', async value => {
  await expect(api.hyperSaveMcpAllowlist(value as api.HyperMcpAllowlist)).rejects.toThrow(); expect(hyperOpenBotRequest).not.toHaveBeenCalled();
});

it.each([undefined, { key: 'other', value: { enabled: true, servers: [] } }, { key: 'mcpAllowlist', value: { enabled: false, servers: [] } }])('requires the exact server save acknowledgment: %j', async value => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce(value);
  await expect(api.hyperSaveMcpAllowlist({ enabled: true, servers: [] })).rejects.toThrow('The server did not confirm');
});

it('propagates a refused write and never issues a second mutation', async () => {
  vi.mocked(hyperOpenBotRequest).mockRejectedValueOnce(new Error('synthetic refusal'));
  await expect(api.hyperSaveMcpAllowlist({ enabled: true, servers: [] })).rejects.toThrow('synthetic refusal'); expect(hyperOpenBotRequest).toHaveBeenCalledTimes(1);
});

it('matches the pinned address normalization while refusing unsupported protocols', () => {
  expect(hyperMcpListedAddress(' HTTPS://user:synthetic@EXAMPLE.test:443/mcp///?token=synthetic#fragment ')).toBe('https://example.test/mcp');
  for (const value of ['server:id', 'file:///tmp/mcp', 'ftp://example.test/mcp']) expect(hyperMcpListedAddress(value)).toBeNull();
});

it('does not synthesize a missing selected server into the roster', () => {
  expect(() => hyperMcpWithdrawServer({ settings: { mcpAllowlist: { enabled: true, servers: ['id'] } }, mcpServers: [] }, 'id')).toThrow('no longer listed');
});
