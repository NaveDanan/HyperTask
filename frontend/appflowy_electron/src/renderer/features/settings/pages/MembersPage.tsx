import { useEffect, useState, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import type { WorkspaceMemberPB } from '@shared/protobuf/flowy-user/workspace_pb';
import { WorkspacePlanPB, type AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FlowySvg } from '@/icons/FlowySvg';
import { tr as trNow, useI18nStore, useTr } from '@/i18n';
import { AFAvatar, AFButton, AFTextField, ActionRow, AppFlowyPopover, FlowyButton, Tooltip, VSpace, showConfirmDialog, showToast } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody, SettingsCategorySpacer } from '../shared';
import { formatJoinedDate, isEmail, roleCan, roleDescriptionKey } from './members-core';
import { createWorkspaceMemberStore, type WorkspaceMemberStore } from './members-store';

// WorkspaceMembersPage (widgets/members/workspace_member_page.dart) and the desktop invitation
// widgets (invitation/invite_member_by_link.dart, invite_member_by_email.dart).

const body = (weight: 400 | 600, color = 'var(--af-text-primary)'): CSSProperties => ({
  fontSize: 'calc(14px * var(--text-scale, 1))',
  lineHeight: '20px',
  fontWeight: weight,
  color,
});
const caption = (color = 'var(--af-text-primary)'): CSSProperties => ({
  fontSize: 'calc(12px * var(--text-scale, 1))',
  lineHeight: '18px',
  fontWeight: 400,
  color,
});
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Material Divider (height 16, hairline centered). */
const Divider = ({ color = 'var(--af-border-primary)' }: { color?: string }) => (
  <div style={{ height: 16, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
    <div style={{ height: 1, flex: 1, background: color, transform: 'scaleY(0.5)' }} />
  </div>
);

/** SettingsCategorySpacer(bottomSpacing: 0). */
const SpacerNoBottom = () => (
  <div style={{ paddingTop: 12, flexShrink: 0 }}>
    <Divider />
  </div>
);

export function MembersPage({ user }: SettingsPageProps) {
  const { tr } = useTr();
  const [bloc] = useState<WorkspaceMemberStore>(() => createWorkspaceMemberStore(user));
  const state = useStore(bloc.store);

  useEffect(() => {
    void bloc.actions.initial();
    return () => bloc.actions.close();
  }, [bloc]);

  return (
    <SettingsBody title={tr('settings.appearance.members.title')} autoSeparate={false}>
      {roleCan.invite(state.myRole) && (
        <div>
          <InviteMemberByLink bloc={bloc} />
          <SettingsCategorySpacer />
          <InviteMemberByEmail bloc={bloc} />
          <SpacerNoBottom />
        </div>
      )}
      {state.members.length > 0 && <MemberList bloc={bloc} members={state.members} myRole={state.myRole} myEmail={user.email} />}
    </SettingsBody>
  );
}

/** The Free-plan member limit check shared by "Copy link" and "generate a new link". */
function showUpgradeDialog(bloc: WorkspaceMemberStore) {
  showConfirmDialog({
    title: trNow('settings.appearance.members.inviteFailedDialogTitle'),
    description: trNow('settings.appearance.members.inviteFailedMemberLimit'),
    confirmLabel: trNow('upgradePlanModal.actionButton'),
    onConfirm: () => void bloc.actions.upgradePlan(),
  });
}

function InviteMemberByLink({ bloc }: { bloc: WorkspaceMemberStore }) {
  const { tr } = useTr();

  const onGenerate = () => {
    const state = bloc.store.getState();
    if (state.inviteLink === null && state.subscriptionInfo?.plan === WorkspacePlanPB.FreePlan && state.members.length >= 2) {
      showUpgradeDialog(bloc);
      return;
    }
    if (state.inviteLink !== null) {
      showConfirmDialog({
        style: 'cancelAndOk',
        title: tr('settings.appearance.members.resetInviteLink'),
        description: tr('settings.appearance.members.resetInviteLinkDescription'),
        confirmLabel: tr('settings.appearance.members.reset'),
        // confirmButtonBuilder: AFFilledTextButton.destructive
        confirmButtonColor: 'var(--af-fill-error-thick)',
        onConfirm: () => void bloc.actions.generateInviteLink(),
      });
    } else {
      void bloc.actions.generateInviteLink();
    }
  };

  const onCopy = () => {
    const state = bloc.store.getState();
    if (state.subscriptionInfo?.plan === WorkspacePlanPB.FreePlan && state.members.length >= 2) {
      showUpgradeDialog(bloc);
      return;
    }
    if (state.inviteLink !== null) {
      window.appflowy.clipboard.writeText(state.inviteLink);
      showToast({ message: tr('shareAction.copyLinkSuccess') });
    } else {
      showToast({ message: tr('settings.appearance.members.noInviteLink'), type: 'error' });
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...body(600), ...ellipsis }}>{tr('settings.appearance.members.inviteLinkToAddMember')}</div>
        <div style={caption()}>
          {tr('settings.appearance.members.clickToCopyLink')}
          {` ${tr('settings.appearance.members.or')} `}
          <span style={{ color: 'var(--af-text-action)', cursor: 'pointer' }} onClick={onGenerate}>
            {tr('settings.appearance.members.generateANewLink')}
          </span>
        </div>
      </div>
      <AFButton
        variant="outlinedNormal"
        text={tr('settings.appearance.members.copyLink')}
        padding="6px 12px"
        style={{ fontWeight: 400, color: 'var(--af-text-primary)' }}
        onTap={onCopy}
      />
    </div>
  );
}

function InviteMemberByEmail({ bloc }: { bloc: WorkspaceMemberStore }) {
  const { tr } = useTr();
  const [email, setEmail] = useState('');

  const invite = () => {
    if (!isEmail(email)) {
      showToast({ type: 'error', message: tr('settings.appearance.members.emailInvalidError') });
      return;
    }
    void bloc.actions.inviteByEmail(email);
    // Clear the field right after inviting.
    setEmail('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={body(600)}>{tr('settings.appearance.members.inviteMemberByEmail')}</div>
      <VSpace size={8} />
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <AFTextField
          size="m"
          value={email}
          hintText={tr('settings.appearance.members.inviteHint')}
          onChanged={setEmail}
          onSubmitted={invite}
          style={{ flex: 1, minWidth: 0 }}
        />
        <div style={{ width: 12, flexShrink: 0 }} />
        <AFButton variant="filledPrimary" text={tr('settings.appearance.members.sendInvite')} onTap={invite} />
      </div>
    </div>
  );
}

function MemberList({
  bloc,
  members,
  myRole,
  myEmail,
}: {
  bloc: WorkspaceMemberStore;
  members: WorkspaceMemberPB[];
  myRole: AFRolePB;
  myEmail: string;
}) {
  const { tr } = useTr();
  const secondary = body(400, 'var(--af-text-secondary)');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 4, minWidth: 0, ...secondary }}>{tr('settings.appearance.members.user')}</div>
        <div style={{ flex: 2, minWidth: 0, ...secondary }}>{tr('settings.appearance.members.role')}</div>
        <div style={{ flex: 3, minWidth: 0, ...secondary }}>{tr('settings.accountPage.email.title')}</div>
        <div style={{ width: 28, flexShrink: 0 }} />
      </div>
      {members.map((member) => (
        <div key={member.email}>
          <Divider />
          <MemberItem bloc={bloc} member={member} myRole={myRole} myEmail={myEmail} />
        </div>
      ))}
    </div>
  );
}

function MemberItem({ bloc, member, myRole, myEmail }: { bloc: WorkspaceMemberStore; member: WorkspaceMemberPB; myRole: AFRolePB; myEmail: string }) {
  const { tr } = useTr();
  const locale = useI18nStore((s) => s.locale);
  const avatarUrl = member.oneOfAvatarUrl.case === 'avatarUrl' ? member.oneOfAvatarUrl.value : '';
  const joinedAt = member.oneOfJoinedAt.case === 'joinedAt' ? Number(member.oneOfJoinedAt.value) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 4, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        <AFAvatar url={avatarUrl} name={member.name} size="s" />
        <div style={{ width: 8, flexShrink: 0 }} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...body(600), ...ellipsis }}>{member.name}</div>
          <div style={{ ...caption('var(--af-text-secondary)'), ...ellipsis }}>{formatJoinedDate(joinedAt, locale)}</div>
        </div>
        <div style={{ width: 8, flexShrink: 0 }} />
      </div>
      {/* The role is read-only text for every role (_MemberRoleActionList renders text only). */}
      <div style={{ flex: 2, minWidth: 0, ...body(400) }}>{tr(roleDescriptionKey(member.role))}</div>
      <div style={{ flex: 3, minWidth: 0, display: 'flex' }}>
        <Tooltip message={member.email}>
          <div style={{ ...body(400), ...ellipsis, minWidth: 0 }}>{member.email}</div>
        </Tooltip>
      </div>
      {roleCan.delete(myRole) && member.email !== myEmail ? (
        <MemberMoreActionList bloc={bloc} member={member} />
      ) : (
        <div style={{ width: 28, flexShrink: 0 }} />
      )}
    </div>
  );
}

function MemberMoreActionList({ bloc, member }: { bloc: WorkspaceMemberStore; member: WorkspaceMemberPB }) {
  const { tr } = useTr();
  return (
    <AppFlowyPopover
      asBarrier
      direction="bottomWithCenterAligned"
      constraints={{ minWidth: 120, maxWidth: 460, maxHeight: 300 }}
      popup={(close) => (
        <ActionRow
          name={tr('settings.appearance.members.removeFromWorkspace')}
          onTap={() => {
            showConfirmDialog({
              style: 'cancelAndOk',
              title: tr('settings.appearance.members.removeMember'),
              description: tr('settings.appearance.members.areYouSureToRemoveMember'),
              confirmLabel: tr('button.yes'),
              confirmButtonColor: 'var(--cs-primary)',
              onConfirm: () => void bloc.actions.removeMember(member.email),
            });
            close();
          }}
        />
      )}
    >
      <FlowyButton useIntrinsicWidth text={<FlowySvg svg="three_dots_s" />} />
    </AppFlowyPopover>
  );
}

