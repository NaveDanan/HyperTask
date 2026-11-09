import { useEffect, useRef, useState } from 'react';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventDeleteAccount, UserEventSignOut, UserEventUpdateUserProfile } from '@/backend/events';
import { FlowySvg } from '@/icons/FlowySvg';
import { useTr, tr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { isAuthEnabled } from '@/startup/cloud-env';
import { runAppFlowy } from '@/startup/launcher';
import { signInActions, useSignInStore } from '@/features/auth/sign-in-store';
import { useDeepLinkStore } from '@/startup/deep-link';
import { AFAvatar, AFButton, AFTextField, FlowyDialog, FlowyText, MaterialDialog, Tooltip, VSpace, showConfirmDialog, showDialog, showToast, type AFTextFieldHandle } from '@/ui';
import { EmojiPicker } from '../emoji/EmojiPicker';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody, SettingsCategory } from '../shared';
import { SettingsInputField } from '../shared-widgets';
import { showChangePasswordDialog, showSetupPasswordDialog } from './PasswordDialogs';
import { usePasswordStore } from './password-store';

const af = {
  body: { fontSize: 'calc(14px * var(--text-scale, 1))', lineHeight: '20px', color: 'var(--af-text-primary)' },
  bodyEnhanced: { fontSize: 'calc(14px * var(--text-scale, 1))', lineHeight: '20px', fontWeight: 600, color: 'var(--af-text-primary)' },
  caption: { fontSize: 'calc(12px * var(--text-scale, 1))', lineHeight: '18px', color: 'var(--af-text-secondary)' },
  heading4: { fontSize: 'calc(16px * var(--text-scale, 1))', lineHeight: '22px', fontWeight: 600, color: 'var(--af-text-primary)' },
} as const;

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
      <MaterialDialog radius={4} style={{ padding: '12px 0 16px' }}>
        <EmojiPicker
          onSelected={(emoji) => {
            void updateUserProfile(user, { iconUrl: emoji });
            close();
          }}
        />
      </MaterialDialog>
    ));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      <Tooltip message={tr('settings.accountPage.general.changeProfilePicture')} verticalOffset={28}>
        <div style={{ cursor: 'pointer', borderRadius: 100, display: 'flex' }} onClick={pickIcon}>
          <AFAvatar url={user.iconUrl} name={name} size="l" />
        </div>
      </Tooltip>
      <div style={{ width: 16, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: editing ? 1 : undefined }}>
        {editing ? (
          <SettingsInputField
            value={name}
            text={text}
            setText={setText}
            autoFocus
            onSave={() => save(text)}
            onBlur={(value) => save(value)}
            onCancel={() => setEditing(false)}
            onEscape={() => setEditing(false)}
          />
        ) : (
          <div style={{ paddingTop: 12, display: 'flex', alignItems: 'center' }}>
            <div style={{ ...af.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</div>
            <div style={{ width: 4 }} />
            <AFButton
              variant="ghostPrimary"
              size="s"
              padding={4}
              onTap={() => {
                setText(name);
                setEditing(true);
              }}
            >
              <FlowySvg svg="toolbar_link_edit_m" size={20} />
            </AFButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** SettingsEmailSection: read-only. */
function EmailSection({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  return (
    <div>
      <div style={af.bodyEnhanced}>{tr('settings.accountPage.email.title')}</div>
      <VSpace size={6} />
      <div style={af.caption}>{user.email}</div>
    </div>
  );
}

/** ChangePasswordSection: "Change password" or "Setup password". */
function PasswordSection() {
  const { tr } = useTr();
  const hasPassword = usePasswordStore((s) => s.hasPassword);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ ...af.bodyEnhanced, flex: 1 }}>{tr('newSettings.myAccount.password.title')}</div>
      <AFButton
        variant="filledPrimary"
        style={{ fontWeight: 600 }}
        text={hasPassword ? tr('newSettings.myAccount.password.changePassword') : tr('newSettings.myAccount.password.setupPassword')}
        onTap={hasPassword ? showChangePasswordDialog : showSetupPasswordDialog}
      />
    </div>
  );
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
  return (
    <div style={{ width: 375, maxHeight: 485 }}>
      <FlowyDialog width={375} maxWidth={375} expandHeight={false}>
        <div style={{ padding: 24, overflowY: 'auto', background: 'var(--cs-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={close}>
              <FlowySvg svg="arrow_back_m" size={24} />
              <div style={{ width: 8 }} />
              <FlowyText fontSize={16} fontWeight={600}>
                {tr('button.back')}
              </FlowyText>
            </div>
            <div style={{ flex: 1 }} />
            <span style={{ display: 'flex', cursor: 'pointer' }} onClick={close}>
              <FlowySvg svg="m_close_m" size={20} />
            </span>
          </div>
          <FlowyText fontSize={22} fontWeight={500} color="var(--cs-tertiary)" textAlign="center" maxLines={null}>
            {tr('settings.accountPage.login.loginLabel')}
          </FlowyText>
          <VSpace size={16} />
          <AFTextField ref={email} size="m" hintText={tr('signIn.pleaseInputYourEmail')} type="email" autoFocus onSubmitted={() => password.current?.focus()} />
          <VSpace size={12} />
          <AFTextField ref={password} size="m" hintText={tr('signIn.enterPassword')} obscureText onSubmitted={submit} />
          <VSpace size={16} />
          <AFButton variant="filledPrimary" size="l" fullWidth disabled={isSubmitting} text={tr('signIn.continueWithPassword')} onTap={submit} />
          {successOrFail && !successOrFail.ok && (
            <>
              <VSpace size={8} />
              <FlowyText color="var(--af-text-error)" maxLines={null}>
                {successOrFail.message}
              </FlowyText>
            </>
          )}
        </div>
      </FlowyDialog>
    </div>
  );
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
      confirmButtonColor: 'var(--cs-primary)',
      onConfirm: async () => {
        await UserEventSignOut();
        didLogout();
      },
    });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ ...af.bodyEnhanced, flex: 1 }}>{tr('settings.accountPage.login.title')}</div>
      <AFButton
        variant="filledPrimary"
        style={{ fontWeight: 600 }}
        text={signIn ? tr('settings.accountPage.login.loginLabel') : tr('settings.accountPage.login.logoutLabel')}
        onTap={onTap}
      />
    </div>
  );
}

/** SettingsAppVersion: the "up to date" branch (AutoUpdateTask is removed in this checkout). */
function AppVersion() {
  const { tr } = useTr();
  const version = useAppStore((s) => s.info?.version ?? '');
  return (
    <div>
      <div style={af.bodyEnhanced}>{tr('settings.accountPage.isUpToDate')}</div>
      <VSpace size={6} />
      <div style={af.caption}>{tr('settings.accountPage.officialVersion', { namedArgs: { version } })}</div>
    </div>
  );
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
  const description = { fontSize: 'calc(14px * var(--text-scale, 1))', color: 'var(--af-text-primary)' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...description, lineHeight: '18px' }}>{tr('newSettings.myAccount.deleteAccount.confirmHint1')}</div>
      <VSpace size={12} />
      <AFTextField size="m" hintText={tr('newSettings.myAccount.deleteAccount.confirmHint3')} onChanged={(value) => (textRef.current = value)} />
      <VSpace size={16} />
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <span
          style={{ display: 'flex', cursor: 'pointer', marginTop: 1 }}
          onClick={() => {
            checkedRef.current = !checked;
            setChecked(!checked);
          }}
        >
          {checked ? <FlowySvg svg="check_filled_s" size={16} blendMode={null} /> : <FlowySvg svg="uncheck_s" size={16} />}
        </span>
        <div style={{ width: 6 }} />
        <div style={{ ...description, lineHeight: '16px', flex: 1 }}>{tr('newSettings.myAccount.deleteAccount.confirmHint2')}</div>
      </div>
    </div>
  );
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
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={af.heading4}>{tr('button.deleteAccount')}</div>
        <VSpace size={4} />
        <div style={{ ...af.caption, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {tr('newSettings.myAccount.deleteAccount.description')}
        </div>
      </div>
      <AFButton variant="outlinedDestructive" text={tr('button.deleteAccount')} style={{ fontWeight: 400 }} onTap={onTap} />
    </div>
  );
}

/** SettingsAccountView (pages/settings_account_view.dart). */
export function AccountPage({ user, closeDialog, didLogout, snapshotAuthType }: SettingsPageProps & { snapshotAuthType: AuthTypePB }) {
  const { tr } = useTr();
  const env = useAppStore((s) => s.env);
  const authEnabled = env ? isAuthEnabled(env) : false;
  const authType = user.userAuthType;
  return (
    <SettingsBody title={tr('newSettings.myAccount.title')}>
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
        <p style={af.caption}>Developed by NaveDanan</p>
      </SettingsCategory>
      {snapshotAuthType === AuthTypePB.Server && <AccountDeletion key="delete" closeDialog={closeDialog} />}
    </SettingsBody>
  );
}
