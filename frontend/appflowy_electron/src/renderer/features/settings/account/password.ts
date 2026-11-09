import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';

// PasswordHttpService (lib/user/application/password/password_http_service.dart) and
// AFPasswordErrorExtension (settings/pages/account/password/error_extensions.dart): direct
// HTTP to the self-hosted GoTrue, through the main process.

export interface PasswordError {
  code: ErrorCode;
  msg: string;
}

export type PasswordResult<T> = { ok: true; value: T } | { ok: false; error: PasswordError };

/** userProfile.token is a JSON object; the bearer is its access_token (af_user_profile_extension.dart). */
export function accessToken(user: Pick<UserProfilePB, 'token'>): string {
  try {
    const json = JSON.parse(user.token) as { access_token?: unknown };
    return typeof json.access_token === 'string' ? json.access_token : '';
  } catch {
    return '';
  }
}

export type HttpSend = (options: { url: string; method: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; body: string }>;

const ENDPOINTS = {
  changePassword: { path: '/gotrue/user/change-password', method: 'POST', error: 'Failed to change password' },
  setupPassword: { path: '/gotrue/user/change-password', method: 'POST', error: 'Failed to setup password' },
  checkHasPassword: { path: '/gotrue/user/auth-info', method: 'GET', error: 'Failed to check password status' },
} as const;

/** _makeRequest: 200 → decoded body (or true), else FlowyError{code: 422 → NewPasswordTooWeak, msg: body.msg ?? default}. */
export async function passwordRequest(
  send: HttpSend,
  baseUrl: string,
  token: string,
  endpoint: keyof typeof ENDPOINTS,
  body?: Record<string, unknown>,
): Promise<PasswordResult<unknown>> {
  const { path, method, error } = ENDPOINTS[endpoint];
  try {
    const response = await send({
      url: `${baseUrl}${path}`,
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: method === 'POST' && body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 200) return { ok: true, value: response.body !== '' ? JSON.parse(response.body) : true };
    const errorBody = (response.body !== '' ? JSON.parse(response.body) : {}) as { msg?: unknown };
    return {
      ok: false,
      error: {
        code: response.status === 422 ? ErrorCode.NewPasswordTooWeak : ErrorCode.Internal,
        msg: typeof errorBody.msg === 'string' ? errorBody.msg : error,
      },
    };
  } catch (e) {
    return { ok: false, error: { code: ErrorCode.Internal, msg: `Network error: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

export const incorrectPasswordPattern = /Incorrect current password/;
export const tooShortPasswordPattern = /Password should be at least (\d+) characters/;
export const tooLongPasswordPattern = /Password cannot be longer than (\d+) characters/;

export type PasswordField = 'current' | 'new' | 'confirm';

/**
 * ChangePasswordDialogContent._onPasswordStateChanged: which field shows which error for a
 * failed change (tr is injected so this stays testable).
 */
export function changePasswordErrorFor(error: PasswordError, tr: (key: string, options?: { namedArgs?: Record<string, string> }) => string): { field: PasswordField; text: string } {
  const msg = error.msg;
  if (incorrectPasswordPattern.test(msg)) return { field: 'current', text: tr('newSettings.myAccount.password.error.currentPasswordIsIncorrect') };
  const short = tooShortPasswordPattern.exec(msg);
  if (short) return { field: 'new', text: tr('newSettings.myAccount.password.error.passwordShouldBeAtLeast6Characters', { namedArgs: { min: short[1] ?? '6' } }) };
  const long = tooLongPasswordPattern.exec(msg);
  if (long) return { field: 'new', text: tr('newSettings.myAccount.password.error.passwordCannotBeLongerThan72Characters', { namedArgs: { max: long[1] ?? '72' } }) };
  if (error.code === ErrorCode.NewPasswordTooWeak) return { field: 'new', text: tr('signIn.passwordMustContain') };
  return { field: 'new', text: msg };
}

/** _save() client checks, in order; the first failure wins. */
export function validateChangePassword(current: string, next: string, confirm: string): { field: PasswordField; key: string } | null {
  if (current === '') return { field: 'current', key: 'newSettings.myAccount.password.error.currentPasswordIsRequired' };
  if (next === '') return { field: 'new', key: 'newSettings.myAccount.password.error.newPasswordIsRequired' };
  if (confirm === '') return { field: 'confirm', key: 'newSettings.myAccount.password.error.confirmPasswordIsRequired' };
  if (next !== confirm) return { field: 'confirm', key: 'newSettings.myAccount.password.error.passwordsDoNotMatch' };
  if (next === current) return { field: 'new', key: 'newSettings.myAccount.password.error.newPasswordIsSameAsCurrent' };
  return null;
}

/** SetupPasswordDialogContent checks. */
export function validateSetupPassword(password: string, confirm: string): { field: 'new' | 'confirm'; key: string } | null {
  if (password === '') return { field: 'new', key: 'newSettings.myAccount.password.error.newPasswordIsRequired' };
  if (confirm === '') return { field: 'confirm', key: 'newSettings.myAccount.password.error.confirmPasswordIsRequired' };
  if (password !== confirm) return { field: 'confirm', key: 'newSettings.myAccount.password.error.passwordsDoNotMatch' };
  return null;
}

/** SetupPasswordDialogContent: every server error goes to the password field (no "incorrect current" case). */
export function setupPasswordErrorFor(error: PasswordError, tr: (key: string, options?: { namedArgs?: Record<string, string> }) => string): string {
  if (incorrectPasswordPattern.test(error.msg)) return error.msg;
  return changePasswordErrorFor(error, tr).text;
}
