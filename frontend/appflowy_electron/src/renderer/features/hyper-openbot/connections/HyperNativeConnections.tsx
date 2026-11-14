import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HyperConnectionsPanel } from './HyperConnectionsPanel';
import { hyperConnectionSelectionFromPath, type HyperConnectionSelection } from './HyperPluginDetailsApi';
/** Main calls this only after consuming the external callback credentials. */
export function hyperReceiveConnectionReturn(serverId: string, navigate: NonNullable<HyperOpenBotSectionContext['navigate']>) {
  if (!/^[a-zA-Z0-9_:@.-]{1,200}$/.test(serverId)) return false;
  navigate('connections', { path: `/connections/${encodeURIComponent(serverId)}` });
  return true;
}
export function hyperConnectionSelectionPath(selection: HyperConnectionSelection, admin = false): string {
  const base = admin ? '/admin/plugins' : '/connections';
  const enc = encodeURIComponent;
  switch (selection.page) {
    case 'list': return base;
    case 'new': return `${base}/new`;
    case 'browse': return `${base}/${selection.provider ?? 'arcade'}`;
    case 'app': return `${base}/${enc(selection.key)}`;
    case 'tool': return `${base}/${enc(selection.key)}/tools/${enc(selection.tool)}`;
    case 'bot': return `${base}/${enc(selection.key)}/bots/${enc(selection.agentId)}`;
  }
}
export default function HyperNativeConnections({ context, path, admin = false }: { context: HyperOpenBotSectionContext; path?: string; admin?: boolean }) {
  return <HyperConnectionsPanel admin={admin} selection={path ? hyperConnectionSelectionFromPath(path) : undefined} onSelectionChange={selection => context.navigate?.(admin ? 'admin-plugins' : 'connections', { path: hyperConnectionSelectionPath(selection, admin) })} />;
}
