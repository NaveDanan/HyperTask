import type { JiraIssue } from './models/jira-issue';
export type JiraExceptionKind = 'notConfigured' | 'auth' | 'permission' | 'notFound' | 'validation' | 'rateLimit' | 'server' | 'network' | 'conflict' | 'transitionUnsupported';
const titles: Record<JiraExceptionKind, string> = { notConfigured: 'Jira is not configured', auth: 'Authentication failed', permission: 'Permission denied',
  notFound: 'Not found', validation: 'Jira rejected the request', rateLimit: 'Too many requests', server: 'Jira server error',
  network: 'Cannot reach Jira', conflict: 'Edit conflict', transitionUnsupported: 'Transition needs more input' };
export interface JiraExceptionOptions { statusCode?: number; fieldErrors?: Record<string, string>; retryAfter?: number | null }
/** retryAfter is milliseconds; kind is stable for banners and dialogs. */
export class HyperJiraException extends Error {
  readonly statusCode?: number;
  constructor(message: string, readonly kind: JiraExceptionKind, o: JiraExceptionOptions = {}) { super(message); this.name = new.target.name; this.statusCode = o.statusCode; }
  get title(): string { return titles[this.kind]; }
  override toString(): string { return this.name + '(' + (this.statusCode ?? '-') + '): ' + this.message; }
}
export class HyperJiraNotConfiguredException extends HyperJiraException { constructor(m: string) { super(m, 'notConfigured'); } }
export class HyperJiraAuthException extends HyperJiraException { constructor(m: string, o: JiraExceptionOptions = {}) { super(m, 'auth', o); } }
export class HyperJiraPermissionException extends HyperJiraException { constructor(m: string, o: JiraExceptionOptions = {}) { super(m, 'permission', o); } }
export class HyperJiraNotFoundException extends HyperJiraException { constructor(m: string, o: JiraExceptionOptions = {}) { super(m, 'notFound', o); } }
export class HyperJiraValidationException extends HyperJiraException {
  readonly fieldErrors: Record<string, string>; constructor(m: string, o: JiraExceptionOptions = {}) { super(m, 'validation', o); this.fieldErrors = o.fieldErrors ?? {}; }
}
export class HyperJiraRateLimitException extends HyperJiraException {
  readonly retryAfter: number | null; constructor(m: string, o: JiraExceptionOptions = {}) { super(m, 'rateLimit', o); this.retryAfter = o.retryAfter ?? null; }
}
export class HyperJiraServerException extends HyperJiraException { constructor(m: string, o: JiraExceptionOptions = {}) { super(m, 'server', o); } }
export class HyperJiraNetworkException extends HyperJiraException { constructor(m: string) { super(m, 'network'); } }
export class HyperJiraConflictException extends HyperJiraException {
  readonly local: JiraIssue; readonly remote: JiraIssue;
  constructor(m: string, o: { local: JiraIssue; remote: JiraIssue }) { super(m, 'conflict'); this.local = o.local; this.remote = o.remote; }
}
export class HyperJiraTransitionUnsupportedException extends HyperJiraException { constructor(m: string) { super(m, 'transitionUnsupported'); } }
/** Unexpected errors use a fixed message, never arbitrary credential-bearing error text. */
export function asJiraException(e: unknown): HyperJiraException { return e instanceof HyperJiraException ? e : new HyperJiraServerException('Unexpected Jira operation failure.'); }
export { HyperJiraException as JiraException, HyperJiraNotConfiguredException as JiraNotConfiguredException, HyperJiraAuthException as JiraAuthException,
  HyperJiraPermissionException as JiraPermissionException, HyperJiraNotFoundException as JiraNotFoundException, HyperJiraValidationException as JiraValidationException,
  HyperJiraRateLimitException as JiraRateLimitException, HyperJiraServerException as JiraServerException, HyperJiraNetworkException as JiraNetworkException,
  HyperJiraConflictException as JiraConflictException, HyperJiraTransitionUnsupportedException as JiraTransitionUnsupportedException };
