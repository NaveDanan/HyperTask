// Generated from rust-lib/hyper-user/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { EMPTY, request, type HyperResult } from '../dispatch';
import { GotrueTokenResponsePBSchema, MagicLinkSignInPBSchema, OauthProviderDataPBSchema, OauthProviderPBSchema, OauthSignInPBSchema, PasscodeSignInPBSchema, SignInPayloadPBSchema, SignInUrlPBSchema, SignInUrlPayloadPBSchema, SignUpPayloadPBSchema, type GotrueTokenResponsePB, type OauthProviderDataPB, type SignInUrlPB } from '@shared/protobuf/hyper-user/auth_pb';
import { ImportHypertaskDataPBSchema } from '@shared/protobuf/hyper-user/import_data_pb';
import { RealtimePayloadPBSchema } from '@shared/protobuf/hyper-user/realtime_pb';
import { ReminderIdentifierPBSchema, ReminderPBSchema, RepeatedReminderPBSchema, type RepeatedReminderPB } from '@shared/protobuf/hyper-user/reminder_pb';
import { RepeatedUserWorkspacePBSchema, UpdateUserProfilePayloadPBSchema, UserProfilePBSchema, UserSettingPBSchema, UserWorkspacePBSchema, type RepeatedUserWorkspacePB, type UserProfilePB, type UserSettingPB, type UserWorkspacePB } from '@shared/protobuf/hyper-user/user_profile_pb';
import { AppearanceSettingsPBSchema, CloudSettingPBSchema, DateTimeSettingsPBSchema, NetworkStatePBSchema, NotificationSettingsPBSchema, UpdateCloudConfigPBSchema, type AppearanceSettingsPB, type CloudSettingPB, type DateTimeSettingsPB, type NotificationSettingsPB } from '@shared/protobuf/hyper-user/user_setting_pb';
import { AcceptWorkspaceInvitationPBSchema, AddWorkspaceMemberPBSchema, BillingPortalPBSchema, CancelWorkspaceSubscriptionPBSchema, ChangeWorkspaceIconPBSchema, CreateWorkspacePBSchema, OpenUserWorkspacePBSchema, PaymentLinkPBSchema, QueryWorkspacePBSchema, RemoveWorkspaceMemberPBSchema, RenameWorkspacePBSchema, RepeatedSubscriptionPlanDetailPBSchema, RepeatedWorkspaceInvitationPBSchema, RepeatedWorkspaceMemberPBSchema, SubscribeWorkspacePBSchema, SuccessWorkspaceSubscriptionPBSchema, UpdateUserWorkspaceSettingPBSchema, UpdateWorkspaceMemberPBSchema, UpdateWorkspaceSubscriptionPaymentPeriodPBSchema, UserWorkspaceIdPBSchema, WorkspaceMemberIdPBSchema, WorkspaceMemberInvitationPBSchema, WorkspaceMemberPBSchema, WorkspaceSettingsPBSchema, WorkspaceSubscriptionInfoPBSchema, WorkspaceUsagePBSchema, type BillingPortalPB, type PaymentLinkPB, type RepeatedSubscriptionPlanDetailPB, type RepeatedWorkspaceInvitationPB, type RepeatedWorkspaceMemberPB, type WorkspaceMemberPB, type WorkspaceSettingsPB, type WorkspaceSubscriptionInfoPB, type WorkspaceUsagePB } from '@shared/protobuf/hyper-user/workspace_pb';

export function UserEventSignInWithEmailPassword(payload: MessageInitShape<typeof SignInPayloadPBSchema>): Promise<HyperResult<GotrueTokenResponsePB>> {
  return request('SignInWithEmailPassword', toBinary(SignInPayloadPBSchema, create(SignInPayloadPBSchema, payload)), GotrueTokenResponsePBSchema);
}

export function UserEventSignUp(payload: MessageInitShape<typeof SignUpPayloadPBSchema>): Promise<HyperResult<UserProfilePB>> {
  return request('SignUp', toBinary(SignUpPayloadPBSchema, create(SignUpPayloadPBSchema, payload)), UserProfilePBSchema);
}

export function UserEventSignOut(): Promise<HyperResult<void>> {
  return request('SignOut', EMPTY);
}

export function UserEventUpdateUserProfile(payload: MessageInitShape<typeof UpdateUserProfilePayloadPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateUserProfile', toBinary(UpdateUserProfilePayloadPBSchema, create(UpdateUserProfilePayloadPBSchema, payload)));
}

export function UserEventGetUserProfile(): Promise<HyperResult<UserProfilePB>> {
  return request('GetUserProfile', EMPTY, UserProfilePBSchema);
}

export function UserEventInitUser(): Promise<HyperResult<void>> {
  return request('InitUser', EMPTY);
}

export function UserEventSetAppearanceSetting(payload: MessageInitShape<typeof AppearanceSettingsPBSchema>): Promise<HyperResult<void>> {
  return request('SetAppearanceSetting', toBinary(AppearanceSettingsPBSchema, create(AppearanceSettingsPBSchema, payload)));
}

export function UserEventGetAppearanceSetting(): Promise<HyperResult<AppearanceSettingsPB>> {
  return request('GetAppearanceSetting', EMPTY, AppearanceSettingsPBSchema);
}

export function UserEventGetUserSetting(): Promise<HyperResult<UserSettingPB>> {
  return request('GetUserSetting', EMPTY, UserSettingPBSchema);
}

export function UserEventOauthSignIn(payload: MessageInitShape<typeof OauthSignInPBSchema>): Promise<HyperResult<UserProfilePB>> {
  return request('OauthSignIn', toBinary(OauthSignInPBSchema, create(OauthSignInPBSchema, payload)), UserProfilePBSchema);
}

export function UserEventGenerateSignInURL(payload: MessageInitShape<typeof SignInUrlPayloadPBSchema>): Promise<HyperResult<SignInUrlPB>> {
  return request('GenerateSignInURL', toBinary(SignInUrlPayloadPBSchema, create(SignInUrlPayloadPBSchema, payload)), SignInUrlPBSchema);
}

export function UserEventGetOauthURLWithProvider(payload: MessageInitShape<typeof OauthProviderPBSchema>): Promise<HyperResult<OauthProviderDataPB>> {
  return request('GetOauthURLWithProvider', toBinary(OauthProviderPBSchema, create(OauthProviderPBSchema, payload)), OauthProviderDataPBSchema);
}

export function UserEventSetCloudConfig(payload: MessageInitShape<typeof UpdateCloudConfigPBSchema>): Promise<HyperResult<void>> {
  return request('SetCloudConfig', toBinary(UpdateCloudConfigPBSchema, create(UpdateCloudConfigPBSchema, payload)));
}

export function UserEventGetCloudConfig(): Promise<HyperResult<CloudSettingPB>> {
  return request('GetCloudConfig', EMPTY, CloudSettingPBSchema);
}

export function UserEventGetAllWorkspace(): Promise<HyperResult<RepeatedUserWorkspacePB>> {
  return request('GetAllWorkspace', EMPTY, RepeatedUserWorkspacePBSchema);
}

export function UserEventOpenWorkspace(payload: MessageInitShape<typeof OpenUserWorkspacePBSchema>): Promise<HyperResult<void>> {
  return request('OpenWorkspace', toBinary(OpenUserWorkspacePBSchema, create(OpenUserWorkspacePBSchema, payload)));
}

export function UserEventGetUserWorkspace(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<HyperResult<UserWorkspacePB>> {
  return request('GetUserWorkspace', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), UserWorkspacePBSchema);
}

export function UserEventUpdateNetworkState(payload: MessageInitShape<typeof NetworkStatePBSchema>): Promise<HyperResult<void>> {
  return request('UpdateNetworkState', toBinary(NetworkStatePBSchema, create(NetworkStatePBSchema, payload)));
}

export function UserEventGetAnonUser(): Promise<HyperResult<UserProfilePB>> {
  return request('GetAnonUser', EMPTY, UserProfilePBSchema);
}

export function UserEventOpenAnonUser(): Promise<HyperResult<void>> {
  return request('OpenAnonUser', EMPTY);
}

export function UserEventPushRealtimeEvent(payload: MessageInitShape<typeof RealtimePayloadPBSchema>): Promise<HyperResult<void>> {
  return request('PushRealtimeEvent', toBinary(RealtimePayloadPBSchema, create(RealtimePayloadPBSchema, payload)));
}

export function UserEventCreateReminder(payload: MessageInitShape<typeof ReminderPBSchema>): Promise<HyperResult<void>> {
  return request('CreateReminder', toBinary(ReminderPBSchema, create(ReminderPBSchema, payload)));
}

export function UserEventGetAllReminders(): Promise<HyperResult<RepeatedReminderPB>> {
  return request('GetAllReminders', EMPTY, RepeatedReminderPBSchema);
}

export function UserEventRemoveReminder(payload: MessageInitShape<typeof ReminderIdentifierPBSchema>): Promise<HyperResult<void>> {
  return request('RemoveReminder', toBinary(ReminderIdentifierPBSchema, create(ReminderIdentifierPBSchema, payload)));
}

export function UserEventUpdateReminder(payload: MessageInitShape<typeof ReminderPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateReminder', toBinary(ReminderPBSchema, create(ReminderPBSchema, payload)));
}

export function UserEventSetDateTimeSettings(payload: MessageInitShape<typeof DateTimeSettingsPBSchema>): Promise<HyperResult<void>> {
  return request('SetDateTimeSettings', toBinary(DateTimeSettingsPBSchema, create(DateTimeSettingsPBSchema, payload)));
}

export function UserEventGetDateTimeSettings(): Promise<HyperResult<DateTimeSettingsPB>> {
  return request('GetDateTimeSettings', EMPTY, DateTimeSettingsPBSchema);
}

export function UserEventSetNotificationSettings(payload: MessageInitShape<typeof NotificationSettingsPBSchema>): Promise<HyperResult<void>> {
  return request('SetNotificationSettings', toBinary(NotificationSettingsPBSchema, create(NotificationSettingsPBSchema, payload)));
}

export function UserEventGetNotificationSettings(): Promise<HyperResult<NotificationSettingsPB>> {
  return request('GetNotificationSettings', EMPTY, NotificationSettingsPBSchema);
}

export function UserEventAddWorkspaceMember(payload: MessageInitShape<typeof AddWorkspaceMemberPBSchema>): Promise<HyperResult<void>> {
  return request('AddWorkspaceMember', toBinary(AddWorkspaceMemberPBSchema, create(AddWorkspaceMemberPBSchema, payload)));
}

export function UserEventRemoveWorkspaceMember(payload: MessageInitShape<typeof RemoveWorkspaceMemberPBSchema>): Promise<HyperResult<void>> {
  return request('RemoveWorkspaceMember', toBinary(RemoveWorkspaceMemberPBSchema, create(RemoveWorkspaceMemberPBSchema, payload)));
}

export function UserEventUpdateWorkspaceMember(payload: MessageInitShape<typeof UpdateWorkspaceMemberPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateWorkspaceMember', toBinary(UpdateWorkspaceMemberPBSchema, create(UpdateWorkspaceMemberPBSchema, payload)));
}

export function UserEventGetWorkspaceMembers(payload: MessageInitShape<typeof QueryWorkspacePBSchema>): Promise<HyperResult<RepeatedWorkspaceMemberPB>> {
  return request('GetWorkspaceMembers', toBinary(QueryWorkspacePBSchema, create(QueryWorkspacePBSchema, payload)), RepeatedWorkspaceMemberPBSchema);
}

export function UserEventImportHypertaskDataFolder(payload: MessageInitShape<typeof ImportHypertaskDataPBSchema>): Promise<HyperResult<void>> {
  return request('ImportHypertaskDataFolder', toBinary(ImportHypertaskDataPBSchema, create(ImportHypertaskDataPBSchema, payload)));
}

export function UserEventCreateWorkspace(payload: MessageInitShape<typeof CreateWorkspacePBSchema>): Promise<HyperResult<UserWorkspacePB>> {
  return request('CreateWorkspace', toBinary(CreateWorkspacePBSchema, create(CreateWorkspacePBSchema, payload)), UserWorkspacePBSchema);
}

export function UserEventDeleteWorkspace(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<HyperResult<void>> {
  return request('DeleteWorkspace', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)));
}

export function UserEventRenameWorkspace(payload: MessageInitShape<typeof RenameWorkspacePBSchema>): Promise<HyperResult<void>> {
  return request('RenameWorkspace', toBinary(RenameWorkspacePBSchema, create(RenameWorkspacePBSchema, payload)));
}

export function UserEventChangeWorkspaceIcon(payload: MessageInitShape<typeof ChangeWorkspaceIconPBSchema>): Promise<HyperResult<void>> {
  return request('ChangeWorkspaceIcon', toBinary(ChangeWorkspaceIconPBSchema, create(ChangeWorkspaceIconPBSchema, payload)));
}

export function UserEventLeaveWorkspace(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<HyperResult<void>> {
  return request('LeaveWorkspace', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)));
}

export function UserEventInviteWorkspaceMember(payload: MessageInitShape<typeof WorkspaceMemberInvitationPBSchema>): Promise<HyperResult<void>> {
  return request('InviteWorkspaceMember', toBinary(WorkspaceMemberInvitationPBSchema, create(WorkspaceMemberInvitationPBSchema, payload)));
}

export function UserEventListWorkspaceInvitations(): Promise<HyperResult<RepeatedWorkspaceInvitationPB>> {
  return request('ListWorkspaceInvitations', EMPTY, RepeatedWorkspaceInvitationPBSchema);
}

export function UserEventAcceptWorkspaceInvitation(payload: MessageInitShape<typeof AcceptWorkspaceInvitationPBSchema>): Promise<HyperResult<void>> {
  return request('AcceptWorkspaceInvitation', toBinary(AcceptWorkspaceInvitationPBSchema, create(AcceptWorkspaceInvitationPBSchema, payload)));
}

export function UserEventMagicLinkSignIn(payload: MessageInitShape<typeof MagicLinkSignInPBSchema>): Promise<HyperResult<UserProfilePB>> {
  return request('MagicLinkSignIn', toBinary(MagicLinkSignInPBSchema, create(MagicLinkSignInPBSchema, payload)), UserProfilePBSchema);
}

export function UserEventSubscribeWorkspace(payload: MessageInitShape<typeof SubscribeWorkspacePBSchema>): Promise<HyperResult<PaymentLinkPB>> {
  return request('SubscribeWorkspace', toBinary(SubscribeWorkspacePBSchema, create(SubscribeWorkspacePBSchema, payload)), PaymentLinkPBSchema);
}

export function UserEventCancelWorkspaceSubscription(payload: MessageInitShape<typeof CancelWorkspaceSubscriptionPBSchema>): Promise<HyperResult<void>> {
  return request('CancelWorkspaceSubscription', toBinary(CancelWorkspaceSubscriptionPBSchema, create(CancelWorkspaceSubscriptionPBSchema, payload)));
}

export function UserEventGetWorkspaceUsage(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<HyperResult<WorkspaceUsagePB>> {
  return request('GetWorkspaceUsage', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), WorkspaceUsagePBSchema);
}

export function UserEventGetBillingPortal(): Promise<HyperResult<BillingPortalPB>> {
  return request('GetBillingPortal', EMPTY, BillingPortalPBSchema);
}

export function UserEventGetMemberInfo(payload: MessageInitShape<typeof WorkspaceMemberIdPBSchema>): Promise<HyperResult<WorkspaceMemberPB>> {
  return request('GetMemberInfo', toBinary(WorkspaceMemberIdPBSchema, create(WorkspaceMemberIdPBSchema, payload)), WorkspaceMemberPBSchema);
}

export function UserEventUpdateWorkspaceSetting(payload: MessageInitShape<typeof UpdateUserWorkspaceSettingPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateWorkspaceSetting', toBinary(UpdateUserWorkspaceSettingPBSchema, create(UpdateUserWorkspaceSettingPBSchema, payload)));
}

export function UserEventGetWorkspaceSetting(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<HyperResult<WorkspaceSettingsPB>> {
  return request('GetWorkspaceSetting', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), WorkspaceSettingsPBSchema);
}

export function UserEventGetWorkspaceSubscriptionInfo(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<HyperResult<WorkspaceSubscriptionInfoPB>> {
  return request('GetWorkspaceSubscriptionInfo', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), WorkspaceSubscriptionInfoPBSchema);
}

export function UserEventUpdateWorkspaceSubscriptionPaymentPeriod(payload: MessageInitShape<typeof UpdateWorkspaceSubscriptionPaymentPeriodPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateWorkspaceSubscriptionPaymentPeriod', toBinary(UpdateWorkspaceSubscriptionPaymentPeriodPBSchema, create(UpdateWorkspaceSubscriptionPaymentPeriodPBSchema, payload)));
}

export function UserEventGetSubscriptionPlanDetails(): Promise<HyperResult<RepeatedSubscriptionPlanDetailPB>> {
  return request('GetSubscriptionPlanDetails', EMPTY, RepeatedSubscriptionPlanDetailPBSchema);
}

export function UserEventNotifyDidSwitchPlan(payload: MessageInitShape<typeof SuccessWorkspaceSubscriptionPBSchema>): Promise<HyperResult<void>> {
  return request('NotifyDidSwitchPlan', toBinary(SuccessWorkspaceSubscriptionPBSchema, create(SuccessWorkspaceSubscriptionPBSchema, payload)));
}

export function UserEventDeleteAccount(): Promise<HyperResult<void>> {
  return request('DeleteAccount', EMPTY);
}

export function UserEventPasscodeSignIn(payload: MessageInitShape<typeof PasscodeSignInPBSchema>): Promise<HyperResult<GotrueTokenResponsePB>> {
  return request('PasscodeSignIn', toBinary(PasscodeSignInPBSchema, create(PasscodeSignInPBSchema, payload)), GotrueTokenResponsePBSchema);
}
