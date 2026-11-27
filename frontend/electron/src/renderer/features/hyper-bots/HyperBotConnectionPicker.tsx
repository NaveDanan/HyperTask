import { ChevronDown, Plug } from 'lucide-react';
import { HYPER_BOTS_TOOL_CONNECTIONS, type HyperBotsConnections, type HyperBotsToolConnection, type HyperBotsToolName } from '@shared/HyperBots';
import { hyperBotConnectionTools, HYPER_BOT_TOOL_ORDER } from './HyperBotSettings';
import { HyperBotToggle } from './HyperBotTools';

export function HyperBotConnectionPicker({ connections, tools, onChange, disabled }: {
  connections?: HyperBotsConnections; tools: HyperBotsToolName[];
  onChange: (tools: HyperBotsToolName[]) => void; disabled?: boolean;
}) {
  const available = (Object.keys(HYPER_BOTS_TOOL_CONNECTIONS) as HyperBotsToolConnection[]).filter(connection =>
    connection === 'projects' || connections?.[connection]?.ready || hyperBotConnectionTools(connection).some(tool => tools.includes(tool)));
  return <details className="hb-connection-picker group w-full rounded-lg border border-border">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <Plug size={15} aria-hidden="true" />Connections
      <ChevronDown className="ms-auto group-open:rotate-180" size={15} aria-hidden="true" />
    </summary>
    <div className="border-t border-border px-3 pb-2">
      <p className="py-2 text-xs text-muted-foreground">Give this bot access to every tool in a connection.</p>
      {available.map(connection => {
        const { label } = HYPER_BOTS_TOOL_CONNECTIONS[connection];
        const names = hyperBotConnectionTools(connection);
        const count = names.filter(tool => tools.includes(tool)).length;
        const ready = connection === 'projects' || connections?.[connection]?.ready;
        const toggle = (enabled: boolean) => onChange(HYPER_BOT_TOOL_ORDER.filter(tool => names.includes(tool) ? enabled : tools.includes(tool)));
        return <div key={connection} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm">
          <span>{label}
            {!ready && <span className="block text-xs text-muted-foreground">Connection unavailable</span>}
            {count > 0 && count < names.length && <span className="block text-xs text-muted-foreground">{count} of {names.length} tools available to this bot</span>}
          </span>
          <HyperBotToggle label={'Enable ' + label} on={count > 0} disabled={disabled} onChange={toggle} />
        </div>;
      })}
    </div>
  </details>;
}
