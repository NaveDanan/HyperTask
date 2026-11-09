// AppFlowyCloudDeepLink (startup/tasks/deeplink/*): appflowy-flutter:// links, and the
// sign-in bridge that turns a GoTrue token response into a login-callback link.
import { create } from 'zustand';
import type { GotrueTokenResponsePB } from '@shared/protobuf/flowy-user/auth_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { UserEventOauthSignIn } from '@/backend/events';
import { showToast } from '@/ui/toast';

export type DeepLinkState = 'none' | 'loading' | 'finish' | 'error';

export const useDeepLinkStore = create<{
  state: DeepLinkState;
  /** InvitationDeepLinkHandler result (openWorkspaceNotifier). */
  invitation: { workspaceId: string; email: string } | null;
}>(() => ({ state: 'none', invitation: null }));

/** Builds `appflowy-flutter://login-callback#…` in the order Dart's passGotrueTokenResponse uses. */
export function loginCallbackUrl(token: GotrueTokenResponsePB): string | null {
  const params: Array<[string, string]> = [];
  const add = (key: string, value: string | bigint | undefined) => {
    if (value === undefined) return;
    const text = String(value);
    if (text !== '' && text !== '0') params.push([key, text]);
  };
  add('access_token', token.accessToken);
  add('expires_at', token.expiresAt);
  add('expires_in', token.expiresIn);
  add('provider_refresh_token', token.oneOfProviderRefreshToken.value);
  add('provider_token', token.oneOfProviderAccessToken.value);
  add('refresh_token', token.refreshToken);
  add('token_type', token.tokenType);
  if (params.length === 0) return null;
  const fragment = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `appflowy-flutter://login-callback#${fragment}`;
}

export async function passGotrueTokenResponse(token: GotrueTokenResponsePB): Promise<void> {
  const url = loginCallbackUrl(token);
  if (url) await handleDeepLink(url);
}

export async function handleDeepLink(url: string): Promise<void> {
  const set = (state: DeepLinkState) => useDeepLinkStore.setState({ state });
  set('none');
  let uri: URL;
  try {
    uri = new URL(url);
  } catch {
    showToast({ message: 'Unexpected empty DeepLink', type: 'error' });
    return;
  }

  if (uri.hash.includes('access_token')) {
    set('loading');
    const result = await UserEventOauthSignIn({
      map: { sign_in_url: url, device_id: await window.appflowy.app.deviceId() },
      authType: AuthTypePB.Server,
    });
    if (result.ok) {
      set('finish');
      // Imported lazily: the launcher imports this module.
      const { runAppFlowy } = await import('./launcher');
      await runAppFlowy();
    } else {
      // The Flutter app leaves the sign-in button spinning here; report the error instead.
      set('error');
      showToast({ message: result.error.msg, type: 'error' });
    }
    return;
  }

  if (uri.host === 'invitation-callback') {
    const workspaceId = uri.searchParams.get('workspace_id');
    const email = uri.searchParams.get('email');
    if (workspaceId && email) useDeepLinkStore.setState({ invitation: { workspaceId, email } });
    return;
  }

  if (url.includes('error=access_denied')) {
    showToast({ message: 'Magic link is invalid or has expired', type: 'error' });
    return;
  }

  if (url === 'appflowy-flutter://' || url === 'appflowy-flutter:///') return;
  showToast({ message: `No handler found for DeepLink: ${url}`, type: 'error' });
}

/** Listens for links forwarded by the main process and handles the launch link. */
export function startDeepLinks(): () => void {
  const stop = window.appflowy.app.onDeepLink((url) => void handleDeepLink(url));
  void window.appflowy.app.takeLaunchDeepLink().then((url) => {
    if (url) void handleDeepLink(url);
  });
  return stop;
}
