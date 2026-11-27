import { hyperMapSourceStatus } from '@shared/HyperHubStatusMapping';
import { z } from 'zod';
import type { HyperHubReadScope } from '@shared/HyperTaskHub';
import type { HyperBotsJiraAccess } from '../HyperBotsConnectors';
import { hyperBotsHttpRequest } from '../HyperBotsHttpTools';
import { hyperHubEmailIdentity, hyperHubHash, hyperHubInstant, type HyperHubRecord } from './HyperTaskHubStore';
import { HyperHubConnectionAccessLost, HyperHubAccessLost, type HyperHubBatch, type HyperHubQuery } from './HyperTaskHubSync';

export function hyperHubJql(project: string, filter = '', includeClosed = false) {
  let depth = 0, quote = '';
  for (let i = 0; i < filter.length; i++) {
    const c = filter[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && /[oO]/.test(c) && (!i || /\W/.test(filter[i - 1])) && /^order\s+by\b/i.test(filter.slice(i))) {
      filter = filter.slice(0, i);
      break;
    }
    if (depth < 0) throw new Error('Invalid Jira filter.');
  }
  if (depth || quote) throw new Error('Invalid Jira filter.');
  return ['project = ' + JSON.stringify(project), ...(filter.trim() ? ['(' + filter.trim() + ')'] : []),
    ...(includeClosed ? [] : ['statusCategory != Done']), '(assignee = currentUser() OR reporter = currentUser())'].join(' AND ') + ' ORDER BY updated ASC, key ASC';
}

const person = z.object({ emailAddress: z.string().nullish(), accountId: z.string().optional(), key: z.string().optional(), name: z.string().optional(), displayName: z.string().optional() });
function matches(a: z.infer<typeof person> | null | undefined, b: z.infer<typeof person>) {
  if (!a) return false;
  const key = (['accountId', 'key', 'name'] as const).find(k => a[k] && b[k]);
  return !!key && a[key] === b[key];
}
const issue = z.object({
  id: z.string().regex(/^\d+$/), key: z.string().regex(/^[a-z][a-z0-9_]*-\d+$/i),
  fields: z.object({ summary: z.string(), updated: z.string(), created: z.string().optional(), duedate: z.iso.date().nullish(),
    issuetype: z.object({ name: z.string() }).nullish(), priority: z.object({ id: z.string() }).nullish(), status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string().optional() }).nullish() }), assignee: person.nullable(), reporter: person.nullish() }),
});
const page = z.object({ issues: z.array(issue), startAt: z.int().nonnegative().optional(), total: z.int().nonnegative().optional(),
  isLast: z.boolean().optional(), nextPageToken: z.string().nullish() });

export class HyperHubJiraSource implements HyperHubQuery {
  readonly kind = 'jira';
  readonly queryId: string;
  readonly label: string;
  constructor(readonly connectionId: string, private readonly project: string, private readonly filter: string,
    private readonly zone: string, private readonly access: () => Promise<HyperBotsJiraAccess>, private readonly fetcher?: typeof fetch,
    private readonly now = Date.now) {
    this.queryId = hyperHubHash('jira', project, filter);
    this.label = 'Jira · ' + project;
  }

  private async request(access: HyperBotsJiraAccess, path: string, signal: AbortSignal, body?: unknown) {
    try { return await hyperBotsHttpRequest('Jira', access, { path, ...(body !== undefined && { method: 'POST' as const, body }) }, signal, this.fetcher); }
    catch (error) {
      if (error instanceof Error && /^Jira returned HTTP 401\./.test(error.message)) throw new HyperHubConnectionAccessLost();
      if (error instanceof Error && /^Jira returned HTTP (403|404)\./.test(error.message)) throw new HyperHubAccessLost();
      throw error;
    }
  }

  async read(scope: HyperHubReadScope, signal: AbortSignal): Promise<HyperHubBatch> {
    const access = await this.access();
    const owner = person.parse(await this.request(access, '/rest/api/2/myself', signal));
    const account = owner.accountId || owner.key || owner.name;
    if (!account) throw new Error('Jira did not identify the connected account.');
    const host = new URL(access.baseUrl).hostname;
    const cloud = host.endsWith('.atlassian.net') || host === 'api.atlassian.com';
    const jql = hyperHubJql(this.project, this.filter);
    const fields = ['summary', 'updated', 'created', 'duedate', 'priority', 'issuetype', 'status', 'assignee', 'reporter'];
    const observedAt = hyperHubInstant(this.now());
    const records: HyperHubRecord[] = [];
    const tokens = new Set<string>();
    let offset = 0, token: string | undefined, total: number | undefined, complete = false;
    const seen = new Set<string>();
    let consistent = true;
    for (;;) {
      const result = page.parse(await this.request(access, cloud ? '/rest/api/2/search/jql' : '/rest/api/2/search', signal,
        { jql, fields, maxResults: 100, ...(cloud ? { nextPageToken: token } : { startAt: offset }) }));
      if (!cloud && result.startAt !== undefined && result.startAt !== offset) break;
      if (total !== undefined && result.total !== total) consistent = false;
      total ??= result.total;
      for (const { id: issueId, key: issueKey, fields: f } of result.issues) {
        if (seen.has(issueId)) consistent = false;
        seen.add(issueId);
        const assigned = matches(f.assignee, owner);
        if (!assigned && !matches(f.reporter, owner)) { consistent = false; continue; }
        const key = { kind: this.kind, instanceId: access.baseUrl, issueId } as const;
        const mapped = hyperMapSourceStatus('jira', f.status.statusCategory?.key);
        records.push({ id: hyperHubHash(scope.connectionId, account, key.instanceId, issueId), scope, key, revision: f.updated, observedAt,
          role: 'origin', openTarget: key, projectId: this.project, label: issueKey, jiraAlias: access.baseUrl + '/browse/' + issueKey,
          ownerAssigned: assigned, decisionDue: f.issuetype?.name.toLowerCase() === 'decision', title: f.summary, rawStatus: f.status.name, category: mapped.category, completion: mapped.completion, initialState: assigned ? mapped.state ?? 'ready' : 'waiting',
          verifiedIdentityIds: [f.assignee, f.reporter].flatMap(p => hyperHubEmailIdentity(p?.emailAddress ?? '') ?? []),
          people: (['assignee', 'reporter'] as const).flatMap(role => {
            const p = f[role], identity = p?.accountId || p?.key || p?.name;
            return p && identity ? [{ id: hyperHubHash(access.baseUrl, identity), name: p.displayName || p.name || identity, role }] : [];
          }),
          due: f.duedate ? { kind: 'civil-date', date: f.duedate, zone: this.zone } : undefined,
          createdAt: f.created && Number.isFinite(Date.parse(f.created)) ? hyperHubInstant(Date.parse(f.created)) : undefined,
          priorityId: f.priority?.id });
      }
      offset += result.issues.length;
      if (cloud ? (result.isLast === true || (result.isLast !== false && result.nextPageToken === null)) : result.total !== undefined && offset >= result.total) {
        complete = consistent && (cloud || seen.size === total);
        break;
      }
      if (!result.issues.length || (!cloud && result.total === undefined) || signal.aborted) break;
      if (cloud) {
        if (!result.nextPageToken || tokens.has(result.nextPageToken)) break;
        token = result.nextPageToken;
        tokens.add(token);
      }
    }
    const last = records.at(-1);
    return { records, completeness: complete ? 'complete' : 'partial', cursor: last ? JSON.stringify([last.revision, last.label]) : null };
  }

  async check(record: HyperHubRecord, signal: AbortSignal, verifyRevision = false) {
    const access = await this.access();
    if (record.key.kind !== 'jira' || record.key.instanceId !== access.baseUrl) throw new HyperHubAccessLost();
    const found = z.object({ id: z.string(), key: issue.shape.key, fields: z.object({ updated: z.string() }).optional() }).parse(await this.request(access,
      '/rest/api/2/issue/' + record.key.issueId + (verifyRevision ? '?fields=updated' : '?fields=summary'), signal));
    if (found.id !== record.key.issueId) throw new HyperHubAccessLost();
    if (verifyRevision && found.fields?.updated !== record.revision) throw new Error('Issue changed.');
    return access.baseUrl + '/browse/' + found.key;
  }
}
