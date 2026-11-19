import { lazy, Suspense, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Globe, Mail, Mic, Plug, Server, ShieldCheck, Sparkles, SquareCheckBig } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsGroup, SettingsPageHeader, SettingsSection } from '@/components/app/settings-layout';
import { HyperEntraSettings } from '@/features/hyper-entra/HyperEntraSettings';
import { HyperServiceStatus, useHyperOpenBotService } from '@/features/hyper-openbot/HyperServiceStatus';
import { VoiceSettingsPanel } from '@/features/hyper-voice/settings/VoiceSettingsPanel';
import { AIPage } from '../ai/AIPage';
import { SelfHostedSettingsView } from '../SelfHostedSettingsView';
import { HyperJiraSettingsPage, useHyperJiraConnection } from '../jira/HyperJiraSettingsPage';
import type { SettingsPageProps } from '../page-props';
import { SettingsPage, settingsDialogActions, useSettingsDialogStore, type HyperConnectionPage } from '../settings-dialog-store';
import { HyperOutlookSettings, useHyperOutlookConnection } from './HyperOutlookSettings';

const HyperOpenBotApps = lazy(() => import('@/features/hyper-openbot/connections/HyperConnectionsPanel')
  .then(module => ({ default: module.HyperConnectionsPanel })));
const HyperConnectedBrowsers = lazy(() => import('@/features/hyper-openbot/computer-browser/HyperBrowsersSection'));

const connections = {
  outlook: { title: 'Microsoft Outlook', icon: Mail, description: 'Calendar and mail from classic Outlook.' },
  jira: { title: 'Jira', icon: SquareCheckBig, description: 'Sync a project and mirror issues to Hyper-Kanban.' },
  ai: { title: 'AI endpoint', icon: Sparkles, description: 'OpenAI-compatible API, credentials, and models.' },
  entra: { title: 'Microsoft Entra ID', icon: ShieldCheck, description: 'Set up company sign-in.' },
  openbot: { title: 'OpenBot apps', icon: Plug, description: 'Manage accounts and app access for Bots.' },
  browsers: { title: 'Connected browsers', icon: Globe, description: 'View and disconnect browsers paired with OpenBot.' },
  voice: { title: 'Voice providers', icon: Mic, description: 'Choose a transcription provider and manage its API key.' },
  server: { title: 'Storage & server', icon: Server, description: 'Choose local storage or connect a collaboration server.' },
} satisfies Record<HyperConnectionPage, { title: string; icon: typeof Plug; description: string }>;

function ConnectionRow({ id, status }: { id: HyperConnectionPage; status?: string }) {
  const { title, icon: Icon, description } = connections[id];
  return <Button type="button" variant="ghost" className="h-auto w-full justify-start gap-3 whitespace-normal rounded-none px-3 py-2 text-left first:rounded-t-lg last:rounded-b-lg sm:px-4"
    onClick={() => settingsDialogActions.setSelectedPage(`connections/${id}`)}>
    <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-foreground">{title}</span>
      <span className="block text-xs font-normal leading-relaxed text-muted-foreground">{description}</span>
      {status && <span role="status" className="mt-1 block break-words text-xs font-medium">{status}</span>}
    </span>
    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
  </Button>;
}

function ConnectionsOverview({ userId }: { userId: string }) {
  const outlook = useHyperOutlookConnection();
  const jira = useHyperJiraConnection(userId);
  const account = outlook.status?.email || outlook.status?.userName;
  return <>
    <SettingsPageHeader title="Connections" description="Manage the services and accounts HyperTask uses." />
    <SettingsSection><SettingsGroup>
      <ConnectionRow id="outlook" status={outlook.status?.available && account ? `${outlook.label} · ${account}` : outlook.label} />
      <ConnectionRow id="jira" status={jira.config?.projectKey ? `${jira.label} · ${jira.config.projectKey}` : jira.label} />
      <ConnectionRow id="openbot" />
      <ConnectionRow id="browsers" />
      <ConnectionRow id="ai" />
      <ConnectionRow id="voice" />
      <ConnectionRow id="entra" />
      <ConnectionRow id="server" />
    </SettingsGroup></SettingsSection>
  </>;
}

function OpenBotConnection({ title, children }: { title: string; children: ReactNode }) {
  const service = useHyperOpenBotService();
  return service.state.ready ? <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading connection settings…</p>}>{children}</Suspense>
    : <><SettingsPageHeader title={title} /><HyperServiceStatus {...service} /></>;
}

function ConnectionDetails({ id, props }: { id: HyperConnectionPage; props: SettingsPageProps }) {
  switch (id) {
    case 'outlook': return <HyperOutlookSettings />;
    case 'jira': return <HyperJiraSettingsPage userId={String(props.user.id)} />;
    case 'ai': return <AIPage key={props.workspace?.workspaceId ?? ''} {...props} />;
    case 'entra': return <HyperEntraSettings />;
    case 'openbot': return <OpenBotConnection title={connections.openbot.title}><HyperOpenBotApps embedded /></OpenBotConnection>;
    case 'browsers': return <OpenBotConnection title={connections.browsers.title}><HyperConnectedBrowsers embedded /></OpenBotConnection>;
    case 'voice': return <>
      <SettingsPageHeader title="Voice providers" />
      <VoiceSettingsPanel connectionsOnly />
    </>;
    case 'server': return <SelfHostedSettingsView restartApp={props.restartApp} showCompanySignIn={false} />;
  }
}

export function HyperConnectionsPage(props: SettingsPageProps) {
  const connection = useSettingsDialogStore(state => state.connection);
  if (!connection) return <ConnectionsOverview userId={String(props.user.id)} />;
  return <>
    <Button type="button" size="sm" variant="ghost" className="mb-4 -ml-2" onClick={() => settingsDialogActions.setSelectedPage(SettingsPage.connections)}>
      <ArrowLeft className="rtl:rotate-180" />All connections
    </Button>
    <ConnectionDetails key={connection} id={connection} props={props} />
  </>;
}
