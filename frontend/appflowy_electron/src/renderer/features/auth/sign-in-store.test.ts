import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';

const mocks = vi.hoisted(() => ({
  magicLink: vi.fn(),
  passcode: vi.fn(),
  password: vi.fn(),
  token: vi.fn(),
  guest: vi.fn(),
  openWorkspace: vi.fn(),
  request: vi.fn(),
}));

vi.mock('@/backend/events', () => ({
  UserEventMagicLinkSignIn: mocks.magicLink,
  UserEventPasscodeSignIn: mocks.passcode,
  UserEventSignInWithEmailPassword: mocks.password,
}));
vi.mock('@/i18n', () => ({ tr: (key: string) => key }));
vi.mock('@/startup/cloud-env', () => ({
  isLocalType: (type: number) => type === 0,
  getAppFlowyCloudUrl: () => 'https://server.example',
}));
vi.mock('@/startup/app-store', () => ({
  useAppStore: { getState: () => ({ env: { authenticatorType: 1 }, deviceId: 'device' }) },
}));
vi.mock('@/startup/deep-link', async () => {
  const { create } = await import('zustand');
  return {
    useDeepLinkStore: create(() => ({ state: 'none', invitation: null })),
    passGotrueTokenResponse: mocks.token,
  };
});
vi.mock('@/startup/HyperLauncher', () => ({
  signUpAsGuest: mocks.guest,
  openWorkspaceOrHandleError: mocks.openWorkspace,
}));

const { signInActions, useSignInStore } = await import('./sign-in-store');
const { useDeepLinkStore } = await import('@/startup/deep-link');

beforeEach(() => {
  vi.resetAllMocks();
  useDeepLinkStore.setState({ state: 'none' });
  useSignInStore.setState({ isSubmitting: false, emailError: null, passwordError: null, successOrFail: null, resetToken: '' });
  vi.stubGlobal('window', { appflowy: { net: { request: mocks.request } } });
});

describe('sign-in flows', () => {
  it('maps an invalid email response to the email field and finishes submission', async () => {
    mocks.magicLink.mockResolvedValue({ ok: false, error: { code: ErrorCode.EmailFormatInvalid, msg: 'Invalid email' } });
    await signInActions.signInWithMagicLink('bad');
    expect(mocks.magicLink).toHaveBeenCalledWith({ email: 'bad', redirectTo: '' });
    expect(useSignInStore.getState()).toMatchObject({ isSubmitting: false, emailError: 'Invalid email' });
  });

  it('prevents duplicate magic-link and passcode requests while verification is pending', async () => {
    useSignInStore.setState({ isSubmitting: true });
    await signInActions.signInWithMagicLink('user@example.com');
    await signInActions.signInWithPasscode('user@example.com', '012345');
    expect(mocks.magicLink).not.toHaveBeenCalled();
    expect(mocks.passcode).not.toHaveBeenCalled();
  });

  it('passes a successful passcode token to the deep-link bridge without dropping leading zeroes', async () => {
    const token = { accessToken: 'access' };
    mocks.passcode.mockResolvedValue({ ok: true, value: token });
    await signInActions.signInWithPasscode('user@example.com', '012345');
    expect(mocks.passcode).toHaveBeenCalledWith({ email: 'user@example.com', passcode: '012345' });
    expect(mocks.token).toHaveBeenCalledWith(token);
    expect(useSignInStore.getState().isSubmitting).toBe(true);
  });

  it('preserves the email/password request and maps password validation errors', async () => {
    mocks.password.mockResolvedValue({ ok: false, error: { code: ErrorCode.PasswordFormatInvalid, msg: 'Invalid password' } });
    await signInActions.signInWithEmailAndPassword('user@example.com', 'secret');
    expect(mocks.password).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret', authType: AuthTypePB.Server, deviceId: 'device' });
    expect(useSignInStore.getState()).toMatchObject({ isSubmitting: false, passwordError: 'Invalid password' });
  });

  it('drives pending and failed verification from deep-link events and clears visible errors', () => {
    useSignInStore.setState({ emailError: 'old', passwordError: 'old' });
    useDeepLinkStore.setState({ state: 'loading' });
    expect(useSignInStore.getState()).toMatchObject({ isSubmitting: true, emailError: null, passwordError: null });
    useDeepLinkStore.setState({ state: 'error' });
    expect(useSignInStore.getState()).toMatchObject({ isSubmitting: false, successOrFail: { ok: false, message: 'signIn.generalError' } });
    signInActions.clearErrors();
    expect(useSignInStore.getState().successOrFail).toBeNull();
  });

  it('opens the workspace after successful guest creation', async () => {
    mocks.guest.mockResolvedValue({ ok: true });
    await signInActions.signInAsGuest();
    expect(mocks.openWorkspace).toHaveBeenCalledOnce();
    expect(useSignInStore.getState()).toMatchObject({ isSubmitting: false, successOrFail: { ok: true } });
  });
});

describe('password recovery', () => {
  it('sends recovery, verifies the code, and uses the recovery token to change the password', async () => {
    mocks.request.mockResolvedValueOnce({ status: 200, body: '{}' });
    expect(await signInActions.forgotPassword('user@example.com')).toMatchObject({ ok: true });
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://server.example/gotrue/recover', body: '{"email":"user@example.com"}' }));

    mocks.request.mockResolvedValueOnce({ status: 200, body: '{"access_token":"recovery"}' });
    expect(await signInActions.validateResetPasswordToken('user@example.com', '012345')).toBe(true);
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ body: '{"type":"recovery","email":"user@example.com","token":"012345"}' }));

    mocks.request.mockResolvedValueOnce({ status: 200, body: '{}' });
    expect(await signInActions.resetPassword('new-secret')).toEqual({ ok: true });
    expect(mocks.request).toHaveBeenLastCalledWith({ url: 'https://server.example/gotrue/user/change-password', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer recovery' }, body: '{"password":"new-secret"}' });
    expect(useSignInStore.getState().isSubmitting).toBe(false);
  });

  it('rejects missing recovery tokens and preserves the weak-password validation message', async () => {
    mocks.request.mockResolvedValueOnce({ status: 200, body: '{}' });
    expect(await signInActions.validateResetPasswordToken('user@example.com', 'bad')).toBe(false);
    expect(useSignInStore.getState().resetToken).toBe('');
    mocks.request.mockResolvedValueOnce({ status: 422, body: '{"msg":"weak"}' });
    expect(await signInActions.resetPassword('weak')).toEqual({ ok: false, message: 'signIn.passwordMustContain' });
    expect(useSignInStore.getState().isSubmitting).toBe(false);
  });
});
