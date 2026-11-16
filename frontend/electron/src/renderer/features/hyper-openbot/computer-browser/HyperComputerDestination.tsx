// HyperTask native destination. Upstream source: routes/_authed/bots.$agentId.computer.tsx (MIT, CopilotKit 2026).
import { useSyncExternalStore } from 'react';
import { HyperBotComputerTab } from './HyperBotComputerTab';
let selected: string | undefined;
const listeners = new Set<() => void>();
export function hyperOpenBotComputer(agentId: string, navigate?: (destination: string) => void) {
  selected = agentId; for (const listener of listeners) listener(); navigate?.('bot-computer');
}
export default function HyperComputerDestination({ path }: { path?: string }) {
  const heldAgentId = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => selected, () => undefined);
  const match = path ? /^\/bots\/([^/]+)\/computer(?:[/?#]|$)/.exec(path) : null;
  let agentId = heldAgentId;
  if (match) { try { agentId = decodeURIComponent(match[1]); } catch { agentId = undefined; } }
  return <section className="p-4"><h2 className="text-lg font-semibold">Bot computer</h2>{agentId ? <HyperBotComputerTab key={agentId} agentId={agentId} /> : <p>Open a computer from a Bot or a private sign-in request.</p>}</section>;
}
