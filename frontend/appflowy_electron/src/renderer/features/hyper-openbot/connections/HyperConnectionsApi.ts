// Adapted from CopilotKit OpenBot, MIT. See REUSE.md and ../LICENSE.
import { hyperOpenBotRequest } from '../transport';

export interface HyperConnection {
  serverId: string; holder?: 'person' | 'deployment'; connected?: boolean;
  revoked?: boolean; verified?: boolean; checkable?: boolean; scope: string;
  connectedAt: string; displayName?: string | null;
}
export interface HyperConnectionApp {
  key: string; title: string; summary: string; docsUrl?: string;
  auth: 'none' | 'deployment-bearer' | 'user-oauth' | 'builtin';
}
export interface HyperConnectionServer {
  id: string; title: string; summary: string; url: string; docsUrl?: string;
  lastError?: string | null; signIn?: boolean; dynamicClient?: boolean;
  hasCredential?: boolean; authScheme?: string | null; accountMode?: 'personal' | 'shared' | null;
  sharedOnly?: boolean; sharedVendorConnected?: boolean;
  tools: { name: string; description: string; effect?: string }[];
}
export interface HyperConnectionDirectory {
  servers: HyperConnectionServer[]; catalogue: HyperConnectionApp[];
}
export interface HyperConnectionRow {
  key: string; title: string; summary: string; server?: HyperConnectionServer;
  app?: HyperConnectionApp; connections: HyperConnection[]; state: string;
}
export function hyperConnectionRows(directory: HyperConnectionDirectory, connections: HyperConnection[]): HyperConnectionRow[] {
  const keys = new Set([...directory.servers.map(s => s.id), ...directory.catalogue.map(a => a.key), ...connections.map(c => c.serverId)]);
  return [...keys].map(key => {
    const server = directory.servers.find(s => s.id === key);
    const app = directory.catalogue.find(a => a.key === key);
    const own = connections.filter(c => c.serverId === key && c.holder !== 'deployment');
    const shared = connections.filter(c => c.serverId === key && c.holder === 'deployment');
    const noAccount = server?.authScheme === 'NO_AUTH' || app?.auth === 'none' || app?.auth === 'builtin';
    const state = !server ? (own.length ? 'Server unavailable' : 'Available')
      : server.accountMode === 'shared' ? (server.sharedVendorConnected || shared.some(c => c.connected) ? 'Team account connected' : 'Team account not connected')
      : own.some(c => !c.revoked) ? (own.some(c => !c.revoked && c.verified === false) ? 'Connection needs checking' : 'Connected')
      : own.length ? 'Reconnect required' : noAccount ? 'On' : 'Not connected';
    return { key, title: server?.title ?? app?.title ?? key, summary: server?.summary ?? app?.summary ?? '', server, app, connections: [...own, ...shared], state };
  }).sort((a, b) => a.title.localeCompare(b.title));
}
export async function hyperLoadConnections() {
  const [directory, result] = await Promise.all([
    hyperOpenBotRequest<HyperConnectionDirectory>('/api/plugins'),
    hyperOpenBotRequest<{ connections: HyperConnection[] }>('/api/plugins/connections'),
  ]);
  return hyperConnectionRows(directory, result.connections);
}
export function hyperServerPath(id: string) { return `/api/plugins/servers/${encodeURIComponent(id)}`; }
export function hyperAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The service returned an unsupported sign-in address.');
  return url.href;
}
export async function hyperStartConnection(id: string) {
  return hyperOpenBotRequest<{ authorizationUrl?: string; connected?: boolean; fields?: unknown[] }>(`${hyperServerPath(id)}/connect?returnTo=settings&from=desktop`, 'POST');
}
export async function hyperAddConnectionServer(title: string, address: string) {
  const url = new URL(address);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !title.trim()) throw new Error('Enter a name and an HTTP or HTTPS server address without credentials.');
  return hyperOpenBotRequest<{ server: HyperConnectionServer; signIn: boolean }>('/api/plugins/servers/by-url', 'POST', { title: title.trim(), url: url.href });
}
