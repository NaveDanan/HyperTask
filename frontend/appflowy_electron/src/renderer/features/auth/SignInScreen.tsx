import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FlowySvg } from '@/icons/FlowySvg';
import { HyperLogo } from '@/ui/HyperLogo';
import { useTr } from '@/i18n';
import { isAuthEnabled, isLocalType } from '@/startup/cloud-env';
import { useAppStore } from '@/startup/app-store';
import { AFButton, AFTextField, Spinner, VSpace, showToast, type AFTextFieldHandle } from '@/ui';
import { WindowTitleBar } from '@/ui/WindowTitleBar';
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

/** heading3.enhanced: 20/28 w600, text.primary. */
const Title = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 'calc(20px * var(--text-scale, 1))', lineHeight: '28px', fontWeight: 600, color: 'var(--af-text-primary)', textAlign: 'center' }}>
    {children}
  </div>
);

const Body = ({ children, enhanced, center }: { children: ReactNode; enhanced?: boolean; center?: boolean }) => (
  <div
    style={{
      fontSize: 'calc(14px * var(--text-scale, 1))',
      lineHeight: '20px',
      fontWeight: enhanced ? 500 : 400,
      color: 'var(--af-text-primary)',
      textAlign: center ? 'center' : undefined,
      whiteSpace: 'pre-line',
    }}
  >
    {children}
  </div>
);

/** FlowyLogoTitle / TitleLogo: 36×36 logo, 20, title, then optional description and info. */
function TitleLogo({ title, description, info }: { title: string; description?: string; info?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <HyperLogo size={36} />
      <VSpace size={20} />
      <Title>{title}</Title>
      {(description || info) && <VSpace size={20} />}
      {description && <Body center>{description}</Body>}
      {info}
      {(description || info) && <VSpace size={20} />}
    </div>
  );
}

/** ContinueWithButton / VerifyingButton: filled primary size l, full width. */
function SubmitButton({ text, submitting, onTap }: { text: string; submitting: boolean; onTap: () => void }) {
  const { tr } = useTr();
  if (submitting) {
    return (
      <div
        style={{
          opacity: 0.7,
          height: 40,
          borderRadius: 10,
          background: 'var(--af-fill-theme-thick)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: 'var(--af-text-on-fill)',
          fontWeight: 500,
        }}
      >
        <Spinner size={15} stroke={3} color="var(--af-text-on-fill)" />
        {tr('signIn.verifying')}
      </div>
    );
  }
  return <AFButton variant="filledPrimary" size="l" text={text} fullWidth onTap={onTap} />;
}

/** BackToLoginButton: ghost text in text.action. */
function LinkButton({ text, onTap, align = 'center' }: { text: string; onTap: () => void; align?: 'center' | 'flex-start' }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: align }}>
      <span
        onClick={onTap}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          cursor: 'pointer',
          fontSize: 'calc(14px * var(--text-scale, 1))',
          lineHeight: '20px',
          color: hover ? 'var(--af-text-action-hover)' : 'var(--af-text-action)',
        }}
      >
        {text}
      </span>
    </div>
  );
}

function FormColumn({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
      <div style={{ width: 320, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cs-surface)' }}>
      <WindowTitleBar />
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ flex: 1 }} />
      <div style={{ width: 320, display: 'flex', flexDirection: 'column' }}>
        <TitleLogo title={tr('welcomeText')} />
        <VSpace size={20} />
        <AFTextField ref={emailRef} hintText={tr('signIn.pleaseInputYourEmail')} type="email" autoComplete="email" onSubmitted={continueWithEmail} />
        <VSpace size={12} />
        <AFButton variant="filledPrimary" size="l" fullWidth text={tr('signIn.continueWithEmail')} onTap={continueWithEmail} />
        <VSpace size={12} />
        <AFButton
          variant="outlinedNormal"
          size="l"
          fullWidth
          text={tr('signIn.continueWithPassword')}
          onTap={() => withValidEmail((email) => push({ name: 'password', email }))}
        />
        <VSpace size={20} />
        {env && isAuthEnabled(env) && <Body>Sign in to your collaboration server</Body>}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <AFButton
          variant="ghostPrimary"
          size="s"
          padding="4px 8px"
          textColor="var(--af-text-secondary)"
          icon={<FlowySvg svg="settings_s" size={20} color="var(--af-text-secondary)" />}
          onTap={() => showDialog((close) => <SimpleSettingsDialog close={close} />)}
          style={{ ['--btn-bg-hover' as string]: 'transparent' }}
        >
          {tr('signIn.settings')}
        </AFButton>
        {env && !isLocalType(env.authenticatorType) && <AnonymousModeButton />}
      </div>
      <VSpace size={20} />
    </div>
  );
}

/** SignInAnonymousButtonV2: opens the existing anonymous user or creates a guest. */
function AnonymousModeButton() {
  const { tr } = useTr();
  return (
    <AFButton
      variant="ghostPrimary"
      size="s"
      padding="4px 8px"
      textColor="var(--af-text-secondary)"
      icon={<FlowySvg svg="anonymous_mode_m" size={20} color="var(--af-text-secondary)" />}
      style={{ ['--btn-bg-hover' as string]: 'transparent' }}
      onTap={async () => {
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
      {tr('signIn.anonymousMode')}
    </AFButton>
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
    <FormColumn>
      {!enteringPasscode ? (
        <>
          <TitleLogo
            title={tr('signIn.checkYourEmail')}
            description={tr('signIn.temporaryVerificationLinkSent')}
            info={<Body enhanced center>{email}</Body>}
          />
          <AFButton variant="filledPrimary" size="l" fullWidth text={tr('signIn.enterCodeManually')} onTap={() => setEnteringPasscode(true)} />
        </>
      ) : (
        <>
          <TitleLogo title={tr('signIn.enterCode')} description={tr('signIn.temporaryVerificationCodeSent')} info={<Body center>{email}</Body>} />
          <AFTextField ref={codeRef} hintText={tr('signIn.enterCode')} type="number" autoFocus onSubmitted={submit} />
          <VSpace size={12} />
          <SubmitButton text={tr('signIn.continueWithLoginCode')} submitting={isSubmitting} onTap={submit} />
        </>
      )}
      <VSpace size={20} />
      <LinkButton text={tr('signIn.backToLogin')} onTap={back} />
    </FormColumn>
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
    <FormColumn>
      <TitleLogo
        title={tr('signIn.enterPassword')}
        info={
          <Body center>
            {tr('signIn.loginAs')}
            <span style={{ fontWeight: 500 }}> {email}</span>
          </Body>
        }
      />
      <AFTextField
        ref={passwordRef}
        hintText={tr('signIn.enterPassword')}
        autoFocus
        obscureText
        autoComplete="current-password"
        onSubmitted={submit}
        suffixIcon={(obscured) => (
          <span style={{ cursor: 'pointer', display: 'flex' }} onClick={() => passwordRef.current?.syncObscured(!obscured)}>
            <FlowySvg svg={obscured ? 'show_s' : 'hide_s'} size={20} color="var(--af-icon-secondary)" />
          </span>
        )}
      />
      <VSpace size={8} />
      <LinkButton align="flex-start" text={tr('signIn.forgotPassword')} onTap={() => push({ name: 'forgotPassword', email })} />
      <VSpace size={20} />
      <SubmitButton text={tr('web.continue')} submitting={isSubmitting} onTap={submit} />
      <VSpace size={20} />
      <LinkButton
        text={tr('signIn.backToLogin')}
        onTap={() => {
          signInActions.clearErrors();
          pop();
        }}
      />
    </FormColumn>
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
    <FormColumn>
      <TitleLogo title={tr('signIn.resetPassword')} description={tr('signIn.resetPasswordDescription')} />
      <AFTextField ref={fieldRef} initialText={email} hintText={tr('signIn.pleaseInputYourEmail')} autoFocus onSubmitted={() => void submit()} />
      <VSpace size={20} />
      <SubmitButton text={tr('button.submit')} submitting={submitting} onTap={() => void submit()} />
      <VSpace size={20} />
      <LinkButton text={tr('signIn.backToLogin')} onTap={pop} />
    </FormColumn>
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

  const label = (text: string) => (
    <div style={{ fontSize: 'calc(12px * var(--text-scale, 1))', lineHeight: '18px', fontWeight: 500, color: 'var(--af-text-secondary)', marginBottom: 8 }}>
      {text}
    </div>
  );

  return (
    <FormColumn>
      {stage === 'enterPasscode' ? (
        <>
          <TitleLogo title={tr('signIn.checkYourEmail')} description={tr('signIn.temporaryVerificationLinkSent')} info={<Body enhanced center>{email}</Body>} />
          <AFTextField
            ref={codeRef}
            hintText={tr('signIn.enterCode')}
            type="number"
            autoFocus
            onSubmitted={(value) => {
              if (!value.trim()) codeRef.current?.syncError(tr('signIn.invalidVerificationCode'));
            }}
          />
          <VSpace size={12} />
          <SubmitButton text={tr('signIn.continueToResetPassword')} submitting={isSubmitting} onTap={() => void validate()} />
        </>
      ) : (
        <>
          <TitleLogo
            title={tr('signIn.resetPassword')}
            info={
              <Body center>
                {tr('signIn.enterNewPasswordFor')}
                <span style={{ fontWeight: 500 }}>{email}</span>
              </Body>
            }
          />
          {label(tr('signIn.newPassword'))}
          <AFTextField ref={newRef} hintText={tr('signIn.enterNewPassword')} obscureText autoComplete="new-password" />
          <VSpace size={16} />
          {label(tr('signIn.confirmPassword'))}
          <AFTextField ref={confirmRef} hintText={tr('signIn.confirmNewPassword')} obscureText autoComplete="new-password" onSubmitted={() => void reset()} />
          <VSpace size={20} />
          <SubmitButton text={tr('signIn.resetPassword')} submitting={isSubmitting} onTap={() => void reset()} />
        </>
      )}
      <VSpace size={20} />
      <LinkButton text={tr('signIn.backToLogin')} onTap={pop} />
    </FormColumn>
  );
}
