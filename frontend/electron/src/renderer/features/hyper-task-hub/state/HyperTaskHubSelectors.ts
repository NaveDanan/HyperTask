import { TZDate } from '@date-fns/tz';
import {
  hyperBuildTaskGraph, hyperCompareFocusOrder, hyperCompareTaskIds, hyperHubDayBounds, hyperHubDayCapacity, hyperPlanningHeldTaskIds,
  hyperTaskDeadline, hyperTaskIsPlanCandidate, hyperTaskPlanningEffort,
} from '@shared/HyperDayPlanner';
import { hyperMapSourceStatus } from '@shared/HyperHubStatusMapping';
import type { HyperMeetingReadiness } from '@shared/HyperMeetingBrief';
import type {
  HyperHubAgendaItem, HyperHubCivilDate, HyperHubCoverage, HyperHubDate, HyperHubFeasibility, HyperHubInstant,
  HyperHubInterval, HyperHubMatrixQuadrant, HyperHubPlanBlock, HyperHubProvenance, HyperHubRanked, HyperHubRankReason,
  HyperHubRecommendation, HyperHubSnapshot, HyperHubSourceKind, HyperHubSourceRef, HyperHubStatusCategory,
  HyperHubStatusIntent, HyperHubTaskView, HyperHubUnscheduled, HyperHubWriteSource,
} from '@shared/HyperTaskHub';

const boardStates = ['review', 'ready', 'doing', 'waiting', 'done'] as const;
const boardLimit = 50;
const matrixQuadrants: readonly HyperHubMatrixQuadrant[] = ['urgent-important', 'important', 'urgent', 'neither'];

export interface HyperHubFilters {
  readonly source?: HyperHubSourceKind;
  readonly connectionId?: string;
  readonly personId?: string;
  readonly projectId?: string;
  readonly due?: 'overdue' | 'today' | 'upcoming' | 'none';
}

export interface HyperHubBoardColumn {
  readonly state: typeof boardStates[number];
  readonly cards: readonly HyperHubTaskView[];
  readonly overflowCount: number;
  readonly firstOverflowId?: string;
}

export interface HyperHubFocusItem {
  readonly task: HyperHubTaskView;
  readonly rank?: HyperHubRanked;
}

export interface HyperHubPendingOrder {
  readonly order: readonly string[];
  readonly movedCount: number;
}

export interface HyperHubTodayBlock {
  readonly task: HyperHubTaskView;
  readonly block: HyperHubPlanBlock;
}

export interface HyperHubTodayRecommendation extends HyperHubTodayBlock {
  readonly ranked: HyperHubRanked;
  readonly kind: HyperHubRecommendation['kind'];
  readonly start: HyperHubInstant;
  readonly reasons: readonly HyperHubRecommendation['reasons'][number][];
}

export interface HyperHubTodayCapacity {
  readonly freeMinutes: number;
  readonly plannedMinutes: number;
  readonly unplacedMinutes: number;
  readonly provisional: boolean;
}

export interface HyperHubToday {
  readonly recommendation: HyperHubTodayRecommendation | null;
  readonly recommendationReason: 'no-ready-task' | 'no-coverage' | 'nothing-fits' | null;
  readonly blocks: readonly HyperHubTodayBlock[];
  readonly agenda: readonly HyperHubAgendaItem[];
  readonly capacity: HyperHubTodayCapacity;
  readonly unscheduled: readonly (HyperHubUnscheduled & { task: HyperHubTaskView })[];
  readonly coverage: 'complete' | 'provisional' | 'missing';
  readonly needsOwnerWindow: boolean;
}

export interface HyperHubMeetingAgendaDetails {
  /** Main sets this after verifying D8 eligibility for the store-scoped occurrence. */
  readonly verifiedEligible: true;
  readonly readiness: HyperMeetingReadiness;
  readonly viewed: boolean;
}

type HyperHubPublicAgendaItem = Extract<HyperHubAgendaItem, { private: false }>;
export type HyperHubMeetingsSnapshot = Omit<HyperHubSnapshot, 'agenda'> & {
  readonly agenda?: readonly (Extract<HyperHubAgendaItem, { private: true }> | (HyperHubPublicAgendaItem & {
    readonly meeting?: HyperHubMeetingAgendaDetails;
  }))[];
};

export interface HyperHubMeetingsOptions {
  readonly now?: Readonly<HyperHubInstant>;
  readonly needsPrep?: boolean;
}

export interface HyperHubMeetingListItem {
  readonly agendaItem: HyperHubPublicAgendaItem;
  readonly readiness: HyperMeetingReadiness;
  readonly viewed: boolean;
  readonly relatedOpenItemCount: number;
}

const noFilters: HyperHubFilters = {};
const selections = new WeakMap<HyperHubSnapshot, WeakMap<HyperHubFilters, ReturnType<typeof derive>>>();

function derive(snapshot: HyperHubSnapshot, filters: HyperHubFilters) {
  const clock = Date.parse(snapshot.asOf.iso);
  const civilDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: snapshot.settings.zone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = civilDay.format(clock);
  const tasks = snapshot.tasks.filter(task => {
    if (task.state === 'dismissed') return false;
    if ((filters.source || filters.connectionId) && !task.sources.some(source =>
      (!filters.source || source.kind === filters.source) &&
      (!filters.connectionId || source.connectionId === filters.connectionId))) return false;
    if (filters.personId && !task.people.some(person => person.id === filters.personId)) return false;
    if (filters.projectId && task.projectId !== filters.projectId) return false;
    if (!filters.due) return true;
    const deadline = hyperTaskDeadline(task);
    if (filters.due === 'none') return !deadline;
    if (!deadline) return false;
    if (filters.due === 'overdue') return deadline.ms < clock;
    if (deadline.ms < clock) return false;
    const day = civilDay.format(deadline.ms - (deadline.date.kind === 'civil-date' ? 1 : 0));
    return filters.due === 'today' ? day === today : day !== today;
  });

  const grouped = new Map(boardStates.map(state => [state, [] as HyperHubTaskView[]]));
  const ranks = new Map(snapshot.ranking.map(rank => [rank.taskId, rank]));
  const rankPositions = new Map(snapshot.ranking.map((rank, index) => [rank.taskId, index]));
  const compareFocus = (a: HyperHubTaskView, b: HyperHubTaskView) => hyperCompareFocusOrder(a, b, rankPositions);
  const focus: HyperHubFocusItem[] = [];
  for (const task of tasks) {
    if (task.state !== 'dismissed' && (task.state !== 'done' || civilDay.format(Date.parse(task.stateChangedAt.iso)) === today)) {
      grouped.get(task.state)!.push(task);
    }
    if (hyperTaskIsPlanCandidate(task)) {
      focus.push({ task, rank: ranks.get(task.id) });
    }
  }
  focus.sort((a, b) => compareFocus(a.task, b.task));

  const board: HyperHubBoardColumn[] = boardStates.map(state => {
    const cards = grouped.get(state)!;
    if (state === 'ready') cards.sort(compareFocus);
    else cards.sort((a, b) => ((a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity)) || hyperCompareTaskIds(a.id, b.id));
    return {
      state, cards: cards.slice(0, boardLimit), overflowCount: Math.max(0, cards.length - boardLimit),
      ...(state === 'ready' && cards.length > boardLimit && { firstOverflowId: cards[boardLimit].id }),
    };
  });
  return {
    tasks, board, focus, triage: grouped.get('review')!, order: focus.map(item => item.task.id),
    today: undefined as HyperHubToday | undefined,
  };
}

function taskReleasedBy(task: HyperHubTaskView, clock: number): boolean {
  return ![task.release, task.snoozeUntil].some(date => date && Date.parse(date.iso) > clock);
}

function deriveToday(
  snapshot: HyperHubSnapshot, tasks: readonly HyperHubTaskView[], focus: readonly HyperHubFocusItem[],
): HyperHubToday {
  const clock = Date.parse(snapshot.asOf.iso);
  const { start, end } = hyperHubDayBounds(clock, snapshot.settings.zone);
  const agenda = (snapshot.agenda ?? []).filter(event => {
    const eventStart = Date.parse(event.interval.start.iso);
    const eventEnd = Date.parse(event.interval.end.iso);
    if (eventStart === eventEnd) return eventStart >= start && eventStart < end;
    return eventStart < end && eventEnd > start && eventStart < eventEnd;
  });
  agenda.sort((a, b) => Date.parse(a.interval.start.iso) - Date.parse(b.interval.start.iso) ||
    hyperCompareTaskIds(a.id, b.id));

  const taskById = new Map(tasks.map(task => [task.id, task]));
  const held = hyperPlanningHeldTaskIds(snapshot.writes);
  const graph = held.size ? hyperBuildTaskGraph(snapshot.tasks, snapshot) : undefined;
  const readyRanks = new Map<string, HyperHubRanked>();
  for (const { task, rank } of focus) {
    if (rank?.feasibility.ready && !held.has(task.id) && taskReleasedBy(task, clock) &&
      ![...(graph?.predecessors.get(task.id) ?? [])].some(id => held.has(id))) readyRanks.set(task.id, rank);
  }
  const planBlocks = snapshot.plan?.blocks ?? [];
  const blocks = planBlocks.flatMap(block => {
    const task = taskById.get(block.taskId);
    const blockStart = Date.parse(block.start.iso);
    return task && !held.has(task.id) && hyperTaskIsPlanCandidate(task) && blockStart >= clock && blockStart < end &&
      taskReleasedBy(task, blockStart) ? [{ task, block }] : [];
  });
  blocks.sort((a, b) => Date.parse(a.block.start.iso) - Date.parse(b.block.start.iso) ||
    hyperCompareTaskIds(a.task.id, b.task.id));
  const unscheduled = (snapshot.plan?.unscheduled ?? []).flatMap(entry => {
    const task = taskById.get(entry.taskId);
    return task && (hyperTaskIsPlanCandidate(task) || (task.state === 'waiting' && task.authoritativeCompletion !== 'complete'))
      ? [{ ...entry, task }] : [];
  });

  let recommendation: HyperHubTodayRecommendation | null = null;
  for (const { task, block } of blocks) {
    const ranked = readyRanks.get(task.id);
    if (!ranked) continue;
    recommendation = {
      task, ranked, block, start: block.start, reasons: block.reasons,
      kind: Date.parse(block.start.iso) === clock ? 'start-now' : 'start-later',
    };
    break;
  }

  const { freeMinutes, coverage, needsOwnerWindow } = snapshot.day
    ? hyperHubDayCapacity(clock, snapshot.day, agenda, snapshot.tasks, planBlocks, held)
    : { freeMinutes: 0, coverage: 'missing' as const, needsOwnerWindow: true };
  let recommendationReason: HyperHubToday['recommendationReason'] = null;
  if (!recommendation) {
    if (!readyRanks.size) recommendationReason = 'no-ready-task';
    else if ((!snapshot.plan && coverage === 'missing') ||
      unscheduled.some(entry => entry.code === 'no-coverage' && readyRanks.has(entry.taskId))) {
      recommendationReason = 'no-coverage';
    } else recommendationReason = 'nothing-fits';
  }
  const plannedMinutes = blocks.reduce((total, { block }) =>
    total + (Date.parse(block.end.iso) - Date.parse(block.start.iso)) / 60_000, 0);
  const unplacedMinutes = unscheduled.reduce((total, { task }) =>
    total + (!held.has(task.id) && hyperTaskIsPlanCandidate(task) ? hyperTaskPlanningEffort(task) : 0), 0);

  return {
    recommendation, recommendationReason, blocks, agenda, unscheduled, coverage, needsOwnerWindow,
    capacity: {
      freeMinutes, plannedMinutes, unplacedMinutes,
      provisional: coverage === 'provisional' || blocks.some(({ block }) => block.provisional),
    },
  };
}

function select(snapshot: HyperHubSnapshot, filters = noFilters) {
  let byFilter = selections.get(snapshot);
  if (!byFilter) {
    byFilter = new WeakMap();
    selections.set(snapshot, byFilter);
  }
  let result = byFilter.get(filters);
  if (!result) {
    result = derive(snapshot, filters);
    byFilter.set(filters, result);
  }
  return result;
}

/** Memoized by immutable snapshot and filter identity. */
export function hyperSelectTasks(snapshot: HyperHubSnapshot, filters?: HyperHubFilters): readonly HyperHubTaskView[] {
  return select(snapshot, filters).tasks;
}

export function hyperSelectBoard(snapshot: HyperHubSnapshot, filters?: HyperHubFilters): readonly HyperHubBoardColumn[] {
  return select(snapshot, filters).board;
}

export function hyperSelectFocus(snapshot: HyperHubSnapshot, filters?: HyperHubFilters): readonly HyperHubFocusItem[] {
  return select(snapshot, filters).focus;
}

/** Applies task filters to the plan and overflow while keeping the day's calendar and free time. */
export function hyperSelectToday(snapshot: HyperHubSnapshot, filters?: HyperHubFilters): HyperHubToday {
  const selection = select(snapshot, filters);
  return selection.today ??= deriveToday(snapshot, selection.tasks, selection.focus);
}

export function hyperSelectTriage(snapshot: HyperHubSnapshot, filters?: HyperHubFilters): readonly HyperHubTaskView[] {
  return select(snapshot, filters).triage;
}

/** Lists verified meetings starting in the next seven days and counts linked open tasks. */
export function hyperSelectMeetings(
  snapshot: HyperHubMeetingsSnapshot,
  { now = snapshot.asOf, needsPrep = false }: HyperHubMeetingsOptions = {},
): readonly HyperHubMeetingListItem[] {
  const from = Date.parse(now.iso);
  const until = from + 7 * 86_400_000;
  const meetings = (snapshot.agenda ?? []).flatMap(agendaItem => {
    if (agendaItem.private || !agendaItem.isMeeting || agendaItem.meeting?.verifiedEligible !== true) return [];
    const start = Date.parse(agendaItem.interval.start.iso);
    const end = Date.parse(agendaItem.interval.end.iso);
    if (!(start >= from && start < until && start < end) || (needsPrep && agendaItem.meeting.readiness === 'prepared')) return [];
    const { readiness, viewed } = agendaItem.meeting;
    return [{ agendaItem, start, readiness, viewed }];
  });
  const counts = relatedOpenCounts(snapshot, meetings.map(({ agendaItem }) => agendaItem.id));
  return meetings.sort((a, b) => a.start - b.start || hyperCompareTaskIds(a.agendaItem.id, b.agendaItem.id))
    .map(({ agendaItem, readiness, viewed }) => ({ agendaItem, readiness, viewed, relatedOpenItemCount: counts.get(agendaItem.id)! }));
}

function relatedOpenCounts(snapshot: HyperHubMeetingsSnapshot, ids: readonly string[]) {
  const counts = new Map(ids.map(id => [id, 0]));
  for (const task of snapshot.tasks) {
    if (task.state === 'done' || task.state === 'dismissed' || task.authoritativeCompletion === 'complete') continue;
    for (const meetingId of new Set(task.meetingIds)) {
      const count = counts.get(meetingId);
      if (count !== undefined) counts.set(meetingId, count + 1);
    }
  }
  return counts;
}

export type HyperHubMeetingDayRow =
  | ({ kind: 'meeting' } & HyperHubMeetingListItem)
  | { kind: 'busy'; agendaItem: Extract<HyperHubAgendaItem, { private: true }> };

export interface HyperHubMeetingDay {
  readonly date: HyperHubCivilDate;
  readonly coverage: readonly HyperHubCoverage[];
  readonly rows: readonly HyperHubMeetingDayRow[];
}

export function hyperSelectMeetingDays(
  snapshot: HyperHubMeetingsSnapshot,
  { now = snapshot.asOf, needsPrep = false }: HyperHubMeetingsOptions = {},
): readonly HyperHubMeetingDay[] {
  const from = Date.parse(now.iso);
  if (!Number.isFinite(from)) return [];
  const zone = snapshot.settings.zone;
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const agenda = (snapshot.agenda ?? []).map(agendaItem => ({
    agendaItem, start: Date.parse(agendaItem.interval.start.iso), end: Date.parse(agendaItem.interval.end.iso),
  })).sort((a, b) => a.start - b.start || hyperCompareTaskIds(a.agendaItem.id, b.agendaItem.id));
  const counts = relatedOpenCounts(snapshot, agenda.map(({ agendaItem }) => agendaItem.id));
  const days: HyperHubMeetingDay[] = [];
  let midnight = hyperHubDayBounds(from, zone).start;
  for (let i = 0; i < 7; i++) {
    const { end } = hyperHubDayBounds(midnight, zone);
    const startOfWindow = Math.max(midnight, from);
    const rows = agenda.flatMap<HyperHubMeetingDayRow>(({ agendaItem, start, end: itemEnd }) => {
      if (!(start < itemEnd && start < end)) return [];
      if (agendaItem.private) {
        return !needsPrep && itemEnd > startOfWindow ? [{ kind: 'busy', agendaItem }] : [];
      }
      if (start < startOfWindow || !agendaItem.isMeeting || !agendaItem.meeting?.verifiedEligible) return [];
      const { readiness, viewed } = agendaItem.meeting;
      if (needsPrep && readiness !== 'none' && readiness !== 'planned') return [];
      return [{ kind: 'meeting', agendaItem, readiness, viewed, relatedOpenItemCount: counts.get(agendaItem.id)! }];
    });
    const window = snapshot.meetingWindow;
    const coverage = window?.coverage.filter(read => {
      const interval = read.interval ?? window.requested;
      return Date.parse(interval.start.iso) < end && Date.parse(interval.end.iso) > startOfWindow;
    }) ?? [];
    days.push({ date: { kind: 'civil-date', date: dateFormat.format(midnight), zone }, coverage, rows });
    midnight = end;
  }
  return days;
}

export type HyperHubMatrixReason =
  | { kind: 'axis'; axis: 'urgency' | 'importance'; value: number; reason?: HyperHubRankReason; provisional?: boolean }
  | { kind: 'missing'; axis: 'urgency' | 'importance'; detail: 'effort' | 'coverage' | 'deadline' | 'priority' | 'unknown' }
  | { kind: 'override' };

export interface HyperHubMatrixCard extends HyperHubFocusItem {
  readonly urgency: number | null;
  readonly importance: number | null;
  readonly override?: HyperHubMatrixQuadrant;
  readonly blocker?: Extract<HyperHubFeasibility, { ready: false }>;
  readonly reasons: readonly HyperHubMatrixReason[];
}

export interface HyperHubMatrix {
  readonly quadrants: readonly {
    quadrant: HyperHubMatrixQuadrant; cards: readonly HyperHubMatrixCard[]; overflowCount: number;
  }[];
  readonly needsDetails: readonly HyperHubMatrixCard[];
}

export function hyperSelectMatrix(snapshot: HyperHubSnapshot, filters?: HyperHubFilters): HyperHubMatrix {
  const byRank = new Map(snapshot.ranking.map((rank, index) => [rank.taskId, { rank, index }]));
  const held = hyperPlanningHeldTaskIds(snapshot.writes);
  const tasks = hyperSelectTasks(snapshot, filters)
    .filter(task => task.state === 'ready' || task.state === 'doing' || task.state === 'waiting')
    .sort((a, b) => (byRank.get(a.id)?.index ?? Infinity) - (byRank.get(b.id)?.index ?? Infinity) || hyperCompareTaskIds(a.id, b.id));
  const grouped = new Map(matrixQuadrants.map(quadrant => [quadrant, [] as HyperHubMatrixCard[]]));
  const needsDetails: HyperHubMatrixCard[] = [];
  for (const task of tasks) {
    const rank = byRank.get(task.id)?.rank;
    const urgency = rank && !rank.unknown.includes('slack') ? rank.urgency : null;
    const importance = rank && !rank.unknown.includes('importance') ? rank.importance : null;
    const storedOverride = snapshot.matrixOverrides?.[task.id];
    const override = storedOverride && matrixQuadrants.includes(storedOverride) ? storedOverride : undefined;
    const reasons: HyperHubMatrixReason[] = [];
    if (urgency === null) {
      const detail = !hyperTaskDeadline(task) ? 'deadline' : task.effortIsEstimate ? 'effort' : rank ? 'coverage' : 'unknown';
      reasons.push({ kind: 'missing', axis: 'urgency', detail });
    } else {
      reasons.push({ kind: 'axis', axis: 'urgency', value: urgency, reason: rank?.reasons.find(item => item.signal === 'slack'),
        provisional: rank?.provisionalSlack });
    }
    reasons.push(importance === null ? { kind: 'missing', axis: 'importance', detail: 'priority' }
      : { kind: 'axis', axis: 'importance', value: importance, reason: rank?.reasons.find(item => item.signal === 'importance') });
    if (override) reasons.push({ kind: 'override' });
    const blocker = held.has(task.id) ? { ready: false as const, code: 'waiting' as const, facts: { held: 1 } }
      : rank?.feasibility.ready === false ? rank.feasibility
        : task.state === 'waiting' ? { ready: false as const, code: 'waiting' as const, facts: { state: task.state } } : undefined;
    const card: HyperHubMatrixCard = { task, rank, urgency, importance, override, blocker, reasons };
    let quadrant = override;
    if (!quadrant && urgency !== null && importance !== null) {
      quadrant = urgency >= 0.50 ? (importance >= 0.67 ? 'urgent-important' : 'urgent') : (importance >= 0.67 ? 'important' : 'neither');
    }
    if (quadrant) grouped.get(quadrant)!.push(card);
    else needsDetails.push(card);
  }
  return {
    quadrants: matrixQuadrants.map(quadrant => {
      const cards = grouped.get(quadrant)!;
      return { quadrant, cards: cards.slice(0, boardLimit), overflowCount: Math.max(0, cards.length - boardLimit) };
    }),
    needsDetails,
  };
}

export interface HyperHubStatusDiffers {
  readonly evidenceId: string;
  readonly source: HyperHubSourceRef;
  readonly write: HyperHubWriteSource;
  readonly observedName: string;
  readonly category: HyperHubStatusCategory;
  readonly intent: Extract<HyperHubStatusIntent, { kind: 'state' }>;
}

export function hyperSelectStatusDiffers(snapshot: HyperHubSnapshot, task: HyperHubTaskView): readonly HyperHubStatusDiffers[] {
  const state = task.state;
  if (state !== 'ready' && state !== 'doing' && state !== 'done') return [];
  return task.sources.flatMap(source => {
    if (!source.statusWrite || (source.role !== 'origin' && source.role !== 'assignment')) return [];
    const write = source.kind === 'jira' ? 'jira' : source.kind === 'newsletter-task' ? 'newsletter' : undefined;
    if (!write || !snapshot.settings.writeBack?.[write].enabled) return [];
    const observed = task.sourceStatus[source.evidenceId];
    if (!observed?.rawStatus) return [];
    const mapped = hyperMapSourceStatus(write, write === 'jira' ? observed.category : observed.rawStatus);
    if (mapped.state === state || (mapped.category === 'unknown' && (write === 'jira' || observed.rawStatus !== 'delayed'))) return [];
    return [{ evidenceId: source.evidenceId, source, write, observedName: observed.rawStatus, category: mapped.category,
      intent: { kind: 'state', state } }];
  });
}

export interface HyperHubTimelineRange {
  readonly start: string; // owner-zone YYYY-MM-DD
  readonly days: 7 | 28;
}

export type HyperHubTimelineGroupBy = 'project' | 'source';

export interface HyperHubTimelineBar {
  readonly id: string;
  readonly kind: 'plan' | 'source';
  readonly interval: HyperHubInterval;
  readonly clipped: HyperHubInterval;
  readonly fixed: boolean;
  readonly provisional: boolean;
  readonly provenance?: HyperHubProvenance;
}

export interface HyperHubTimelineMarker {
  readonly kind: 'planned' | 'due';
  readonly date: HyperHubDate;
  readonly at: HyperHubInstant;
}

export interface HyperHubTimelineRow {
  readonly task: HyperHubTaskView;
  readonly bars: readonly HyperHubTimelineBar[];
  readonly markers: readonly HyperHubTimelineMarker[];
  readonly cycle: boolean;
  readonly hiddenPredecessorIds: readonly string[];
  readonly missingPredecessorIds: readonly string[];
}

export interface HyperHubTimelineEdge {
  readonly predecessorId: string;
  readonly successorId: string;
  readonly fromBarId: string;
  readonly toBarId: string;
  readonly from: HyperHubInstant;
  readonly to: HyperHubInstant;
}

export interface HyperHubTimeline {
  readonly interval: HyperHubInterval;
  readonly groups: readonly { key: string | null; rows: readonly HyperHubTimelineRow[] }[];
  readonly edges: readonly HyperHubTimelineEdge[];
  readonly undated: readonly HyperHubTimelineRow[];
  readonly outOfRangeCount: number;
}

const timelineInstant = (ms: number): HyperHubInstant => ({ kind: 'instant', iso: new Date(ms).toISOString() });

function civilMidnight(date: string, zone: string, offset = 0): number {
  const [year, month, day] = date.split('-').map(Number);
  return +new TZDate(year, month - 1, day + offset, zone);
}

function validTimelineInterval(interval: HyperHubInterval): boolean {
  return Date.parse(interval.start.iso) < Date.parse(interval.end.iso);
}

export function hyperSelectTimeline(
  snapshot: HyperHubSnapshot, range: HyperHubTimelineRange, groupBy: HyperHubTimelineGroupBy = 'project', filters?: HyperHubFilters,
): HyperHubTimeline {
  const zone = snapshot.settings.zone;
  const from = civilMidnight(range.start, zone);
  const until = civilMidnight(range.start, zone, range.days);
  const inRange = (ms: number) => ms >= from && ms < until;
  const graph = hyperBuildTaskGraph(snapshot.tasks, snapshot);
  const cycleIds = new Set(snapshot.cycleTaskIds);
  const blocks = new Map<string, HyperHubPlanBlock[]>();
  for (const block of snapshot.plan?.blocks ?? []) {
    if (!validTimelineInterval(block) || graph.heldTaskIds.has(block.taskId)) continue;
    if (!blocks.has(block.taskId)) blocks.set(block.taskId, []);
    blocks.get(block.taskId)!.push(block);
  }
  const byId = new Map<string, { row: HyperHubTimelineRow; first?: HyperHubTimelineBar; last?: HyperHubTimelineBar }>();
  const undated: HyperHubTimelineRow[] = [];
  let outOfRangeCount = 0;
  const tasks = [...hyperSelectTasks(snapshot, filters)].sort((a, b) => hyperCompareTaskIds(a.id, b.id));
  for (const task of tasks) {
    const bars: HyperHubTimelineBar[] = [];
    const plan = blocks.get(task.id) ?? [];
    plan.sort((a, b) => Date.parse(a.start.iso) - Date.parse(b.start.iso) || Date.parse(a.end.iso) - Date.parse(b.end.iso) ||
      Number(b.fixed) - Number(a.fixed) || Number(a.provisional) - Number(b.provisional));
    for (const [index, { start, end, fixed, provisional }] of plan.entries()) {
      const interval = { start, end };
      bars.push({ id: task.id + '/plan/' + index, kind: 'plan', interval, clipped: interval, fixed, provisional });
    }
    const schedule = task.schedule && validTimelineInterval(task.schedule) ? task.schedule : undefined;
    if (schedule) {
      const interval = { start: schedule.start, end: schedule.end };
      bars.push({ id: task.id + '/source', kind: 'source', interval, clipped: interval, fixed: false, provisional: false,
        provenance: schedule.provenance });
    }
    const markers: HyperHubTimelineMarker[] = [];
    for (const [kind, date] of [['planned', schedule ? undefined : task.planned], ['due', task.due]] as const) {
      if (!date) continue;
      const at = date.kind === 'instant' ? Date.parse(date.iso) : civilMidnight(date.date, zone);
      if (Number.isFinite(at)) markers.push({ kind, date, at: timelineInstant(at) });
    }
    const visibleBars = bars.flatMap(bar => {
      const start = Math.max(from, Date.parse(bar.interval.start.iso));
      const end = Math.min(until, Date.parse(bar.interval.end.iso));
      return start < end ? [{ ...bar, clipped: { start: timelineInstant(start), end: timelineInstant(end) } }] : [];
    });
    const visibleMarkers = markers.filter(marker => inRange(Date.parse(marker.at.iso)));
    const row: HyperHubTimelineRow = {
      task, bars: visibleBars, markers: visibleMarkers, cycle: cycleIds.has(task.id) || graph.cycles.has(task.id),
      hiddenPredecessorIds: [], missingPredecessorIds: [],
    };
    if (!bars.length && !markers.length) {
      undated.push(row);
    } else if (!visibleBars.length && !visibleMarkers.length) {
      outOfRangeCount++;
    } else {
      const first = bars[0];
      const last = bars[plan.length ? plan.length - 1 : 0];
      byId.set(task.id, { row, first: visibleBars.find(bar => bar.id === first?.id), last: visibleBars.find(bar => bar.id === last?.id) });
    }
  }

  const groups = new Map<string | null, HyperHubTimelineRow[]>();
  const edges: HyperHubTimelineEdge[] = [];
  const undatedIds = new Set(undated.map(row => row.task.id));
  function addPredecessorFacts(row: HyperHubTimelineRow, first?: HyperHubTimelineBar): HyperHubTimelineRow {
    const hiddenPredecessorIds: string[] = [];
    const missingPredecessorIds: string[] = [];
    const id = row.task.id;
    const component = graph.cycles.get(id);
    for (const predecessorId of [...(graph.predecessors.get(id) ?? [])].sort(hyperCompareTaskIds)) {
      if (!graph.byId.has(predecessorId)) {
        missingPredecessorIds.push(predecessorId);
        continue;
      }
      const predecessor = byId.get(predecessorId);
      if (!predecessor && !undatedIds.has(predecessorId)) hiddenPredecessorIds.push(predecessorId);
      const last = predecessor?.last;
      if (!last || !first || (component !== undefined && component === graph.cycles.get(predecessorId))) continue;
      const from = last.interval.end;
      const to = first.interval.start;
      if (inRange(Date.parse(from.iso)) && inRange(Date.parse(to.iso))) {
        edges.push({ predecessorId, successorId: id, fromBarId: last.id, toBarId: first.id, from, to });
      }
    }
    return { ...row, hiddenPredecessorIds, missingPredecessorIds };
  }
  for (const { row, first } of byId.values()) {
    const key = (groupBy === 'project' ? row.task.projectId : row.task.sources[0]?.kind) ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(addPredecessorFacts(row, first));
  }
  return {
    interval: { start: timelineInstant(from), end: timelineInstant(until) },
    groups: [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : hyperCompareTaskIds(a, b))
      .map(([key, rows]) => ({ key, rows })),
    edges, undated: undated.map(row => addPredecessorFacts(row)), outOfRangeCount,
  };
}

/** Count position changes among IDs common to both lists. Arrivals and removals do not count as moves. */
export function hyperSelectPendingOrder(
  displayedOrder: readonly string[],
  snapshot: HyperHubSnapshot,
  filters?: HyperHubFilters,
): HyperHubPendingOrder {
  const { order } = select(snapshot, filters);
  const incoming = new Set(order);
  const displayed = new Set(displayedOrder);
  const previousShared = displayedOrder.filter(id => incoming.has(id));
  const nextShared = order.filter(id => displayed.has(id));
  const movedCount = nextShared.reduce((count, id, index) => count + Number(id !== previousShared[index]), 0);
  return { order, movedCount };
}
