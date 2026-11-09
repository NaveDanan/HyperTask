import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventGetUserProfile } from '@/backend/events';
import { Bell, CreditCard, Database, Flag, Gem, Globe, Keyboard, LayoutDashboard, Server, ShieldCheck, Sparkles, UserRound, Users, X } from 'lucide-react';
import { NavItem } from '@/components/app/nav';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTr } from '@/i18n';
import { runAppFlowy } from '@/startup/launcher';
import { closeAllDialogs, showDialog } from '@/ui';
import { loseFocus, openSettings } from '@/features/home/notifiers';
import { AccountPage } from './account/AccountPage';
import { passwordActions } from './account/password-store';
import { AIPage } from './ai/AIPage';
import { CertificatesPage } from './certificates/CertificatesPage';
import { ManageDataPage } from './manage-data/ManageDataPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import type { SettingsPageProps } from './page-props';
import { FeatureFlagsPage } from './pages/FeatureFlagsPage';
import { MembersPage } from './pages/MembersPage';
import { SitesPage } from './pages/SitesPage';
import { SelfHostedSettingsView } from './SelfHostedSettingsView';
import {
  SettingsPage,
  isDebugBuild,
  isSettingsPage,
  settingsDialogActions,
  useSettingsDialogStore,
  visibleSettingsPages,
  workspaceRole,
} from './settings-dialog-store';
import { fetchWorkspaces, startSettingsWorkspace, useSettingsWorkspaceStore } from './settings-workspace-store';
import { ShortcutsPage } from './shortcuts/ShortcutsPage';
import { WorkspacePage } from './workspace/WorkspacePage';

const MENU: Record<SettingsPage, { label: (tr: (key: string) => string) => string; icon: () => ReactNode }> = {
  [SettingsPage.account]: { label: (tr) => tr('settings.accountPage.menuLabel'), icon: () => <UserRound className="size-4" /> },
  [SettingsPage.workspace]: { label: (tr) => tr('settings.workspacePage.menuLabel'), icon: () => <LayoutDashboard className="size-4" /> },
  [SettingsPage.member]: { label: (tr) => tr('settings.appearance.members.label'), icon: () => <Users className="size-4" /> },
  [SettingsPage.manageData]: { label: (tr) => tr('settings.manageDataPage.menuLabel'), icon: () => <Database className="size-4" /> },
  [SettingsPage.notifications]: { label: (tr) => tr('settings.menu.notifications'), icon: () => <Bell className="size-4" /> },
  // [CUSTOM] hard-coded English labels.
  [SettingsPage.cloud]: { label: () => 'Storage & server', icon: () => <Server className="size-4" /> },
  [SettingsPage.companyCertificates]: { label: () => 'Certificates', icon: () => <ShieldCheck className="size-4" /> },
  [SettingsPage.shortcuts]: { label: (tr) => tr('settings.shortcutsPage.menuLabel'), icon: () => <Keyboard className="size-4" /> },
  [SettingsPage.ai]: { label: (tr) => tr('settings.aiPage.menuLabel'), icon: () => <Sparkles className="size-4" /> },
  [SettingsPage.sites]: { label: (tr) => tr('settings.sites.title'), icon: () => <Globe className="size-4" /> },
  [SettingsPage.plan]: { label: (tr) => tr('settings.planPage.menuLabel'), icon: () => <Gem className="size-4" /> },
  [SettingsPage.billing]: { label: (tr) => tr('settings.billingPage.menuLabel'), icon: () => <CreditCard className="size-4" /> },
  [SettingsPage.featureFlags]: { label: () => 'Feature Flags', icon: () => <Flag className="size-4" /> },
};

function SettingsMenu({ pages, current }: { pages: SettingsPage[]; current: SettingsPage }) {
  const { tr } = useTr();
  return <nav className="flex h-full w-56 shrink-0 flex-col gap-px overflow-y-auto border-r bg-sidebar p-2">
    <div className="px-2 pt-2 pb-2 text-xs font-medium text-muted-foreground">{tr('settings.title')}</div>
    {pages.map((page) => <NavItem key={page} label={MENU[page].label(tr)} icon={MENU[page].icon()} active={page === current}
      role="button" tabIndex={0} data-selected={page === current ? 'true' : undefined}
      onClick={() => settingsDialogActions.setSelectedPage(page)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') settingsDialogActions.setSelectedPage(page); }} />)}
  </nav>;
}

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/**
 * getSettingsView: plan and billing are unreachable (FeatureFlag.planBilling is forced off),
 * so they render nothing.
 */
function SettingsView({ page, props }: { page: SettingsPage; props: SettingsPageProps & { snapshot: UserProfilePB } }) {
  switch (page) {
    case SettingsPage.account:
      return <AccountPage {...props} snapshotAuthType={props.snapshot.userAuthType} />;
    case SettingsPage.workspace:
      return <WorkspacePage {...props} />;
    case SettingsPage.manageData:
      return <ManageDataPage {...props} />;
    case SettingsPage.notifications:
      return <NotificationsPage {...props} />;
    case SettingsPage.cloud:
      // SettingCloud → SelfHostedSettingsView [CUSTOM].
      return <SelfHostedSettingsView restartApp={props.restartApp} />;
    case SettingsPage.companyCertificates:
      return <CertificatesPage {...props} />;
    case SettingsPage.shortcuts:
      return <ShortcutsPage {...props} />;
    case SettingsPage.ai:
      // LocalSettingsAIView(key: ValueKey(workspaceId)) → OpenAIEndpointSettingsView [CUSTOM].
      return <AIPage key={props.workspace?.workspaceId ?? ''} {...props} />;
    case SettingsPage.member:
      return <MembersPage {...props} />;
    case SettingsPage.sites:
      return <SitesPage {...props} />;
    case SettingsPage.featureFlags:
      return <FeatureFlagsPage {...props} />;
    default:
      return null;
  }
}

/** SettingsDialog (lib/workspace/presentation/settings/settings_dialog.dart). */
function SettingsDialog({ close }: { close: () => void }) {
  const open = useSettingsDialogStore((s) => s.open);
  const page = useSettingsDialogStore((s) => s.page);
  const isBillingEnabled = useSettingsDialogStore((s) => s.isBillingEnabled);
  const liveUser = useSettingsWorkspaceStore((s) => s.user);
  const workspace = useSettingsWorkspaceStore((s) => s.current);
  const { width, height } = useWindowSize();
  if (!open) return null;

  // Menu: the profile and role snapshot taken when the dialog opened (ambiguity A2).
  const pages = visibleSettingsPages({
    workspaceType: open.snapshot.workspaceType,
    role: open.role,
    isBillingEnabled,
    debug: isDebugBuild(),
  });

  // width: max(564, 0.6 × window) snapped up to 56 by SimpleDialog's IntrinsicWidth, within the 40px insets.
  const dialogWidth = Math.min(width - 80, Math.ceil(Math.max(564, width * 0.6) / 56) * 56);
  const pageProps: SettingsPageProps & { snapshot: UserProfilePB } = {
    user: liveUser ?? open.snapshot,
    workspace,
    role: workspaceRole(workspace),
    snapshot: open.snapshot,
    closeDialog: close,
    didLogout: () => {
      close();
      void runAppFlowy();
    },
    restartApp: () => {
      close();
      void runAppFlowy();
    },
  };

  return (
    <div className="flex overflow-hidden rounded-xl bg-background text-foreground shadow-2xl ring-1 ring-foreground/10"
      style={{ width: dialogWidth, height: Math.min(height * 0.7, height - 48) }}>
      <SettingsMenu pages={pages} current={page} />
      <div className="relative h-full min-w-0 flex-1">
        <ScrollArea key={page} className="h-full">
          <div className="mx-auto w-full max-w-3xl px-10 py-8">
            {/* Page-local state resets on switch. */}
            <SettingsView key={page} page={page} props={pageProps} />
          </div>
        </ScrollArea>
        <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Close" onClick={close}><X className="size-4" /></Button>
      </div>
    </div>
  );
}

/**
 * Listens for openSettings (sidebar gear button, Mod+,; the payload may be an initial page)
 * and shows the settings dialog. A second Mod+, while it is open pops every dialog
 * (Navigator.popUntil(isFirst)), closing it and anything stacked on top.
 */
export function SettingsDialogHost({ user }: { user: UserProfilePB }) {
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    let stopWorkspace: (() => void) | null = null;
    let closeDialog: (() => void) | null = null;
    let opening = false;

    const finish = () => {
      stopWorkspace?.();
      stopWorkspace = null;
      closeDialog = null;
      settingsDialogActions.closed();
    };

    const off = openSettings.on((payload) => {
      if (useSettingsDialogStore.getState().open) {
        closeAllDialogs();
        finish();
        return;
      }
      if (opening) return;
      opening = true;
      loseFocus.emit();
      const initPage = isSettingsPage(payload) ? payload : null;
      void (async () => {
        // UserWorkspaceBloc.state.userProfile / currentWorkspace?.role at open time.
        const [profile, { current }] = await Promise.all([UserEventGetUserProfile(), fetchWorkspaces()]);
        const snapshot = profile.ok ? profile.value : userRef.current;
        useSettingsWorkspaceStore.setState({ current });
        opening = false;
        if (useSettingsDialogStore.getState().open) return;
        settingsDialogActions.opened(snapshot, workspaceRole(current), initPage);
        stopWorkspace = startSettingsWorkspace(snapshot);
        // PasswordBloc(userProfile)..init..checkHasPassword (a new bloc on this path).
        void passwordActions.init(snapshot);
        closeDialog = showDialog((close) => <SettingsDialog close={close} />, { onClosed: finish });
      })();
    });

    return () => {
      off();
      // runAppFlowy() rebuilds the whole tree in Flutter, dialogs stacked on settings included.
      if (useSettingsDialogStore.getState().open) closeAllDialogs();
      else closeDialog?.();
      finish();
    };
  }, []);

  useEffect(() => {
    // The profile handed to the home screen seeds the dialog's live copy.
    useSettingsWorkspaceStore.setState({ user });
  }, [user]);

  return null;
}
