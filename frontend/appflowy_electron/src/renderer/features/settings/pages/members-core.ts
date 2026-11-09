import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';

// Pure parts of the Members page (widgets/members/**, lib/shared/af_role_pb_extension.dart,
// lib/shared/af_user_profile_extension.dart).

/** AFRolePBExtension. */
export const roleCan = {
  invite: (role: AFRolePB) => role === AFRolePB.Owner,
  delete: (role: AFRolePB) => role === AFRolePB.Owner,
  update: (role: AFRolePB) => role === AFRolePB.Owner,
  leave: (role: AFRolePB) => role !== AFRolePB.Owner,
};

/** AFRolePBExtension.description i18n key. */
export function roleDescriptionKey(role: AFRolePB): string {
  switch (role) {
    case AFRolePB.Owner:
      return 'settings.appearance.members.owner';
    case AFRolePB.Member:
      return 'settings.appearance.members.member';
    default:
      return 'settings.appearance.members.guest';
  }
}

/** UserProfilePBExtension.authToken: `access_token` of the JSON token, or null. */
export function authTokenOf(user: Pick<UserProfilePB, 'token'>): string | null {
  try {
    const map = JSON.parse(user.token) as Record<string, unknown> | null;
    const token = map?.['access_token'];
    if (token === undefined || token === null) return null;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/**
 * InviteCodeEndpoint.uri: only the scheme, host and port of the cloud base URL are kept
 * (Dart Uri.replace with the default port, which it omits when printing).
 */
export function inviteCodeUrl(baseUrl: string, workspaceId: string): string {
  const base = new URL(baseUrl);
  return `${base.protocol}//${base.host}/api/workspace/${workspaceId}/invite-code`;
}

/** WorkspaceMemberBloc._buildInviteLink. */
export function buildInviteLink(shareDomain: string, inviteCode: string, authToken: string | null): string {
  return authToken !== null ? `${shareDomain}/app/invited/${inviteCode}` : '';
}

/** `isEmail` from package:string_validator 1.1.0 (matched against the lower-cased text). */
const EMAIL =
  /^((([a-z]|\d|[!#$%&'*+\-/=?^_`{|}~]|[ -퟿豈-﷏ﷰ-￯])+(\.([a-z]|\d|[!#$%&'*+\-/=?^_`{|}~]|[ -퟿豈-﷏ﷰ-￯])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[ -퟿豈-﷏ﷰ-￯])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[ -퟿豈-﷏ﷰ-￯]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[ -퟿豈-﷏ﷰ-￯])|(([a-z]|\d|[ -퟿豈-﷏ﷰ-￯])([a-z]|\d|-|\.|_|~|[ -퟿豈-﷏ﷰ-￯])*([a-z]|\d|[ -퟿豈-﷏ﷰ-￯])))\.)+(([a-z]|[ -퟿豈-﷏ﷰ-￯])|(([a-z]|[ -퟿豈-﷏ﷰ-￯])([a-z]|\d|-|\.|_|~|[ -퟿豈-﷏ﷰ-￯])*([a-z]|[ -퟿豈-﷏ﷰ-￯])))$/;

export const isEmail = (text: string) => EMAIL.test(text.toLowerCase());

/** DateFormat('MMM d, y') with the month abbreviation of the given locale. */
export function formatMonthDayYear(date: Date, locale = 'en-US'): string {
  let month: string;
  try {
    month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
  } catch {
    month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
  }
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/** _MemberItem._formatJoinedDate (hard-coded English prefix). */
export const formatJoinedDate = (joinedAtSec: number, locale?: string) =>
  `Joined on ${formatMonthDayYear(new Date(joinedAtSec * 1000), locale)}`;

export type HttpOutcome<T> = { ok: true; value: T } | { ok: false; msg: string };

type Fetch = (options: { url: string; method: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; body: string }>;

/** MemberHttpService._makeRequest: 200 → decoded body (or true when empty); else body.msg ?? default. */
export async function memberRequest(
  fetch: Fetch,
  { baseUrl, authToken, workspaceId, method, body, errorMessage }: { baseUrl: string; authToken: string; workspaceId: string; method: 'GET' | 'POST' | 'DELETE'; body?: unknown; errorMessage: string },
): Promise<HttpOutcome<unknown>> {
  try {
    const response = await fetch({
      url: inviteCodeUrl(baseUrl, workspaceId),
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (response.status === 200) {
      return { ok: true, value: response.body !== '' ? JSON.parse(response.body) : true };
    }
    const errorBody = response.body !== '' ? (JSON.parse(response.body) as Record<string, unknown> | null) : {};
    const msg = errorBody?.['msg'];
    return { ok: false, msg: msg === undefined || msg === null ? errorMessage : String(msg) };
  } catch (error) {
    return { ok: false, msg: `Network error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** MemberHttpService.getInviteCode: `data.code` must be a non-empty string. */
export async function getInviteCode(fetch: Fetch, baseUrl: string, authToken: string, workspaceId: string): Promise<HttpOutcome<string>> {
  const result = await memberRequest(fetch, { baseUrl, authToken, workspaceId, method: 'GET', errorMessage: 'Failed to get invite code' });
  if (!result.ok) return result;
  try {
    const code = (result.value as { data: { code: unknown } }).data.code;
    if (typeof code !== 'string' || code === '') return { ok: false, msg: `Failed to get invite code: ${code ?? 'null'}` };
    return { ok: true, value: code };
  } catch (error) {
    return { ok: false, msg: `Failed to get invite code: ${String(error)}` };
  }
}

/** MemberHttpService.generateInviteCode: POST `{"validity_period_hours": null}`; `data.code.toString()`. */
export async function generateInviteCode(fetch: Fetch, baseUrl: string, authToken: string, workspaceId: string): Promise<HttpOutcome<string>> {
  const result = await memberRequest(fetch, {
    baseUrl,
    authToken,
    workspaceId,
    method: 'POST',
    body: { validity_period_hours: null },
    errorMessage: 'Failed to generate invite code',
  });
  if (!result.ok) return result;
  try {
    const code = (result.value as { data: { code: unknown } }).data.code;
    return { ok: true, value: code === undefined || code === null ? 'null' : String(code) };
  } catch (error) {
    return { ok: false, msg: `Failed to generate invite code: ${String(error)}` };
  }
}
