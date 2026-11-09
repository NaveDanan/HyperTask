import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff, Mail, Settings, VenetianMask } from 'lucide-react';
import { TitleBar } from '@/components/app/window-controls';
import { Button } from '@/components/ui/button';
import { Field, FieldTitle } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { HyperLogo } from '@/ui/HyperLogo';
import { useTr } from '@/i18n';
import { isAuthEnabled, isLocalType } from '@/startup/cloud-env';
import { useAppStore } from '@/startup/app-store';
import { AFTextField, showToast, type AFTextFieldHandle, type AFTextFieldProps } from '@/ui';
import { SimpleSettingsDialog } from './SimpleSettingsDialog';
import { showDialog } from '@/ui/Dialog';
import { signInActions, useSignInStore } from './sign-in-store';

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

type Page =
  | { name: 'main' }
  | { name: 'magicLink'; email: string }
  | { name: 'password'; email: string }
  | { name: 'forgotPassword'; email: string }
  | { name: 'resetPassword'; email: string };

const hyperAuthScreenClass =
  'flex h-full flex-col bg-background bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklch,var(--muted)_100%,transparent),transparent)]';

function HyperTitleLogo({ title, description, info, mail = false }: { title: string; description?: string; info?: ReactNode; mail?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <HyperLogo size={40} />
      {mail && <div className="flex size-12 items-center justify-center rounded-xl bg-muted"><Mail className="size-5 text-muted-foreground" /></div>}
      <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-center text-sm text-muted-foreground">{description}</p>}
      {info && <div className="text-center text-sm text-muted-foreground">{info}</div>}
    </div>
  );
}

// Keep AFTextField's imperative validation, focus, obscuring and keyboard behavior.
const HyperAuthField = forwardRef<AFTextFieldHandle, AFTextFieldProps & { passcode?: boolean; label?: string }>(function HyperAuthField(
  { passcode, label, ...props },
  ref,
) {
  return (
    <Field className={cn('[&_input]:h-10', passcode && '[&_input]:text-center [&_input]:font-mono [&_input]:tracking-[0.5em]')}>
      {label && <FieldTitle className="text-xs text-muted-foreground">{label}</FieldTitle>}
      <AFTextField ref={ref} {...props} />
    </Field>
  );
});

function HyperSubmitButton({ text, submitting, onTap }: { text: string; submitting: boolean; onTap: () => void }) {
  const { tr } = useTr();
  return (
    <Button size="lg" className="h-10 w-full" disabled={submitting} onClick={onTap}>
      {submitting && <Spinner className="size-4" />}
      {submitting ? tr('signIn.verifying') : text}
    </Button>
  );
}

function HyperLinkButton({ text, onTap, align = 'center' }: { text: string; onTap: () => void; align?: 'center' | 'flex-start' }) {
  return (
    <div className={cn('flex', align === 'center' ? 'justify-center' : 'justify-start')}>
      <Button variant="link" className="h-auto p-0 text-sm text-muted-foreground hover:text-foreground" onClick={onTap}>{text}</Button>
    </div>
  );
}

function HyperBackButton({ onTap }: { onTap: () => void }) {
  const { tr } = useTr();
  return <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={onTap}><ArrowLeft className="size-4" />{tr('signIn.backToLogin')}</Button>;
}

function HyperFormColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 overflow-y-auto px-6 py-6">{children}</div>;
}

/** SignInScreen (desktop_sign_in_screen.dart, modified): email/password sign-in to the user's server. */
export function SignInScreen() {
  const [stack, setStack] = useState<Page[]>([{ name: 'main' }]);
  const push = (page: Page) => setStack((s) => [...s, page]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const popTo = (name: Page['name']) =>
    setStack((s) => {
      const index = s.map((p) => p.name).lastIndexOf(name);
      return index >= 0 ? s.slice(0, index + 1) : s;
    });
  const page = stack[stack.length - 1];

  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      {page.name === 'main' && <MainPage push={push} />}
      {page.name === 'magicLink' && <MagicLinkPage email={page.email} pop={pop} />}
      {page.name === 'password' && <PasswordPage email={page.email} pop={pop} push={push} />}
      {page.name === 'forgotPassword' && <ForgotPasswordPage email={page.email} pop={pop} push={push} />}
      {page.name === 'resetPassword' && <ResetPasswordPage email={page.email} pop={pop} done={() => popTo('password')} />}
    </div>
  );
}

function MainPage({ push }: { push: (page: Page) => void }) {
  const { tr } = useTr();
  const env = useAppStore((s) => s.env);
  const emailRef = useRef<AFTextFieldHandle>(null);
  const emailError = useSignInStore((s) => s.emailError);
  const successOrFail = useSignInStore((s) => s.successOrFail);
  const isSubmitting = useSignInStore((s) => s.isSubmitting);

  useEffect(() => {
    if (successOrFail?.ok === false) emailRef.current?.syncError(successOrFail.message);
    else if (emailError) emailRef.current?.syncError(emailError);
    else if (!isSubmitting) emailRef.current?.clearError();
  }, [emailError, successOrFail, isSubmitting]);

  const withValidEmail = (next: (email: string) => void) => {
    const email = emailRef.current?.value().trim() ?? '';
    if (!isEmail(email)) {
      emailRef.current?.syncError(tr('signIn.invalidEmail'));
      return;
    }
    next(email);
  };
  const continueWithEmail = () =>
    withValidEmail((email) => {
      void signInActions.signInWithMagicLink(email);
      push({ name: 'magicLink', email });
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HyperFormColumn>
        <HyperTitleLogo title={tr('welcomeText')} description={env && isAuthEnabled(env) ? 'Sign in to your collaboration server' : undefined} />
        <div className="flex flex-col gap-3">
          <HyperAuthField ref={emailRef} hintText={tr('signIn.pleaseInputYourEmail')} type="email" autoComplete="email" onSubmitted={continueWithEmail} />
          <Button size="lg" className="h-10 w-full" onClick={continueWithEmail}>{tr('signIn.continueWithEmail')}</Button>
          <Button variant="outline" size="lg" className="h-10 w-full" onClick={() => withValidEmail((email) => push({ name: 'password', email }))}>{tr('signIn.continueWithPassword')}</Button>
        </div>
      </HyperFormColumn>
      <div className="flex h-14 shrink-0 items-center justify-center gap-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => showDialog((close) => <SimpleSettingsDialog close={close} />)}>
          <Settings className="size-4" />{tr('signIn.settings')}
        </Button>
        {env && !isLocalType(env.authenticatorType) && <AnonymousModeButton />}
      </div>
    </div>
  );
}

/** SignInAnonymousButtonV2: opens the existing anonymous user or creates a guest. */
function AnonymousModeButton() {
  const { tr } = useTr();
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground"
      onClick={async () => {
        const { UserEventGetAnonUser, UserEventOpenAnonUser } = await import('@/backend/events');
        const anon = await UserEventGetAnonUser();
        if (anon.ok) {
          const opened = await UserEventOpenAnonUser();
          if (opened.ok) {
            const { runAppFlowy } = await import('@/startup/launcher');
            await runAppFlowy();
          }
        } else {
          await signInActions.signInAsGuest();
        }
      }}
    >
      <VenetianMask className="size-4" />{tr('signIn.anonymousMode')}
    </Button>
  );
}

function MagicLinkPage({ email, pop }: { email: string; pop: () => void }) {
  const { tr } = useTr();
  const [enteringPasscode, setEnteringPasscode] = useState(false);
  const codeRef = useRef<AFTextFieldHandle>(null);
  const isSubmitting = useSignInStore((s) => s.isSubmitting);
  const successOrFail = useSignInStore((s) => s.successOrFail);

  useEffect(() => {
    if (successOrFail?.ok === false) codeRef.current?.syncError(tr('signIn.tokenHasExpiredOrInvalid'));
  }, [successOrFail, tr]);

  const submit = () => {
    const code = codeRef.current?.value().trim() ?? '';
    if (!code) {
      codeRef.current?.syncError(tr('signIn.invalidVerificationCode'));
      return;
    }
    void signInActions.signInWithPasscode(email, code);
  };
  const back = () => {
    signInActions.clearErrors();
    pop();
  };

  return (
    <HyperFormColumn>
      <HyperBackButton onTap={back} />
      {!enteringPasscode ? (
        <>
          <HyperTitleLogo mail title={tr('signIn.checkYourEmail')} description={tr('signIn.temporaryVerificationLinkSent')} info={<span className="font-medium text-foreground">{email}</span>} />
          <Button size="lg" className="h-10 w-full" onClick={() => setEnteringPasscode(true)}>{tr('signIn.enterCodeManually')}</Button>
        </>
      ) : (
        <>
          <HyperTitleLogo mail title={tr('signIn.enterCode')} description={tr('signIn.temporaryVerificationCodeSent')} info={<span className="font-medium text-foreground">{email}</span>} />
          <div className="flex flex-col gap-3">
            <HyperAuthField passcode ref={codeRef} hintText={tr('signIn.enterCode')} type="number" autoFocus onSubmitted={submit} />
            <HyperSubmitButton text={tr('signIn.continueWithLoginCode')} submitting={isSubmitting} onTap={submit} />
          </div>
        </>
      )}
    </HyperFormColumn>
  );
}

function PasswordPage({ email, pop, push }: { email: string; pop: () => void; push: (page: Page) => void }) {
  const { tr } = useTr();
  const passwordRef = useRef<AFTextFieldHandle>(null);
  const isSubmitting = useSignInStore((s) => s.isSubmitting);
  const successOrFail = useSignInStore((s) => s.successOrFail);
  const passwordError = useSignInStore((s) => s.passwordError);

  useEffect(() => {
    if (successOrFail?.ok === false || passwordError) passwordRef.current?.syncError(tr('signIn.invalidLoginCredentials'));
    else passwordRef.current?.clearError();
  }, [successOrFail, passwordError, tr]);

  const submit = () => void signInActions.signInWithEmailAndPassword(email, passwordRef.current?.value() ?? '');

  return (
    <HyperFormColumn>
      <HyperBackButton onTap={() => { signInActions.clearErrors(); pop(); }} />
      <HyperTitleLogo title={tr('signIn.enterPassword')} info={<>{tr('signIn.loginAs')}<span className="font-medium text-foreground"> {email}</span></>} />
      <div className="flex flex-col gap-3">
        <HyperAuthField
          ref={passwordRef}
          hintText={tr('signIn.enterPassword')}
          autoFocus
          obscureText
          autoComplete="current-password"
          onSubmitted={submit}
          suffixIcon={(obscured) => (
            <Button variant="ghost" size="icon-sm" aria-label={tr('signIn.enterPassword')} onClick={() => passwordRef.current?.syncObscured(!obscured)}>
              {obscured ? <Eye className="size-4 text-muted-foreground" /> : <EyeOff className="size-4 text-muted-foreground" />}
            </Button>
          )}
        />
        <HyperLinkButton align="flex-start" text={tr('signIn.forgotPassword')} onTap={() => push({ name: 'forgotPassword', email })} />
        <HyperSubmitButton text={tr('web.continue')} submitting={isSubmitting} onTap={submit} />
      </div>
    </HyperFormColumn>
  );
}

function ForgotPasswordPage({ email, pop, push }: { email: string; pop: () => void; push: (page: Page) => void }) {
  const { tr } = useTr();
  const fieldRef = useRef<AFTextFieldHandle>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const value = fieldRef.current?.value().trim() ?? '';
    if (!isEmail(value)) {
      fieldRef.current?.syncError(tr('signIn.invalidEmail'));
      return;
    }
    setSubmitting(true);
    const result = await signInActions.forgotPassword(value);
    setSubmitting(false);
    if (result.ok) push({ name: 'resetPassword', email: value });
    else fieldRef.current?.syncError(result.msg);
  };

  return (
    <HyperFormColumn>
      <HyperBackButton onTap={pop} />
      <HyperTitleLogo title={tr('signIn.resetPassword')} description={tr('signIn.resetPasswordDescription')} />
      <div className="flex flex-col gap-3">
        <HyperAuthField ref={fieldRef} initialText={email} hintText={tr('signIn.pleaseInputYourEmail')} autoFocus onSubmitted={() => void submit()} />
        <HyperSubmitButton text={tr('button.submit')} submitting={submitting} onTap={() => void submit()} />
      </div>
    </HyperFormColumn>
  );
}

function ResetPasswordPage({ email, pop, done }: { email: string; pop: () => void; done: () => void }) {
  const { tr } = useTr();
  const [stage, setStage] = useState<'enterPasscode' | 'setNewPassword'>('enterPasscode');
  const codeRef = useRef<AFTextFieldHandle>(null);
  const newRef = useRef<AFTextFieldHandle>(null);
  const confirmRef = useRef<AFTextFieldHandle>(null);
  const isSubmitting = useSignInStore((s) => s.isSubmitting);

  const validate = async () => {
    const code = codeRef.current?.value().trim() ?? '';
    if (!code) {
      codeRef.current?.syncError(tr('signIn.invalidVerificationCode'));
      return;
    }
    if (await signInActions.validateResetPasswordToken(email, code)) setStage('setNewPassword');
    else codeRef.current?.syncError(tr('signIn.resetPasswordFailed'));
  };

  const reset = async () => {
    const password = newRef.current?.value() ?? '';
    const confirm = confirmRef.current?.value() ?? '';
    if (!password) return newRef.current?.syncError(tr('signIn.newPasswordCannotBeEmpty'));
    if (!confirm) return confirmRef.current?.syncError(tr('signIn.confirmPasswordCannotBeEmpty'));
    if (password !== confirm) return confirmRef.current?.syncError(tr('signIn.passwordsDoNotMatch'));
    const result = await signInActions.resetPassword(password);
    if (result.ok) {
      showToast({ message: tr('signIn.resetPasswordSuccess') });
      done();
    } else if (result.message) {
      newRef.current?.syncError(result.message);
    }
  };

  return (
    <HyperFormColumn>
      <HyperBackButton onTap={pop} />
      {stage === 'enterPasscode' ? (
        <>
          <HyperTitleLogo mail title={tr('signIn.checkYourEmail')} description={tr('signIn.temporaryVerificationLinkSent')} info={<span className="font-medium text-foreground">{email}</span>} />
          <div className="flex flex-col gap-3">
            <HyperAuthField
              passcode
              ref={codeRef}
              hintText={tr('signIn.enterCode')}
              type="number"
              autoFocus
              onSubmitted={(value) => {
                if (!value.trim()) codeRef.current?.syncError(tr('signIn.invalidVerificationCode'));
              }}
            />
            <HyperSubmitButton text={tr('signIn.continueToResetPassword')} submitting={isSubmitting} onTap={() => void validate()} />
          </div>
        </>
      ) : (
        <>
          <HyperTitleLogo title={tr('signIn.resetPassword')} info={<>{tr('signIn.enterNewPasswordFor')}<span className="font-medium text-foreground">{email}</span></>} />
          <div className="flex flex-col gap-3">
            <HyperAuthField label={tr('signIn.newPassword')} ref={newRef} hintText={tr('signIn.enterNewPassword')} obscureText autoComplete="new-password" />
            <HyperAuthField label={tr('signIn.confirmPassword')} ref={confirmRef} hintText={tr('signIn.confirmNewPassword')} obscureText autoComplete="new-password" onSubmitted={() => void reset()} />
            <HyperSubmitButton text={tr('signIn.resetPassword')} submitting={isSubmitting} onTap={() => void reset()} />
          </div>
        </>
      )}
    </HyperFormColumn>
  );
}
