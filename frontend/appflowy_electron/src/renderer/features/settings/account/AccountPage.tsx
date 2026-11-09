import { useEffect, useRef, useState } from 'react';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventDeleteAccount, UserEventSignOut, UserEventUpdateUserProfile } from '@/backend/events';
import { ArrowLeft, PencilLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Badge } from '@/components/reui/badge';
import { HyperLogo } from '@/ui/HyperLogo';
import { useTr, tr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { isAuthEnabled } from '@/startup/cloud-env';
import { runAppFlowy } from '@/startup/launcher';
import { signInActions, useSignInStore } from '@/features/auth/sign-in-store';
import { useDeepLinkStore } from '@/startup/deep-link';
import { AFAvatar, AFTextField, Tooltip, showConfirmDialog, showDialog, showToast, type AFTextFieldHandle } from '@/ui';
import { EmojiPicker } from '../emoji/EmojiPicker';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody, SettingsCategory } from '../shared';
import { SettingsInputField } from '../shared-widgets';
import { showChangePasswordDialog, showSetupPasswordDialog } from './PasswordDialogs';
import { usePasswordStore } from './password-store';

/** SettingsUserViewBloc: every change is one UpdateUserProfile with only that field. */
async function updateUserProfile(user: UserProfilePB, field: { name?: string; iconUrl?: string }) {
  const result = await UserEventUpdateUserProfile({
    id: user.id,
    oneOfName: field.name !== undefined ? { case: 'name', value: field.name } : { case: undefined },
    oneOfIconUrl: field.iconUrl !== undefined ? { case: 'iconUrl', value: field.iconUrl } : { case: undefined },
  });
  if (!result.ok) console.error(result.error.msg);
}

/** AccountUserProfile (pages/account/account_user_profile.dart). */
function AccountUserProfile({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  const [name, setName] = useState(user.name);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(user.name);
  useEffect(() => setName(user.name), [user.name]);

  const save = (value: string) => {
    // onSave: optimistic setState, then updateUserName (no validation).
    setName(value);
    void updateUserProfile(user, { name: value });
    setEditing(false);
  };

  const pickIcon = () =>
    showDialog((close) => (
      <div className="rounded-xl bg-popover py-3 shadow-xl ring-1 ring-foreground/10">
        <EmojiPicker
          onSelected={(emoji) => {
            void updateUserProfile(user, { iconUrl: emoji });
            close();
          }}
        />
      </div>
    ));

  return <SettingsRow label={<div className="flex min-w-0 items-center gap-4">
    <Tooltip message={tr('settings.accountPage.general.changeProfilePicture')} verticalOffset={28}>
      <button type="button" className="inline-flex rounded-full focus-visible:ring-2 focus-visible:ring-ring" onClick={pickIcon} aria-label={tr('settings.accountPage.general.changeProfilePicture')}><AFAvatar url={user.iconUrl} name={name} size="l" /></button>
    </Tooltip>
    <div className="min-w-0 flex-1">{editing ? <SettingsInputField value={name} text={text} setText={setText} autoFocus onSave={() => save(text)} onBlur={(value) => save(value)} onCancel={() => setEditing(false)} onEscape={() => setEditing(false)} /> :
      <div className="flex items-center gap-1"><span className="truncate text-sm font-medium">{name}</span><Button variant="ghost" size="icon-sm" aria-label="Rename" onClick={() => { setText(name); setEditing(true); }}><PencilLine className="size-4" /></Button></div>}
    </div>
  </div>} />;
}

/** SettingsEmailSection: read-only. */
function EmailSection({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  return <SettingsRow label={tr('settings.accountPage.email.title')} description={user.email} />;
}

/** ChangePasswordSection: "Change password" or "Setup password". */
function PasswordSection() {
  const { tr } = useTr();
  const hasPassword = usePasswordStore((s) => s.hasPassword);
  return <SettingsRow label={tr('newSettings.myAccount.password.title')} control={<Button variant="outline" size="sm" onClick={hasPassword ? showChangePasswordDialog : showSetupPasswordDialog}>{hasPassword ? tr('newSettings.myAccount.password.changePassword') : tr('newSettings.myAccount.password.setupPassword')}</Button>} />;
}

/** The "Log in" dialog: FlowyDialog(375×485) with a back/close header and email + password sign-in. */
function LoginDialog({ close, didLogin }: { close: () => void; didLogin: () => void }) {
  const { tr } = useTr();
  const email = useRef<AFTextFieldHandle>(null);
  const password = useRef<AFTextFieldHandle>(null);
  const { isSubmitting, emailError, passwordError, successOrFail } = useSignInStore();
  const deepLinkState = useDeepLinkStore((s) => s.state);
  useEffect(() => {
    // The token goes through the login-callback deep link, which runs runAppFlowy() itself.
    if (deepLinkState === 'finish') {
      close();
      didLogin();
    }
  }, [deepLinkState, close, didLogin]);
  useEffect(() => {
    if (emailError) email.current?.syncError(emailError);
    if (passwordError) password.current?.syncError(passwordError);
  }, [emailError, passwordError]);
  const submit = () => void signInActions.signInWithEmailAndPassword(email.current?.value() ?? '', password.current?.value() ?? '');
  return <div className="flex max-h-[30rem] w-[min(24rem,calc(100vw-5rem))] flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
    <div className="flex items-center"><Button variant="ghost" size="sm" onClick={close}><ArrowLeft className="size-4" />{tr('button.back')}</Button><Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={close}><X className="size-4" /></Button></div>
    <h2 className="text-base font-medium">{tr('settings.accountPage.login.loginLabel')}</h2>
    <AFTextField ref={email} size="m" hintText={tr('signIn.pleaseInputYourEmail')} type="email" autoFocus onSubmitted={() => password.current?.focus()} />
    <AFTextField ref={password} size="m" hintText={tr('signIn.enterPassword')} obscureText onSubmitted={submit} />
    <Button size="lg" className="w-full" disabled={isSubmitting} onClick={submit}>{tr('signIn.continueWithPassword')}</Button>
    {successOrFail && !successOrFail.ok && <div className="text-sm text-destructive">{successOrFail.message}</div>}
  </div>;
}

/** AccountSignInOutSection: "Log in" (signIn) or "Log out". */
function SignInOutSection({ signIn, didLogout, didLogin }: { signIn: boolean; didLogout: () => void; didLogin: () => void }) {
  const { tr } = useTr();
  const onTap = () => {
    if (signIn) {
      signInActions.cancel();
      showDialog((close) => <LoginDialog close={close} didLogin={didLogin} />);
      return;
    }
    // showCancelAndConfirmDialog: confirm "Yes" in the primary color.
    showConfirmDialog({
      title: tr('settings.accountPage.login.logoutLabel'),
      description: tr('settings.menu.logoutPrompt'),
      style: 'cancelAndOk',
      confirmLabel: tr('button.yes'),
      onConfirm: async () => {
        await UserEventSignOut();
        didLogout();
      },
    });
  };
  return <SettingsRow label={tr('settings.accountPage.login.title')} control={<Button variant="outline" size="sm" onClick={onTap}>{signIn ? tr('settings.accountPage.login.loginLabel') : tr('settings.accountPage.login.logoutLabel')}</Button>} />;
}

/** SettingsAppVersion: the "up to date" branch (AutoUpdateTask is removed in this checkout). */
function AppVersion() {
  const { tr } = useTr();
  const version = useAppStore((s) => s.info?.version ?? '');
  return <SettingsRow label={<div className="flex items-center gap-3"><HyperLogo size={32} /><div className="flex flex-col gap-1"><span className="text-sm font-semibold">HyperTask</span><span className="font-mono text-xs text-muted-foreground">{tr('settings.accountPage.officialVersion', { namedArgs: { version } })}</span></div></div>} control={<Badge variant="success-light" size="sm">{tr('settings.accountPage.isUpToDate')}</Badge>} />;
}

const DELETE_CONFIRM_TEXTS = ['delete my account', 'deletemyaccount', 'DELETE MY ACCOUNT', 'DELETEMYACCOUNT'];

/** deleteMyAccount: checkbox, then the confirmation text, then UserEventDeleteAccount. */
export function deleteAccountCheck(text: string, checked: boolean): 'unchecked' | 'mismatch' | null {
  if (!checked) return 'unchecked';
  if (!DELETE_CONFIRM_TEXTS.includes(text) && text !== tr('newSettings.myAccount.deleteAccount.confirmHint3')) return 'mismatch';
  return null;
}

function AccountDeletionBody({ textRef, checkedRef }: { textRef: { current: string }; checkedRef: { current: boolean } }) {
  const { tr } = useTr();
  const [checked, setChecked] = useState(false);
  return <div className="flex flex-col gap-3 text-sm">
    <div>{tr('newSettings.myAccount.deleteAccount.confirmHint1')}</div>
    <Input placeholder={tr('newSettings.myAccount.deleteAccount.confirmHint3')} onChange={(event) => (textRef.current = event.target.value)} />
    <label className="flex items-start gap-2"><Checkbox checked={checked} onCheckedChange={() => { checkedRef.current = !checked; setChecked(!checked); }} /><span>{tr('newSettings.myAccount.deleteAccount.confirmHint2')}</span></label>
  </div>;
}

/** AccountDeletionButton (pages/account/account_deletion.dart). */
function AccountDeletion({ closeDialog }: { closeDialog: () => void }) {
  const { tr } = useTr();
  const onTap = () => {
    const textRef = { current: '' };
    const checkedRef = { current: false };
    showConfirmDialog({
      title: tr('newSettings.myAccount.deleteAccount.title'),
      description: '',
      style: 'cancelAndOk',
      confirmLabel: tr('space.delete'),
      closeOnAction: false,
      children: <AccountDeletionBody textRef={textRef} checkedRef={checkedRef} />,
      onConfirm: async (close) => {
        const problem = deleteAccountCheck(textRef.current.trim(), checkedRef.current);
        if (problem === 'unchecked') {
          showToast({ message: tr('newSettings.myAccount.deleteAccount.checkToConfirmError'), type: 'warning' });
          return;
        }
        if (problem === 'mismatch') {
          showToast({ message: tr('newSettings.myAccount.deleteAccount.confirmTextValidationFailed'), type: 'warning' });
          return;
        }
        const result = await UserEventDeleteAccount();
        if (!result.ok) {
          showToast({ message: result.error.msg, type: 'error' });
          return;
        }
        showToast({ message: tr('newSettings.myAccount.deleteAccount.deleteAccountSuccess') });
        close();
        window.setTimeout(() => {
          closeDialog();
          void runAppFlowy();
        }, 1000);
      },
    });
  };
  return <SettingsSection title={tr('button.deleteAccount')}><SettingsGroup className="border-destructive/30"><SettingsRow label={tr('button.deleteAccount')} description={tr('newSettings.myAccount.deleteAccount.description')} destructive control={<Button variant="destructive" size="sm" onClick={onTap}>{tr('button.deleteAccount')}</Button>} /></SettingsGroup></SettingsSection>;
}

/** SettingsAccountView (pages/settings_account_view.dart). */
export function AccountPage({ user, closeDialog, didLogout, snapshotAuthType }: SettingsPageProps & { snapshotAuthType: AuthTypePB }) {
  const { tr } = useTr();
  const env = useAppStore((s) => s.env);
  const authEnabled = env ? isAuthEnabled(env) : false;
  const authType = user.userAuthType;
  return (
    <SettingsBody title={tr('newSettings.myAccount.title')} autoSeparate={false}>
      <SettingsCategory key="profile" title={tr('newSettings.myAccount.myProfile')}>
        <AccountUserProfile user={user} />
      </SettingsCategory>
      {authEnabled && authType !== AuthTypePB.Local && (
        <SettingsCategory key="account" title={tr('newSettings.myAccount.myAccount')}>
          <EmailSection user={user} />
          <PasswordSection />
          <SignInOutSection signIn={false} didLogout={didLogout} didLogin={closeDialog} />
        </SettingsCategory>
      )}
      {authEnabled && authType === AuthTypePB.Local && (
        <SettingsCategory key="login" title={tr('settings.accountPage.login.title')}>
          <SignInOutSection signIn didLogout={didLogout} didLogin={closeDialog} />
        </SettingsCategory>
      )}
      <SettingsCategory key="about" title={tr('newSettings.myAccount.aboutAppFlowy')}>
        <AppVersion />
        <div className="px-4 py-3 text-xs text-muted-foreground">Developed by NaveDanan</div>
      </SettingsCategory>
      {snapshotAuthType === AuthTypePB.Server && <AccountDeletion key="delete" closeDialog={closeDialog} />}
    </SettingsBody>
  );
}
