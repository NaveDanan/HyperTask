import type { ReactNode } from 'react';

export interface HyperOpenBotSectionContext {
  /** Open an existing conversation by channel ID. */
  openConversation(channelId: string): void;
  /** Start a new conversation with one or more Bots. */
  startConversation(agentIds: string[]): void;
}
export interface HyperOpenBotSection {
  readonly id: string;
  readonly label: string;
  readonly group: 'work' | 'bots' | 'personal' | 'admin';
  render(context: HyperOpenBotSectionContext): ReactNode;
}

/** Parity sections added beside Conversations, Bots, Skills and Connections. Each area owns its slot. */
export const HYPER_OPENBOT_SECTIONS: readonly HyperOpenBotSection[] = [
  // slot: groups
  /* groups */
  // slot: routines
  /* routines */
  // slot: memory
  /* memory */
  // slot: bot-tabs
  /* bot-tabs */
  // slot: approvals-inbox
  /* approvals-inbox */
  // slot: vault
  /* vault */
  // slot: computer-browser
  /* computer-browser */
  // slot: screens
  /* screens */
  // slot: settings
  /* settings */
  // slot: admin-governance
  /* admin-governance */
  // slot: admin-platform
  /* admin-platform */
  // slot: onboarding
  /* onboarding */
];
