import { create } from 'zustand';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { getAppFlowyCloudUrl } from '@/startup/cloud-env';
import { accessToken, passwordRequest, type PasswordResult } from './password';

interface PasswordState {
  hasPassword: boolean;
  isSubmitting: boolean;
}

/** PasswordBloc (lib/user/application/password/password_bloc.dart). */
export const usePasswordStore = create<PasswordState>(() => ({ hasPassword: false, isSubmitting: false }));

let service: { baseUrl: string; token: string } | null = null;

const send: Parameters<typeof passwordRequest>[0] = (options) => window.appflowy.net.request(options);

export const passwordActions = {
  /** init + checkHasPassword. Local users skip init, so every later event is a no-op. */
  async init(user: UserProfilePB) {
    service = null;
    usePasswordStore.setState({ hasPassword: false, isSubmitting: false });
    if (user.userAuthType === AuthTypePB.Local) return;
    service = { baseUrl: getAppFlowyCloudUrl(), token: accessToken(user) };
    await passwordActions.checkHasPassword();
  },
  /** A 403 or any failure means "no password". */
  async checkHasPassword() {
    if (!service) return;
    const result = await passwordRequest(send, service.baseUrl, service.token, 'checkHasPassword');
    const has = result.ok && typeof result.value === 'object' && result.value !== null && (result.value as { has_password?: unknown }).has_password === true;
    usePasswordStore.setState({ hasPassword: has });
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<PasswordResult<unknown> | null> {
    if (!service || usePasswordStore.getState().isSubmitting) return null;
    usePasswordStore.setState({ isSubmitting: true });
    const result = await passwordRequest(send, service.baseUrl, service.token, 'changePassword', {
      current_password: currentPassword,
      password: newPassword,
    });
    usePasswordStore.setState({ isSubmitting: false });
    return result;
  },
  async setupPassword(newPassword: string): Promise<PasswordResult<unknown> | null> {
    if (!service || usePasswordStore.getState().isSubmitting) return null;
    usePasswordStore.setState({ isSubmitting: true });
    const result = await passwordRequest(send, service.baseUrl, service.token, 'setupPassword', { password: newPassword });
    usePasswordStore.setState({ isSubmitting: false, hasPassword: result.ok });
    return result;
  },
};
