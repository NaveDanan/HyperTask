// Adapted from OpenBot f8af37a, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE.
// app/components/admin/controls/mcp-allowlist-section.tsx; server/admin/controls.ts.
import type { HyperMcpAllowlistOverview } from './HyperPlatformApi';

/** Match the pinned server. Query, fragment and userinfo never form part of an address approval. */
export function hyperMcpListedAddress(entry: string): string | null {
  try {
    const url = new URL(entry.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}
/** Show only the host. Paths, userinfo, queries and opaque IDs can contain secrets. */
export function hyperMcpAddressLabel(entry: string): string {
  const address = hyperMcpListedAddress(entry);
  return address === null ? 'Saved server approval' : new URL(address).host;
}
export function hyperMcpServerApproved(data: HyperMcpAllowlistOverview, server: HyperMcpAllowlistOverview['mcpServers'][number]): boolean {
  const address = hyperMcpListedAddress(server.url);
  return data.settings.mcpAllowlist.servers.some(entry => entry === server.id || (address !== null && hyperMcpListedAddress(entry) === address));
}
/** An unparseable server URL must never match all the other opaque ID approvals. */
export function hyperMcpWithdrawServer(data: HyperMcpAllowlistOverview, id: string): string[] {
  const server = data.mcpServers.find(row => row.id === id);
  if (!server) throw new Error('This server is no longer listed. Refresh these settings.');
  const address = hyperMcpListedAddress(server.url);
  return data.settings.mcpAllowlist.servers.filter(entry => entry !== id && (address === null || hyperMcpListedAddress(entry) !== address));
}
