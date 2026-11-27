import { z } from 'zod';
import { hyperChooseJiraCandidates, hyperMapSourceStatus } from '@shared/HyperHubStatusMapping';
import type { HyperHubStatusCandidate, HyperHubStatusIntent } from '@shared/HyperTaskHub';
import { hyperBotsHttpRequest, type HyperBotsHttpAccess } from '../HyperBotsHttpTools';
import { HyperHubStatusError, type HyperHubDiscovery, type HyperHubStatusWriter, type HyperHubWriteTarget } from './HyperHubStatusWriter';
import { hyperHubJql } from './HyperHubJiraSource';
import { hyperHubHash } from './HyperTaskHubStore';

const id = z.string().min(1).max(512);
const person = z.object({ accountId: id.optional(), key: id.optional(), name: id.optional(), displayName: z.string().optional() });
const status = z.object({ id, name: z.string(), statusCategory: z.object({ key: z.string().optional() }).nullish() });
const issue = z.object({ id, key: id, fields: z.object({ project: z.object({ key: id, id: id.optional() }), summary: z.string(),
  updated: id, status, assignee: person.nullable(), reporter: person.nullish() }) });
const transition = z.object({ id, name: z.string(), to: status, isGlobal: z.boolean().optional(),
  fields: z.record(z.string(), z.object({ required: z.boolean(), name: z.string().optional(),
    allowedValues: z.array(z.object({ id, name: id })).optional().catch(undefined) })).optional().catch(undefined) });

export class HyperHubJiraStatusWriter implements HyperHubStatusWriter {
  readonly source = 'jira';
  constructor(private readonly access: HyperBotsHttpAccess, readonly binding: string, private readonly fetcher: typeof fetch, private readonly filter = '') {}
  private path(target: HyperHubWriteTarget) {
    if (target.key.kind !== 'jira' || target.key.instanceId !== this.access.baseUrl || !/^\d+$/.test(target.key.issueId)) throw new HyperHubStatusError('access-denied');
    return '/rest/api/2/issue/' + target.key.issueId;
  }
  private owner(signal: AbortSignal) {
    return hyperBotsHttpRequest('Jira', this.access, { path: '/rest/api/2/myself' }, signal, this.fetcher).then(value => person.parse(value));
  }
  async principal(signal: AbortSignal) {
    const owner = await this.owner(signal);
    return owner.accountId || owner.key || owner.name;
  }
  async discover(target: HyperHubWriteTarget, intent: HyperHubStatusIntent, previous: string | undefined, signal: AbortSignal, phase?: 'final' | 'observe'): Promise<HyperHubDiscovery> {
    const path = this.path(target);
    const get = (path: string) => hyperBotsHttpRequest('Jira', this.access, { path }, signal, this.fetcher);
    const owner = await this.owner(signal);
    const principal = owner.accountId || owner.key || owner.name;
    if (this.filter.trim() && target.key.kind === 'jira') {
      const host = new URL(this.access.baseUrl).hostname;
      const cloud = host.endsWith('.atlassian.net') || host === 'api.atlassian.com';
      const result = await hyperBotsHttpRequest('Jira', this.access, { method: 'POST', path: cloud ? '/rest/api/2/search/jql' : '/rest/api/2/search',
        body: { jql: 'id = ' + target.key.issueId + ' AND ' + hyperHubJql(target.projectId, this.filter, true), fields: ['id'], maxResults: 1 } }, signal, this.fetcher);
      const rows = z.object({ issues: z.array(z.object({ id })) }).parse(result).issues;
      if (rows.length !== 1 || rows[0].id !== target.key.issueId) throw new HyperHubStatusError('access-denied');
    }
    const getTransitions = async () => z.object({ transitions: z.array(transition) }).parse(await get(path + '/transitions?expand=transitions.fields')).transitions;
    let transitions = phase === 'final' ? await getTransitions() : undefined;
    const found = issue.parse(await get(path + '?fields=summary,status,updated,project,assignee,reporter'));
    const f = found.fields;
    if (!principal || target.id !== hyperHubHash('jira', principal, this.access.baseUrl, found.id) ||
      ![f.project.key, f.project.id].includes(target.projectId) ||
      ![f.assignee, f.reporter].some(p => p && (p.accountId || p.key || p.name) === principal)) throw new HyperHubStatusError('access-denied');
    try { transitions ??= await getTransitions(); }
    catch (error) { if (phase !== 'observe') throw error; transitions = []; } // The by-id read already verified the observation. Reverse options may be unavailable.
    if (new Set(transitions.map(t => t.id)).size !== transitions.length) throw new HyperHubStatusError('unsupported');
    const choices = hyperChooseJiraCandidates(f.status.id, transitions.map(t => ({ ...t, to: { ...t.to, category: t.to.statusCategory?.key } })), intent, previous);
    return { source: this.source, site: this.access.baseUrl, principal, accountLabel: owner.displayName || principal,
      target: { key: found.key, title: f.summary }, versionLabel: f.updated, permissionCheckedOnConfirm: false,
      current: { id: f.status.id, name: f.status.name, category: hyperMapSourceStatus('jira', f.status.statusCategory?.key).category }, ...choices };
  }
  async send(target: HyperHubWriteTarget, candidate: HyperHubStatusCandidate, resolution: string | undefined, signal: AbortSignal) {
    const response = await hyperBotsHttpRequest('Jira', this.access, { method: 'POST', expectedStatus: 204, path: this.path(target) + '/transitions',
      body: { transition: { id: candidate.candidateId }, ...(resolution && { fields: { resolution: { id: resolution } } }) } }, signal, this.fetcher);
    if (response !== null) throw new Error('Unrecognized transition receipt.');
  }
}
