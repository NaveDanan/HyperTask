import { HyperAdminDestinationGate } from './admin-governance/HyperAdminDestinationGate';
import type { HyperInitialDraft } from './conversations/HyperInitialDraftTransfer';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

export interface HyperOpenBotSectionContext {
  /** Open an existing conversation by channel ID. */
  openConversation(channelId: string): void;
  /** Start a new conversation with one or more Bots. */
  initialDraftSupported?: boolean;
  startConversation(agentIds: string[], initialDraft?: HyperInitialDraft): Promise<void>;
  navigate?(destinationId: string, intent?: { path: string }): void;
  initialAgentIds?: readonly string[];
  navigationIntent?: { path: string };
}
export interface HyperOpenBotSection {
  readonly id: string;
  readonly label: string;
  readonly group: 'work' | 'bots' | 'personal' | 'admin';
  render(context: HyperOpenBotSectionContext): ReactNode;
}

/** Lazily load an area module whose default export renders the section. Call once per slot entry. */
export function hyperLazySection(load: () => Promise<{ default: ComponentType<{ context: HyperOpenBotSectionContext; path?: string }> }>) {
  const Section = lazy(load);
  return (context: HyperOpenBotSectionContext) => <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}><Section key={context.navigationIntent?.path} context={context} path={context.navigationIntent?.path} /></Suspense>;
}

function hyperLazyAdminSection(load: Parameters<typeof hyperLazySection>[0]) {
  const render=hyperLazySection(load);
  return (context:HyperOpenBotSectionContext)=><HyperAdminDestinationGate path={context.navigationIntent?.path} navigate={context.navigate}>{render(context)}</HyperAdminDestinationGate>;
}

/** Parity sections added beside Conversations, Bots, Skills and Connections. Each area owns its slot. */
export const HYPER_OPENBOT_SECTIONS: readonly HyperOpenBotSection[] = [
  // slot: conversations
  { id: 'new-conversation', label: 'New conversation', group: 'work', render: hyperLazySection(() => import('./conversations/HyperNewConversationSection')) },
  // slot: routines
  { id: 'routines', label: 'Routines', group: 'work', render: hyperLazySection(() => import('./routines/HyperRoutinesSection')) },
  { id: 'responsibilities', label: 'Responsibilities', group: 'work', render: hyperLazySection(() => import('./routines/HyperResponsibilitiesSection')) },
  // slot: memory
  { id: 'memory', label: 'Memory', group: 'personal', render: hyperLazySection(() => import('./memory/HyperMemorySection')) },
  { id: 'personal-learning', label: 'Your learned skills', group: 'personal', render: hyperLazySection(() => import('./memory/HyperPersonalLearningSection')) },
  { id: 'learning', label: 'Learning', group: 'admin', render: hyperLazyAdminSection(() => import('./memory/HyperLearningSection')) },
  // slot: bot-tabs
  { id: 'bot', label: 'Bot', group: 'bots', render: hyperLazySection(() => import('./bot-tabs/HyperBotSection')) },
  { id: 'needs-you', label: 'Needs you', group: 'work', render: hyperLazySection(() => import('./bot-tabs/HyperBotAttentionBoard')) },
  { id: 'external-agents', label: 'External agents', group: 'bots', render: hyperLazySection(() => import('./bot-tabs/HyperExternalAgents')) },
  { id: 'reachability', label: 'Reaching you', group: 'personal', render: hyperLazySection(() => import('./bot-tabs/HyperReachability')) },
  // slot: approvals-inbox
  { id: 'approvals', label: 'Approvals', group: 'personal', render: hyperLazySection(() => import('./approvals-inbox/HyperApprovalsSection')) },
  // slot: vault
  { id: 'vault', label: 'Vault', group: 'personal', render: hyperLazySection(() => import('./vault/HyperVaultSection')) },
  // slot: computer-browser
  { id: 'browser', label: 'Browser', group: 'personal', render: hyperLazySection(() => import('./computer-browser/HyperBrowserSection')) },
  { id: 'connected-browsers', label: 'Connected browsers', group: 'personal', render: hyperLazySection(() => import('./computer-browser/HyperBrowsersSection')) },
  { id: 'computer', label: 'Computer', group: 'personal', render: hyperLazySection(() => import('./computer-browser/HyperComputerSettings')) },
  { id: 'bot-computer', label: 'Bot computer', group: 'bots', render: hyperLazySection(() => import('./computer-browser/HyperComputerDestination')) },
  // slot: screens
  { id: 'screens', label: 'Screens', group: 'personal', render: hyperLazySection(() => import('./screens-gen/HyperScreensDestination')) },
  { id: 'components-gallery', label: 'Components gallery', group: 'personal', render: hyperLazySection(() => import('./screens-gen/HyperGallerySection')) },
  { id: 'components-admin', label: 'UI components', group: 'admin', render: hyperLazyAdminSection(() => import('./screens-gen/HyperAdminComponentsSection')) },
  { id: 'components-playground', label: 'Component playground', group: 'admin', render: hyperLazyAdminSection(() => import('./screens-gen/HyperPlaygroundSection')) },
  // slot: settings
  { id: 'settings', label: 'Settings', group: 'personal', render: hyperLazySection(() => import('./settings/HyperSettingsSection')) },
  // slot: admin-governance
  { id: 'admin-governance', label: 'Admin', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-governance/HyperGovernanceSection')) },
  // slot: admin-platform
  { id: 'admin-providers', label: 'Providers', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperProvidersSection')) },
  { id: 'admin-credentials', label: 'Credentials', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperCredentialsSection')) },
  { id: 'admin-plugins', label: 'Plugins', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperPluginsSection')) },
  { id: 'admin-skills', label: 'Skills', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperSkillsSection')) },
  { id: 'admin-proactive', label: 'Routines', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperProactiveSection')) },
  { id: 'admin-playground', label: 'Playground', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperPlaygroundSection')) },
  { id: 'admin-computers', label: 'Computers', group: 'admin', render: hyperLazyAdminSection(() => import('./admin-platform/HyperComputersSection')) },
  // slot: onboarding
  { id: 'home', label: 'Home', group: 'work', render: hyperLazySection(() => import('./onboarding/HyperHomeSection')) },
  { id: 'setup', label: 'Setup', group: 'personal', render: hyperLazySection(() => import('./onboarding/HyperSetupSection')) },
];
