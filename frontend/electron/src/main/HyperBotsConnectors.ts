import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { HyperBotsConnections, HyperBotsConnectionState } from '@shared/HyperBots';
import { hyperBotsSafeError, type HyperBotsEndpoint } from './HyperBotsEngine';
import { hyperBotsParseArgs as parseArgs, type HyperBotsBoundTool, type HyperBotsOutlook } from './HyperBotsOutlookTools';
import { HyperBotsToolError, type HyperBotsBinding, type HyperBotsTool, type HyperBotsToolRegistry } from './HyperBotsRuntime';
import { HyperOutlookUnavailable } from './HyperOutlookBridge';

// The Outlook tools live in HyperBotsOutlookTools; these names stay importable from here.
export { hyperBotsOutlookTool, hyperBotsOutlookTools, type HyperBotsBoundTool } from './HyperBotsOutlookTools';
const MAX_BODY = 1024 * 1024;
const JIRA_SETUP = 'Set up Jira in the Jira tab (URL, project and token).';
const clip = (text: string, max: number) => text.length > max ? text.slice(0, max) + '…' : text;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export type HyperBotsJiraAccess = { userId: string; baseUrl: string; projectKey: string; authType: 'basic' | 'personalAccessToken'; username: string; authorization: string };
/** Mirrors HyperJiraConfig.normalizeBaseUrl (renderer jira-config.ts). */
function normalizeBaseUrl(url: string): string {
  const v = url.trim(); if (!v) return '';
  try { const u = new URL(v.includes('://') ? v : 'https://' + v); return u.hostname ? u.protocol + '//' + u.host + u.pathname.replace(/\/+$/, '') : ''; } catch { return ''; }
}
/** The Jira tab's saved settings and credential for userId, with the same account id as jiraCredentialAccountId. */
export async function hyperBotsReadJira(prefs: { get(key: string): Promise<unknown> }, credentials: { read(accountId: string): Promise<{ username: string; secret: string } | null> }, userId: string): Promise<HyperBotsJiraAccess> {
  let raw = await prefs.get('hypertask.jira.' + userId + '.config');
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(JIRA_SETUP);
  const j = raw as Record<string, unknown>;
  const baseUrl = normalizeBaseUrl(String(j.baseUrl ?? '')), projectKey = String(j.projectKey ?? '').trim().toUpperCase();
  const authType = j.authType === 'basic' ? 'basic' : 'personalAccessToken', username = String(j.username ?? '');
  if (!baseUrl || !projectKey) throw new Error(JIRA_SETUP);
  const saved = await credentials.read(userId + '|' + baseUrl + '|' + projectKey + '|' + authType + '|' + username);
  if (!saved?.secret) throw new Error(JIRA_SETUP);
  const authorization = authType === 'basic' ? 'Basic ' + Buffer.from(saved.username + ':' + saved.secret, 'utf8').toString('base64') : 'Bearer ' + saved.secret;
  return { userId, baseUrl, projectKey, authType, username, authorization };
}
/** What the owner approves: the account, server and project. The secret is never part of it. */
export function hyperBotsJiraBinding(access: HyperBotsJiraAccess): HyperBotsBinding {
  return {
    destination: `Jira project ${access.projectKey} at ${access.baseUrl} as ${access.username || 'token'}`,
    fingerprint: createHash('sha256').update(JSON.stringify([access.userId, access.baseUrl, access.projectKey, access.authType, access.username])).digest('hex'),
  };
}

const JiraArgs = z.strictObject({
  summary: z.string().min(1).max(255).refine(s => s.trim().length > 0 && !/[\r\n]/.test(s), 'The summary must be one non-empty line.'),
  description: z.string().max(20000).optional(),
  issueType: z.string().trim().min(1).max(50).default('Task'),
  labels: z.array(z.string().regex(/^\S{1,50}$/, 'Labels are 1..50 characters without spaces.')).max(10).optional(),
});
type JiraArgs = z.output<typeof JiraArgs>;
/** Jira's error fields, redacted as a whole before the 500-character clip. */
function jiraErrorText(text: string, secrets: string[]): string {
  try {
    const j = JSON.parse(text), parts: string[] = [];
    if (Array.isArray(j?.errorMessages)) parts.push(...j.errorMessages.map(String));
    if (j?.errors && typeof j.errors === 'object') for (const [k, v] of Object.entries(j.errors)) parts.push(`${k}: ${String(v)}`);
    if (parts.length) return hyperBotsSafeError(parts.join('; '), secrets);
  } catch {}
  return hyperBotsSafeError(text, secrets);
}
async function readCapped(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length') ?? '0') > MAX_BODY) { await response.body?.cancel().catch(() => {}); throw new Error('The Jira response was too large.'); }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) { await reader.cancel().catch(() => {}); throw new Error('The Jira response was too large.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const BOUND_TTL_MS = 5 * 60_000;
/**
 * Creates an issue in the configured project only. Never retried: a lost response is a 'transport' (unknown) outcome.
 * `access` belongs to one HyperTask user. bind() resolves it; run() receives the approved fingerprint and writes only
 * with an access whose binding matches it (the one bind() just resolved, else a fresh read that must still match), so
 * the approved destination is the one that receives the write.
 */
export function hyperBotsJiraTool(deps: { access: () => Promise<HyperBotsJiraAccess>; fetch?: typeof fetch; timeoutMs?: number }): HyperBotsBoundTool {
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const bound = new Map<string, { access: HyperBotsJiraAccess; at: number }>();
  const resolve = async () => {
    try { return await deps.access(); } catch (error) { throw new HyperBotsToolError('refused', hyperBotsSafeError(message(error), [])); }
  };
  return {
    name: 'jira_create_issue', access: 'write',
    description: 'Create an issue in the owner\'s configured Jira project. Requires owner approval.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['summary'],
      properties: {
        summary: { type: 'string', minLength: 1, maxLength: 255, description: 'One-line summary' },
        description: { type: 'string', maxLength: 20000 },
        issueType: { type: 'string', minLength: 1, maxLength: 50, description: 'Issue type name (default Task)' },
        labels: { type: 'array', maxItems: 10, items: { type: 'string', pattern: '^\\S{1,50}$' } },
      },
    },
    parse: args => parseArgs(JiraArgs, args),
    summarize: args => { const a = args as JiraArgs; return `Create Jira ${a.issueType}: "${a.summary}"`; },
    async bind(args, signal) {
      signal.throwIfAborted();
      const access = await resolve();
      const now = Date.now();
      for (const [key, entry] of bound) if (now - entry.at > BOUND_TTL_MS) bound.delete(key);
      bound.set(JSON.stringify(args), { access, at: now });
      return hyperBotsJiraBinding(access);
    },
    async run(args, signal, fingerprint) {
      const a = args as JiraArgs;
      // Taken synchronously, before any await: nothing can re-bind these arguments in between.
      const argsKey = JSON.stringify(args), entry = bound.get(argsKey);
      bound.delete(argsKey);
      const fresh = entry && Date.now() - entry.at <= BOUND_TTL_MS && (!fingerprint || hyperBotsJiraBinding(entry.access).fingerprint === fingerprint);
      const access = fresh ? entry.access : await resolve();
      // The write goes only to the destination the owner approved, whatever re-bound these arguments meanwhile.
      if (fingerprint && hyperBotsJiraBinding(access).fingerprint !== fingerprint) throw new HyperBotsToolError('refused', 'The Jira destination changed after it was approved; nothing was sent.');
      const secrets = [access.authorization];
      const fields: Record<string, unknown> = { project: { key: access.projectKey }, summary: a.summary, issuetype: { name: a.issueType } };
      if (a.description !== undefined) fields.description = a.description;
      if (a.labels?.length) fields.labels = a.labels;
      let response: Response, text: string;
      if (signal.aborted) throw new HyperBotsToolError('refused', 'Stopped before the Jira request was sent.');
      try {
        response = await (deps.fetch ?? globalThis.fetch)(access.baseUrl + '/rest/api/2/issue', {
          method: 'POST', redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: access.authorization, 'X-Atlassian-Token': 'no-check', 'user-agent': 'HyperTask' },
          body: JSON.stringify({ fields }),
        });
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
          await response.body?.cancel().catch(() => {});
          throw new HyperBotsToolError('refused', 'Jira redirected the request (an SSO or login redirect). Check the URL and token in the Jira tab.');
        }
        text = await readCapped(response);
      } catch (error) {
        if (error instanceof HyperBotsToolError) throw error;
        throw new HyperBotsToolError('transport', `Jira request failed: ${hyperBotsSafeError(message(error), secrets)}`);
      }
      const detail = jiraErrorText(text, secrets) || hyperBotsSafeError(response.statusText, secrets);
      // A 5xx (e.g. a gateway timeout) may come after Jira created the issue: outcome unknown, never a refusal.
      if (response.status >= 500) throw new HyperBotsToolError('transport', `Jira answered HTTP ${response.status}; the issue may have been created, check the project before retrying: ${detail}`);
      if (!response.ok) throw new HyperBotsToolError('refused', `Jira refused the issue (HTTP ${response.status})${response.status === 401 || response.status === 403 ? '; check the token in the Jira tab' : ''}: ${detail}`);
      let key: unknown;
      try { key = JSON.parse(text)?.key; } catch {}
      // A 2xx without a readable key may still have created the issue, so it is never treated as a refusal.
      if (typeof key !== 'string' || !key) throw new HyperBotsToolError('transport', 'Jira accepted the request but returned no issue key; check the project before retrying.');
      return { key, url: access.baseUrl + '/browse/' + key };
    },
  };
}

export class HyperBotsTools implements HyperBotsToolRegistry {
  private readonly tools = new Map<string, HyperBotsTool>();
  constructor(tools: HyperBotsTool[]) {
    for (const tool of tools) {
      if (!/^[a-z0-9_]{1,64}$/.test(tool.name)) throw new Error(`Invalid tool name ${JSON.stringify(tool.name)}.`);
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name "${tool.name}".`);
      this.tools.set(tool.name, tool);
    }
  }
  get(name: string) { return this.tools.get(name); }
  specs(names: string[]) {
    return names.flatMap(name => { const tool = this.tools.get(name); return tool ? [{ type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: tool.parameters } }] : []; });
  }
}

const bounded = <T>(run: () => Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out')), ms);
  Promise.resolve().then(run).then(resolve, reject).finally(() => clearTimeout(timer));
});
/**
 * Independent, bounded checks of the app's own connections; never throws.
 * The Outlook check is the one approved exception to "approval before every connector call": it asks only whether
 * classic Outlook answers, reads no calendar item, and keeps no personal field (the bridge's name and address are dropped here).
 */
export async function hyperBotsConnections(deps: { endpoint: () => Promise<HyperBotsEndpoint>; outlook: HyperBotsOutlook; jira: () => Promise<HyperBotsJiraAccess> }, timeoutMs = 10_000): Promise<HyperBotsConnections> {
  const failed = (problem: string): HyperBotsConnectionState => ({ ready: false, problem });
  const [model, outlook, jira] = await Promise.all([
    bounded(deps.endpoint, timeoutMs).then(
      (e): HyperBotsConnections['model'] => !e.baseUrl ? failed('Set up the AI endpoint in Settings → AI.')
        : !e.defaultModel ? failed(`Choose a default model in Settings → AI (endpoint ${e.baseUrl}).`)
        : { ready: true, detail: `${e.defaultModel} at ${e.baseUrl}`, defaultModel: e.defaultModel },
      error => failed(`Set up the AI endpoint in Settings → AI. ${message(error)}`.trim())),
    bounded(() => deps.outlook.request('status', undefined), timeoutMs).then(
      (s): HyperBotsConnectionState => s.available ? { ready: true, detail: 'Classic Outlook is available' } : failed(s.reason ? clip(s.reason, 300) : HyperOutlookUnavailable),
      error => failed(/timed out/.test(message(error)) ? `Classic Outlook did not respond. ${HyperOutlookUnavailable}` : message(error) || HyperOutlookUnavailable)),
    bounded(deps.jira, timeoutMs).then(
      (a): HyperBotsConnections['jira'] => ({ ready: true, detail: `${a.projectKey} at ${a.baseUrl}`, projectKey: a.projectKey }),
      error => failed(message(error) === JIRA_SETUP ? JIRA_SETUP : `${JIRA_SETUP} ${message(error)}`)),
  ]);
  return { model, outlook, jira };
}
