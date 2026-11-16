import { useId, useImperativeHandle, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldError } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { useTr } from '@/i18n';
import { showDialog, showToast, type AFTextFieldHandle } from '@/ui';
import { PasswordSuffixIcon } from '../shared-widgets';
import { changePasswordErrorFor, setupPasswordErrorFor, validateChangePassword, validateSetupPassword, type PasswordField } from './password';
import { passwordActions } from './password-store';

function PasswordField({ label, hint, fieldRef }: { label: string; hint: string; fieldRef: React.RefObject<AFTextFieldHandle | null> }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [obscured, setObscured] = useState(true);
  useImperativeHandle(fieldRef, () => ({
    syncError: setError, clearError: () => setError(null), syncObscured: setObscured,
    focus: () => inputRef.current?.focus(), select: () => inputRef.current?.select(), value: () => inputRef.current?.value ?? '',
  }));
  return <Field data-invalid={error !== null ? 'true' : undefined}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <InputGroup data-size="l" data-error={error !== null ? 'true' : undefined}>
      <InputGroupInput ref={inputRef} id={id} placeholder={hint} type={obscured ? 'password' : 'text'} autoComplete="current-password" spellCheck={false} aria-invalid={error !== null ? true : undefined} />
      <InputGroupAddon align="inline-end"><PasswordSuffixIcon isObscured={obscured} onTap={() => fieldRef.current?.syncObscured(!obscured)} /></InputGroupAddon>
    </InputGroup>
    {error && <FieldError className="text-xs">{error}</FieldError>}
  </Field>;
}

function DialogShell({ title, close, children, onSave }: { title: string; close: () => void; children: React.ReactNode; onSave: () => void }) {
  const { tr } = useTr();
  return <div className="flex w-[min(25rem,calc(100vw-5rem))] flex-col gap-4 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
    <div className="flex items-center gap-2"><h2 className="flex-1 text-base font-medium">{title}</h2><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}><X className="size-4" /></Button></div>
    {children}
    <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4"><Button variant="outline" onClick={close}>{tr('button.cancel')}</Button><Button onClick={onSave}>{tr('button.save')}</Button></div>
  </div>;
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
      <PasswordField label={tr('newSettings.myAccount.password.newPassword')} hint={tr('newSettings.myAccount.password.hint.enterYourNewPassword')} fieldRef={next} />
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
