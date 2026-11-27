import { hyperPreviewWeights } from '@shared/HyperHubWeights';
import type { HyperHubRankInput } from '@shared/HyperPriorityEngine';
import { HyperHubWeightsSchema, type HyperHubVersion, type HyperHubSnapshot, type HyperHubTaskView,
  type HyperHubStatusCandidate, type HyperHubStatusPreview, type HyperHubStatusRejectCode, type HyperHubWriteView,
  type HyperTaskHubM5Actions } from '@shared/HyperTaskHub';

type RequestVersion = { scopeGeneration: number; expectedRevision: number };
interface Fixture {
  current(): HyperHubSnapshot;
  version(): HyperHubVersion;
  reject(request: RequestVersion): 'scope-changed' | 'revision-conflict' | null;
  rankInput(): Omit<HyperHubRankInput, 'weights'>;
  editTask(id: string, update: (task: HyperHubTaskView) => HyperHubTaskView): void;
  publish(): void;
}

function candidates(jira: boolean, current: string, progress: number): HyperHubStatusCandidate[] {
  const rows: HyperHubStatusCandidate[] = jira ? [
    { candidateId: 'review', actionLabel: 'Request review', to: { id: 'review', name: 'In Review', category: 'indeterminate' },
      preselected: false, effects: [{ code: 'workflow-effects' }] },
    { candidateId: 'resolve', actionLabel: 'Resolve issue', to: { id: 'done', name: 'Done', category: 'done' },
      preselected: false, resolution: { values: [{ id: 'fixed', name: 'Fixed' }, { id: 'duplicate', name: 'Duplicate' }] },
      effects: [{ code: 'any-status-transition' }, { code: 'workflow-effects' }] },
    { candidateId: 'reopen', actionLabel: 'Reopen issue', to: { id: 'open', name: 'Open', category: 'new' },
      preselected: false, effects: [{ code: 'workflow-effects' }] },
  ] : (['pending', 'in-progress', 'completed', 'delayed'] as const).map(status => ({
    candidateId: status, actionLabel: status, to: { id: status, name: status,
      category: status === 'completed' ? 'done' : status === 'pending' ? 'new' : 'indeterminate' }, preselected: false,
    effects: [...(status === 'completed' ? [{ code: 'progress-set' as const, from: progress, to: 100 as const }]
      : current === 'completed' ? [{ code: 'progress-kept' as const, value: progress }] : []),
      { code: 'chart-normalized' }, { code: 'parent-rollup' }],
  }));
  return rows.filter(row => row.to.name !== current);
}

/** In-memory demo actions. All source changes are confined to this fixture client. */
export function createHyperHubM5FixtureActions({ current, version, reject, rankInput, editTask, publish }: Fixture): HyperTaskHubM5Actions {
  let serial = 0;
  const next = () => 'fixture-token-' + ++serial;
  const statuses = new Map<string, { preview: HyperHubStatusPreview; taskId: string; evidenceId: string; expires: number; scope: RequestVersion }>();
  const mirrors = new Map<string, { taskId: string; scope: RequestVersion }>();
  const failure = <T extends HyperHubStatusRejectCode>(code: T) => ({ ...version(), ok: false as const, code });
  const record = (id: string) => current().writes?.find(w => w.operationId === id);
  const saveWrite = (write: HyperHubWriteView) => {
    current().writes = [...(current().writes ?? []).filter(w => w.operationId !== write.operationId), write];
    publish();
  };
  return {
    async previewStatus(request) {
      const code = reject(request);
      if (code) return failure(code);
      const intent = request.intent;
      const reverse = intent.kind === 'reverse' ? record(intent.operationId) : undefined;
      if (intent.kind === 'reverse' && !reverse?.undoAvailable) return failure('unsupported');
      const pair = current().tasks.flatMap(task => task.sources.map(ref => ({ task, ref }))).find(({ ref, task }) =>
        'handle' in request ? ref.handle === request.handle : ref.evidenceId === reverse?.evidenceId && task.id === reverse.taskId);
      if (!pair) return failure('not-found');
      const { task, ref } = pair;
      if (!['origin', 'assignment'].includes(ref.role) || !['jira', 'newsletter-task'].includes(ref.kind)) return failure('unsupported');
      const jira = ref.kind === 'jira', source = jira ? 'jira' : 'newsletter';
      if (!current().settings.writeBack?.[source].enabled) return failure('disabled');
      if (!ref.statusWrite?.available) return failure(ref.statusWrite?.code ?? 'unavailable');
      const name = task.sourceStatus[ref.evidenceId]?.rawStatus ?? 'Unknown';
      const progress = name === 'completed' ? 100 : 60;
      let rows = candidates(jira, name, progress);
      if (reverse) rows = rows.filter(row => row.to.name === reverse.fromName);
      if (!rows.length) return failure('no-actions');
      if (reverse && rows.length === 1) rows[0].preselected = true;
      if (intent.kind === 'state') {
        const desired = { ready: 'new', doing: 'indeterminate', done: 'done' }[intent.state];
        const matches = rows.filter(r => r.to.category === desired && r.to.id !== 'delayed');
        if (matches.length === 1) matches[0].preselected = true;
      }
      const preview: HyperHubStatusPreview = {
        previewId: next(), expiresAt: { kind: 'instant', iso: new Date(Date.parse(current().asOf.iso) + 60000).toISOString() },
        source, site: jira ? 'jira.example.test' : 'newsletter.example.test',
        accountLabel: jira ? 'Yael Levi' : 'Configured Newsletter connection',
        target: { key: jira ? ref.label : task.id, title: task.title, container: task.projectId },
        current: { id: name === 'In Review' ? 'review' : name.toLowerCase(), name, category: ['Done', 'completed'].includes(name) ? 'done'
          : ['Open', 'pending'].includes(name) ? 'new' : 'indeterminate', ...(!jira && { progress }) },
        versionLabel: current().asOf.iso, candidates: rows,
        unavailable: jira ? [{ actionLabel: 'Deploy', toName: 'Released', reason: 'required-fields', fields: ['Environment'] }] : [],
        permissionCheckedOnConfirm: !jira,
      };
      statuses.set(preview.previewId, { preview, taskId: task.id, evidenceId: ref.evidenceId, expires: Date.now() + 60000, scope: request });
      return { ...version(), ok: true, preview: structuredClone(preview) };
    },
    async approveStatus({ previewId, candidateId, resolutionId }) {
      const bound = statuses.get(previewId);
      statuses.delete(previewId);
      if (!bound || Date.now() >= bound.expires) return { ...version(), outcome: 'expired' };
      const code = reject(bound.scope);
      if (code) return { ...version(), outcome: 'failed', code };
      const row = bound.preview.candidates.find(r => r.candidateId === candidateId);
      if (!row || (row.resolution ? !row.resolution.values.some(v => v.id === resolutionId) : resolutionId !== undefined))
        return { ...version(), outcome: 'failed', code: 'invalid' };
      const write: HyperHubWriteView = { operationId: next(), taskId: bound.taskId, evidenceId: bound.evidenceId,
        source: bound.preview.source, at: current().asOf, fromName: bound.preview.current.name, toName: row.to.name,
        state: 'succeeded', readback: 'verified', observedName: row.to.name, held: false, ownerReleaseAvailable: false, undoAvailable: true };
      const completion = row.to.category === 'done' ? 'complete' : 'open';
      editTask(write.taskId, task => ({ ...task, authoritativeCompletion: task.sources[0]?.evidenceId === write.evidenceId ? completion : task.authoritativeCompletion,
        sourceStatus: { ...task.sourceStatus, [write.evidenceId]: { rawStatus: row.to.name, category: row.to.category, completion } } }));
      for (const old of current().writes ?? []) if (old.evidenceId === write.evidenceId) old.undoAvailable = false;
      saveWrite(write);
      return { ...version(), outcome: 'succeeded', write: structuredClone(write) };
    },
    async discardStatus({ previewId }) {
      statuses.delete(previewId);
      return { ...version(), ok: true };
    },
    async releaseHold(request) {
      const code = reject(request);
      if (code) return failure(code);
      const original = record(request.operationId);
      if (!original || original.state !== 'unknown' || !original.held || !original.ownerReleaseAvailable) return failure('held');
      const write = { ...original, held: false, ownerReleaseAvailable: false, ownerReleasedAt: current().asOf, undoAvailable: false };
      saveWrite(write);
      return { ...version(), ok: true, write: structuredClone(write) };
    },
    async previewWeights(request) {
      const code = reject(request);
      if (code) return failure(code);
      if (!HyperHubWeightsSchema.safeParse(request.draft).success) return failure('invalid');
      const input = rankInput();
      return { ...version(), ok: true, seq: request.seq, diff: hyperPreviewWeights(input, current().settings.weights, request.draft) };
    },
    async saveWeights(request) {
      const code = reject(request);
      if (code) return failure(code);
      if (!HyperHubWeightsSchema.safeParse(request.weights).success) return failure('invalid');
      current().settings.weights = { ...request.weights };
      publish();
      return { ...version(), ok: true };
    },
    async previewMirror(request) {
      const code = reject(request);
      if (code) return failure(code);
      const task = current().tasks.find(t => t.id === request.taskId);
      if (!task?.mirror || task.mirror.exists || !task.mirror.eligible || task.state === 'review' || task.state === 'dismissed') return failure('unavailable');
      const token = next();
      mirrors.set(token, { taskId: task.id, scope: request });
      return { ...version(), ok: true, preview: { token, destination: 'Hyper-Kanban', audience: 'Editorial workspace',
        title: task.title, link: 'https://newsletter.example.test/projects/' + task.projectId + '/tasks/' + task.id } };
    },
    async applyMirror({ token }) {
      const bound = mirrors.get(token);
      mirrors.delete(token);
      if (!bound) return failure('invalid');
      const code = reject(bound.scope);
      if (code) return failure(code);
      const evidenceId = 'fixture-mirror-' + bound.taskId;
      editTask(bound.taskId, task => ({ ...task, sources: [...task.sources, { evidenceId, handle: '', openable: true,
        stale: false, connectionId: 'project-release', kind: 'hypertask', role: 'mirror', label: 'Hyper-Kanban' }] }));
      publish();
      const ref = current().tasks.find(t => t.id === bound.taskId)?.sources.find(s => s.evidenceId === evidenceId);
      return ref ? { ...version(), ok: true, handle: ref.handle } : failure('unavailable');
    },
  };
}
