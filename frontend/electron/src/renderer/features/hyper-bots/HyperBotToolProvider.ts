import { HYPER_BOTS_TOOLS, type HyperBotsToolName } from '@shared/HyperBots';
export type HyperBotToolProvider = 'outlook' | 'jira' | 'hypertask' | 'newsletter';
export function hyperBotToolProvider(tool: string): HyperBotToolProvider | null {
  const group = Object.hasOwn(HYPER_BOTS_TOOLS, tool) ? HYPER_BOTS_TOOLS[tool as HyperBotsToolName].group : undefined;
  if (group?.startsWith('outlook-')) return 'outlook';
  if (group === 'hypertask-projects') return 'hypertask';
  return group === 'jira' || group === 'newsletter' ? group : null;
}
