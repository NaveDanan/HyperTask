import { useRef } from 'react';
import { FlowySvg } from '@/icons/FlowySvg';
import { useTr } from '@/i18n';
import { AFButton, AFTextField, showDialog, showToast, type AFTextFieldHandle } from '@/ui';
import { PasswordSuffixIcon } from '../shared-widgets';
import { changePasswordErrorFor, setupPasswordErrorFor, validateChangePassword, validateSetupPassword, type PasswordField } from './password';
import { passwordActions } from './password-store';

const caption = { fontSize: 'calc(12px * var(--text-scale, 1))', lineHeight: '18px', fontWeight: 600, color: 'var(--af-text-secondary)' } as const;

function PasswordField({ label, hint, fieldRef }: { label: string; hint: string; fieldRef: React.RefObject<AFTextFieldHandle | null> }) {
  return (
    <>
      <div style={caption}>{label}</div>
      <div style={{ height: 4 }} />
      <AFTextField
        ref={fieldRef}
        hintText={hint}
        obscureText
        autoComplete="current-password"
        suffixIcon={(obscured) => <PasswordSuffixIcon isObscured={obscured} onTap={() => fieldRef.current?.syncObscured(!obscured)} />}
      />
    </>
  );
}

function DialogShell({ title, close, children, onSave }: { title: string; close: () => void; children: React.ReactNode; onSave: () => void }) {
  const { tr } = useTr();
  return (
    <div
      style={{
        background: 'var(--af-surface-primary)',
        borderRadius: 16,
        padding: '16px 20px',
        width: 400,
        maxWidth: 'calc(100vw - 80px)',
        boxShadow: '0 11px 15px -7px #00000033, 0 24px 38px 3px #00000024, 0 9px 46px 8px #0000001F',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 'calc(16px * var(--text-scale, 1))', lineHeight: '22px', fontWeight: 700, color: 'var(--af-text-primary)' }}>{title}</div>
        <AFButton variant="ghostPrimary" size="s" padding={4} onTap={close}>
          <FlowySvg svg="password_close_m" size={20} />
        </AFButton>
      </div>
      <div style={{ height: 16 }} />
      {children}
      <div style={{ height: 16 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <AFButton variant="outlinedNormal" text={tr('button.cancel')} onTap={close} />
        <AFButton variant="filledPrimary" text={tr('button.save')} onTap={onSave} />
      </div>
    </div>
  );
}

/** ChangePasswordDialogContent (settings/pages/account/password/change_password.dart). */
function ChangePasswordDialog({ close }: { close: () => void }) {
  const { tr } = useTr();
  const current = useRef<AFTextFieldHandle>(null);
  const next = useRef<AFTextFieldHandle>(null);
  const confirm = useRef<AFTextFieldHandle>(null);
  const fields: Record<PasswordField, React.RefObject<AFTextFieldHandle | null>> = { current, new: next, confirm };

  const save = async () => {
    const [c, n, f] = [current.current?.value() ?? '', next.current?.value() ?? '', confirm.current?.value() ?? ''];
    const invalid = validateChangePassword(c, n, f);
    if (invalid) {
      fields[invalid.field].current?.syncError(tr(invalid.key));
      return;
    }
    const result = await passwordActions.changePassword(c, n);
    if (!result) return;
    if (result.ok) {
      showToast({ message: tr('newSettings.myAccount.password.toast.passwordUpdatedSuccessfully') });
      close();
      return;
    }
    const { field, text } = changePasswordErrorFor(result.error, tr);
    fields[field].current?.syncError(text);
  };

  return (
    <DialogShell title={tr('newSettings.myAccount.password.changePassword')} close={close} onSave={() => void save()}>
      <PasswordField label={tr('newSettings.myAccount.password.currentPassword')} hint={tr('newSettings.myAccount.password.hint.enterYourCurrentPassword')} fieldRef={current} />
      <div style={{ height: 16 }} />
      <PasswordField label={tr('newSettings.myAccount.password.newPassword')} hint={tr('newSettings.myAccount.password.hint.enterYourNewPassword')} fieldRef={next} />
      <div style={{ height: 16 }} />
      <PasswordField label={tr('newSettings.myAccount.password.confirmNewPassword')} hint={tr('newSettings.myAccount.password.hint.confirmYourNewPassword')} fieldRef={confirm} />
    </DialogShell>
  );
}

/** SetupPasswordDialogContent (settings/pages/account/password/setup_password.dart). */
function SetupPasswordDialog({ close }: { close: () => void }) {
  const { tr } = useTr();
  const password = useRef<AFTextFieldHandle>(null);
  const confirm = useRef<AFTextFieldHandle>(null);

  const save = async () => {
    const [p, c] = [password.current?.value() ?? '', confirm.current?.value() ?? ''];
    const invalid = validateSetupPassword(p, c);
    if (invalid) {
      (invalid.field === 'new' ? password : confirm).current?.syncError(tr(invalid.key));
      return;
    }
    const result = await passwordActions.setupPassword(p);
    if (!result) return;
    if (result.ok) {
      showToast({ message: tr('newSettings.myAccount.password.toast.passwordSetupSuccessfully') });
      close();
      return;
    }
    password.current?.syncError(setupPasswordErrorFor(result.error, tr));
  };

  return (
    <DialogShell title={tr('newSettings.myAccount.password.setupPassword')} close={close} onSave={() => void save()}>
      <PasswordField label={tr('newSettings.myAccount.password.title')} hint={tr('newSettings.myAccount.password.hint.confirmYourPassword')} fieldRef={password} />
      <div style={{ height: 16 }} />
      <PasswordField label={tr('newSettings.myAccount.password.confirmPassword')} hint={tr('newSettings.myAccount.password.hint.confirmYourPassword')} fieldRef={confirm} />
    </DialogShell>
  );
}

/** showDialog(barrierDismissible: false) → Dialog(radius 16). */
export function showChangePasswordDialog() {
  showDialog((close) => <ChangePasswordDialog close={close} />, { barrierDismissible: false });
}

export function showSetupPasswordDialog() {
  showDialog((close) => <SetupPasswordDialog close={close} />, { barrierDismissible: false });
}
