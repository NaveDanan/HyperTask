import { hyperMapSourceStatus } from '@shared/HyperHubStatusMapping';
import { z } from 'zod';
import type { HyperHubReadScope } from '@shared/HyperTaskHub';
import { hyperBotsNewsletterTools } from '../HyperBotsNewsletterTools';
import type { HyperNewsletterConnection } from '../HyperNewsletterConnection';
import { hyperHubHash, hyperHubInstant, type HyperHubInventory, type HyperHubRecord } from './HyperTaskHubStore';
import { HyperHubConnectionAccessLost, HyperHubAccessLost, type HyperHubBatch } from './HyperTaskHubSync';

const id = z.string().regex(/^[\w-]{1,128}$/);
const project = z.object({ id, title: z.string(), updated: z.string().nullish(), webUrl: z.string().nullish() });
function documentUrl(base: string, path: string, webUrl?: string | null) {
  if (webUrl) {
    try {
      const url = new URL(webUrl, base + '/');
      if (url.origin === new URL(base).origin && !url.username && !url.password && !url.search &&
        url.pathname.startsWith(new URL(base).pathname.replace(/\/$/, '') + '/')) return url.href;
    } catch { /* Some server versions omit a browser URL. Use the verified resource path. */ }
  }
  return base + path;
}
const resource = z.object({ id, name: z.string() });
const task = z.object({ id, name: z.string(), resourceId: id.nullish(), status: z.string().optional(), startDate: z.iso.date().nullish(),
  endDate: z.iso.date().nullish(), predecessorIds: z.array(id).optional() });
const chart = project.extend({ gantt: z.object({ tasks: z.array(task), resources: z.array(resource), nextOffset: z.null() }) });
type Project = z.infer<typeof project>;
type Chart = z.infer<typeof chart>;

/** The Bots reads page a whole server response in memory. Main consumes that same read in one pass. */
export class HyperHubNewsletterReader {
  private readonly tools;
  private readonly charts = new Map<string, { revision: string; value: Promise<Chart> }>();
  private listing?: Promise<Project[]>;
  constructor(connection: Pick<HyperNewsletterConnection, 'access'>, account: string, private readonly fingerprint: string, fetcher: typeof fetch,
    private readonly mappedResources: (projectId: string) => ReadonlySet<string>) {
    this.tools = hyperBotsNewsletterTools({ access: () => connection.access(account), fetch: fetcher });
  }
  private async read(name: 'newsletter_list_gantts' | 'newsletter_get_gantt', signal: AbortSignal, projectId?: string) {
    const tool = this.tools.find(t => t.name === name && t.access === 'read')!;
    try { return await tool.run({ projectId, offset: 0, limit: Number.MAX_SAFE_INTEGER }, signal, this.fingerprint); }
    catch (error) {
      if (error instanceof Error && /returned HTTP 401\b|connection changed after approval/.test(error.message)) {
        this.charts.clear();
        throw new HyperHubConnectionAccessLost();
      }
      if (error instanceof Error && /returned HTTP (403|404)\b/.test(error.message)) {
        this.charts.clear();
        throw new HyperHubAccessLost();
      }
      throw error;
    }
  }
  list(signal: AbortSignal) {
    this.listing ??= this.read('newsletter_list_gantts', signal)
      .then(value => {
        const projects = z.object({ items: z.array(project), nextOffset: z.null() }).parse(value).items;
        const accessible = new Set(projects.map(p => p.id));
        for (const id of this.charts.keys()) if (!accessible.has(id)) this.charts.delete(id);
        return projects;
      })
      .finally(() => { this.listing = undefined; });
    return this.listing;
  }
  load(p: Project, signal: AbortSignal) {
    const prior = this.charts.get(p.id);
    if (p.updated && prior?.revision === p.updated) return prior.value;
    const value = this.read('newsletter_get_gantt', signal, p.id).then(data => {
      const result = chart.parse(data);
      if (result.id !== p.id || p.updated && result.updated !== p.updated) throw new Error('Newsletter project changed during the read.');
      const resources = this.mappedResources(p.id);
      const selected = result.gantt.tasks.filter(t => t.resourceId && resources.has(t.resourceId));
      const predecessors = new Set(selected.flatMap(t => t.predecessorIds ?? []));
      // Setup reads the same endpoint for its resource picker. Retain no unselected task text.
      result.gantt.tasks = result.gantt.tasks.flatMap(t => {
        if (t.resourceId && resources.has(t.resourceId)) return [t];
        return predecessors.has(t.id) ? [{ id: t.id, name: '', status: t.status }] : [];
      });
      return result;
    }).catch(error => { if (this.charts.get(p.id)?.value === value) this.charts.delete(p.id); throw error; });
    this.charts.set(p.id, { revision: p.updated ?? '', value });
    return value;
  }
  async article(articleId: string, signal: AbortSignal) {
    const tool = this.tools.find(t => t.name === 'newsletter_get_article' && t.access === 'read')!;
    try {
      const result = z.object({ id, title: z.string(), excerpt: z.string().nullish(), updated: z.string().nullish(), webUrl: z.string().nullish() })
        .parse(await tool.run({ articleId, contentOffset: 0 }, signal, this.fingerprint));
      if (result.id !== articleId) throw new HyperHubAccessLost();
      return result;
    } catch (error) {
      if (error instanceof Error && /returned HTTP 401\b|connection changed after approval/.test(error.message)) {
        this.charts.clear();
        throw new HyperHubConnectionAccessLost();
      }
      if (error instanceof Error && /returned HTTP (403|404)\b/.test(error.message)) throw new HyperHubAccessLost();
      throw error;
    }
  }
  async options(signal: AbortSignal) {
    const projects = [];
    for (const p of await this.list(signal)) {
      const details = await this.load(p, signal);
      projects.push({ id: p.id, name: p.title, resources: details.gantt.resources });
    }
    return projects;
  }
}

export class HyperHubNewsletterSource {
  readonly kind = 'newsletter-task';
  readonly connectionId = 'newsletter';
  readonly label = 'Newsletter Gantt';
  readonly queryId: string;
  constructor(private readonly reader: Pick<HyperHubNewsletterReader, 'list' | 'load'> | undefined,
    private readonly projectId: string, private readonly resources: Set<string>, private readonly zone: string,
    private readonly baseUrl: string, private readonly now = Date.now) {
    this.queryId = hyperHubHash(this.baseUrl, projectId, [...resources].sort(), zone);
  }
  async read(scope: HyperHubReadScope, signal: AbortSignal, previous?: HyperHubInventory): Promise<HyperHubBatch> {
    const summary = (await this.reader?.list(signal))?.find(p => p.id === this.projectId);
    if (!summary || !this.reader) throw new HyperHubAccessLost();
    const observedAt = hyperHubInstant(this.now());
    if (previous?.evidence && summary.updated && previous.cursor === summary.updated) {
      return { cursor: summary.updated, completeness: 'complete',
        evidence: previous.evidence.map(record => ({ ...record, scope, observedAt })), records: previous.records.map(record => ({ ...record, scope, observedAt,
          category: record.rawStatus === 'delayed' ? 'indeterminate' : hyperMapSourceStatus('newsletter', record.rawStatus).category,
          documentUrl: this.baseUrl + '/gantt-editor/' + encodeURIComponent(record.projectId) })) };
    }
    const p = await this.reader.load(summary, signal);
    const tasks = new Map(p.gantt.tasks.map(t => [t.id, t]));
    if (tasks.size !== p.gantt.tasks.length) throw new Error('Duplicate Newsletter task identity.');
    const evidence = (taskId: string) => hyperHubHash(this.connectionId, this.baseUrl, p.id, taskId);
    const civil = (date?: string | null) => date ? { kind: 'civil-date' as const, date, zone: this.zone } : undefined;
    const revision = p.updated || hyperHubHash(p.gantt);
    const records: HyperHubRecord[] = [];
    for (const t of tasks.values()) {
      if (!t.resourceId || !this.resources.has(t.resourceId)) continue;
      const key = { kind: this.kind, connectionId: this.connectionId, projectId: p.id, taskId: t.id } as const;
      records.push({ key, id: evidence(t.id), scope, openTarget: key, role: 'assignment', observedAt, revision,
        projectId: p.id, label: p.title, title: t.name, documentUrl: this.baseUrl + '/gantt-editor/' + encodeURIComponent(p.id), initialState: t.status === 'completed' ? 'done' : t.status === 'in-progress' ? 'doing' : 'ready',
        category: t.status === 'delayed' ? 'indeterminate' : hyperMapSourceStatus('newsletter', t.status).category, completion: t.status === 'completed' ? 'complete' : t.status ? 'open' : 'unknown', rawStatus: t.status, due: civil(t.endDate), planned: civil(t.startDate),
        predecessorEvidenceIds: [...new Set(t.predecessorIds)].filter(id => {
          const pred = tasks.get(id);
          // The typed source field establishes the edge. A missing endpoint must still block a forecast.
          return pred?.status !== 'completed' || !!pred.resourceId && this.resources.has(pred.resourceId);
        }).map(evidence) });
    }
    const key = { kind: this.kind, connectionId: this.connectionId, projectId: p.id } as const;
    const document: HyperHubRecord = { key, id: hyperHubHash(this.baseUrl, key), openTarget: key, scope, observedAt, revision,
      projectId: p.id, label: p.title, initialState: 'ready', role: 'mentions', completion: 'unknown',
      documentUrl: documentUrl(this.baseUrl, '/api/projects/' + encodeURIComponent(p.id), p.webUrl),
      document: { kind: 'newsletter-project', connectionId: this.connectionId } };
    return { records, evidence: [document], completeness: 'complete', cursor: revision };
  }
  async check(record: HyperHubRecord, signal: AbortSignal) {
    const current = await this.read(record.scope, signal);
    const item = [...current.records, ...current.evidence ?? []].find(item => item.id === record.id);
    if (!item) throw new HyperHubAccessLost();
    if (item.revision !== record.revision) throw new Error('Project changed.');
    return item.documentUrl ?? this.baseUrl;
  }
}

export class HyperHubArticleSource {
  readonly kind = 'newsletter-article';
  readonly connectionId = 'newsletter';
  readonly label = 'Newsletter article';
  readonly queryId: string;
  constructor(private readonly reader: HyperHubNewsletterReader | undefined, private readonly baseUrl: string,
    private readonly articleId: string, private readonly meetingId?: string) {
    this.queryId = hyperHubHash('article', baseUrl, articleId, meetingId);
  }
  async read(scope: HyperHubReadScope, signal: AbortSignal): Promise<HyperHubBatch> {
    if (!this.reader) throw new HyperHubAccessLost();
    const article = await this.reader.article(this.articleId, signal);
    const key = { kind: this.kind, connectionId: this.connectionId, articleId: article.id } as const;
    const excerpt = article.excerpt?.slice(0, 1024);
    return { records: [], completeness: 'complete', cursor: null, evidence: [{ id: hyperHubHash(this.baseUrl, key), key, scope, openTarget: key,
      label: article.title.slice(0, 500), briefExcerpt: excerpt, revision: hyperHubHash(article.updated, article.title, excerpt),
      createdAt: article.updated && Number.isFinite(Date.parse(article.updated)) ? hyperHubInstant(Date.parse(article.updated)) : undefined,
      observedAt: hyperHubInstant(Date.now()), completion: 'unknown', initialState: 'ready', projectId: '', role: 'mentions',
      documentUrl: documentUrl(this.baseUrl, '/api/newsletters/' + encodeURIComponent(this.articleId), article.webUrl),
      document: { kind: this.kind, connectionId: this.connectionId, ownerSelected: !this.meetingId }, linkedMeetingId: this.meetingId }] };
  }
  async check(record: HyperHubRecord, signal: AbortSignal) {
    const item = (await this.read(record.scope, signal)).evidence?.[0];
    if (item?.id !== record.id) throw new HyperHubAccessLost();
    if (item.revision !== record.revision) throw new Error('Article changed.');
    return item.documentUrl;
  }
}
