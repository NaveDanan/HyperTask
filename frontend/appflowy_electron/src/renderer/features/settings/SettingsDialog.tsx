import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventGetUserProfile } from '@/backend/events';
import { FlowySvg } from '@/icons/FlowySvg';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useTr } from '@/i18n';
import { runAppFlowy } from '@/startup/launcher';
import { closeAllDialogs, showDialog } from '@/ui';
import { loseFocus, openSettings } from '@/features/home/notifiers';
import { AccountPage } from './account/AccountPage';
import { passwordActions } from './account/password-store';
import { AIPage } from './ai/AIPage';
import { CertificatesPage } from './certificates/CertificatesPage';
import { ManageDataPage } from './manage-data/ManageDataPage';
import { MaterialIcon } from './material';
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
import './settings.css';

const MENU: Record<SettingsPage, { label: (tr: (key: string) => string) => string; icon: () => ReactNode }> = {
  [SettingsPage.account]: { label: (tr) => tr('settings.accountPage.menuLabel'), icon: () => svg('settings_page_user_m') },
  [SettingsPage.workspace]: { label: (tr) => tr('settings.workspacePage.menuLabel'), icon: () => svg('settings_page_workspace_m') },
  [SettingsPage.member]: { label: (tr) => tr('settings.appearance.members.label'), icon: () => svg('settings_page_users_m') },
  [SettingsPage.manageData]: { label: (tr) => tr('settings.manageDataPage.menuLabel'), icon: () => svg('settings_page_database_m') },
  [SettingsPage.notifications]: { label: (tr) => tr('settings.menu.notifications'), icon: () => svg('settings_page_bell_m') },
  // [CUSTOM] hard-coded English labels.
  [SettingsPage.cloud]: { label: () => 'Storage & server', icon: () => svg('settings_page_cloud_m') },
  [SettingsPage.companyCertificates]: { label: () => 'Certificates', icon: () => MaterialIcon.verifiedUserOutlined(20) },
  [SettingsPage.shortcuts]: { label: (tr) => tr('settings.shortcutsPage.menuLabel'), icon: () => svg('settings_page_keyboard_m') },
  [SettingsPage.ai]: { label: (tr) => tr('settings.aiPage.menuLabel'), icon: () => svg('settings_page_ai_m') },
  [SettingsPage.sites]: { label: (tr) => tr('settings.sites.title'), icon: () => svg('settings_page_earth_m') },
  [SettingsPage.plan]: { label: (tr) => tr('settings.planPage.menuLabel'), icon: () => svg('settings_page_plan_m') },
  [SettingsPage.billing]: { label: (tr) => tr('settings.billingPage.menuLabel'), icon: () => svg('settings_page_credit_card_m') },
  [SettingsPage.featureFlags]: { label: () => 'Feature Flags', icon: () => MaterialIcon.flag(20) },
};

function svg(name: FlowySvgName) {
  return <FlowySvg svg={name} />;
}

/** SettingsMenuElement (widgets/settings_menu_element.dart): 38px AFBaseButton row. */
function SettingsMenuElement({ page, selected, label, icon }: { page: SettingsPage; selected: boolean; label: string; icon: ReactNode }) {
  return (
    <div
      className="settings-menu-item"
      role="button"
      tabIndex={0}
      data-selected={selected ? 'true' : undefined}
      onClick={() => settingsDialogActions.setSelectedPage(page)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') settingsDialogActions.setSelectedPage(page);
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
      <div style={{ width: 8, flexShrink: 0 }} />
      <div style={{ fontSize: 'calc(14px * var(--text-scale, 1))', lineHeight: '20px', color: 'var(--af-text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>{label}</div>
    </div>
  );
}

/** SettingsMenu (widgets/settings_menu.dart): flat list, layer01 background, 8px start radius. */
function SettingsMenu({ pages, current }: { pages: SettingsPage[]; current: SettingsPage }) {
  const { tr } = useTr();
  return (
    <div
      style={{
        height: '100%',
        background: 'var(--af-surface-container-layer01)',
        borderStartStartRadius: 8,
        borderEndStartRadius: 8,
        overflowY: 'auto',
        padding: '24px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {pages.map((page) => (
        <SettingsMenuElement key={page} page={page} selected={page === current} label={MENU[page].label(tr)} icon={MENU[page].icon()} />
      ))}
    </div>
  );
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
    <div
      style={{
        width: dialogWidth,
        height: Math.min(height * 0.7, height - 48),
        borderRadius: 16,
        overflow: 'hidden',
        background: 'var(--af-background-primary)',
        boxShadow: '0 11px 15px -7px #00000033, 0 24px 38px 3px #00000024, 0 9px 46px 8px #0000001F',
        display: 'flex',
        alignItems: 'flex-start',
        color: 'var(--text-color)',
      }}
    >
      <div style={{ width: 204, height: '100%', flexShrink: 0 }}>
        <SettingsMenu pages={pages} current={page} />
      </div>
      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--af-border-primary)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
        {/* Each page gets its own subtree, so page-local state resets on switch. */}
        <SettingsView key={page} page={page} props={pageProps} />
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
