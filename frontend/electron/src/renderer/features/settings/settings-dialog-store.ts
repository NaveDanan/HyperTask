import { create } from 'zustand';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/hyper-user/workspace_pb';
import type { UserProfilePB, UserWorkspacePB } from '@shared/protobuf/hyper-user/user_profile_pb';
import { useAppStore } from '@/startup/app-store';

/** SettingsPage, in the enum declaration order of settings_dialog_bloc.dart (companyCertificates is custom). */
export enum SettingsPage {
  account = 'account',
  appearance = 'appearance',
  workspace = 'workspace',
  manageData = 'manageData',
  shortcuts = 'shortcuts',
  ai = 'ai',
  voice = 'voice',
  plan = 'plan',
  billing = 'billing',
  sites = 'sites',
  notifications = 'notifications',
  connections = 'connections',
  jira = 'jira',
  cloud = 'cloud',
  companyCertificates = 'companyCertificates',
  member = 'member',
  featureFlags = 'featureFlags',
  /** [CUSTOM] the Trash page, which moved out of the sidebar footer. */
  archived = 'archived',
}

export type SettingsMenuPage = Exclude<SettingsPage, SettingsPage.jira | SettingsPage.ai | SettingsPage.cloud>;

export const isSettingsPage = (value: unknown): value is SettingsPage =>
  typeof value === 'string' && (Object.values(SettingsPage) as string[]).includes(value);

const connections = ['outlook', 'jira', 'ai', 'entra', 'openbot', 'browsers', 'voice', 'server'] as const;
export type HyperConnectionPage = typeof connections[number];

export function settingsDestination(value: string | void | null): { page: SettingsPage; connection: HyperConnectionPage | null } {
  const connection = connections.find(id => value === `connections/${id}` ||
    (id === 'jira' && value === SettingsPage.jira) || (id === 'ai' && value === SettingsPage.ai) ||
    (id === 'server' && value === SettingsPage.cloud));
  return connection
    ? { page: SettingsPage.connections, connection }
    : { page: isSettingsPage(value) ? value : SettingsPage.account, connection: null };
}

/** kDebugMode: a development (unpackaged) build. */
export const isDebugBuild = () => useAppStore.getState().info?.isPackaged === false;

/** UserWorkspacePB.role: a proto one_of whose Dart getter defaults to Owner; null without a workspace. */
export function workspaceRole(workspace: UserWorkspacePB | null | undefined): AFRolePB | null {
  if (!workspace) return null;
  return workspace.oneOfRole.case === 'role' ? workspace.oneOfRole.value : AFRolePB.Owner;
}

/** FeatureFlag.planBilling.isOn is forced to false in this checkout (lib/shared/feature_flags.dart). */
export const PLAN_BILLING_ENABLED = false;

/**
 * SettingsMenu (widgets/settings_menu.dart): the visible pages in render order.
 * `workspaceType` comes from the profile snapshot taken when the dialog opened.
 */
export function visibleSettingsPages({
  workspaceType,
  role,
  isBillingEnabled,
  debug,
}: {
  workspaceType: WorkspaceTypePB;
  role: AFRolePB | null;
  isBillingEnabled: boolean;
  debug: boolean;
}): SettingsMenuPage[] {
  const serverMember = workspaceType === WorkspaceTypePB.ServerW && role !== null && role !== AFRolePB.Guest;
  const pages: SettingsMenuPage[] = [SettingsPage.account, SettingsPage.appearance];
  // The Workspace page holds the name, icon and Delete/Leave, which a local workspace does not have.
  if (workspaceType !== WorkspaceTypePB.LocalW) pages.push(SettingsPage.workspace);
  // FeatureFlag.membersSettings is always on (released flag).
  if (serverMember) pages.push(SettingsPage.member);
  pages.push(
    SettingsPage.manageData,
    SettingsPage.archived,
    SettingsPage.notifications,
    SettingsPage.connections,
    SettingsPage.companyCertificates,
    SettingsPage.shortcuts,
    SettingsPage.voice,
  );
  if (serverMember) pages.push(SettingsPage.sites);
  if (PLAN_BILLING_ENABLED && isBillingEnabled) pages.push(SettingsPage.plan, SettingsPage.billing);
  if (debug) pages.push(SettingsPage.featureFlags);
  return pages;
}

interface SettingsDialogState {
  /** Open dialog instance, or null. */
  open: { snapshot: UserProfilePB; role: AFRolePB | null } | null;
  page: SettingsPage;
  connection: HyperConnectionPage | null;
  /** Always false here: Plan/Billing are forced off, so _isBillingEnabled is never consulted. */
  isBillingEnabled: boolean;
}

/** SettingsDialogBloc (workspace/application/settings/settings_dialog_bloc.dart). */
export const useSettingsDialogStore = create<SettingsDialogState>(() => ({ open: null, page: SettingsPage.account, connection: null, isBillingEnabled: false }));

export const settingsDialogActions = {
  /** SettingsDialogBloc(initPage): page = initPage ?? account, isBillingEnabled = false. */
  opened(snapshot: UserProfilePB, role: AFRolePB | null, destination: string | void) {
    useSettingsDialogStore.setState({ open: { snapshot, role }, ...settingsDestination(destination), isBillingEnabled: false });
  },
  closed() {
    useSettingsDialogStore.setState({ open: null });
  },
  /** setSelectedPage: in-memory only. */
  setSelectedPage(destination: string) {
    useSettingsDialogStore.setState(settingsDestination(destination));
  },
};
