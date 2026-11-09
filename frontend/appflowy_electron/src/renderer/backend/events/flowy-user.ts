// Generated from rust-lib/flowy-user/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { EMPTY, request, type FlowyResult } from '../dispatch';
import { GotrueTokenResponsePBSchema, MagicLinkSignInPBSchema, OauthProviderDataPBSchema, OauthProviderPBSchema, OauthSignInPBSchema, PasscodeSignInPBSchema, SignInPayloadPBSchema, SignInUrlPBSchema, SignInUrlPayloadPBSchema, SignUpPayloadPBSchema, type GotrueTokenResponsePB, type OauthProviderDataPB, type SignInUrlPB } from '@shared/protobuf/flowy-user/auth_pb';
import { ImportAppFlowyDataPBSchema } from '@shared/protobuf/flowy-user/import_data_pb';
import { RealtimePayloadPBSchema } from '@shared/protobuf/flowy-user/realtime_pb';
import { ReminderIdentifierPBSchema, ReminderPBSchema, RepeatedReminderPBSchema, type RepeatedReminderPB } from '@shared/protobuf/flowy-user/reminder_pb';
import { RepeatedUserWorkspacePBSchema, UpdateUserProfilePayloadPBSchema, UserProfilePBSchema, UserSettingPBSchema, UserWorkspacePBSchema, type RepeatedUserWorkspacePB, type UserProfilePB, type UserSettingPB, type UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AppearanceSettingsPBSchema, CloudSettingPBSchema, DateTimeSettingsPBSchema, NetworkStatePBSchema, NotificationSettingsPBSchema, UpdateCloudConfigPBSchema, type AppearanceSettingsPB, type CloudSettingPB, type DateTimeSettingsPB, type NotificationSettingsPB } from '@shared/protobuf/flowy-user/user_setting_pb';
import { AcceptWorkspaceInvitationPBSchema, AddWorkspaceMemberPBSchema, BillingPortalPBSchema, CancelWorkspaceSubscriptionPBSchema, ChangeWorkspaceIconPBSchema, CreateWorkspacePBSchema, OpenUserWorkspacePBSchema, PaymentLinkPBSchema, QueryWorkspacePBSchema, RemoveWorkspaceMemberPBSchema, RenameWorkspacePBSchema, RepeatedSubscriptionPlanDetailPBSchema, RepeatedWorkspaceInvitationPBSchema, RepeatedWorkspaceMemberPBSchema, SubscribeWorkspacePBSchema, SuccessWorkspaceSubscriptionPBSchema, UpdateUserWorkspaceSettingPBSchema, UpdateWorkspaceMemberPBSchema, UpdateWorkspaceSubscriptionPaymentPeriodPBSchema, UserWorkspaceIdPBSchema, WorkspaceMemberIdPBSchema, WorkspaceMemberInvitationPBSchema, WorkspaceMemberPBSchema, WorkspaceSettingsPBSchema, WorkspaceSubscriptionInfoPBSchema, WorkspaceUsagePBSchema, type BillingPortalPB, type PaymentLinkPB, type RepeatedSubscriptionPlanDetailPB, type RepeatedWorkspaceInvitationPB, type RepeatedWorkspaceMemberPB, type WorkspaceMemberPB, type WorkspaceSettingsPB, type WorkspaceSubscriptionInfoPB, type WorkspaceUsagePB } from '@shared/protobuf/flowy-user/workspace_pb';

export function UserEventSignInWithEmailPassword(payload: MessageInitShape<typeof SignInPayloadPBSchema>): Promise<FlowyResult<GotrueTokenResponsePB>> {
  return request('SignInWithEmailPassword', toBinary(SignInPayloadPBSchema, create(SignInPayloadPBSchema, payload)), GotrueTokenResponsePBSchema);
}

export function UserEventSignUp(payload: MessageInitShape<typeof SignUpPayloadPBSchema>): Promise<FlowyResult<UserProfilePB>> {
  return request('SignUp', toBinary(SignUpPayloadPBSchema, create(SignUpPayloadPBSchema, payload)), UserProfilePBSchema);
}

export function UserEventSignOut(): Promise<FlowyResult<void>> {
  return request('SignOut', EMPTY);
}

export function UserEventUpdateUserProfile(payload: MessageInitShape<typeof UpdateUserProfilePayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateUserProfile', toBinary(UpdateUserProfilePayloadPBSchema, create(UpdateUserProfilePayloadPBSchema, payload)));
}

export function UserEventGetUserProfile(): Promise<FlowyResult<UserProfilePB>> {
  return request('GetUserProfile', EMPTY, UserProfilePBSchema);
}

export function UserEventInitUser(): Promise<FlowyResult<void>> {
  return request('InitUser', EMPTY);
}

export function UserEventSetAppearanceSetting(payload: MessageInitShape<typeof AppearanceSettingsPBSchema>): Promise<FlowyResult<void>> {
  return request('SetAppearanceSetting', toBinary(AppearanceSettingsPBSchema, create(AppearanceSettingsPBSchema, payload)));
}

export function UserEventGetAppearanceSetting(): Promise<FlowyResult<AppearanceSettingsPB>> {
  return request('GetAppearanceSetting', EMPTY, AppearanceSettingsPBSchema);
}

export function UserEventGetUserSetting(): Promise<FlowyResult<UserSettingPB>> {
  return request('GetUserSetting', EMPTY, UserSettingPBSchema);
}

export function UserEventOauthSignIn(payload: MessageInitShape<typeof OauthSignInPBSchema>): Promise<FlowyResult<UserProfilePB>> {
  return request('OauthSignIn', toBinary(OauthSignInPBSchema, create(OauthSignInPBSchema, payload)), UserProfilePBSchema);
}

export function UserEventGenerateSignInURL(payload: MessageInitShape<typeof SignInUrlPayloadPBSchema>): Promise<FlowyResult<SignInUrlPB>> {
  return request('GenerateSignInURL', toBinary(SignInUrlPayloadPBSchema, create(SignInUrlPayloadPBSchema, payload)), SignInUrlPBSchema);
}

export function UserEventGetOauthURLWithProvider(payload: MessageInitShape<typeof OauthProviderPBSchema>): Promise<FlowyResult<OauthProviderDataPB>> {
  return request('GetOauthURLWithProvider', toBinary(OauthProviderPBSchema, create(OauthProviderPBSchema, payload)), OauthProviderDataPBSchema);
}

export function UserEventSetCloudConfig(payload: MessageInitShape<typeof UpdateCloudConfigPBSchema>): Promise<FlowyResult<void>> {
  return request('SetCloudConfig', toBinary(UpdateCloudConfigPBSchema, create(UpdateCloudConfigPBSchema, payload)));
}

export function UserEventGetCloudConfig(): Promise<FlowyResult<CloudSettingPB>> {
  return request('GetCloudConfig', EMPTY, CloudSettingPBSchema);
}

export function UserEventGetAllWorkspace(): Promise<FlowyResult<RepeatedUserWorkspacePB>> {
  return request('GetAllWorkspace', EMPTY, RepeatedUserWorkspacePBSchema);
}

export function UserEventOpenWorkspace(payload: MessageInitShape<typeof OpenUserWorkspacePBSchema>): Promise<FlowyResult<void>> {
  return request('OpenWorkspace', toBinary(OpenUserWorkspacePBSchema, create(OpenUserWorkspacePBSchema, payload)));
}

export function UserEventGetUserWorkspace(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<FlowyResult<UserWorkspacePB>> {
  return request('GetUserWorkspace', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), UserWorkspacePBSchema);
}

export function UserEventUpdateNetworkState(payload: MessageInitShape<typeof NetworkStatePBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateNetworkState', toBinary(NetworkStatePBSchema, create(NetworkStatePBSchema, payload)));
}

export function UserEventGetAnonUser(): Promise<FlowyResult<UserProfilePB>> {
  return request('GetAnonUser', EMPTY, UserProfilePBSchema);
}

export function UserEventOpenAnonUser(): Promise<FlowyResult<void>> {
  return request('OpenAnonUser', EMPTY);
}

export function UserEventPushRealtimeEvent(payload: MessageInitShape<typeof RealtimePayloadPBSchema>): Promise<FlowyResult<void>> {
  return request('PushRealtimeEvent', toBinary(RealtimePayloadPBSchema, create(RealtimePayloadPBSchema, payload)));
}

export function UserEventCreateReminder(payload: MessageInitShape<typeof ReminderPBSchema>): Promise<FlowyResult<void>> {
  return request('CreateReminder', toBinary(ReminderPBSchema, create(ReminderPBSchema, payload)));
}

export function UserEventGetAllReminders(): Promise<FlowyResult<RepeatedReminderPB>> {
  return request('GetAllReminders', EMPTY, RepeatedReminderPBSchema);
}

export function UserEventRemoveReminder(payload: MessageInitShape<typeof ReminderIdentifierPBSchema>): Promise<FlowyResult<void>> {
  return request('RemoveReminder', toBinary(ReminderIdentifierPBSchema, create(ReminderIdentifierPBSchema, payload)));
}

export function UserEventUpdateReminder(payload: MessageInitShape<typeof ReminderPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateReminder', toBinary(ReminderPBSchema, create(ReminderPBSchema, payload)));
}

export function UserEventSetDateTimeSettings(payload: MessageInitShape<typeof DateTimeSettingsPBSchema>): Promise<FlowyResult<void>> {
  return request('SetDateTimeSettings', toBinary(DateTimeSettingsPBSchema, create(DateTimeSettingsPBSchema, payload)));
}

export function UserEventGetDateTimeSettings(): Promise<FlowyResult<DateTimeSettingsPB>> {
  return request('GetDateTimeSettings', EMPTY, DateTimeSettingsPBSchema);
}

export function UserEventSetNotificationSettings(payload: MessageInitShape<typeof NotificationSettingsPBSchema>): Promise<FlowyResult<void>> {
  return request('SetNotificationSettings', toBinary(NotificationSettingsPBSchema, create(NotificationSettingsPBSchema, payload)));
}

export function UserEventGetNotificationSettings(): Promise<FlowyResult<NotificationSettingsPB>> {
  return request('GetNotificationSettings', EMPTY, NotificationSettingsPBSchema);
}

export function UserEventAddWorkspaceMember(payload: MessageInitShape<typeof AddWorkspaceMemberPBSchema>): Promise<FlowyResult<void>> {
  return request('AddWorkspaceMember', toBinary(AddWorkspaceMemberPBSchema, create(AddWorkspaceMemberPBSchema, payload)));
}

export function UserEventRemoveWorkspaceMember(payload: MessageInitShape<typeof RemoveWorkspaceMemberPBSchema>): Promise<FlowyResult<void>> {
  return request('RemoveWorkspaceMember', toBinary(RemoveWorkspaceMemberPBSchema, create(RemoveWorkspaceMemberPBSchema, payload)));
}

export function UserEventUpdateWorkspaceMember(payload: MessageInitShape<typeof UpdateWorkspaceMemberPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateWorkspaceMember', toBinary(UpdateWorkspaceMemberPBSchema, create(UpdateWorkspaceMemberPBSchema, payload)));
}

export function UserEventGetWorkspaceMembers(payload: MessageInitShape<typeof QueryWorkspacePBSchema>): Promise<FlowyResult<RepeatedWorkspaceMemberPB>> {
  return request('GetWorkspaceMembers', toBinary(QueryWorkspacePBSchema, create(QueryWorkspacePBSchema, payload)), RepeatedWorkspaceMemberPBSchema);
}

export function UserEventImportAppFlowyDataFolder(payload: MessageInitShape<typeof ImportAppFlowyDataPBSchema>): Promise<FlowyResult<void>> {
  return request('ImportAppFlowyDataFolder', toBinary(ImportAppFlowyDataPBSchema, create(ImportAppFlowyDataPBSchema, payload)));
}

export function UserEventCreateWorkspace(payload: MessageInitShape<typeof CreateWorkspacePBSchema>): Promise<FlowyResult<UserWorkspacePB>> {
  return request('CreateWorkspace', toBinary(CreateWorkspacePBSchema, create(CreateWorkspacePBSchema, payload)), UserWorkspacePBSchema);
}

export function UserEventDeleteWorkspace(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<FlowyResult<void>> {
  return request('DeleteWorkspace', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)));
}

export function UserEventRenameWorkspace(payload: MessageInitShape<typeof RenameWorkspacePBSchema>): Promise<FlowyResult<void>> {
  return request('RenameWorkspace', toBinary(RenameWorkspacePBSchema, create(RenameWorkspacePBSchema, payload)));
}

export function UserEventChangeWorkspaceIcon(payload: MessageInitShape<typeof ChangeWorkspaceIconPBSchema>): Promise<FlowyResult<void>> {
  return request('ChangeWorkspaceIcon', toBinary(ChangeWorkspaceIconPBSchema, create(ChangeWorkspaceIconPBSchema, payload)));
}

export function UserEventLeaveWorkspace(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<FlowyResult<void>> {
  return request('LeaveWorkspace', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)));
}

export function UserEventInviteWorkspaceMember(payload: MessageInitShape<typeof WorkspaceMemberInvitationPBSchema>): Promise<FlowyResult<void>> {
  return request('InviteWorkspaceMember', toBinary(WorkspaceMemberInvitationPBSchema, create(WorkspaceMemberInvitationPBSchema, payload)));
}

export function UserEventListWorkspaceInvitations(): Promise<FlowyResult<RepeatedWorkspaceInvitationPB>> {
  return request('ListWorkspaceInvitations', EMPTY, RepeatedWorkspaceInvitationPBSchema);
}

export function UserEventAcceptWorkspaceInvitation(payload: MessageInitShape<typeof AcceptWorkspaceInvitationPBSchema>): Promise<FlowyResult<void>> {
  return request('AcceptWorkspaceInvitation', toBinary(AcceptWorkspaceInvitationPBSchema, create(AcceptWorkspaceInvitationPBSchema, payload)));
}

export function UserEventMagicLinkSignIn(payload: MessageInitShape<typeof MagicLinkSignInPBSchema>): Promise<FlowyResult<UserProfilePB>> {
  return request('MagicLinkSignIn', toBinary(MagicLinkSignInPBSchema, create(MagicLinkSignInPBSchema, payload)), UserProfilePBSchema);
}

export function UserEventSubscribeWorkspace(payload: MessageInitShape<typeof SubscribeWorkspacePBSchema>): Promise<FlowyResult<PaymentLinkPB>> {
  return request('SubscribeWorkspace', toBinary(SubscribeWorkspacePBSchema, create(SubscribeWorkspacePBSchema, payload)), PaymentLinkPBSchema);
}

export function UserEventCancelWorkspaceSubscription(payload: MessageInitShape<typeof CancelWorkspaceSubscriptionPBSchema>): Promise<FlowyResult<void>> {
  return request('CancelWorkspaceSubscription', toBinary(CancelWorkspaceSubscriptionPBSchema, create(CancelWorkspaceSubscriptionPBSchema, payload)));
}

export function UserEventGetWorkspaceUsage(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<FlowyResult<WorkspaceUsagePB>> {
  return request('GetWorkspaceUsage', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), WorkspaceUsagePBSchema);
}

export function UserEventGetBillingPortal(): Promise<FlowyResult<BillingPortalPB>> {
  return request('GetBillingPortal', EMPTY, BillingPortalPBSchema);
}

export function UserEventGetMemberInfo(payload: MessageInitShape<typeof WorkspaceMemberIdPBSchema>): Promise<FlowyResult<WorkspaceMemberPB>> {
  return request('GetMemberInfo', toBinary(WorkspaceMemberIdPBSchema, create(WorkspaceMemberIdPBSchema, payload)), WorkspaceMemberPBSchema);
}

export function UserEventUpdateWorkspaceSetting(payload: MessageInitShape<typeof UpdateUserWorkspaceSettingPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateWorkspaceSetting', toBinary(UpdateUserWorkspaceSettingPBSchema, create(UpdateUserWorkspaceSettingPBSchema, payload)));
}

export function UserEventGetWorkspaceSetting(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<FlowyResult<WorkspaceSettingsPB>> {
  return request('GetWorkspaceSetting', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), WorkspaceSettingsPBSchema);
}

export function UserEventGetWorkspaceSubscriptionInfo(payload: MessageInitShape<typeof UserWorkspaceIdPBSchema>): Promise<FlowyResult<WorkspaceSubscriptionInfoPB>> {
  return request('GetWorkspaceSubscriptionInfo', toBinary(UserWorkspaceIdPBSchema, create(UserWorkspaceIdPBSchema, payload)), WorkspaceSubscriptionInfoPBSchema);
}

export function UserEventUpdateWorkspaceSubscriptionPaymentPeriod(payload: MessageInitShape<typeof UpdateWorkspaceSubscriptionPaymentPeriodPBSchema>): Promise<FlowyResult<void>> {
  return request('UpdateWorkspaceSubscriptionPaymentPeriod', toBinary(UpdateWorkspaceSubscriptionPaymentPeriodPBSchema, create(UpdateWorkspaceSubscriptionPaymentPeriodPBSchema, payload)));
}

export function UserEventGetSubscriptionPlanDetails(): Promise<FlowyResult<RepeatedSubscriptionPlanDetailPB>> {
  return request('GetSubscriptionPlanDetails', EMPTY, RepeatedSubscriptionPlanDetailPBSchema);
}

export function UserEventNotifyDidSwitchPlan(payload: MessageInitShape<typeof SuccessWorkspaceSubscriptionPBSchema>): Promise<FlowyResult<void>> {
  return request('NotifyDidSwitchPlan', toBinary(SuccessWorkspaceSubscriptionPBSchema, create(SuccessWorkspaceSubscriptionPBSchema, payload)));
}

export function UserEventDeleteAccount(): Promise<FlowyResult<void>> {
  return request('DeleteAccount', EMPTY);
}

export function UserEventPasscodeSignIn(payload: MessageInitShape<typeof PasscodeSignInPBSchema>): Promise<FlowyResult<GotrueTokenResponsePB>> {
  return request('PasscodeSignIn', toBinary(PasscodeSignInPBSchema, create(PasscodeSignInPBSchema, payload)), GotrueTokenResponsePBSchema);
}
