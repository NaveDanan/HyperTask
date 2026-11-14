import { HyperBotMemoryTab } from '../memory';
import { HyperBotComputerTab } from '../computer-browser/HyperBotComputerTab';
import type { ComponentType } from 'react';
export interface HyperBotExtraTab {
  id: 'memory' | 'routines' | 'responsibilities' | 'computer';
  label: string;
  component: ComponentType<{ agentId: string }>;
}
/** Integration slots populated by the corresponding area owners. */
export const HYPER_BOT_EXTRA_TABS: readonly HyperBotExtraTab[] = [
  // slot: memory
  { id: 'memory', label: 'Memory', component: HyperBotMemoryTab },
  // slot: routines
  /* routines */
  // slot: responsibilities
  /* responsibilities */
  // slot: computer
  { id: 'computer', label: 'Computer', component: HyperBotComputerTab },
];
