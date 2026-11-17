import { HYPER_BOTS_TOOLS, type HyperBotsToolName } from '@shared/HyperBots';
export type HyperBotToolProvider = 'outlook' | 'jira';
export function hyperBotToolProvider(tool: string): HyperBotToolProvider | null {
  const group = Object.hasOwn(HYPER_BOTS_TOOLS, tool) ? HYPER_BOTS_TOOLS[tool as HyperBotsToolName].group : undefined;
  return group?.startsWith('outlook-') ? 'outlook' : group === 'jira' ? 'jira' : null;
}
