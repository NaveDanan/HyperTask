import { createHyperHubM5FixtureActions } from './HyperHubM5FixtureActions';
import { hyperBuildTaskGraph } from '@shared/HyperDayPlanner';
import { hyperHubMergedIds, hyperHubPair, type HyperHubMerge } from '@shared/HyperHubLinks';
import { hyperHubCohortIsPreview } from '@shared/HyperTaskHub';
import { hyperHubFixturePrecision } from '@shared/HyperHubExtraction';
import { TZDate } from '@date-fns/tz';
import { hyperCompareFocusOrder, hyperHubAvailabilityFromSnapshotParts, hyperHubProjectAvailabilityDay, hyperPlanDay } from '@shared/HyperDayPlanner';
import { hyperRankTasks } from '@shared/HyperPriorityEngine';
import type { HyperHubFeedback, HyperHubFeedbackEvent, HyperHubInterval, HyperHubOpenResult, HyperHubOpenTarget, HyperHubSetupScope, HyperHubSnapshot,
  HyperHubTaskView, HyperTaskHubM5Api } from '@shared/HyperTaskHub';

export const HyperTaskHubClient: HyperTaskHubM5Api = {
  previewStatus: request => window.hypertask.taskHub.previewStatus(request),
  approveStatus: request => window.hypertask.taskHub.approveStatus(request),
  discardStatus: request => window.hypertask.taskHub.discardStatus(request),
  releaseHold: request => window.hypertask.taskHub.releaseHold(request),
  previewWeights: request => window.hypertask.taskHub.previewWeights(request),
  saveWeights: request => window.hypertask.taskHub.saveWeights(request),
  previewMirror: request => window.hypertask.taskHub.previewMirror(request),
  applyMirror: request => window.hypertask.taskHub.applyMirror(request),
  getBrief: request => window.hypertask.taskHub.getBrief(request),
  summarizeBrief: request => window.hypertask.taskHub.summarizeBrief(request),
  openBriefEvidence: async request => finishOpen(await window.hypertask.taskHub.openBriefEvidence(request)),
  getSnapshot: () => window.hypertask.taskHub.getSnapshot(),
  refresh: request => window.hypertask.taskHub.refresh(request),
  sendFeedback: event => window.hypertask.taskHub.sendFeedback(event),
  openSource: async handle => finishOpen(await window.hypertask.taskHub.openSource(handle)),
  onSnapshot: listener => window.hypertask.taskHub.onSnapshot(listener),
  setFocusVisible: visible => window.hypertask.taskHub.setFocusVisible(visible),
  getSetupOptions: () => window.hypertask.taskHub.getSetupOptions(),
  getSetupScope: () => window.hypertask.taskHub.getSetupScope(),
  setSetupScope: request => window.hypertask.taskHub.setSetupScope(request),
};

async function finishOpen(result: HyperHubOpenResult & { target?: HyperHubOpenTarget }): Promise<HyperHubOpenResult> {
  const api = window.hypertask.taskHub;
  if (result.ok && result.target?.kind === 'hypertask') {
    const [{ FolderEventGetView }, { tabsActions }] = await Promise.all([import('@/backend/events'), import('@/features/tabs/tabs-store')]);
    const view = await FolderEventGetView({ value: result.target.viewId });
    const current = await api.getSnapshot();
    if (current.scopeGeneration !== result.scopeGeneration || current.revision !== result.revision) {
      return { ok: false, code: current.scopeGeneration !== result.scopeGeneration ? 'scope-changed' : 'revision-conflict',
        revision: current.revision, scopeGeneration: current.scopeGeneration };
    }
    if (!view.ok) return { ...result, ok: false, code: 'access-denied' };
    tabsActions.openView(view.value, { rowId: result.target.rowId });
  }
  return result;
}

/** The subset whose visual effect is known before main recalculates ranking and order. */
function optimisticTask(task: HyperHubTaskView, e: HyperHubFeedback, zone: string): HyperHubTaskView {
  if (task.id !== e.targetId) return task;
  switch (e.type) {
    case 'edit': return { ...task, title: e.title };
    case 'pin': case 'unpin': return { ...task, pinned: e.type === 'pin' };
    case 'accept': case 'dismiss': case 'set-state':
      return { ...task, state: e.type === 'set-state' ? e.state : e.type === 'dismiss' ? 'dismissed' : 'ready' };
    case 'snooze': return { ...task, snoozeUntil: e.until };
    case 'not-today': {
      const tomorrow = new TZDate(Date.now(), zone);
      tomorrow.setHours(24, 0, 0, 0);
      return { ...task, snoozeUntil: { kind: 'instant', iso: new Date(+tomorrow).toISOString() } };
    }
    case 'reschedule': return { ...task, fixedBlocks: [e.block] };
    default: return task;
  }
}

export function hyperHubOptimisticTasks(s: HyperHubSnapshot, e: HyperHubFeedbackEvent): HyperHubTaskView[] {
  if (e.type === 'set-matrix-quadrant' || 'day' in e || 'meetingId' in e) return s.tasks;
  if (e.type !== 'reorder') return s.tasks.map(t => optimisticTask(t, e, s.settings.zone));
  const task = s.tasks.find(t => t.id === e.targetId);
  if (!task) return s.tasks;
  if (e.position === 'reset') return s.tasks.map(t => t === task ? { ...t, manualOrder: undefined } : t);
  const focus = ['ready', 'doing'].includes(task.state);
  const ranks = new Map(s.ranking.map((rank, i) => [rank.taskId, i]));
  const column = s.tasks.filter(t => (focus ? ['ready', 'doing'].includes(t.state) : t.state === task.state) && t !== task)
    .sort((a, b) => focus ? hyperCompareFocusOrder(a, b, ranks) :
      (a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity) || a.id.localeCompare(b.id));
  const beforeId = e.position === 'end' ? null : e.position.beforeId;
  const index = beforeId ? column.findIndex(t => t.id === beforeId) : column.length;
  if (index < 0) return s.tasks;
  column.splice(index, 0, task);
  const order = new Map(column.map((t, i) => [t.id, i]));
  return s.tasks.map(t => order.has(t.id) ? { ...t, manualOrder: order.get(t.id) } : t);
}

/** Read and interact with a local snapshot without installing a preload bridge. */
export function createHyperTaskHubFixtureClient(initial: HyperHubSnapshot): HyperTaskHubM5Api {
  let snapshot = structuredClone(initial);
  let scope: HyperHubSetupScope | null = snapshot.settings.writeBack ? {
    writeBack: { jira: snapshot.settings.writeBack.jira.enabled, newsletter: snapshot.settings.writeBack.newsletter.enabled },
    zone: snapshot.settings.zone, hours: snapshot.settings.hours ?? { start: '09:00', end: '18:00' }, breaks: snapshot.settings.breaks ?? [],
    daysOff: [], workdays: snapshot.settings.workdays, aliases: [], jiraProjects: [], nativeViews: [],
  } : null;
  let originalTasks = snapshot.tasks;
  const merges: Record<string, HyperHubMerge> = {};
  const negatives = new Set<string>();
  const history = new Map<string, { targetId: string; before: Map<string, HyperHubTaskView>; undoRelation?: () => void }>();
  const dayHistory = new Map<string, HyperHubInterval[]>();
  function rankInput(ownerWindows = snapshot.day?.ownerWindows ?? []) {
    const day = snapshot.day, { zone, workdays, hours, breaks } = snapshot.settings;
    if (!day || !hours) return { tasks: snapshot.tasks, writes: snapshot.writes, nowMs: Date.parse(snapshot.asOf.iso) };
    const nowMs = Date.parse(snapshot.asOf.iso);
    const availability = hyperHubAvailabilityFromSnapshotParts({ zone, workdays, hours, breaks, ownerWindows,
      sources: [{ agenda: snapshot.agenda ?? [], complete: (initial.day?.coverage ?? []).flatMap(c =>
        c.basis === 'complete' || c.basis === 'stale-complete' ? [{ interval: c.interval, asOf: snapshot.asOf,
          newerRefreshPartial: c.basis === 'stale-complete' }] : []) }] });
    return { nowMs, tasks: snapshot.tasks, writes: snapshot.writes, availability };
  }
  function updateDay(ownerWindows: HyperHubInterval[]) {
    const input = rankInput(ownerWindows);
    const { nowMs, availability } = input;
    if (!availability) return;
    const ranking = hyperRankTasks({ ...input, weights: snapshot.settings.weights });
    snapshot = { ...snapshot, ranking, plan: hyperPlanDay({ ...input, ranking }), day: hyperHubProjectAvailabilityDay(nowMs, availability) };
  }
  const listeners = new Set<(s: HyperHubSnapshot) => void>();
  const version = () => ({ revision: snapshot.revision, scopeGeneration: snapshot.scopeGeneration });
  const reject = (v: { expectedRevision: number; scopeGeneration: number }) => v.scopeGeneration !== snapshot.scopeGeneration ?
    'scope-changed' as const : v.expectedRevision !== snapshot.revision ? 'revision-conflict' as const : null;
  function publish() {
    const revision = snapshot.revision + 1;
    const merged = hyperHubMergedIds(merges);
    const tasks = originalTasks.filter(t => merged(t.id) === t.id).map(task => {
      const members = [task, ...originalTasks.filter(t => t !== task && merged(t.id) === task.id)];
      const sources = new Map<string, HyperHubTaskView['sources'][number]>();
      for (const source of members.flatMap(t => t.sources)) {
        if (!sources.has(source.evidenceId) || sources.get(source.evidenceId)?.role === 'mentions') {
          sources.set(source.evidenceId, { ...source, handle: ['fixture', snapshot.scopeGeneration, revision, source.evidenceId].join('.') });
        }
      }
      const edges = (kind: 'blocks' | 'blockedBy') => members.flatMap(t => t[kind]).map(edge => ({
        ...edge, predecessorId: merged(edge.predecessorId), successorId: merged(edge.successorId),
      }));
      const mirror = [...sources.values()].find(s => s.role === 'mirror');
      return { ...task, ...(mirror && { mirror: { exists: true as const, handle: mirror.handle } }), sources: [...sources.values()], blocks: edges('blocks'), blockedBy: edges('blockedBy'),
        sourceStatus: Object.assign({}, ...members.map(t => t.sourceStatus)),
        mergeEntryIds: Object.keys(merges).filter(key => merged(merges[key].into) === task.id) };
    });
    snapshot = { ...snapshot, revision, tasks, cycleTaskIds: [...hyperBuildTaskGraph(tasks).cycles.keys()],
      linkSuggestions: initial.linkSuggestions?.filter(s => merged(s.targetId) === s.targetId && merged(s.otherTaskId) === s.otherTaskId &&
        !negatives.has(hyperHubPair(s.targetId, s.otherTaskId))) };
    if (snapshot.settings.cohortPrecision) {
      const precision = structuredClone(initial.settings.cohortPrecision!);
      for (const task of originalTasks) {
        const cohort = task.reviewSpan?.cohort;
        if (!cohort || task.state === 'review' || initial.tasks.find(t => t.id === task.id)?.state !== 'review') continue;
        if (task.state === 'dismissed') precision[cohort].dismissed++;
        else precision[cohort].accepted++;
      }
      for (const cohort of ['en', 'he', 'mixed'] as const) {
        const c = precision[cohort];
        c.preview = hyperHubCohortIsPreview(c.accepted, c.dismissed, hyperHubFixturePrecision[cohort]);
      }
      snapshot.settings = { ...snapshot.settings, cohortPrecision: precision };
    }
    if (snapshot.day) updateDay(snapshot.day.ownerWindows);
    for (const listener of listeners) listener(structuredClone(snapshot));
  }
  const m5 = createHyperHubM5FixtureActions({
    current: () => snapshot, version, reject, rankInput,
    editTask(id, update) { originalTasks = originalTasks.map(t => t.id === id ? update(t) : t); },
    publish,
  });
  return {
    ...m5,
    getBrief: async () => ({ ...version(), ok: false, code: 'unavailable' }),
    summarizeBrief: async () => ({ ...version(), ok: false, code: 'unavailable' }),
    openBriefEvidence: async () => ({ ...version(), ok: false, code: 'unavailable' }),
    getSnapshot: async () => structuredClone(snapshot),
    refresh: async v => { const code = reject(v); if (code) throw new Error(code); return structuredClone(snapshot); },
    onSnapshot: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    setFocusVisible: async () => {},
    getSetupOptions: async () => ({
      jira: { configured: snapshot.sources.some(s => s.kind === 'jira') },
      mailbox: { available: snapshot.sources.some(s => s.kind === 'outlook-mail'), flagsVerified: false },
      outlook: { available: snapshot.sources.some(s => s.kind === 'outlook-calendar' && s.status !== 'unconfigured') },
      newsletter: { configured: snapshot.sources.some(s => s.kind === 'newsletter-task'),
        gantt: snapshot.sources.some(s => s.kind === 'newsletter-task'), projects: [] },
    }),
    getSetupScope: async () => ({ ...version(), scope }),
    setSetupScope: async v => {
      const code = reject(v); if (code) throw new Error(code);
      scope = structuredClone(v.scope);
      history.clear(); dayHistory.clear();
      snapshot = { ...snapshot, scopeGeneration: snapshot.scopeGeneration + 1,
        settings: { ...snapshot.settings, zone: scope.zone, workdays: scope.workdays, setupComplete: true } };
      if (snapshot.settings.writeBack) {
        for (const source of ['jira', 'newsletter'] as const) snapshot.settings.writeBack[source].enabled = !!scope.writeBack?.[source];
      }
      publish();
      return { ...version(), scope };
    },
    openSource: async handle => snapshot.tasks.some(t => t.sources.some(s => s.handle === handle && s.openable))
      ? { ...version(), ok: true } : { ...version(), ok: false, code: 'access-denied' },
    sendFeedback: async e => {
      const code = reject(e);
      if (code) return { ...version(), ok: false, code };
      if ('meetingId' in e) return { ...version(), ok: false, code: 'unavailable' };
      if ('day' in e) {
        const day = snapshot.day, ledgerEntryId = 'fixture-' + snapshot.revision;
        if (!day || e.day.date !== day.date.date || e.day.zone !== day.date.zone) return { ...version(), ok: false, code: 'invalid' };
        if (e.type === 'undo') {
          const previous = dayHistory.get(e.ledgerEntryId);
          if (!previous) return { ...version(), ok: false, code: 'invalid' };
          if ([...dayHistory.keys()].at(-1) !== e.ledgerEntryId) return { ...version(), ok: false, code: 'revision-conflict' };
          updateDay(previous);
          dayHistory.delete(e.ledgerEntryId);
        } else {
          dayHistory.set(ledgerEntryId, day.ownerWindows);
          updateDay(e.type === 'declare-availability' ? e.windows : []);
        }
        publish();
        return { ...version(), ok: true, ledgerEntryId };
      }
      if (e.type === 'set-matrix-quadrant') {
        const task = snapshot.tasks.find(t => t.id === e.taskId);
        if (!task || !['ready', 'doing', 'waiting'].includes(task.state)) return { ...version(), ok: false, code: 'invalid' };
        const previous = snapshot.matrixOverrides?.[task.id];
        const ledgerEntryId = 'fixture-' + snapshot.revision;
        snapshot.matrixOverrides = { ...snapshot.matrixOverrides, [task.id]: e.quadrant };
        history.set(ledgerEntryId, { targetId: task.id, before: new Map(), undoRelation() {
          if (previous) snapshot.matrixOverrides![task.id] = previous;
          else delete snapshot.matrixOverrides![task.id];
        } });
        publish();
        return { ...version(), ok: true, ledgerEntryId };
      }
      const prior = snapshot.tasks.find(t => t.id === e.targetId);
      if (!prior) return { ...version(), ok: false, code: 'access-denied' };
      const ledgerEntryId = 'fixture-' + snapshot.revision;
      let tasks = originalTasks;
      let undoRelation: (() => void) | undefined;
      if (e.type === 'undo') {
        const entry = history.get(e.ledgerEntryId);
        if (entry?.targetId !== e.targetId) return { ...version(), ok: false, code: 'invalid' };
        const newer = [...history.entries()].slice([...history.keys()].indexOf(e.ledgerEntryId) + 1);
        if (newer.some(([, other]) => other.targetId === entry.targetId)) return { ...version(), ok: false, code: 'revision-conflict' };
        entry.undoRelation?.();
        tasks = originalTasks.map(t => entry.before.get(t.id) ?? t);
        history.delete(e.ledgerEntryId);
      } else if (e.type === 'merge' || e.type === 'reject-match') {
        const pair = hyperHubPair(e.targetId, e.otherTaskId);
        if (!snapshot.linkSuggestions?.some(s => hyperHubPair(s.targetId, s.otherTaskId) === pair)) return { ...version(), ok: false, code: 'invalid' };
        if (e.type === 'merge') {
          merges[ledgerEntryId] = { from: e.otherTaskId, into: e.targetId };
          undoRelation = () => { delete merges[ledgerEntryId]; };
        } else {
          negatives.add(pair);
          undoRelation = () => { negatives.delete(pair); };
        }
      } else if (e.type === 'split') {
        const previous = merges[e.mergeEntryId];
        if (!previous || !prior.mergeEntryIds?.includes(e.mergeEntryId)) return { ...version(), ok: false, code: 'invalid' };
        const pair = hyperHubPair(previous.from, previous.into);
        delete merges[e.mergeEntryId];
        negatives.add(pair);
        undoRelation = () => { merges[e.mergeEntryId] = previous; negatives.delete(pair); };
      } else if (e.type === 'link' || e.type === 'unlink') {
        const ref = snapshot.tasks.flatMap(t => t.sources).find(s => s.handle === e.handle);
        if (!ref || (e.type === 'unlink' && !prior.sources.some(s => s.evidenceId === ref.evidenceId && s.role === 'mentions')) ||
          (e.type === 'link' && prior.sources.some(s => s.evidenceId === ref.evidenceId))) return { ...version(), ok: false, code: 'invalid' };
        tasks = originalTasks.map(t => t.id !== e.targetId ? t : { ...t, sources: e.type === 'link'
          ? [...t.sources, { ...ref, role: 'mentions' as const }] : t.sources.filter(s => s.evidenceId !== ref.evidenceId) });
      } else tasks = hyperHubOptimisticTasks({ ...snapshot, tasks: originalTasks }, e);
      if (e.type !== 'undo') {
        const before = new Map(originalTasks.filter((t, i) => t !== tasks[i]).map(t => [t.id, t]));
        if (!before.size && !undoRelation) return { ...version(), ok: false, code: 'unavailable' };
        history.set(ledgerEntryId, { targetId: e.targetId, before, undoRelation });
      }
      originalTasks = tasks;
      publish();
      return { ...version(), ok: true, ledgerEntryId };
    },
  };
}
