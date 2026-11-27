import { hyperBuildMeetingBrief, hyperBriefSummaryRequest, type HyperMeetingBrief, type HyperMeetingBriefEvidence } from '@shared/HyperMeetingBrief';
import type { HyperHubSummaryTransport } from './HyperHubSummaryTransport';
import { hyperHubCalendarInterval } from './HyperHubOutlookSource';
import type { HyperHubMirror } from './HyperHubMirror';
import { hyperHubOriginKey } from './HyperTaskHubStore';
import { HyperTaskHubWriteback, type HyperHubDocument } from './HyperTaskHubWriteback';
import { HyperHubStatusError, type HyperHubStatusWriter } from './HyperHubStatusWriter';
import { hyperNormalizeWeights, hyperPreviewWeights } from '@shared/HyperHubWeights';
import type { HyperHubRankInput } from '@shared/HyperPriorityEngine';
import type { HyperHubStatusIntent, HyperHubWriteSource } from '@shared/HyperTaskHub';
import { randomUUID } from 'node:crypto';
import { TZDate } from '@date-fns/tz';
import type { HyperHubConnectionStatus, HyperHubFeedbackEvent, HyperHubSetupOptions, HyperHubFeedbackResult, HyperHubOpenResult, HyperHubOpenTarget,
  HyperHubRejectCode, HyperHubSetupScope, HyperHubSnapshot, HyperHubTaskView } from '@shared/HyperTaskHub';
import { hyperHubAvailabilityFromSnapshotParts, hyperHubProjectAvailabilityDay, hyperPlanDay, hyperCompareFocusOrder } from '@shared/HyperDayPlanner';
import { hyperHubCohortIsPreview, type HyperHubCohortPrecision, type HyperHubLanguageCohort } from '@shared/HyperTaskHub';
import { hyperHubFixturePrecision } from '@shared/HyperHubExtraction';
import { type HyperHubIssueAlias, hyperHubLinkSuggestions, hyperHubMentions, hyperHubMergedIds, hyperHubPair } from '@shared/HyperHubLinks';
import { hyperBuildTaskGraph } from '@shared/HyperDayPlanner';
import { hyperHubRelations, type HyperHubRelationChange } from './HyperTaskHubStore';
import { hyperRankTasks } from '@shared/HyperPriorityEngine';
import { hyperHubBusyInterval, hyperHubHash, hyperHubInstant, type HyperHubDecision, type HyperHubInventory, type HyperHubRecord, type HyperTaskHubStore } from './HyperTaskHubStore';
import { HyperHubAccessLost, HyperHubConnectionAccessLost, HyperHubStoreAccessLost, hyperHubQueryKey, HyperTaskHubSync, type HyperHubQuery } from './HyperTaskHubSync';

const defaultWeights = { slack: 45, importance: 25, unblocking: 20, age: 10 };
type Version = { scopeGeneration: number; expectedRevision: number };
type Rank = typeof hyperRankTasks;
type DecisionPreview = { id: string; decision: HyperHubDecision };
type RankInput = Omit<HyperHubRankInput, 'weights'>;
const dayKey = (date: string, zone: string) => JSON.stringify([zone, date]);
const sameQueue = (a: HyperHubTaskView, b: HyperHubTaskView) => a.state === b.state ||
  (['ready', 'doing'].includes(a.state) && ['ready', 'doing'].includes(b.state));
export interface HyperHubSource extends HyperHubQuery {
  open?(record: HyperHubRecord, signal: AbortSignal, assertCurrent: () => void): Promise<void>;
  check(record: HyperHubRecord, signal: AbortSignal, verifyRevision?: boolean): Promise<string | void>;
}
export class HyperHubRejection extends Error {
  constructor(readonly code: HyperHubRejectCode) { super(code); }
}

function sourceSchedule(r: HyperHubRecord): HyperHubTaskView['schedule'] {
  const provenance = { kind: 'source' as const, evidenceId: r.id };
  if (r.schedule) return { ...r.schedule, provenance };
  if (r.key.kind !== 'newsletter-task' || !r.key.taskId || r.planned?.kind !== 'civil-date' ||
    r.due?.kind !== 'civil-date' || r.planned.zone !== r.due.zone || r.planned.date > r.due.date) return;
  // A Newsletter task stores both inclusive civil endpoints together, including in older cached records.
  const zone = r.planned.zone;
  const midnight = (date: string, offset: number) => {
    const [year, month, day] = date.split('-').map(Number);
    return hyperHubInstant(+new TZDate(year, month - 1, day + offset, zone));
  };
  return { start: midnight(r.planned.date, 0), end: midnight(r.due.date, 1), provenance };
}

type BriefRecords = Map<string, { r: HyperHubRecord; stale: boolean }>;

function meetingEvidence(records: BriefRecords, tasks: HyperHubTaskView[], issues: HyperHubIssueAlias[]) {
  const tasksBySource = new Map(tasks.flatMap(task => task.sources.filter(s => s.role !== 'mentions').map(s => [s.evidenceId, task] as const)));
  const evidence: HyperMeetingBriefEvidence[] = [];
  const originByCitation = new Map<string, string>();
  for (const { r, stale } of records.values()) {
    if (!r.openTarget || r.occurrence) continue;
    const key = r.key, task = tasksBySource.get(r.id);
    const subject = key.kind === 'outlook-mail' ? r.label : r.title ?? r.label;
    const base = { id: r.id, revision: hyperHubHash(r.revision, task?.state, task?.blocks, r.verifiedIdentityIds, r.document, r.linkedMeetingId), subject,
      sourceTime: key.kind === 'outlook-mail' && r.createdAt ? r.createdAt :
        /^\d{4}-/.test(r.revision) && Number.isFinite(Date.parse(r.revision)) ? hyperHubInstant(Date.parse(r.revision)) : r.createdAt ?? r.observedAt,
      stale, accessible: true, excerpt: (r.briefExcerpt ?? r.reviewSpan?.excerpt ?? subject).slice(0, 1024),
      verifiedIdentityIds: r.verifiedIdentityIds, projectIds: r.projectId ? [hyperHubHash(r.scope.connectionId, r.projectId)] : [],
      trustedDocumentIds: [r.id] };
    const jiraKeys = key.kind === 'jira' ? [{ instanceId: key.instanceId, key: r.label }] :
      hyperHubMentions(subject + ' ' + base.excerpt, issues).flatMap(id => {
        const issue = records.get(id)?.r;
        return issue?.key.kind === 'jira' ? [{ instanceId: issue.key.instanceId, key: issue.label }] : [];
      });
    if (key.kind === 'outlook-mail' && r.briefExcerpt !== undefined) {
      evidence.push({ ...base, jiraKeys, kind: 'mail', connectionId: r.scope.connectionId, storeId: key.storeId, messageId: key.entryId,
        verifiedThreadId: r.verifiedThreadId, attachmentNames: r.attachmentNames });
    } else if (task) {
      evidence.push({ ...base, kind: key.kind === 'jira' ? 'issue' : task.blocks.length ? 'blocker' : 'action',
        open: !['done', 'dismissed'].includes(task.state) && task.authoritativeCompletion !== 'complete',
        ownerAssigned: task.state !== 'review' && task.state !== 'waiting', due: task.due, jiraKeys });
    }
    if (task && key.kind === 'jira' && r.ownerAssigned) {
      const id = 'work.' + r.id;
      evidence.push({ ...base, id, kind: r.decisionDue ? 'decision' : 'action', ownerAssigned: true, due: task.due,
        open: !['done', 'dismissed'].includes(task.state) && task.authoritativeCompletion !== 'complete', jiraKeys });
      originByCitation.set(id, r.id);
    }
    const document = r.document ?? (key.kind === 'jira' ? { kind: 'jira' as const, jiraKey: jiraKeys[0] } :
      key.kind === 'hypertask' ? { kind: 'hypertask-row' as const } : undefined);
    if (document) {
      const id = task ? 'doc.' + r.id : r.id;
      originByCitation.set(id, r.id);
      evidence.push({ ...base, id, kind: 'document', documentId: r.id, document, jiraKeys });
    }
  }
  return { tasksBySource, evidence, originByCitation };
}

export class HyperTaskHubService {
  readonly writeback: HyperTaskHubWriteback;
  private frozen?: { revision: number; input: Omit<HyperHubRankInput, 'weights'> };
  private readonly cacheKeys = new Map<string, { signature: string; version: string }>();
  private readonly briefs = new Map<string, Extract<HyperMeetingBrief, { eligible: true }>>();
  private readonly secret = randomUUID();
  private readonly controller = new AbortController();
  private readonly sync: HyperTaskHubSync;
  private readonly attempted = new Map<string, number>();
  private readonly now: () => number;
  constructor(private readonly store: HyperTaskHubStore, private readonly deps: {
    accountId: string; workspaceId: string; generation: number; now?: () => number;
    validate(): Promise<boolean>; queries(scope: HyperHubSetupScope): HyperHubSource[];
    mirror?: HyperHubMirror;
    checkMirrorRow?(row: NonNullable<import('./HyperTaskHubStore').HyperHubDiskState['ledger']['mirrorRows']>[string], originKey: string, signal: AbortSignal): Promise<void>;
    writers?: Partial<Record<HyperHubWriteSource, HyperHubStatusWriter>>;
    summary?: HyperHubSummaryTransport;
    outlookOffline?(): boolean;
    summaryConfigured?(): Promise<boolean>;
    setupOptions?(signal: AbortSignal): Promise<HyperHubSetupOptions>;
    changed(snapshot: HyperHubSnapshot): void; rank?: Rank; openExternal(url: string): Promise<void>;
  }) {
    this.now = deps.now ?? Date.now;
    this.writeback = new HyperTaskHubWriteback(store, { now: this.now, validate: deps.validate, signal: this.controller.signal,
      member: t => this.inventories().some(i => i.batch?.records.some(r => r.id === t.id && (r.role === 'origin' || r.role === 'assignment'))),
      publish: () => this.publish(), writer: source => deps.writers?.[source], version: () => this.version });
    this.sync = new HyperTaskHubSync(store, () => deps.validate(), () => deps.generation, () => this.publish(), this.now);
    const cutoff = this.now() - 30 * 86400000;
    const selected = new Set(this.queries().map(hyperHubQueryKey));
    const retained = (r: HyperHubRecord) => Date.parse(r.observedAt.iso) >= cutoff && (r.expiresAt ?? Infinity) > this.now();
    const expired = (i: HyperHubInventory) => i.status.lastSuccess && Date.parse(i.status.lastSuccess.iso) < cutoff;
    if (Object.entries(store.current.cache).some(([id, i]) => !selected.has(id) || expired(i) || [...i.records, ...i.evidence ?? []].some(r => !retained(r)))) {
      store.commit(() => true, d => {
        for (const [id, i] of Object.entries(d.cache)) {
          if (!selected.has(id) || expired(i)) delete d.cache[id];
          else {
            const records = i.records.filter(retained);
            i.evidence = i.evidence?.filter(retained);
            if (records.length !== i.records.length) i.cursor = null;
            i.records = records;
          }
        }
      });
    }
  }

  close() { this.controller.abort(); this.briefs.clear(); this.cacheKeys.clear(); }
  get outlookStore() { return this.store.current.outlookStore; }
  get version() { return { revision: this.store.current.revision, scopeGeneration: this.deps.generation }; }
  get setup() {
    const scope = this.store.current.setup;
    return { ...this.version, scope: scope && { ...scope, writeBack: scope.writeBack ?? { jira: false, newsletter: false },
      ai: scope.ai ?? null, mail: scope.mail ?? null } };
  }
  getSetupOptions() {
    if (!this.deps.setupOptions) throw new HyperHubRejection('unavailable');
    return this.deps.setupOptions(this.controller.signal);
  }
  private queries() { return this.setup.scope ? this.deps.queries(this.setup.scope) : []; }
  private inventories() {
    return this.queries().map(query => ({ query, batch: this.store.current.cache[hyperHubQueryKey(query)] }));
  }
  private publish() { if (!this.controller.signal.aborted) this.deps.changed(this.snapshot()); }
  private assert(v: Version) {
    if (this.controller.signal.aborted || v.scopeGeneration !== this.deps.generation) throw new HyperHubRejection('scope-changed');
    if (v.expectedRevision !== this.version.revision) throw new HyperHubRejection('revision-conflict');
  }
  private async recheck(v: Version) {
    if (!await this.deps.validate()) throw new HyperHubRejection('scope-changed');
    this.assert(v);
  }

  snapshot(preview?: DecisionPreview, requestedMeeting?: string, planAt?: number): HyperHubSnapshot {
    return this.project(false, preview, requestedMeeting, planAt);
  }
  private project(inputOnly: true): RankInput;
  private project(inputOnly: false, preview?: DecisionPreview, requestedMeeting?: string, planAt?: number): HyperHubSnapshot;
  private project(inputOnly: boolean, preview?: DecisionPreview, requestedMeeting?: string, planAt?: number): RankInput | HyperHubSnapshot {
    const time = this.now();
    const inventories = this.inventories();
    const statuses = inventories.map(({ query, batch }) => {
      const status = batch?.status;
      const syncing = this.sync.isReading(query);
      if (!status) return { kind: query.kind, connectionId: query.connectionId, label: query.label, status: syncing ? 'syncing' as const : 'stale' as const, lastSuccess: null,
        coverage: [{ queryId: query.queryId, connectionId: query.connectionId, completeness: 'partial' as const, lastSuccess: null }] };
      if (syncing) return { ...status, status: 'syncing' as const };
      const stale = !this.sync.hasRead(query) || time - Date.parse(status.lastSuccess?.iso ?? '') > (query.kind === 'newsletter-task' ? 30 : 10) * 60000;
      return stale && status.status === 'fresh' ? { ...status, status: 'stale' as const } : status;
    });
    const connections = new Map<string, HyperHubConnectionStatus>();
    const staleRecords = new Set<HyperHubRecord>();
    inventories.forEach(({ query, batch }, index) => {
      const status = statuses[index], prior = connections.get(query.connectionId);
      if (status.status !== 'fresh') for (const r of batch?.records ?? []) staleRecords.add(r);
      if (!prior) connections.set(query.connectionId, { ...status, coverage: [...status.coverage] });
      else {
        prior.coverage.push(...status.coverage);
        prior.label = query.kind === 'jira' ? 'Jira' : query.kind === 'newsletter-task' ? 'Newsletter Gantt' : 'HyperTask';
        if (prior.status !== status.status) prior.status = 'partial';
        if (!status.lastSuccess || (prior.lastSuccess && status.lastSuccess.iso < prior.lastSuccess.iso)) prior.lastSuccess = status.lastSuccess;
      }
    });
    const { ledger } = this.store.current;
    const relations = ledger.relations ?? hyperHubRelations();
    const mergedId = hyperHubMergedIds(relations.merges);
    const writes = this.writeback.entries.filter(e => this.writeback.visible(e)).map(e => ({ ...e.view,
      taskId: mergedId(ledger.actionIds[e.target.id] ?? e.view.taskId), undoAvailable: e.view.undoAvailable && !!this.setup.scope?.writeBack?.[e.view.source] }));
    const groups = new Map<string, Map<string, HyperHubRecord>>();
    for (const { batch } of inventories) {
      for (const r of batch?.records ?? []) {
        if (Date.parse(r.observedAt.iso) < time - 30 * 86400000 || (r.expiresAt ?? Infinity) <= time) continue;
        const id = r.role === 'mirror' ? ledger.mirrorActionIds[r.id] : ledger.actionIds[r.id];
        if (!id) continue;
        const group = groups.get(mergedId(id)) ?? new Map();
        group.set(r.id, r);
        groups.set(mergedId(id), group);
      }
    }
    const allRecords = new Map([...groups.values()].flatMap(group => [...group]));
    const issues = [...allRecords.values()].flatMap(r => r.key.kind === 'jira' && r.jiraAlias ?
      [{ evidenceId: r.id, key: r.label, instance: r.key.instanceId, url: r.jiraAlias }] : []);
    const tasks: HyperHubTaskView[] = [];
    for (const [id, group] of groups) {
      const originals = [...group.values()].filter(r => r.role !== 'mirror');
      const primary = originals.find(r => ledger.actionIds[r.id] === id) ?? originals[0];
      if (!primary) continue;
      const records = [primary, ...[...group.values()].filter(r => r !== primary && (r.role !== 'mirror' || originals.some(o => r.originKey ? r.originKey === hyperHubOriginKey(o) : !!o.jiraAlias && o.jiraAlias === r.jiraAlias)))];
      const mentions = new Set(originals.flatMap(r => r.reviewSpan ? hyperHubMentions(r.reviewSpan.excerpt, issues) : []));
      for (const [key, linked] of Object.entries(relations.references)) {
        const [owner, evidence] = JSON.parse(key);
        if (mergedId(owner) !== id) continue;
        if (linked) mentions.add(evidence); else mentions.delete(evidence);
      }
      for (const evidence of mentions) {
        const r = allRecords.get(evidence);
        if (r && !group.has(evidence)) records.push({ ...r, role: 'mentions' });
      }
      const decision = ledger.decisions[id];
      const origin = { kind: 'source' as const, evidenceId: primary.id };
      const schedule = originals.map(sourceSchedule).find(s => s !== undefined);
      const mirrorRef = records.find(r => r.role === 'mirror');
      const key = hyperHubOriginKey(primary);
      const mirrored = ledger.mirrorRows?.[key];
      const state = decision.state ?? primary.initialState;
      const eligible = !!this.deps.mirror && this.mirrorLink(primary, decision.titleOverride) !== undefined && !['review', 'dismissed'].includes(state);
      const mirror = mirrored || mirrorRef ? { exists: true as const, handle: this.handle(mirrorRef?.id ?? key) } : { exists: false as const, eligible };
      tasks.push({ id, mirror, schedule, title: decision.titleOverride ?? primary.title ?? primary.label, ...decision, state: decision.state ?? primary.initialState, pinned: !!decision.pinned,
        sources: records.map(r => ({ evidenceId: r.id, role: r.role, kind: r.key.kind, connectionId: r.scope.connectionId, label: r.label,
          ...((r.role === 'origin' || r.role === 'assignment') && (r.key.kind === 'jira' || r.key.kind === 'newsletter-task' && r.key.taskId) &&
            { statusWrite: this.writeHint(r.key.kind === 'jira' ? 'jira' : 'newsletter', r.id) }),
          attachmentNames: r.attachmentNames,
          openable: !!r.openTarget, stale: staleRecords.has(r),
          handle: this.handle(r.id) })),
        sourceStatus: Object.fromEntries(records.map(r => [r.id, { rawStatus: r.rawStatus, completion: r.completion, category: r.category }])),
        reviewSpan: primary.reviewSpan, mergeEntryIds: Object.keys(relations.merges).filter(key => mergedId(relations.merges[key].into) === id),
        authoritativeCompletion: primary.completion, projectId: primary.projectId, createdAt: primary.createdAt,
        due: primary.due, planned: primary.planned, sourceDue: Object.fromEntries(records.filter(r => r.due && r.role !== 'mentions').map(r => [r.id, r.due!])),
        fieldOrigins: { ...(primary.due && { due: origin }), ...(primary.planned && { planned: origin }), ...(primary.effortMinutes && { effortMinutes: origin }) },
        sourcePriority: primary.priorityId ? { priorityId: primary.priorityId, evidenceId: primary.id } : undefined,
        effortMinutes: primary.effortMinutes ?? 45, effortIsEstimate: primary.effortMinutes === undefined,
        people: [...new Map(originals.flatMap(r => r.people ?? []).map(p => [p.id + p.role, p])).values()], meetingIds: [], blocks: [], blockedBy: [] });
    }
    for (const [id, decision] of Object.entries(preview ? { ...ledger.decisions, [preview.id]: preview.decision } : ledger.decisions)) {
      if (!decision.titleOverride || mergedId(id) !== id || tasks.some(t => t.id === id)) continue;
      tasks.push({ ...decision, id, title: decision.titleOverride, state: decision.state ?? 'ready', pinned: !!decision.pinned,
        authoritativeCompletion: decision.prepMeetingId ? (decision.state === 'done' ? 'complete' : 'open') : 'unknown',
        sources: [], sourceStatus: {}, people: [], meetingIds: [], blocks: [], blockedBy: [],
        effortMinutes: decision.prepBlock ? 15 : 45, effortIsEstimate: !decision.prepBlock });
    }
    const byId = new Map(tasks.map(task => [task.id, task]));
    for (const task of tasks) {
      for (const r of groups.get(task.id)?.values() ?? []) for (const pred of r.predecessorEvidenceIds ?? []) {
        const sourceId = r.id;
        const predecessorId = mergedId(ledger.actionIds[pred] ?? ledger.mirrorActionIds[pred] ?? pred);
        const edge = { predecessorId, successorId: task.id, verified: true, resolvedByOwner: false,
          provenance: { kind: 'source' as const, evidenceId: sourceId } };
        task.blockedBy.push(edge);
        byId.get(predecessorId)?.blocks.push(edge);
      }
    }
    const scope = this.setup.scope;
    const zone = scope?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ownerWindows = Object.entries(ledger.availability ?? {})
      .flatMap(([key, windows]) => JSON.parse(key)[0] === zone ? windows : []);
    const sources = inventories.filter(({ query }) => query.availabilitySource).map(({ query, batch }) => {
      const expired = !batch?.status.lastSuccess || time - Date.parse(batch.status.lastSuccess.iso) >= 30 * 86400000;
      // On restart an online profile can already differ from the persisted selection.
      // Wait for the first bound read before broadcasting cached Outlook details or claiming fresh coverage.
      const unverified = query.kind === 'outlook-calendar' && !this.sync.hasRead(query) && !this.deps.outlookOffline?.();
      const agenda = expired ? [] : batch.agenda ?? [];
      return { agenda: unverified ? agenda.flatMap(item => item.availability === 'free' || item.availability === 'working-elsewhere' ? [] :
        [hyperHubBusyInterval(item.interval, item.sourceKind)]) : agenda,
        complete: !expired && batch.lastComplete &&
        time - Date.parse(batch.lastComplete.asOf.iso) < 30 * 86400000 ? [{ ...batch.lastComplete,
          newerRefreshPartial: batch.status.status !== 'fresh' || !this.sync.hasRead(query) }] : [] };
    });
    const availability = scope && hyperHubAvailabilityFromSnapshotParts({ zone, workdays: scope.workdays, hours: scope.hours,
      breaks: scope.breaks, daysOff: scope.daysOff, ownerWindows, sources });
    const agenda = [...new Map(sources.flatMap(s => s.agenda).map(item => [item.id, { ...item }])).values()];
    const records = new Map(inventories.flatMap(({ batch }, i) => [...batch?.records ?? [], ...batch?.evidence ?? []]
      .filter(r => r.scope.accountId === this.deps.accountId && r.scope.workspaceId === this.deps.workspaceId &&
        r.scope.connectionId === inventories[i].query.connectionId && Date.parse(r.observedAt.iso) >= time - 30 * 86400000 && (r.expiresAt ?? Infinity) > time)
      .map(r => [r.id, { r, stale: statuses[i].status !== 'fresh' }] as const)));
    const meetings = new Map(agenda.flatMap(item => {
      const record = records.get(item.id)?.r, event = record?.occurrence, key = record?.key;
      return !item.private && item.isMeeting && event && key?.kind === 'outlook-calendar' && key.storeId === this.outlookStore &&
        event.key.connectionId === record.scope.connectionId && event.key.storeId === key.storeId && event.key.occurrenceId === key.occurrenceId &&
        key.originalStart.kind === 'instant' && event.key.originalStart.kind === 'instant' &&
        Date.parse(key.originalStart.iso) === Date.parse(event.key.originalStart.iso) &&
        item.id === hyperHubHash(key.storeId, key.occurrenceId, Date.parse(key.originalStart.iso)) && event.id === item.id &&
        event.interval.start.iso === item.interval.start.iso && event.interval.end.iso === item.interval.end.iso ? [[item.id, event] as const] : [];
    }));
    for (const task of tasks) {
      const decision = preview?.id === task.id ? preview.decision : ledger.decisions[task.id];
      const meeting = decision?.prepMeetingId && meetings.get(decision.prepMeetingId);
      if (meeting) { task.meetingIds.push(meeting.id); task.prepDeadline = meeting.interval.start; }
    }
    const input = { tasks, writes, nowMs: planAt ?? time, availability: availability ?? undefined };
    if (inputOnly) return input;
    const weights = ledger.weights ?? defaultWeights;
    const ranking = (this.deps.rank ?? hyperRankTasks)({ ...input, weights });
    const plan = hyperPlanDay({ ...input, ranking });
    if (!preview) {
      const liveVersions = new Set<string>();
      const jiraInstance = [...records.values()].map(({ r }) => r.key).find(k => k.kind === 'jira')?.instanceId;
      const { tasksBySource, evidence, originByCitation } = meetingEvidence(records, tasks, issues);
      const newsletterConnections = [...new Set([...scope?.newsletterProjects ?? [], ...scope?.newsletterArticles ?? []].map(s => s.connectionId))];
      const evidenceSignature = hyperHubHash(evidence.map(e => [e.id, e.revision, e.stale, e.sourceTime, e.kind, 'open' in e && e.open]));
      for (const item of agenda) {
        const event = meetings.get(item.id);
        if (!event || item.private) continue;
        const prep = tasks.filter(task => task.meetingIds.includes(item.id));
        const state = ledger.meetings?.[item.id];
        const series = [...records.values()].map(({ r }) => r.occurrence).filter(prior => prior && event.verifiedSeriesId &&
          prior.verifiedSeriesId === event.verifiedSeriesId && prior.key.storeId === event.key.storeId &&
          Date.parse(prior.interval.end.iso) <= Math.min(time, Date.parse(event.interval.start.iso))).filter(prior => !!prior)
          .sort((a, b) => Date.parse(b.interval.start.iso) - Date.parse(a.interval.start.iso)).slice(0, 2);
        const manual = evidence.filter(e => {
          const id = originByCitation.get(e.id) ?? e.id;
          const record = records.get(id)?.r;
          const key = record?.key;
          return scope?.meetingLinks?.some(link => link.meetingId === item.id && link.evidenceId === id) ||
            record?.linkedMeetingId === item.id ||
            (key?.kind === 'newsletter-article' && scope?.newsletterArticles?.some(a => a.articleId === key.articleId && a.meetingId === item.id)) ||
            (key?.kind === 'hypertask' && 'pageId' in key && scope?.nativePages?.some(p => p.viewId === key.pageId && p.meetingId === item.id)) ||
            prep.some(t => relations.references[JSON.stringify([t.id, id])]);
        }).map(e => e.id);
        const content = event.subject + ' ' + (event.excerpt ?? '');
        const issueIds = hyperHubMentions(content, issues);
        const jiraKeys = issueIds.flatMap(id => {
          const issue = records.get(id)?.r;
          return issue?.key.kind === 'jira' ? [{ instanceId: issue.key.instanceId, key: issue.label }] : [];
        });
        const urls = new Set(content.split(/[\s<>"]+/));
        const docIds = [...records.values()].filter(({ r }) => (r.jiraAlias && urls.has(r.jiraAlias)) ||
          (r.documentUrl && urls.has(r.documentUrl))).map(({ r }) => r.id);
        const projectIds = [...new Set([...issueIds, ...docIds, ...manual].flatMap(id => {
          const source = records.get(originByCitation.get(id) ?? id)?.r;
          return source?.projectId ? [hyperHubHash(source.scope.connectionId, source.projectId)] : [];
        }))];
        const blockIds = new Set(prep.filter(t => ledger.decisions[t.id]?.prepBlock).map(t => t.id));
        const firstBlock = prep.find(t => blockIds.has(t.id))?.fixedBlocks?.[0];
        const prepPlan = firstBlock && Date.parse(firstBlock.start.iso) > time && blockIds.size &&
          !plan.blocks.some(b => blockIds.has(b.taskId)) ? hyperPlanDay({ ...input, nowMs: Date.parse(firstBlock.start.iso), ranking }) : plan;
        const blocks = prepPlan.blocks.filter(b => b.fixed && blockIds.has(b.taskId));
        const preparation = { ownerConfirmed: state?.confirmed, viewed: state?.viewed, blocks,
          tasks: prep.filter(t => !blockIds.has(t.id)).map(t => ({ id: t.id, completion: t.authoritativeCompletion })) };
        const eventStale = records.get(event.id)!.stale;
        const signature = hyperHubHash(this.version.revision, evidenceSignature, event.revision, eventStale, manual, preparation,
          series.map(s => s.revision), jiraKeys, docIds, Math.floor(time / 60000), time >= Date.parse(event.interval.start.iso) - 30 * 60000);
        const cached = this.cacheKeys.get(event.id);
        const hit = cached?.signature === signature && this.briefs.get(cached.version);
        const priorDecisions = series.flatMap(prior => {
          const excerpt = prior.excerpt?.split(/\r?\n/).find(line => /^(?:decision|החלטה)\s*:\s*\S/i.test(line.trim()));
          return excerpt ? [{ ...prior, kind: 'prior-decision' as const, priorOccurrenceKey: prior.key, excerpt,
            stale: records.get(prior.id)!.stale }] : [];
        });
        const brief = hit || hyperBuildMeetingBrief({ now: hyperHubInstant(time), requestedOccurrence: event.key,
          occurrence: { ...event, stale: eventStale, jiraKeys, projectIds, trustedDocumentIds: docIds }, evidence: [...evidence, ...priorDecisions], history: series,
          configuredJiraInstanceId: jiraInstance, configuredNewsletterConnectionIds: newsletterConnections, manualEvidenceIds: manual,
          writes, preparation });
        if (!brief.eligible) continue;
        item.meeting = { verifiedEligible: true, readiness: brief.readiness, viewed: brief.viewed, joinUrl: brief.meeting.joinUrl?.startsWith('https://') ? brief.meeting.joinUrl : undefined };
        for (const work of [...brief.openActions, ...brief.relatedIssues, ...brief.blockers, ...brief.decisionsDue]) {
          const task = tasksBySource.get(this.recordId(work.id));
          if (task && !task.meetingIds.includes(item.id)) task.meetingIds.push(item.id);
        }
        if (item.id === requestedMeeting || (Date.parse(brief.prewarmAt.iso) <= time && Date.parse(event.interval.end.iso) >= time)) {
          this.cacheKeys.set(event.id, { signature, version: brief.briefVersion });
          this.briefs.set(brief.briefVersion, brief);
          liveVersions.add(brief.briefVersion);
        }
      }
      for (const [id, key] of this.cacheKeys) if (!liveVersions.has(key.version)) this.cacheKeys.delete(id);
      for (const key of this.briefs.keys()) if (!liveVersions.has(key)) this.briefs.delete(key);
    }
    const cohortPrecision = Object.fromEntries((['en', 'he', 'mixed'] as const).map(cohort => {
      const labels = Object.values(ledger.decisions).flatMap(d => d.reviewLabel?.cohort === cohort ? [d.reviewLabel] : []);
      const accepted = labels.filter(l => l.accepted).length, dismissed = labels.length - accepted;
      return [cohort, { accepted, dismissed, preview: hyperHubCohortIsPreview(accepted, dismissed, hyperHubFixturePrecision[cohort]) }];
    })) as Record<HyperHubLanguageCohort, HyperHubCohortPrecision>;
    const requested = { start: hyperHubInstant(time), end: hyperHubCalendarInterval(time, zone).end };
    const coverage: NonNullable<HyperHubSnapshot['meetingWindow']>['coverage'] = [];
    const boundary = new TZDate(time, zone);
    boundary.setHours(0, 0, 0, 0);
    for (let day = 0, start = requested.start; day < 7; day++) {
      boundary.setDate(boundary.getDate() + 1);
      const end = hyperHubInstant(+boundary);
      statuses.forEach((status, i) => {
        if (!inventories[i].query.availabilitySource) return;
        for (const read of status.coverage) {
          const complete = status.status === 'fresh' && read.completeness === 'complete' && read.interval &&
            read.interval.start.iso <= start.iso && read.interval.end.iso >= end.iso;
          coverage.push({ ...read, interval: { start, end }, completeness: complete ? 'complete' : 'partial' });
        }
      });
      start = end;
    }
    return { ...this.version, writes, meetingWindow: { requested, coverage },
      matrixOverrides: Object.fromEntries(tasks.flatMap(t => ledger.decisions[t.id]?.matrixQuadrant ? [[t.id, ledger.decisions[t.id].matrixQuadrant!]] : [])),
      linkSuggestions: hyperHubLinkSuggestions(tasks, relations.negatives, scope?.aliases ?? []),
      cycleTaskIds: [...hyperBuildTaskGraph(tasks, { writes }).cycles.keys()].sort(), asOf: hyperHubInstant(time), tasks, ranking, agenda, plan,
      day: availability ? hyperHubProjectAvailabilityDay(time, availability) : undefined, sources: [...connections.values()],
      settings: { cohortPrecision, writeBack: {
        jira: { enabled: !!scope?.writeBack?.jira, available: this.writeback.available('jira') },
        newsletter: { enabled: !!scope?.writeBack?.newsletter, available: this.writeback.available('newsletter') },
      }, setupComplete: !!scope, zone, workdays: scope?.workdays ?? [], hours: scope?.hours,
        breaks: scope?.breaks, outlookAvailability: !!scope?.outlookCalendar, weights } };
  }

  private readonly mirrorTokens = new Map<string, { v: Version; taskId: string; evidenceId: string; originKey: string; boardId?: string;
    destination: string; revision: string; link: string; title: string; expires: number; doc: HyperHubDocument }>();
  private mirrorLink(r: HyperHubRecord, ownerTitle?: string) {
    if (r.role !== 'origin' && r.role !== 'assignment') return;
    if (r.key.kind === 'jira') return r.jiraAlias;
    if (r.key.kind === 'newsletter-task' && r.key.taskId) return r.documentUrl;
    if (r.key.kind === 'outlook-mail' && (!r.reviewSpan || ownerTitle && !ownerTitle.includes(r.reviewSpan.excerpt))) return 'outlook:' + encodeURIComponent(r.key.entryId);
  }
  private async mirrorAccess(id: string, v: Version) {
    const source = await this.access(id, v, true);
    if (source.query.kind === 'jira') {
      // A by-ID open check alone does not verify the current assignment or the selected filter.
      const current = await source.query.read({ ...source.record.scope, generation: v.scopeGeneration }, this.controller.signal);
      if (!current.records.some(r => r.id === id && r.revision === source.record.revision)) throw new HyperHubRejection('access-denied');
      await this.recheck(v);
    }
    return source;
  }
  async previewMirror(v: Version & { taskId: string }, doc: HyperHubDocument) {
    this.assert(v);
    const task = this.snapshot().tasks.find(t => t.id === v.taskId);
    if (!task || !this.deps.mirror || task.mirror?.exists || !task.mirror?.eligible) throw new HyperHubRejection('access-denied');
    const { record } = await this.mirrorAccess(task.sources[0].evidenceId, v);
    const link = this.mirrorLink(record, this.store.current.ledger.decisions[task.id]?.titleOverride);
    if (!link) throw new HyperHubRejection('invalid');
    const { boardId, destination, audience } = await this.deps.mirror.destination(this.controller.signal);
    await this.recheck(v);
    if (!doc.trusted()) throw new HyperHubRejection('access-denied');
    for (const [id, old] of this.mirrorTokens) if (old.expires <= this.now()) this.mirrorTokens.delete(id);
    const token = randomUUID(), title = task.title.slice(0, 500);
    this.mirrorTokens.set(token, { v, taskId: task.id, evidenceId: record.id, originKey: hyperHubOriginKey(record),
      doc, boardId, destination, link, title, revision: record.revision, expires: this.now() + 60000 });
    return { ...this.version, ok: true as const, preview: { token, title, link, destination, audience } };
  }
  async applyMirror(token: string, doc: HyperHubDocument) {
    const b = this.mirrorTokens.get(token);
    if (!b || !this.deps.mirror || b.doc.frame !== doc.frame || b.doc.window !== doc.window) throw new HyperHubRejection('invalid');
    this.mirrorTokens.delete(token);
    const check = async () => {
      const current = { scopeGeneration: b.v.scopeGeneration, expectedRevision: this.version.revision };
      const { record } = await this.mirrorAccess(b.evidenceId, current);
      const task = this.snapshot().tasks.find(t => t.id === b.taskId);
      if (!task || ['review', 'dismissed'].includes(task.state) || task.title.slice(0, 500) !== b.title || record.revision !== b.revision ||
        task.sources[0]?.evidenceId !== b.evidenceId) throw new HyperHubRejection('revision-conflict');
      if (!b.doc.trusted() || !doc.trusted() || b.expires <= this.now() || this.mirrorLink(record, this.store.current.ledger.decisions[task.id]?.titleOverride) !== b.link) throw new HyperHubRejection('access-denied');
    };
    const row = await this.deps.mirror.apply(b, this.controller.signal, check);
    this.store.commit(() => true, d => { (d.ledger.mirrorRows ??= {})[b.originKey] = row; });
    this.publish();
    return { ...this.version, ok: true as const, handle: this.handle(b.originKey) };
  }

  private writeHint(source: HyperHubWriteSource, id: string) {
    const code = this.writeback.blocked(id) ? 'held' as const : !this.writeback.available(source) ? 'reconnect' as const :
      !this.store.current.setup?.writeBack?.[source] ? 'disabled' as const : this.writeback.lastFailure(id);
    return { available: !code, code };
  }
  previewStatus(v: Version & { intent: HyperHubStatusIntent; handle?: string }, doc: HyperHubDocument) {
    this.assert(v);
    return this.writeback.preview(doc, v.intent, () => {
      for (const t of this.snapshot().tasks) {
        const ref = t.sources.find(s => s.handle === v.handle && s.statusWrite);
        if (!ref) continue;
        const r = this.inventories().flatMap(i => i.batch?.records ?? []).find(r => r.id === ref.evidenceId);
        if (r) return { target: { id: r.id, key: r.key, projectId: r.projectId }, taskId: t.id };
      }
      throw new HyperHubStatusError('access-denied');
    });
  }
  async releaseHold(v: Version & { operationId: string }, doc: HyperHubDocument) {
    await this.recheck(v);
    return this.writeback.release(doc, v.operationId);
  }
  previewWeights(v: Version & { draft: typeof defaultWeights; seq: number }) {
    this.assert(v);
    if (this.frozen?.revision !== this.version.revision) this.frozen = { revision: this.version.revision, input: this.project(true) };
    return { ...this.version, ok: true as const, seq: v.seq,
      diff: hyperPreviewWeights(this.frozen.input, this.store.current.ledger.weights ?? defaultWeights, v.draft) };
  }
  async saveWeights(v: Version & { weights: typeof defaultWeights }) {
    try { hyperNormalizeWeights(v.weights); } catch { throw new HyperHubRejection('invalid'); }
    await this.recheck(v);
    this.store.commit(() => { this.assert(v); return true; }, d => { d.ledger.weights = { ...v.weights }; });
    this.publish();
    return { ...this.version, ok: true as const };
  }

  meetingIds(store: string) {
    const result = new Map<string, string>();
    if (this.outlookStore !== store || !this.setup.scope?.outlookCalendar) return result;
    const meetingIds = new Set(this.snapshot().agenda?.flatMap(m => m.meeting?.verifiedEligible ? [m.id] : []));
    for (const { batch, query } of this.inventories()) if (query.kind === 'outlook-calendar') {
      for (const r of batch?.evidence ?? []) if (r.occurrence && meetingIds.has(r.id)) result.set(r.id, r.occurrence.sourceTime.iso);
    }
    return result;
  }

  private handle(id: string) {
    const { scopeGeneration, revision } = this.version;
    return [scopeGeneration, revision, hyperHubHash(this.secret, scopeGeneration, revision, id)].join('.');
  }

  async refresh(v: Version, kind?: HyperHubQuery['kind'], manual = true, outlookCadence = 60_000) {
    this.assert(v);
    const queries = this.queries().filter(q => {
      if (kind && q.kind !== kind || q.kind === 'outlook-calendar' && this.deps.outlookOffline?.()) return false;
      const cadence = q.kind === 'outlook-calendar' ? outlookCadence : q.kind.startsWith('newsletter-') ? 15 * 60_000 : q.kind === 'outlook-mail' ? 5 * 60_000 : 0;
      const key = hyperHubQueryKey(q);
      const last = this.attempted.get(key) ?? -Infinity;
      if (!manual && this.now() - last < cadence && !this.sync.isReading(q)) return false;
      this.attempted.set(key, this.now());
      return true;
    });
    if (manual) await this.writeback.reconcile();
    if (!queries.length) return this.snapshot();
    const remaining = queries.values();
    const worker = async () => {
      for (const q of remaining) {
        if (this.controller.signal.aborted) return;
        await this.sync.run({ accountId: this.deps.accountId, workspaceId: this.deps.workspaceId, connectionId: q.connectionId,
          generation: this.deps.generation }, q, this.controller.signal, manual);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queries.length) }, worker));
    if (this.controller.signal.aborted || !await this.deps.validate()) throw new HyperHubRejection('scope-changed');
    return this.snapshot();
  }

  setSetupScope(v: Version, scope: HyperHubSetupScope, outlookStore?: string) {
    this.assert(v);
    const priorMail = this.setup.scope?.mail, mail = scope.mail;
    if (mail?.enabled && mail.confirmedAt && priorMail?.confirmedAt?.iso === mail.confirmedAt.iso &&
      (this.outlookStore !== outlookStore || !priorMail.enabled || mail.folders.some(f => !priorMail.folders.includes(f)) ||
       (mail.retentionDays ?? 30) > (priorMail.retentionDays ?? 30) || (mail.importFlags && !priorMail.importFlags))) {
      throw new HyperHubRejection('invalid');
    }
    const keys = new Set(this.deps.queries(scope).map(hyperHubQueryKey));
    this.store.commit(() => !this.controller.signal.aborted, d => {
      d.setup = { ...scope, writeBack: { jira: !!scope.writeBack?.jira && this.writeback.available('jira'),
        newsletter: !!scope.writeBack?.newsletter && this.writeback.available('newsletter') } };
      if (d.outlookStore !== outlookStore) for (const [key, value] of Object.entries(d.cache)) {
        if (value.status.kind === 'outlook-calendar' || value.status.kind === 'outlook-mail') delete d.cache[key];
      }
      d.outlookStore = outlookStore;
      for (const key of Object.keys(d.cache)) if (!keys.has(key)) delete d.cache[key];
    });
    // All old reads are tied to this service. The IPC owner installs a new generation after setup.
    this.close();
  }

  private async handleAccessLoss(error: unknown, record: HyperHubRecord) {
    if (!(error instanceof HyperHubAccessLost)) return;
    if (this.controller.signal.aborted || !await this.deps.validate() || this.controller.signal.aborted) throw new HyperHubRejection('scope-changed');
    this.store.accessGeneration++;
    this.store.commit(() => !this.controller.signal.aborted, d => {
      for (const [key, inventory] of Object.entries(d.cache)) {
        if (error instanceof HyperHubConnectionAccessLost && inventory.status.connectionId === record.scope.connectionId ||
          error instanceof HyperHubStoreAccessLost && inventory.status.kind.startsWith('outlook-')) { delete d.cache[key]; continue; }
        inventory.evidence = inventory.evidence?.filter(r => r.id !== record.id && !(r.key.kind === 'outlook-mail' &&
          record.key.kind === 'outlook-mail' && r.key.storeId === record.key.storeId && r.key.entryId === record.key.entryId));
        if (record.occurrence) inventory.agenda = inventory.agenda?.flatMap(item => item.id !== record.id ? [item] :
          ['free', 'working-elsewhere'].includes(item.availability) ? [] : [hyperHubBusyInterval(item.interval, item.sourceKind)]);
        const size = inventory.records.length;
        inventory.records = inventory.records.filter(r => r.id !== record.id &&
          !(record.key.kind === 'outlook-mail' && r.key.kind === 'outlook-mail' &&
            r.key.storeId === record.key.storeId && r.key.entryId === record.key.entryId));
        if (inventory.records.length !== size) inventory.cursor = null;
      }
      if (error instanceof HyperHubStoreAccessLost && d.setup) { d.setup.mail = null; d.setup.outlookCalendar = false; }
    });
    this.publish();
    throw new HyperHubRejection('access-denied');
  }

  private async access(id: string, v: Version, verifyRevision = false) {
    this.assert(v);
    for (const { batch, query } of this.inventories()) {
      const record = batch?.records.find(r => r.id === id) ?? batch?.evidence?.find(r => r.id === id);
      if (!record?.openTarget) continue;
      let url: string | void;
      try {
        const scope = { accountId: this.deps.accountId, workspaceId: this.deps.workspaceId,
          connectionId: query.connectionId, generation: v.scopeGeneration };
        url = await query.check({ ...record, scope }, this.controller.signal, verifyRevision);
      }
      catch (error) {
        await this.handleAccessLoss(error, record);
        await this.recheck(v);
        throw new HyperHubRejection('unavailable');
      }
      await this.recheck(v);
      return { target: record.openTarget, url, record, query };
    }
    throw new HyperHubRejection('access-denied');
  }

  async openSource(handle: string): Promise<HyperHubOpenResult & { target?: HyperHubOpenTarget }> {
    const [generation, revision] = handle.split('.');
    const v = { scopeGeneration: Number(generation), expectedRevision: Number(revision) };
    try {
      this.assert(v);
      const mirror = Object.entries(this.store.current.ledger.mirrorRows ?? {}).find(([key]) => this.handle(key) === handle);
      if (mirror && this.deps.checkMirrorRow) {
        const [key, row] = mirror;
        const r = this.inventories().flatMap(i => i.batch?.records ?? []).find(r => hyperHubOriginKey(r) === key);
        if (!r) throw new HyperHubRejection('access-denied');
        await this.access(r.id, v);
        await this.deps.checkMirrorRow(row, key, this.controller.signal);
        await this.recheck(v);
        return { ...this.version, ok: true as const, target: row };
      }
      const source = this.snapshot().tasks.flatMap(t => t.sources).find(s => s.handle === handle);
      if (!source) throw new HyperHubRejection('access-denied');
      return await this.openEvidence(source.evidenceId, v);
    } catch (error) { return this.reject(error); }
  }

  private async openEvidence(id: string, v: Version) {
    try {
      const { target, url, query, record } = await this.access(id, v);
      this.assert(v);
      if (query.open) {
        try { await query.open(record, this.controller.signal, () => this.assert(v)); }
        catch (error) { await this.handleAccessLoss(error, record); throw error; }
      }
      else if (url) await this.deps.openExternal(url);
      await this.recheck(v);
      return { ...this.version, ok: true as const, ...(target.kind === 'hypertask' && { target }) };
    } catch (error) { return this.reject(error); }
  }

  private brief(meetingId: string) {
    this.snapshot(undefined, meetingId);
    const brief = [...this.briefs.values()].find(b => b.meeting.id === meetingId);
    if (!brief) throw new HyperHubRejection('access-denied');
    return brief;
  }

  async getBrief(v: Version & { meetingId: string }) {
    try {
      await this.recheck(v);
      const brief = this.brief(v.meetingId);
      if (!this.deps.outlookOffline?.()) await this.access(v.meetingId, v);
      const native = new Set(this.inventories().filter(({ query }) => query.kind === 'hypertask')
        .flatMap(({ batch }) => [...batch?.records ?? [], ...batch?.evidence ?? []].map(r => r.id)));
      for (const id of new Set(this.items(brief).map(item => this.recordId(item.id)))) {
        if (native.has(id)) await this.access(id, v);
      }
      await this.recheck(v);
      const ai = this.setup.scope?.ai;
      const summariesAvailable = !!(ai?.summaries && ai.confirmedAt && this.deps.summary && await this.deps.summaryConfigured?.());
      await this.recheck(v);
      if (brief.viewed) return { ...this.version, ok: true as const, brief, summariesAvailable };
      this.store.commit(() => !this.controller.signal.aborted, ({ ledger }) => {
        ((ledger.meetings ??= {})[v.meetingId] ??= {}).viewed = true;
      });
      this.publish();
      return { ...this.version, ok: true as const, summariesAvailable, brief: this.brief(v.meetingId) };
    } catch (error) { return this.reject(error); }
  }

  private items(brief: Extract<HyperMeetingBrief, { eligible: true }>) {
    return [brief.meeting, ...brief.openActions, ...brief.relatedIssues, ...brief.blockers, ...brief.openWithAttendees,
      ...brief.decisionsDue, ...brief.priorDecisions, ...brief.linkedDocuments, ...brief.threads.flatMap(t => t.messages)];
  }
  private recordId(id: string) {
    return id.replace(/^(doc|work)\./, '');
  }
  private citation(brief: Extract<HyperMeetingBrief, { eligible: true }>, id: string) {
    if (!this.items(brief).some(item => item.id === id)) throw new HyperHubRejection('access-denied');
    return this.recordId(id);
  }

  async openBriefEvidence(v: Version & { meetingId: string; evidenceId: string }) {
    try {
      await this.recheck(v);
      const id = this.citation(this.brief(v.meetingId), v.evidenceId);
      if (id !== v.meetingId) await this.access(v.meetingId, v);
      return await this.openEvidence(id, v);
    } catch (error) { return this.reject(error); }
  }

  async summarizeBrief(v: Version & { meetingId: string; evidenceIds: string[] }, trusted = () => true) {
    try {
      this.assert(v);
      if (!this.setup.scope?.ai?.summaries || !this.setup.scope.ai.confirmedAt) throw new HyperHubRejection('access-denied');
      if (!this.deps.summary) throw new HyperHubRejection('unavailable');
      const brief = this.brief(v.meetingId);
      const request = hyperBriefSummaryRequest(brief, v.evidenceIds);
      if (!request.untrusted_data.length || request.untrusted_data.length !== v.evidenceIds.length) throw new HyperHubRejection('invalid');
      const verify = async () => {
        await this.recheck(v);
        for (const id of new Set([v.meetingId, ...v.evidenceIds.map(id => this.citation(brief, id))])) {
          await this.access(id, v, true);
        }
        await this.recheck(v);
        if (!trusted()) throw new HyperHubRejection('access-denied');
        if (this.brief(v.meetingId).briefVersion !== brief.briefVersion) throw new HyperHubRejection('revision-conflict');
      };
      await verify();
      const summary = await this.deps.summary(request, this.controller.signal, verify).finally(verify);
      return { ...this.version, ok: true as const, ...summary };
    } catch (error) { return this.reject(this.controller.signal.aborted ? new HyperHubRejection('scope-changed') : error); }
  }

  private async prepFeedback(e: Extract<HyperHubFeedbackEvent, { meetingId: string }>) {
    const { meetingId } = e;
    // Undo works on the owner's entry even if the occurrence was subsequently removed.
    const brief = e.type === 'undo' ? undefined : this.brief(meetingId);
    if (brief) await this.access(meetingId, e);
    else await this.recheck(e);
    const id = randomUUID(), at = hyperHubInstant(this.now()), taskId = randomUUID();
    const block = e.type === 'block-before' && brief ? { start: hyperHubInstant(Date.parse(brief.meeting.interval.start.iso) - 15 * 60_000),
      end: brief.meeting.interval.start } : undefined;
    const decision: HyperHubDecision = { firstSeenAt: at, stateChangedAt: at, state: 'ready', prepMeetingId: meetingId,
      titleOverride: e.type === 'add-prep-task' && e.title || 'Meeting preparation',
      ...(block && { fixedBlocks: [block], prepBlock: true }) };
    if (block && (Date.parse(block.start.iso) < this.now() || !this.snapshot({ id: taskId, decision }, undefined,
      Date.parse(block.start.iso)).plan?.blocks.some(b => b.fixed && b.taskId === taskId))) throw new HyperHubRejection('invalid');
    this.assert(e);
    this.store.commit(() => !this.controller.signal.aborted, ({ ledger }) => {
      const history = ledger.prepHistory ??= [];
      const state = ((ledger.meetings ??= {})[meetingId] ??= {});
      if (e.type === 'undo') {
        const index = history.findIndex(h => h.id === e.ledgerEntryId && h.meetingId === meetingId);
        if (index < 0) throw new HyperHubRejection('invalid');
        const entry = history[index];
        if (history.slice(index + 1).some(h => h.meetingId === meetingId) ||
          (entry.createdTaskId && ledger.history.some(h => entry.createdTaskId! in h.before))) throw new HyperHubRejection('revision-conflict');
        if (entry.createdTaskId) delete ledger.decisions[entry.createdTaskId];
        else state.confirmed = entry.previousConfirmed;
        history.splice(index, 1);
      } else if (e.type === 'mark-prepared') {
        history.push({ id, meetingId, previousConfirmed: state.confirmed });
        state.confirmed = true;
      } else {
        ledger.decisions[taskId] = decision;
        history.push({ id, meetingId, createdTaskId: taskId });
      }
    });
    this.publish();
    return { ...this.version, ok: true as const, ledgerEntryId: id };
  }

  private reject(error: unknown) {
    return { ...this.version, ok: false as const, code: error instanceof HyperHubRejection ? error.code : 'unavailable' as const };
  }

  async sendFeedback(e: HyperHubFeedbackEvent): Promise<HyperHubFeedbackResult> {
    try {
      this.assert(e);

      if ('meetingId' in e) return await this.prepFeedback(e);
      if ('day' in e) {
        await this.recheck(e);
        if (this.setup.scope?.zone !== e.day.zone) throw new HyperHubRejection('invalid');
        const key = dayKey(e.day.date, e.day.zone), ledgerEntryId = randomUUID();
        this.store.commit(() => !this.controller.signal.aborted, ({ ledger }) => {
          const windows = ledger.availability ??= {};
          const history = ledger.dayHistory ??= [];
          const before = windows[key] ?? [];
          if (e.type === 'undo') {
            const idx = history.findIndex(h => h.id === e.ledgerEntryId && h.key === key);
            if (idx < 0) throw new HyperHubRejection('invalid');
            if (history.slice(idx + 1).some(h => h.key === key)) throw new HyperHubRejection('revision-conflict');
            windows[key] = history[idx].before;
            history.splice(idx, 1);
          } else windows[key] = e.type === 'declare-availability' ? e.windows : [];
          if (e.type !== 'undo') history.push({ id: ledgerEntryId, key, before });
        });
        this.publish();
        return { ...this.version, ok: true, ledgerEntryId };
      }
      const { tasks, ranking } = this.snapshot();
      const targetId = e.type === 'set-matrix-quadrant' ? e.taskId : e.targetId;
      const target = tasks.find(t => t.id === targetId);
      if (e.type === 'set-matrix-quadrant' && target && ['done', 'review', 'dismissed'].includes(target.state)) throw new HyperHubRejection('invalid');
      if (!target || (target.state === 'dismissed' && e.type !== 'undo')) throw new HyperHubRejection('access-denied');
      if (target.sources.length) await this.access(target.sources[0].evidenceId, e);
      else await this.recheck(e);
      if (e.type === 'reorder' && typeof e.position === 'object') {
        const beforeId = e.position.beforeId;
        const anchor = tasks.find(t => t.id === beforeId && sameQueue(t, target));
        if (!anchor) throw new HyperHubRejection('invalid');
        if (anchor.sources.length) await this.access(anchor.sources[0].evidenceId, e);
      }
      let evidence: string | undefined;
      if (e.type === 'link' || e.type === 'unlink') {
        const ref = tasks.flatMap(t => t.sources).find(s => s.handle === e.handle);
        if (!ref || (e.type === 'link' ? target.sources.some(s => s.evidenceId === ref.evidenceId) :
          !target.sources.some(s => s.evidenceId === ref.evidenceId && s.role === 'mentions'))) throw new HyperHubRejection('invalid');
        evidence = ref.evidenceId;
        await this.access(evidence, e);
      }
      if (e.type === 'merge' || e.type === 'reject-match') {
        const other = tasks.find(t => t.id === e.otherTaskId && t.id !== target.id && t.state !== 'dismissed');
        if (!other || !hyperHubLinkSuggestions([target, other], {}, this.setup.scope?.aliases ?? []).length) throw new HyperHubRejection('invalid');
        for (const ref of [...target.sources, ...other.sources]) await this.access(ref.evidenceId, e);
      }
      if (e.type === 'split' || e.type === 'undo') {
        for (const ref of target.sources.slice(1)) await this.access(ref.evidenceId, e);
        if (e.type === 'undo') {
          const entry = this.store.current.ledger.history.find(h => h.id === e.ledgerEntryId && h.targetId === target.id);
          for (const id of Object.keys(entry?.before ?? {})) {
            const other = tasks.find(t => t.id === id && t.id !== target.id);
            if (other) for (const ref of other.sources) await this.access(ref.evidenceId, e);
          }
        }
      }
      this.assert(e);
      if (e.type === 'set-state' && e.state === 'doing' && (target.state === 'ready' || this.writeback.entries.some(entry => entry.view.held && target.sources.some(ref => ref.evidenceId === entry.target.id))) &&
        !ranking.find(r => r.taskId === target.id)?.feasibility.ready) throw new HyperHubRejection('unavailable');
      const ledgerEntryId = randomUUID();
      const at = hyperHubInstant(this.now());
      this.store.commit(() => !this.controller.signal.aborted, draft => {
        const { decisions, history } = draft.ledger;
        const before: Record<string, HyperHubDecision> = {};
        const edit = (id: string) => { before[id] ??= structuredClone(decisions[id]); return decisions[id]; };
        const relations = draft.ledger.relations ??= hyperHubRelations();
        const changes: HyperHubRelationChange[] = [];
        const setRelation = (table: 'negatives' | 'references', key: string, value: boolean) => {
          changes.push({ table, key, previous: relations[table][key] });
          relations[table][key] = value;
        };
        const item = edit(target.id);
        switch (e.type) {
          case 'set-matrix-quadrant': item.matrixQuadrant = e.quadrant; break;
          case 'edit': item.titleOverride = e.title; item.state ??= target.state; break;
          case 'link': case 'unlink':
            setRelation('references', JSON.stringify([target.id, evidence]), e.type === 'link');
            break;
          case 'reject-match':
            edit(e.otherTaskId);
            setRelation('negatives', hyperHubPair(target.id, e.otherTaskId), true);
            break;
          case 'merge':
            edit(e.otherTaskId);
            changes.push({ table: 'merges', key: ledgerEntryId });
            relations.merges[ledgerEntryId] = { from: e.otherTaskId, into: target.id };
            break;
          case 'split': {
            const prior = relations.merges[e.mergeEntryId];
            if (!prior || !target.mergeEntryIds?.includes(e.mergeEntryId)) throw new HyperHubRejection('invalid');
            edit(prior.from); edit(prior.into);
            changes.push({ table: 'merges', key: e.mergeEntryId, previous: prior });
            delete relations.merges[e.mergeEntryId];
            setRelation('negatives', hyperHubPair(prior.into, prior.from), true);
            break;
          }
          case 'pin': case 'unpin': item.pinned = e.type === 'pin'; break;
          case 'accept': case 'dismiss': case 'set-state':
            item.state = e.type === 'set-state' ? e.state : e.type === 'accept' ? 'ready' : 'dismissed';
            if (target.reviewSpan?.cohort && target.state === 'review' && ['ready', 'dismissed'].includes(item.state)) {
              item.reviewLabel = { cohort: target.reviewSpan.cohort, accepted: item.state === 'ready' };
            }
            item.stateChangedAt = at;
            break;
          case 'snooze': item.snoozeUntil = e.until; break;
          case 'not-today': {
            const tomorrow = new TZDate(this.now(), draft.setup!.zone);
            tomorrow.setHours(24, 0, 0, 0);
            item.snoozeUntil = hyperHubInstant(+tomorrow);
            break;
          }
          case 'reschedule': item.fixedBlocks = [e.block]; break;
          case 'reorder': {
            if (e.position === 'reset') { delete item.manualOrder; break; }
            const ranks = new Map(ranking.map((r, i) => [r.taskId, i]));
            const sorted = tasks.filter(t => t.id !== target.id && sameQueue(t, target))
              .sort((a, b) => ['ready', 'doing'].includes(target.state) ? hyperCompareFocusOrder(a, b, ranks) :
                (a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity) || a.id.localeCompare(b.id));
            const beforeId = e.position === 'end' ? null : e.position.beforeId;
            const index = beforeId ? sorted.findIndex(t => t.id === beforeId) : sorted.length;
            if (index < 0) throw new HyperHubRejection('invalid');
            sorted.splice(index, 0, target);
            sorted.forEach((t, i) => { if (decisions[t.id].manualOrder !== i) edit(t.id).manualOrder = i; });
            break;
          }
          case 'undo': {
            const idx = history.findIndex(h => h.id === e.ledgerEntryId && h.targetId === target.id);
            if (idx < 0) throw new HyperHubRejection('invalid');
            const entry = history[idx];
            if (history.slice(idx + 1).some(h => Object.keys(h.before).some(id => id in entry.before))) throw new HyperHubRejection('revision-conflict');
            for (const [id, previous] of Object.entries(entry.before)) { edit(id); decisions[id] = previous; }
            for (const change of entry.changes ?? []) {
              if (change.previous === undefined) delete relations[change.table][change.key];
              else if (change.table === 'merges') relations.merges[change.key] = change.previous;
              else relations[change.table][change.key] = change.previous;
            }
            history.splice(idx, 1);
            break;
          }

        }
        if (e.type !== 'undo') history.push({ id: ledgerEntryId, targetId, before, changes });
      });
      this.publish();
      return { ...this.version, ok: true, ledgerEntryId };
    } catch (error) { return this.reject(error); }
  }
}
