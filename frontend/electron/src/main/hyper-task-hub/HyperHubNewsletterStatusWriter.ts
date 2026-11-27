import { z } from 'zod';
import { hyperChooseNewsletterCandidates, hyperMapSourceStatus } from '@shared/HyperHubStatusMapping';
import type { HyperHubStatusCandidate, HyperHubStatusIntent } from '@shared/HyperTaskHub';
import { hyperBotsHttpRequest, type HyperBotsHttpAccess } from '../HyperBotsHttpTools';
import { HyperHubStatusError, type HyperHubDiscovery, type HyperHubStatusWriter, type HyperHubWriteTarget } from './HyperHubStatusWriter';
import { hyperHubHash } from './HyperTaskHubStore';

const id = z.string().regex(/^[\w-]{1,128}$/);
const task = z.object({ id, name: z.string(), status: z.enum(['pending', 'in-progress', 'completed', 'delayed']),
  progress: z.number().min(0).max(100).nullable(), indentLevel: z.int().nonnegative(), resourceId: id.nullish() });
const project = z.object({ id, title: z.string(), updated: z.string().min(1), gantt: z.object({ tasks: z.array(task), nextOffset: z.null().optional() }) });

export class HyperHubNewsletterStatusWriter implements HyperHubStatusWriter {
  readonly source = 'newsletter';
  constructor(private readonly access: HyperBotsHttpAccess, readonly binding: string, private readonly fetcher: typeof fetch,
    private readonly selected: (project: string, resource: string) => boolean) {}
  private key(target: HyperHubWriteTarget) {
    const key = target.key;
    if (key.kind !== 'newsletter-task' || !id.safeParse(key.projectId).success || !key.taskId || !id.safeParse(key.taskId).success ||
      target.id !== hyperHubHash('newsletter', this.access.baseUrl, key.projectId, key.taskId)) throw new HyperHubStatusError('access-denied');
    return { path: '/api/projects/' + key.projectId, taskId: key.taskId, projectId: key.projectId };
  }
  async discover(target: HyperHubWriteTarget, intent: HyperHubStatusIntent, previous: string | undefined, signal: AbortSignal, phase?: 'final' | 'observe'): Promise<HyperHubDiscovery> {
    const { path, taskId, projectId } = this.key(target);
    const p = project.safeParse(await hyperBotsHttpRequest('Newsletter', this.access, { path }, signal, this.fetcher));
    if (!p.success || p.data.id !== projectId) throw new HyperHubStatusError('unsupported');
    const rows = p.data.gantt.tasks;
    if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some((r, i) => r.indentLevel > (i ? rows[i - 1].indentLevel + 1 : 0))) throw new HyperHubStatusError('unsupported');
    const index = rows.findIndex(r => r.id === taskId);
    if (index < 0) throw new HyperHubStatusError('not-found');
    const row = rows[index];
    if (!row.resourceId || !this.selected(projectId, row.resourceId)) throw new HyperHubStatusError('access-denied');
    const parent = rows[index + 1]?.indentLevel > row.indentLevel;
    if (parent && phase !== 'observe') throw new HyperHubStatusError('not-leaf');
    const choices = parent ? { candidates: [], unavailable: [] } : hyperChooseNewsletterCandidates(row.status, row.progress, intent, previous);
    return { source: this.source, principal: this.binding, accountLabel: 'Configured Newsletter connection', site: this.access.baseUrl,
      target: { key: taskId, container: p.data.title, title: row.name }, versionLabel: p.data.updated, permissionCheckedOnConfirm: true,
      current: { id: row.status, name: row.status, progress: row.progress, category: row.status === 'delayed' ? 'indeterminate' as const : hyperMapSourceStatus('newsletter', row.status).category }, ...choices };
  }
  async send(target: HyperHubWriteTarget, candidate: HyperHubStatusCandidate, _resolution: string | undefined, signal: AbortSignal) {
    const { path, taskId } = this.key(target);
    const receipt = await hyperBotsHttpRequest('Newsletter', this.access, { method: 'PATCH', expectedStatus: 200, path: path + '/tasks/' + taskId + '/status',
      body: { status: candidate.to.id } }, signal, this.fetcher);
    if (!z.object({ id: z.literal(taskId), status: z.literal(candidate.to.id) }).safeParse(receipt).success) throw new Error('Unrecognized task receipt.');
  }
}
