import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { WorkspaceMemberPB } from '@shared/protobuf/flowy-user/workspace_pb';
import { WorkspacePlanPB, AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { Copy, Mail, MoreHorizontal, Trash2 } from 'lucide-react';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/reui/badge';
import { tr as trNow, useI18nStore, useTr } from '@/i18n';
import { AFAvatar, Tooltip, showConfirmDialog, showToast } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { formatJoinedDate, isEmail, roleCan, roleDescriptionKey } from './members-core';
import { createWorkspaceMemberStore, type WorkspaceMemberStore } from './members-store';

// WorkspaceMembersPage (widgets/members/workspace_member_page.dart) and the desktop invitation
// widgets (invitation/invite_member_by_link.dart, invite_member_by_email.dart).

export function MembersPage({ user }: SettingsPageProps) {
  const { tr } = useTr();
  const [bloc] = useState<WorkspaceMemberStore>(() => createWorkspaceMemberStore(user));
  const state = useStore(bloc.store);

  useEffect(() => {
    void bloc.actions.initial();
    return () => bloc.actions.close();
  }, [bloc]);

  return (
    <>
      <SettingsPageHeader title={tr('settings.appearance.members.title')} />
      {roleCan.invite(state.myRole) && <SettingsSection><SettingsGroup>
        <InviteMemberByLink bloc={bloc} />
        <InviteMemberByEmail bloc={bloc} />
      </SettingsGroup></SettingsSection>}
      {state.members.length > 0 && <SettingsSection><SettingsGroup><MemberList bloc={bloc} members={state.members} myRole={state.myRole} myEmail={user.email} /></SettingsGroup></SettingsSection>}
    </>
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
        confirmButtonColor: 'var(--destructive)',
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

  return <SettingsRow label={tr('settings.appearance.members.inviteLinkToAddMember')} description={<>
    {tr('settings.appearance.members.clickToCopyLink')}{` ${tr('settings.appearance.members.or')} `}
    <Button variant="link" className="h-auto p-0 text-xs" onClick={onGenerate}>{tr('settings.appearance.members.generateANewLink')}</Button>
  </>} control={<Button variant="outline" size="sm" onClick={onCopy}><Copy className="size-4" />{tr('settings.appearance.members.copyLink')}</Button>} />;
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

  return <SettingsRow label={tr('settings.appearance.members.inviteMemberByEmail')}>
    <div className="flex items-start gap-3"><InputGroup><InputGroupAddon><Mail className="size-4" /></InputGroupAddon>
      <InputGroupInput spellCheck={false} value={email} aria-label={tr('settings.appearance.members.inviteMemberByEmail')} placeholder={tr('settings.appearance.members.inviteHint')} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') invite(); }} />
    </InputGroup><Button onClick={invite}>{tr('settings.appearance.members.sendInvite')}</Button></div>
  </SettingsRow>;
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
  return <Table className="table-fixed"><TableHeader><TableRow>
    <TableHead className="w-2/5 px-4 text-xs font-medium text-muted-foreground">{tr('settings.appearance.members.user')}</TableHead>
    <TableHead className="text-xs font-medium text-muted-foreground">{tr('settings.appearance.members.role')}</TableHead>
    <TableHead className="text-xs font-medium text-muted-foreground">{tr('settings.accountPage.email.title')}</TableHead>
    <TableHead className="w-12" />
  </TableRow></TableHeader><TableBody>{members.map((member) => <MemberItem key={member.email} bloc={bloc} member={member} myRole={myRole} myEmail={myEmail} />)}</TableBody></Table>;
}

function MemberItem({ bloc, member, myRole, myEmail }: { bloc: WorkspaceMemberStore; member: WorkspaceMemberPB; myRole: AFRolePB; myEmail: string }) {
  const { tr } = useTr();
  const locale = useI18nStore((s) => s.locale);
  const avatarUrl = member.oneOfAvatarUrl.case === 'avatarUrl' ? member.oneOfAvatarUrl.value : '';
  const joinedAt = member.oneOfJoinedAt.case === 'joinedAt' ? Number(member.oneOfJoinedAt.value) : 0;
  return <TableRow>
    <TableCell className="px-4 py-3"><div className="flex min-w-0 items-center gap-2">
      <span className="contents [&_[data-slot=avatar]]:size-7!"><AFAvatar url={avatarUrl} name={member.name} size="s" /></span>
      <div className="min-w-0"><div className="truncate text-sm font-medium">{member.name}</div><div className="truncate text-xs text-muted-foreground">{formatJoinedDate(joinedAt, locale)}</div></div>
    </div></TableCell>
    <TableCell><Badge variant={member.role === AFRolePB.Owner ? 'info-light' : 'secondary'} size="sm">{tr(roleDescriptionKey(member.role))}</Badge></TableCell>
    <TableCell><Tooltip message={member.email}><span className="block truncate text-sm">{member.email}</span></Tooltip></TableCell>
    <TableCell>{roleCan.delete(myRole) && member.email !== myEmail && <MemberMoreActionList bloc={bloc} member={member} />}</TableCell>
  </TableRow>;
}

function MemberMoreActionList({ bloc, member }: { bloc: WorkspaceMemberStore; member: WorkspaceMemberPB }) {
  const { tr } = useTr();
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tr('settings.appearance.members.removeFromWorkspace')} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56"><DropdownMenuItem variant="destructive" onClick={() => {
      showConfirmDialog({
        style: 'cancelAndOk',
        title: tr('settings.appearance.members.removeMember'),
        description: tr('settings.appearance.members.areYouSureToRemoveMember'),
        confirmLabel: tr('button.yes'),
        onConfirm: () => void bloc.actions.removeMember(member.email),
      });
    }}><Trash2 className="size-4" />{tr('settings.appearance.members.removeFromWorkspace')}</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu>;
}
