import { JiraConfig, JiraCredentials } from './data/models/jira-config';
import { JiraLocalStore, type JiraKeyValueStorage } from './data/jira-local-store';
import { JiraRepository } from './data/jira-repository';
import { SessionJiraCredentialStore } from './data/jira-credential-store';
import type { JiraHttpRequest, JiraHttpResponse, JiraHttpTransport } from './data/jira-api-client';
export const testToken = 'pat-SECRET-0123456789';
export const testConfig = new JiraConfig({ baseUrl: 'https://jira.example.com', projectKey: 'DEMO' });
export class HyperFakeKeyValue implements JiraKeyValueStorage {
  values: Record<string, string> = {};
  get(k: string): string | null { return this.values[k] ?? null; }
  async set(k: string, v: string): Promise<void> { this.values[k] = v; }
  async remove(k: string): Promise<void> { delete this.values[k]; }
}
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }): JiraHttpResponse {
  return { status, body: body == null ? '' : JSON.stringify(body), headers };
}
export interface HyperIssueJsonOptions { summary?: string; status?: string; category?: string; assignee?: string; updated?: string; description?: string; type?: string }
export function issueJson(key: string, o: HyperIssueJsonOptions = {}) {
  return { id: key.split('-').at(-1), key, fields: { summary: o.summary ?? 'Summary of ' + key, description: o.description ?? '',
    status: { name: o.status ?? 'To Do', statusCategory: { key: o.category ?? 'new' } }, issuetype: { id: '10002', name: o.type ?? 'Task' },
    priority: { name: 'Medium' }, assignee: o.assignee === undefined ? null : { name: o.assignee, key: o.assignee, displayName: 'User ' + o.assignee },
    created: '2024-04-01T10:00:00.000+0300', updated: o.updated ?? '2024-05-01T10:00:00.000+0300' } };
}
export function transitionJson(id: string, name: string, toStatus: string, category: string, fields: Record<string, unknown> = {}, hasScreen = false) {
  return { id, name, hasScreen, to: { name: toStatus, statusCategory: { key: category } }, fields };
}
export function resolutionField(required = true) { return { resolution: { required, name: 'Resolution', allowedValues: [{ id: '1', name: 'Fixed' }, { id: '2', name: "Won't Fix" }, { id: '10000', name: 'Done' }] } }; }
export class HyperFakeJira {
  requests: JiraHttpRequest[] = [];
  routes = new Map<string, JiraHttpTransport>();
  on(method: string, path: string, handler: JiraHttpTransport): void { this.routes.set(method + ' ' + path, handler); }
  transport: JiraHttpTransport = async r => {
    this.requests.push(r); return this.routes.get(r.method + ' ' + new URL(r.url).pathname)?.(r) ?? jsonResponse({ errorMessages: ['No route'] }, 404);
  };
  where(method: string, path: string): JiraHttpRequest[] { return this.requests.filter(r => r.method === method && new URL(r.url).pathname === path); }
  serveSearch(issues: ReturnType<typeof issueJson>[]): void {
    this.on('POST', '/rest/api/2/search', async r => { const startAt = JSON.parse(r.body!).startAt as number;
      return jsonResponse({ startAt, maxResults: 2, total: issues.length, issues: issues.slice(startAt, startAt + 2) }); });
  }
}
export async function configuredRepository(jira: HyperFakeJira, storage = new HyperFakeKeyValue(), clock?: () => Date) {
  const credentialStore = new SessionJiraCredentialStore();
  const repo = new JiraRepository({ store: new JiraLocalStore('1', storage), credentialStore, transport: jira.transport, clock });
  await repo.saveConfig(testConfig, new JiraCredentials({ secret: testToken }));
  return repo;
}
