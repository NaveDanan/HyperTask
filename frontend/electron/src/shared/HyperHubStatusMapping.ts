import type {
  HyperHubCompletion, HyperHubState, HyperHubStatusCandidate, HyperHubStatusCategory, HyperHubStatusEffect,
  HyperHubStatusIntent, HyperHubStatusUnavailable, HyperHubWriteSource,
} from './HyperTaskHub';

type HyperHubWritableState = Extract<HyperHubStatusIntent, { kind: 'state' }>['state'];

const categoryByState = {
  ready: 'new', doing: 'indeterminate', done: 'done',
} as const satisfies Record<HyperHubWritableState, HyperHubStatusCategory>;
const stateByCategory = { new: 'ready', indeterminate: 'doing', done: 'done' } as const;
const newsletterStatuses = { pending: 'Pending', 'in-progress': 'In progress', completed: 'Completed', delayed: 'Delayed' } as const;
export type HyperHubNewsletterStatus = keyof typeof newsletterStatuses;

export function hyperMapSourceStatus(
  source: HyperHubWriteSource, status: unknown, localState?: HyperHubState,
): { category: HyperHubStatusCategory; completion: HyperHubCompletion; state?: HyperHubState } {
  const key = source === 'newsletter'
    ? (status === 'pending' ? 'new' : status === 'in-progress' ? 'indeterminate' : status === 'completed' ? 'done' : 'unknown')
    : status;
  const category = key === 'new' || key === 'indeterminate' || key === 'done' ? key : 'unknown';
  const completion = category === 'done' ? 'complete' : category !== 'unknown' || (source === 'newsletter' && status === 'delayed')
    ? 'open' : 'unknown';
  const state = localState ?? (category === 'unknown' ? undefined : stateByCategory[category]);
  return { category, completion, ...(state !== undefined && { state }) };
}

export interface HyperHubJiraTransition {
  id: string;
  name: string;
  to: { id: string; name: string; category?: string };
  isGlobal?: boolean;
  fields?: Readonly<Record<string, {
    name?: string;
    required: boolean;
    allowedValues?: readonly { id: string; name: string }[];
  }>>;
}

export interface HyperHubStatusChoices {
  candidates: HyperHubStatusCandidate[];
  unavailable: HyperHubStatusUnavailable[];
}

export function hyperStatusEffects(
  source: HyperHubWriteSource, fromStatusId: string, toStatusId: string,
  { progress = null, isGlobal = false, resolutionName }: {
    progress?: number | null; isGlobal?: boolean; resolutionName?: string;
  } = {},
): HyperHubStatusEffect[] {
  if (source === 'jira') {
    const effects: HyperHubStatusEffect[] = [{ code: 'workflow-effects' }];
    if (isGlobal) effects.push({ code: 'any-status-transition' });
    if (resolutionName !== undefined) effects.push({ code: 'resolution-set', valueName: resolutionName });
    return effects;
  }
  const effects: HyperHubStatusEffect[] = [];
  if (toStatusId === 'completed') effects.push({ code: 'progress-set', from: progress, to: 100 });
  else if (fromStatusId === 'completed' && progress !== null) effects.push({ code: 'progress-kept', value: progress });
  effects.push({ code: 'parent-rollup' }, { code: 'chart-normalized' });
  return effects;
}

function preselect(candidates: HyperHubStatusCandidate[], intent: HyperHubStatusIntent) {
  if (intent.kind === 'choose') return;
  const matching = intent.kind === 'reverse' ? candidates : candidates.filter(candidate => candidate.to.category === categoryByState[intent.state]);
  if (matching.length === 1) matching[0].preselected = true;
}

export function hyperChooseJiraCandidates(
  currentStatusId: string, transitions: readonly HyperHubJiraTransition[], intent: HyperHubStatusIntent, previousStatusId?: string,
): HyperHubStatusChoices {
  const candidates: HyperHubStatusCandidate[] = [];
  const unavailable: HyperHubStatusUnavailable[] = [];
  for (const transition of transitions) {
    const { id, name, to, fields } = transition;
    if (intent.kind === 'reverse' && to.id !== previousStatusId) continue;
    const action = { actionLabel: name, toName: to.name };
    if (to.id === currentStatusId) {
      unavailable.push({ ...action, reason: 'self' });
      continue;
    }
    if (!id || !name || !to.id || !to.name) {
      unavailable.push({ ...action, reason: 'metadata' });
      continue;
    }
    const required = Object.entries(fields ?? {}).filter(([, field]) => field.required);
    const values = fields?.resolution?.allowedValues?.filter(value => value.id && value.name)
      .map(({ id, name }) => ({ id, name }));
    const resolution = required.length === 1 && required[0][0] === 'resolution' && values?.length ? { values } : undefined;
    if (!fields || (required.length && !resolution)) {
      unavailable.push({
        ...action, reason: 'required-fields',
        ...(required.length > 0 && { fields: required.map(([key, field]) => field.name || key) }),
      });
      continue;
    }
    candidates.push({
      candidateId: id, actionLabel: name, to: { id: to.id, name: to.name, category: hyperMapSourceStatus('jira', to.category).category },
      preselected: false, ...(resolution && { resolution }),
      effects: hyperStatusEffects('jira', currentStatusId, to.id, { isGlobal: transition.isGlobal }),
    });
  }
  preselect(candidates, intent);
  return { candidates, unavailable };
}

export function hyperChooseNewsletterCandidates(
  currentStatusId: string, progress: number | null | undefined, intent: HyperHubStatusIntent, previousStatusId?: string,
): HyperHubStatusChoices {
  const candidates: HyperHubStatusCandidate[] = Object.entries(newsletterStatuses)
    .filter(([id]) => id !== currentStatusId && (intent.kind !== 'reverse' || id === previousStatusId))
    .map(([id, name]) => ({
      candidateId: id, actionLabel: name, to: { id, name, category: hyperMapSourceStatus('newsletter', id).category },
      preselected: false, effects: hyperStatusEffects('newsletter', currentStatusId, id, { progress }),
    }));
  preselect(candidates, intent);
  return { candidates, unavailable: [] };
}

export type HyperHubStatusPrecondition = { statusId: string; revision: string } & (
  | { source: 'jira'; candidate: HyperHubStatusCandidate | undefined }
  | { source: 'newsletter'; progress: number | null; leaf: boolean }
);

export function hyperDetectStatusConflict(
  approved: HyperHubStatusPrecondition, current: HyperHubStatusPrecondition, resolutionId?: string,
): boolean {
  if (approved.statusId !== current.statusId || approved.revision !== current.revision) return true;
  if (approved.source === 'newsletter' && current.source === 'newsletter') {
    return !approved.leaf || !current.leaf || approved.progress !== current.progress;
  }
  if (approved.source !== 'jira' || current.source !== 'jira') return true;
  const before = approved.candidate;
  const after = current.candidate;
  if (!before || !after || before.candidateId !== after.candidateId || before.to.id !== after.to.id ||
    before.to.category !== after.to.category || Boolean(before.resolution) !== Boolean(after.resolution) ||
    before.effects.some(effect => effect.code === 'any-status-transition') !==
      after.effects.some(effect => effect.code === 'any-status-transition')) return true;
  if (before.resolution && after.resolution) {
    return resolutionId === undefined || !before.resolution.values.some(value => value.id === resolutionId) ||
      !after.resolution.values.some(value => value.id === resolutionId);
  }
  return resolutionId !== undefined;
}
