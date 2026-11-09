import { create } from 'zustand';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB, UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '@/startup/app-store';

/** SettingsPage, in the enum declaration order of settings_dialog_bloc.dart (companyCertificates is custom). */
export enum SettingsPage {
  account = 'account',
  workspace = 'workspace',
  manageData = 'manageData',
  shortcuts = 'shortcuts',
  ai = 'ai',
  plan = 'plan',
  billing = 'billing',
  sites = 'sites',
  notifications = 'notifications',
  cloud = 'cloud',
  companyCertificates = 'companyCertificates',
  member = 'member',
  featureFlags = 'featureFlags',
}

export const isSettingsPage = (value: unknown): value is SettingsPage =>
  typeof value === 'string' && (Object.values(SettingsPage) as string[]).includes(value);

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
}): SettingsPage[] {
  const serverMember = workspaceType === WorkspaceTypePB.ServerW && role !== null && role !== AFRolePB.Guest;
  const pages: SettingsPage[] = [SettingsPage.account, SettingsPage.workspace];
  // FeatureFlag.membersSettings is always on (released flag).
  if (serverMember) pages.push(SettingsPage.member);
  pages.push(
    SettingsPage.manageData,
    SettingsPage.notifications,
    SettingsPage.cloud,
    SettingsPage.companyCertificates,
    SettingsPage.shortcuts,
    SettingsPage.ai,
  );
  if (serverMember) pages.push(SettingsPage.sites);
  if (PLAN_BILLING_ENABLED && isBillingEnabled) pages.push(SettingsPage.plan, SettingsPage.billing);
  if (debug) pages.push(SettingsPage.featureFlags);
  return pages;
}

interface SettingsDialogState {
  /** Open dialog instance, or null. */
  open: { initPage: SettingsPage | null; snapshot: UserProfilePB; role: AFRolePB | null } | null;
  page: SettingsPage;
  /** Always false here: Plan/Billing are forced off, so _isBillingEnabled is never consulted. */
  isBillingEnabled: boolean;
}

/** SettingsDialogBloc (workspace/application/settings/settings_dialog_bloc.dart). */
export const useSettingsDialogStore = create<SettingsDialogState>(() => ({ open: null, page: SettingsPage.account, isBillingEnabled: false }));

export const settingsDialogActions = {
  /** SettingsDialogBloc(initPage): page = initPage ?? account, isBillingEnabled = false. */
  opened(snapshot: UserProfilePB, role: AFRolePB | null, initPage: SettingsPage | null) {
    useSettingsDialogStore.setState({ open: { initPage, snapshot, role }, page: initPage ?? SettingsPage.account, isBillingEnabled: false });
  },
  closed() {
    useSettingsDialogStore.setState({ open: null });
  },
  /** setSelectedPage: in-memory only. */
  setSelectedPage(page: SettingsPage) {
    useSettingsDialogStore.setState({ page });
  },
};
