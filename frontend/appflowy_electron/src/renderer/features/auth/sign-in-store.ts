import { create } from 'zustand';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { UserEventMagicLinkSignIn, UserEventPasscodeSignIn, UserEventSignInWithEmailPassword } from '@/backend/events';
import { tr } from '@/i18n';
import { isLocalType } from '@/startup/cloud-env';
import { getAppFlowyCloudUrl } from '@/startup/cloud-env';
import { passGotrueTokenResponse, useDeepLinkStore } from '@/startup/deep-link';
import { openWorkspaceOrHandleError, signUpAsGuest } from '@/startup/HyperLauncher';
import { useAppStore } from '@/startup/app-store';

type Outcome = { ok: true } | { ok: false; message: string } | null;

interface SignInState {
  isSubmitting: boolean;
  emailError: string | null;
  passwordError: string | null;
  successOrFail: Outcome;
  /** Recovery access token from /gotrue/verify. */
  resetToken: string;
}

export const useSignInStore = create<SignInState>(() => ({
  isSubmitting: false,
  emailError: null,
  passwordError: null,
  successOrFail: null,
  resetToken: '',
}));

const set = useSignInStore.setState;
const start = () => set({ isSubmitting: true, emailError: null, passwordError: null, successOrFail: null });

// The deep-link loading state drives isSubmitting, as SignInBloc.deepLinkStateChange does.
useDeepLinkStore.subscribe((state, prev) => {
  if (state.state === prev.state) return;
  if (state.state === 'loading') set({ isSubmitting: true, emailError: null, passwordError: null });
  if (state.state === 'error') set({ isSubmitting: false, successOrFail: { ok: false, message: tr('signIn.generalError') } });
});

/** SignInBloc._stateFromCode. */
function stateFromCode(error: FlowyError) {
  switch (error.code) {
    case ErrorCode.EmailFormatInvalid:
      set({ isSubmitting: false, emailError: error.msg });
      return;
    case ErrorCode.PasswordFormatInvalid:
      set({ isSubmitting: false, passwordError: error.msg });
      return;
    case ErrorCode.UserUnauthorized: {
      const msg = error.msg;
      const message =
        msg.includes('rate limit') || msg.includes('For security purposes')
          ? tr('signIn.tooFrequentVerificationCodeRequest')
          : msg.includes('invalid')
            ? tr('signIn.tokenHasExpiredOrInvalid')
            : msg.includes('Invalid login credentials')
              ? tr('signIn.invalidLoginCredentials')
              : tr('signIn.generalError');
      set({ isSubmitting: false, successOrFail: { ok: false, message } });
      return;
    }
    default:
      set({ isSubmitting: false, successOrFail: { ok: false, message: tr('signIn.generalError') } });
  }
}

const authType = () =>
  isLocalType(useAppStore.getState().env?.authenticatorType ?? 0) ? AuthTypePB.Local : AuthTypePB.Server;

/** PasswordHttpService: the reset-password calls go straight to GoTrue, as in the Flutter app. */
async function gotrue(path: string, body: object, token = ''): Promise<{ ok: true; json: unknown } | { ok: false; code: ErrorCode; msg: string }> {
  const fallback: Record<string, string> = {
    '/gotrue/recover': 'Failed to send password reset email',
    '/gotrue/verify': 'Failed to verify reset password token',
    '/gotrue/user/change-password': 'Failed to setup password',
  };
  try {
    const response = await window.appflowy.net.request({
      url: `${getAppFlowyCloudUrl()}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    let json: { msg?: string } | null = null;
    try {
      json = response.body ? JSON.parse(response.body) : null;
    } catch {
      json = null;
    }
    if (response.status === 200) return { ok: true, json: json ?? true };
    return {
      ok: false,
      code: response.status === 422 ? ErrorCode.NewPasswordTooWeak : ErrorCode.Internal,
      msg: json?.msg ?? fallback[path] ?? 'Request failed',
    };
  } catch (error) {
    return { ok: false, code: ErrorCode.Internal, msg: `Network error: ${error}` };
  }
}

export const signInActions = {
  async signInWithEmailAndPassword(email: string, password: string) {
    start();
    const result = await UserEventSignInWithEmailPassword({
      email,
      password,
      authType: authType(),
      deviceId: useAppStore.getState().deviceId,
    });
    if (result.ok) {
      void passGotrueTokenResponse(result.value);
      set({ isSubmitting: false });
    } else stateFromCode(result.error);
  },

  async signInWithMagicLink(email: string) {
    if (useSignInStore.getState().isSubmitting) return;
    start();
    const result = await UserEventMagicLinkSignIn({ email, redirectTo: '' });
    if (result.ok) set({ isSubmitting: false });
    else stateFromCode(result.error);
  },

  async signInWithPasscode(email: string, passcode: string) {
    if (useSignInStore.getState().isSubmitting) return;
    start();
    const result = await UserEventPasscodeSignIn({ email, passcode });
    if (result.ok) void passGotrueTokenResponse(result.value);
    else stateFromCode(result.error);
  },

  async signInAsGuest() {
    start();
    const result = await signUpAsGuest();
    if (result.ok) {
      set({ isSubmitting: false, successOrFail: { ok: true } });
      await openWorkspaceOrHandleError();
    } else stateFromCode(result.error);
  },

  clearErrors() {
    set({ emailError: null, passwordError: null, successOrFail: null });
  },

  cancel() {
    set({ isSubmitting: false, emailError: null, passwordError: null, successOrFail: null });
  },

  forgotPassword: (email: string) => gotrue('/gotrue/recover', { email }),

  async validateResetPasswordToken(email: string, token: string): Promise<boolean> {
    if (useSignInStore.getState().isSubmitting) return false;
    set({ isSubmitting: true });
    const result = await gotrue('/gotrue/verify', { type: 'recovery', email, token });
    const accessToken = result.ok ? (result.json as { access_token?: string }).access_token : undefined;
    set({ isSubmitting: false, resetToken: accessToken ?? '' });
    return Boolean(accessToken);
  },

  async resetPassword(newPassword: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (useSignInStore.getState().isSubmitting) return { ok: false, message: '' };
    set({ isSubmitting: true });
    const result = await gotrue('/gotrue/user/change-password', { password: newPassword }, useSignInStore.getState().resetToken);
    set({ isSubmitting: false });
    if (result.ok) return { ok: true };
    return {
      ok: false,
      message: result.code === ErrorCode.NewPasswordTooWeak ? tr('signIn.passwordMustContain') : result.msg,
    };
  },
};
