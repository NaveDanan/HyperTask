// Adapted from OpenBot, MIT Copyright (c) 2026 CopilotKit.
import HyperNativeConnections from '../connections/HyperNativeConnections';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HyperMcpAllowlistSection } from './HyperMcpAllowlistSection';
export default function HyperSection(props: { context: HyperOpenBotSectionContext; path?: string }) {
  const list = !props.path || /^\/admin\/plugins\/?$/.test(props.path);
  return <div className="flex h-full flex-col overflow-y-auto">
    <div className="shrink-0"><HyperNativeConnections admin {...props} /></div>
    {list && <HyperMcpAllowlistSection key={props.path ?? '/admin/plugins'} context={props.context} />}
  </div>;
}
