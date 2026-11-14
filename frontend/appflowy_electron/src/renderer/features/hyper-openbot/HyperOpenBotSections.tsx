import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

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

/** Lazily load an area module whose default export renders the section. Call once per slot entry. */
export function hyperLazySection(load: () => Promise<{ default: ComponentType<{ context: HyperOpenBotSectionContext }> }>) {
  const Section = lazy(load);
  return (context: HyperOpenBotSectionContext) => <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}><Section context={context} /></Suspense>;
}

/** Parity sections added beside Conversations, Bots, Skills and Connections. Each area owns its slot. */
export const HYPER_OPENBOT_SECTIONS: readonly HyperOpenBotSection[] = [
  // slot: conversations
  /* conversations */
  // slot: routines
  /* routines */
  // slot: memory
  /* memory */
  // slot: bot-tabs
  /* bot-tabs */
  // slot: approvals-inbox
  /* approvals-inbox */
  // slot: vault
  { id: 'vault', label: 'Vault', group: 'personal', render: hyperLazySection(() => import('./vault/HyperVaultSection')) },
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
