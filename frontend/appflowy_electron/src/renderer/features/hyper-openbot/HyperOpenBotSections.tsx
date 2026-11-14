import type { HyperInitialDraft } from './onboarding/HyperHomeApi';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

export interface HyperOpenBotSectionContext {
  /** Open an existing conversation by channel ID. */
  openConversation(channelId: string): void;
  /** Start a new conversation with one or more Bots. */
  initialDraftSupported?: boolean;
  startConversation(agentIds: string[], initialDraft?: HyperInitialDraft): Promise<void>;
  navigate?(destinationId: string): void;
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
  { id: 'new-conversation', label: 'New conversation', group: 'work', render: hyperLazySection(() => import('./conversations/HyperNewConversationSection')) },
  // slot: routines
  /* routines */
  // slot: memory
  /* memory */
  // slot: bot-tabs
  /* bot-tabs */
  // slot: approvals-inbox
  { id: 'approvals', label: 'Approvals', group: 'personal', render: hyperLazySection(() => import('./approvals-inbox/HyperApprovalsSection')) },
  // slot: vault
  { id: 'vault', label: 'Vault', group: 'personal', render: hyperLazySection(() => import('./vault/HyperVaultSection')) },
  // slot: computer-browser
  { id: 'browser', label: 'Browser', group: 'personal', render: hyperLazySection(() => import('./computer-browser/HyperBrowserSection')) },
  { id: 'connected-browsers', label: 'Connected browsers', group: 'personal', render: hyperLazySection(() => import('./computer-browser/HyperBrowsersSection')) },
  { id: 'computer', label: 'Computer', group: 'personal', render: hyperLazySection(() => import('./computer-browser/HyperComputerSettings')) },
  // slot: screens
  /* screens */
  // slot: settings
  { id: 'settings', label: 'Settings', group: 'personal', render: hyperLazySection(() => import('./settings/HyperSettingsSection')) },
  // slot: admin-governance
  { id: 'admin-governance', label: 'Admin', group: 'admin', render: hyperLazySection(() => import('./admin-governance/HyperGovernanceSection')) },
  // slot: admin-platform
  /* admin-platform */
  // slot: onboarding
  { id: 'home', label: 'Home', group: 'work', render: hyperLazySection(() => import('./onboarding/HyperHomeSection')) },
  { id: 'setup', label: 'Setup', group: 'personal', render: hyperLazySection(() => import('./onboarding/HyperSetupSection')) },
];
