import { createStore } from 'zustand/vanilla';
import { AFRolePB, RecurringIntervalPB, SubscriptionPlanPB, WorkspacePlanPB, type WorkspaceMemberPB, type WorkspaceSubscriptionInfoPB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import {
  FolderEventReadCurrentWorkspace,
  UserEventGetWorkspaceMembers,
  UserEventGetWorkspaceSubscriptionInfo,
  UserEventInviteWorkspaceMember,
  UserEventRemoveWorkspaceMember,
  UserEventSubscribeWorkspace,
} from '@/backend/events';
import { tr } from '@/i18n';
import { getAppFlowyCloudUrl, getAppFlowyShareDomain } from '@/startup/cloud-env';
import { useAppStore } from '@/startup/app-store';
import { showConfirmDialog, showToast } from '@/ui';
import { authTokenOf, buildInviteLink, generateInviteCode, getInviteCode, roleCan } from './members-core';

export interface WorkspaceMemberState {
  members: WorkspaceMemberPB[];
  myRole: AFRolePB;
  isLoading: boolean;
  subscriptionInfo: WorkspaceSubscriptionInfoPB | null;
  inviteLink: string | null;
}

const fetchViaMain = (options: { url: string; method: string; headers?: Record<string, string>; body?: string }) =>
  window.appflowy.net.request(options);

const copyLinkToast = () => showToast({ message: tr('shareAction.copyLinkSuccess') });

/**
 * WorkspaceMemberBloc (widgets/members/workspace_member_bloc.dart) plus the page's result
 * listener (_showResultDialog). The page does not pass its workspace id, so the bloc reads
 * the current folder workspace.
 */
export function createWorkspaceMemberStore(user: UserProfilePB) {
  const store = createStore<WorkspaceMemberState>(() => ({
    members: [],
    myRole: AFRolePB.Guest,
    isLoading: true,
    subscriptionInfo: null,
    inviteLink: null,
  }));
  let workspaceId: string | null = null;
  // MemberHttpService is only created by getInviteCode (auth token + workspace id present).
  let http: { baseUrl: string; authToken: string } | null = null;
  let closed = false;

  const myRoleIn = (members: WorkspaceMemberPB[]) => members.find((m) => m.email === user.email)?.role ?? AFRolePB.Guest;

  async function fetchSubscriptionInfo() {
    if (!workspaceId) return;
    const result = await UserEventGetWorkspaceSubscriptionInfo({ workspaceId });
    if (result.ok && !closed) store.setState({ subscriptionInfo: result.value });
  }

  async function getInviteCodeEvent() {
    const baseUrl = getAppFlowyCloudUrl();
    const authToken = authTokenOf(user);
    if (authToken === null || workspaceId === null) return;
    http = { baseUrl, authToken };
    const result = await getInviteCode(fetchViaMain, baseUrl, authToken, workspaceId);
    if (result.ok && !closed) {
      store.setState({ inviteLink: buildInviteLink(getAppFlowyShareDomain(), result.value, authTokenOf(user)) });
    }
  }

  const actions = {
    /** initial: resolve the workspace, load the members and my role; then getInviteCode. */
    async initial() {
      const current = await FolderEventReadCurrentWorkspace();
      if (!current.ok) return;
      workspaceId = current.value.id;
      // The workspace id ValueNotifier listener re-runs getInviteCode once the id is known.
      void getInviteCodeEvent();
      const result = await UserEventGetWorkspaceMembers({ workspaceId });
      const members = result.ok ? result.value.items : [];
      const myRole = myRoleIn(members);
      if (myRole === AFRolePB.Owner) void fetchSubscriptionInfo();
      if (!closed) store.setState({ members, myRole, isLoading: false });
    },

    async inviteByEmail(email: string) {
      if (!workspaceId) return;
      const result = await UserEventInviteWorkspaceMember({ workspaceId, inviteeEmail: email, role: AFRolePB.Member });
      if (result.ok) {
        showToast({ message: tr('settings.appearance.members.inviteMemberSuccess') });
        return;
      }
      const message =
        result.error.code === ErrorCode.WorkspaceMemberLimitExceeded
          ? tr('settings.appearance.members.inviteFailedMemberLimit')
          : tr('settings.appearance.members.failedToInviteMember');
      showConfirmDialog({
        title: tr('settings.appearance.members.inviteFailedDialogTitle'),
        description: message,
        confirmLabel: tr('settings.appearance.members.memberLimitExceededUpgrade'),
        onConfirm: () => void actions.upgradePlan(),
      });
    },

    async removeMember(email: string) {
      if (!workspaceId) return;
      const result = await UserEventRemoveWorkspaceMember({ workspaceId, email });
      if (result.ok && !closed) store.setState((s) => ({ members: s.members.filter((m) => m.email !== email) }));
    },

    /** generateInviteLink: reports generate vs reset, copies the new link, toasts 200 ms later. */
    async generateInviteLink() {
      if (!workspaceId || !http) return;
      const reset = store.getState().inviteLink !== null;
      const result = await generateInviteCode(fetchViaMain, http.baseUrl, http.authToken, workspaceId);
      if (!result.ok) {
        showToast({
          type: 'error',
          message: tr(reset ? 'settings.appearance.members.resetLinkFailed' : 'settings.appearance.members.generatedLinkFailed'),
        });
        return;
      }
      const inviteLink = buildInviteLink(getAppFlowyShareDomain(), result.value, authTokenOf(user));
      if (!closed) store.setState({ inviteLink });
      showToast({
        message: tr(reset ? 'settings.appearance.members.resetLinkSuccessfully' : 'settings.appearance.members.generatedLinkSuccessfully'),
      });
      window.appflowy.clipboard.writeText(inviteLink);
      window.setTimeout(copyLinkToast, 200);
    },

    /** upgradePlan: only from the Free plan; opens the payment link (vendor links are refused). */
    async upgradePlan() {
      if (!workspaceId) return;
      const plan = store.getState().subscriptionInfo?.plan;
      if (plan === undefined || plan !== WorkspacePlanPB.FreePlan) return;
      const debug = useAppStore.getState().info?.isPackaged === false;
      const result = await UserEventSubscribeWorkspace({
        workspaceId,
        recurringInterval: RecurringIntervalPB.Year,
        workspaceSubscriptionPlan: SubscriptionPlanPB.Pro,
        successUrl: `${debug ? 'https://beta.appflowy.com' : 'https://appflowy.com'}/after-payment?plan=pro`,
      });
      if (result.ok) await window.appflowy.shell.openExternal(result.value.paymentLink).catch(() => {});
    },

    close() {
      closed = true;
    },
  };

  return { store, actions, canInvite: () => roleCan.invite(store.getState().myRole) };
}

export type WorkspaceMemberStore = ReturnType<typeof createWorkspaceMemberStore>;
