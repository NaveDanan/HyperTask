import { TZDate } from '@date-fns/tz';
import type {
  HyperHubAgendaItem, HyperHubDate, HyperHubDay, HyperHubFacts, HyperHubFeasibility, HyperHubInstant, HyperHubPlacementReason,
  HyperHubPlan, HyperHubPlanBlock, HyperHubRanked, HyperHubTaskView, HyperHubUnscheduled, HyperHubWriteView,
} from './HyperTaskHub';

const minute = 60_000;
const staleAfterMs = 30 * minute;
const estimateMinutes = 45;

/** Civil interval endpoints are local midnights. The end endpoint is exclusive. */
export interface HyperHubAvailabilityInterval {
  start: HyperHubDate;
  end: HyperHubDate;
}

export interface HyperHubAvailability {
  zone: string;
  workdays: readonly number[]; // Sunday = 0
  hours: { start: string; end: string }; // HH:mm in the owner's zone
  breaks?: readonly { start: string; end: string }[];
  daysOff?: readonly string[];
  ownerWindows?: readonly HyperHubAvailabilityInterval[];
  /** Include every enabled availability source, even if it has no complete reads yet. */
  sources?: readonly {
    /** Only still-authorized complete reads belong here. Keep one per covered interval. */
    complete: readonly {
      interval: HyperHubAvailabilityInterval;
      asOf: HyperHubInstant;
      newerRefreshPartial?: boolean;
    }[];
    /** Include known busy intervals from partial reads too. IDs require accessible meeting details. */
    busy: readonly (HyperHubAvailabilityInterval & {
      status: 'busy' | 'tentative' | 'out-of-office' | 'reservation' | 'free' | 'working-elsewhere' | 'declined' | 'cancelled';
      meetingId?: string;
    })[];
  }[];
}

type AvailabilitySource = NonNullable<HyperHubAvailability['sources']>[number];

export interface HyperHubAvailabilityParts extends Omit<HyperHubAvailability, 'sources'> {
  /** One entry per enabled source, even when a source has no complete reads. */
  sources: readonly {
    complete: AvailabilitySource['complete'];
    agenda: readonly HyperHubAgendaItem[];
  }[];
}

function agendaBusy(agenda: readonly HyperHubAgendaItem[]): AvailabilitySource['busy'] {
  return agenda.flatMap<AvailabilitySource['busy'][number]>(event => {
    if (event.sourceKind === 'hypertask') {
      const { start, end } = rangeOf(event.interval);
      return !event.allDay && start < end ? [{ ...event.interval, status: 'reservation' }] : [];
    }
    const status = event.availability === 'oof' ? 'out-of-office' : event.availability;
    if (status === 'free' || status === 'working-elsewhere') return [];
    return [{ ...event.interval, status, ...(!event.private && event.isMeeting && { meetingId: event.id }) }];
  });
}

/** Converts authorized source reads and occurrences into the shared ranking and planning input. */
export function hyperHubAvailabilityFromSnapshotParts(
  { sources, ...settings }: HyperHubAvailabilityParts,
): HyperHubAvailability {
  return { ...settings, sources: sources.map(({ complete, agenda }) => ({ complete, busy: agendaBusy(agenda) })) };
}

export interface HyperHubHoldInput {
  writes?: readonly HyperHubWriteView[];
}

export function hyperPlanningHeldTaskIds(writes: HyperHubHoldInput['writes']): ReadonlySet<string> {
  return new Set(writes?.filter(write => write.held && !write.ownerReleasedAt).map(write => write.taskId));
}

export interface HyperHubPlanInput extends HyperHubHoldInput {
  nowMs: number;
  tasks: readonly HyperHubTaskView[];
  ranking: readonly HyperHubRanked[];
  availability?: HyperHubAvailability;
}

interface Range { start: number; end: number }
interface Deadline { ms: number; date: HyperHubDate; evidenceId?: string }
interface Reservation extends Range { taskId: string }
interface Fit { range: Range; gap: Range; fixed?: true }
interface DayAvailability { work: Range[]; covered: Range[]; free: Range[]; freeIgnoringCoverage: Range[] }

export function hyperCompareTaskIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function hyperCompareManualOrder(a: HyperHubTaskView, b: HyperHubTaskView): number {
  const byPin = Number(b.pinned) - Number(a.pinned);
  return byPin || ((a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity)) || 0;
}

export function hyperCompareFocusOrder(
  a: HyperHubTaskView,
  b: HyperHubTaskView,
  rankPositions: ReadonlyMap<string, number>,
): number {
  return hyperCompareManualOrder(a, b) ||
    ((rankPositions.get(a.id) ?? Infinity) - (rankPositions.get(b.id) ?? Infinity)) ||
    hyperCompareTaskIds(a.id, b.id);
}

function instant(ms: number): HyperHubInstant {
  return { kind: 'instant', iso: new Date(ms).toISOString() };
}

function dateMs(date: HyperHubDate, endOfCivilDay = false): number {
  if (date.kind === 'instant') return Date.parse(date.iso);
  const [year, month, day] = date.date.split('-').map(Number);
  return +new TZDate(year, month - 1, day + Number(endOfCivilDay), date.zone);
}

export function hyperTaskDeadline(task: HyperHubTaskView): Deadline | undefined {
  let earliest: Deadline | undefined;
  for (const field of ['due', 'prepDeadline'] as const) {
    const date = task[field];
    const origin = task.fieldOrigins?.[field];
    if (!date) continue;
    if (task.state === 'review' && task.reviewSpan && origin?.kind !== 'owner' &&
      (origin === undefined || origin.evidenceId === task.reviewSpan.evidenceId)) continue;
    const ms = dateMs(date, true);
    if (!Number.isFinite(ms) || (earliest && earliest.ms <= ms)) continue;
    earliest = { ms, date, evidenceId: origin?.kind === 'source' ? origin.evidenceId : undefined };
  }
  return earliest;
}

function releaseMs(task: HyperHubTaskView): number {
  return Math.max(task.release ? dateMs(task.release) : -Infinity, task.snoozeUntil ? dateMs(task.snoozeUntil) : -Infinity);
}

export function hyperTaskHasKnownEffort(task: HyperHubTaskView): boolean {
  return !task.effortIsEstimate && Number.isFinite(task.effortMinutes) && task.effortMinutes > 0;
}

export function hyperTaskPlanningEffort(task: HyperHubTaskView): number {
  return hyperTaskHasKnownEffort(task) ? task.effortMinutes : estimateMinutes;
}

export function hyperTaskIsPlanCandidate(task: HyperHubTaskView): boolean {
  return (task.state === 'ready' || task.state === 'doing') && task.authoritativeCompletion !== 'complete';
}

function rangeOf(interval: HyperHubAvailabilityInterval): Range {
  return { start: dateMs(interval.start), end: dateMs(interval.end) };
}

function compareRanges(a: Range, b: Range): number {
  return a.start - b.start || a.end - b.end;
}

function union(ranges: readonly Range[]): Range[] {
  const merged: Range[] = [];
  for (const { start, end } of ranges.filter(range => range.start < range.end).sort(compareRanges)) {
    const last = merged.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

function intersect(a: readonly Range[], b: readonly Range[]): Range[] {
  const result: Range[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) result.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return result;
}

function subtract(ranges: readonly Range[], cuts: readonly Range[]): Range[] {
  const result: Range[] = [];
  let i = 0;
  for (const range of ranges) {
    let start = range.start;
    while (i < cuts.length && cuts[i].end <= start) i++;
    while (i < cuts.length && cuts[i].start < range.end) {
      if (start < cuts[i].start) result.push({ start, end: cuts[i].start });
      start = Math.max(start, cuts[i].end);
      if (start >= range.end) break;
      i++;
    }
    if (start < range.end) result.push({ start, end: range.end });
  }
  return result;
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

function contains(ranges: readonly Range[], interval: Range): boolean {
  return ranges.some(range => range.start <= interval.start && range.end >= interval.end);
}

export function hyperHubDayBounds(ms: number, zone: string): Range {
  const date = new TZDate(ms, zone);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return { start: +new TZDate(year, month, day, zone), end: +new TZDate(year, month, day + 1, zone) };
}

function reservationsFor(tasks: readonly HyperHubTaskView[], heldTaskIds?: ReadonlySet<string>): Reservation[] {
  return tasks.filter(task => hyperTaskIsPlanCandidate(task) || heldTaskIds?.has(task.id))
    .flatMap(task => (task.fixedBlocks ?? []).map(interval => ({ ...rangeOf(interval), taskId: task.id })))
    .filter(range => range.start < range.end)
    .sort((a, b) => compareRanges(a, b) || hyperCompareTaskIds(a.taskId, b.taskId));
}

/** Prepares the same coverage and work-window rules for slack and both planning passes. */
export function hyperResolveAvailability(nowMs: number, availability?: HyperHubAvailability) {
  const zone = availability?.zone ?? 'UTC';
  const dayEnd = hyperHubDayBounds(nowMs, zone).end;
  const sources = availability?.sources ?? [];
  const busyEvents = sources.flatMap(source => source.busy
    .filter(event => event.status === 'busy' || event.status === 'tentative' ||
      event.status === 'out-of-office' || event.status === 'reservation')
    .map(event => ({ ...rangeOf(event), meetingId: event.meetingId })));
  const busy = union(busyEvents);
  const meetingsByStart = new Map<number, string>();
  for (const { start, end, meetingId } of busyEvents) {
    const existing = meetingsByStart.get(start);
    if (start < end && meetingId && (!existing || hyperCompareTaskIds(meetingId, existing) < 0)) {
      meetingsByStart.set(start, meetingId);
    }
  }

  // Complete coverage is the intersection of the enabled sources. With no source, use explicit owner windows.
  let complete: Range[] = [];
  let fresh: Range[] = [];
  sources.forEach((source, index) => {
    const ranges = source.complete.map(read => ({
      range: rangeOf(read.interval),
      fresh: !read.newerRefreshPartial && nowMs - dateMs(read.asOf) <= staleAfterMs,
    }));
    const sourceComplete = union(ranges.map(read => read.range));
    const sourceFresh = union(ranges.filter(read => read.fresh).map(read => read.range));
    complete = index === 0 ? sourceComplete : intersect(complete, sourceComplete);
    fresh = index === 0 ? sourceFresh : intersect(fresh, sourceFresh);
  });
  const owner = union((availability?.ownerWindows ?? []).map(rangeOf));
  const covered = union([...complete, ...owner]);
  const ownerOnly = subtract(owner, complete);
  const stale = subtract(complete, fresh);

  const days = new Map<number, DayAvailability>();
  function day(ms: number): DayAvailability {
    const date = new TZDate(ms, zone);
    const year = date.getFullYear();
    const month = date.getMonth();
    const dayOfMonth = date.getDate();
    const midnight = +new TZDate(year, month, dayOfMonth, zone);
    const cached = days.get(midnight);
    if (cached) return cached;

    const workDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
    let work: Range[] = [];
    if (availability?.workdays.includes(date.getDay()) && !availability.daysOff?.includes(workDate)) {
      const time = (hhmm: string) => {
        const [hours, minutes] = hhmm.split(':').map(Number);
        return +new TZDate(year, month, dayOfMonth, hours, minutes, zone);
      };
      const start = Math.max(nowMs, time(availability.hours.start));
      const end = time(availability.hours.end);
      const breaks = union((availability.breaks ?? []).map(value => ({ start: time(value.start), end: time(value.end) })));
      if (start < end) work = subtract([{ start, end }], breaks);
    }
    const coveredWork = intersect(work, covered);
    const result = {
      work, covered: coveredWork,
      free: subtract(coveredWork, busy),
      freeIgnoringCoverage: subtract(work, busy),
    };
    days.set(midnight, result);
    return result;
  }

  function slackBefore(tasks: readonly HyperHubTaskView[], heldTaskIds?: ReadonlySet<string>) {
    const fixed = union(reservationsFor(tasks, heldTaskIds));
    const cache = new Map<number, { freeMinutes: number; provisional: boolean } | undefined>();
    return (deadlineMs: number) => {
      if (!availability) return undefined;
      if (cache.has(deadlineMs)) return cache.get(deadlineMs);
      let freeMs = 0;
      let provisional = false;
      for (let ms = nowMs; ms < deadlineMs; ms = hyperHubDayBounds(ms, zone).end) {
        const today = day(ms);
        const untilDue = [{ start: ms, end: deadlineMs }];
        const work = intersect(today.work, untilDue);
        if (work.some(window => !contains(today.covered, window))) {
          cache.set(deadlineMs, undefined);
          return undefined;
        }
        provisional ||= work.some(window => ownerOnly.some(range => overlaps(range, window)) || stale.some(range => overlaps(range, window)));
        for (const window of subtract(intersect(today.free, untilDue), fixed)) freeMs += window.end - window.start;
      }
      const result = { freeMinutes: freeMs / minute, provisional };
      cache.set(deadlineMs, result);
      return result;
    };
  }

  return { dayEnd, day, fresh, ownerOnly, stale, meetingsByStart, slackBefore };
}

/** Projects the planner's combined coverage and working intervals for the renderer. */
export function hyperHubProjectAvailabilityDay(nowMs: number, availability: HyperHubAvailability): HyperHubDay {
  const { zone } = availability;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nowMs);
  const resolved = hyperResolveAvailability(nowMs, availability);
  const { work, covered } = resolved.day(nowMs);
  const asInterval = ({ start, end }: Range) => ({ start: instant(start), end: instant(end) });
  const basisRanges: [HyperHubDay['coverage'][number]['basis'], Range[]][] = [
    ['complete', intersect(work, resolved.fresh)],
    ['stale-complete', intersect(work, resolved.stale)],
    ['owner', intersect(work, resolved.ownerOnly)],
    ['missing', subtract(work, covered)],
  ];
  const owner = union((availability.ownerWindows ?? []).map(rangeOf));
  return {
    date: { kind: 'civil-date', date, zone },
    working: work.map(asInterval),
    coverage: basisRanges.flatMap(([basis, ranges]) => ranges.map(range => ({ basis, range })))
      .sort((a, b) => compareRanges(a.range, b.range))
      .map(({ basis, range }) => ({ basis, interval: asInterval(range) })),
    ownerWindows: intersect([hyperHubDayBounds(nowMs, zone)], owner).map(asInterval),
  };
}

/** Capacity includes valid fixed blocks as planned time and accounts for other fixed reservations as busy. */
export function hyperHubDayCapacity(
  nowMs: number,
  day: HyperHubDay,
  agenda: readonly HyperHubAgendaItem[],
  tasks: readonly HyperHubTaskView[],
  blocks: readonly HyperHubPlanBlock[],
  heldTaskIds?: ReadonlySet<string>,
) {
  const { end } = hyperHubDayBounds(nowMs, day.date.zone);
  const work = intersect(union(day.working.map(rangeOf)), [{ start: nowMs, end }]);
  const covered = intersect(work, union(day.coverage.filter(read => read.basis !== 'missing').map(read => rangeOf(read.interval))));
  const fresh = union(day.coverage.filter(read => read.basis === 'complete').map(read => rangeOf(read.interval)));
  const needsOwnerWindow = subtract(work, covered).length > 0;
  let coverage: 'complete' | 'provisional' | 'missing' = 'complete';
  if (needsOwnerWindow && covered.length === 0) coverage = 'missing';
  else if (needsOwnerWindow || subtract(covered, fresh).length > 0) coverage = 'provisional';
  const placedFixed = union(blocks.filter(block => block.fixed && !heldTaskIds?.has(block.taskId)).map(rangeOf));
  const unplacedFixed = subtract(union(reservationsFor(tasks, heldTaskIds)), placedFixed);
  const busy = union([...agendaBusy(agenda).map(rangeOf), ...unplacedFixed]);
  const freeMinutes = subtract(covered, busy).reduce((total, range) => total + (range.end - range.start), 0) / minute;
  return { coverage, needsOwnerWindow, freeMinutes } as const;
}

export function hyperBuildTaskGraph(tasks: readonly HyperHubTaskView[], { writes }: HyperHubHoldInput = {}) {
  const heldTaskIds = hyperPlanningHeldTaskIds(writes);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  const isComplete = (id: string) => !heldTaskIds.has(id) && byId.get(id)?.authoritativeCompletion === 'complete';
  for (const task of tasks) {
    for (const edge of [...task.blockedBy, ...task.blocks]) {
      const { predecessorId, successorId } = edge;
      if (!edge.verified || edge.resolvedByOwner || !byId.has(successorId) ||
        isComplete(predecessorId) || isComplete(successorId)) continue;
      if (!predecessors.has(successorId)) predecessors.set(successorId, new Set());
      if (!successors.has(predecessorId)) successors.set(predecessorId, new Set());
      predecessors.get(successorId)!.add(predecessorId);
      successors.get(predecessorId)!.add(successorId);
    }
  }

  // Finishing order followed by a walk of the reversed edges identifies actual cycle members,
  // including self-dependencies. A task downstream of a cycle still has a waiting blocker.
  const finished: string[] = [];
  const visited = new Set<string>();
  for (const id of byId.keys()) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, edges: (successors.get(id) ?? []).values() }];
    while (stack.length) {
      const current = stack[stack.length - 1];
      const next = current.edges.next();
      if (next.done) {
        finished.push(current.id);
        stack.pop();
      } else if (!visited.has(next.value)) {
        visited.add(next.value);
        stack.push({ id: next.value, edges: (successors.get(next.value) ?? []).values() });
      }
    }
  }
  const cycles = new Map<string, string>();
  visited.clear();
  for (let i = finished.length - 1; i >= 0; i--) {
    const id = finished[i];
    if (visited.has(id)) continue;
    const component = [id];
    visited.add(id);
    for (const member of component) {
      for (const parent of predecessors.get(member) ?? []) {
        if (!byId.has(parent) || visited.has(parent)) continue;
        component.push(parent);
        visited.add(parent);
      }
    }
    if (component.length > 1 || successors.get(id)?.has(id)) {
      const cycleIds = component.sort(hyperCompareTaskIds).join(', ');
      for (const member of component) cycles.set(member, cycleIds);
    }
  }
  return { byId, predecessors, successors, cycles, finished, heldTaskIds };
}

type TaskGraph = ReturnType<typeof hyperBuildTaskGraph>;

function predecessorFacts(graph: TaskGraph, ids: Iterable<string>): HyperHubFacts {
  const parents = [...ids].sort(hyperCompareTaskIds);
  const missing = parents.filter(id => !graph.byId.has(id));
  return {
    predecessorId: parents[0],
    predecessorIds: parents.join(', '),
    ...(missing.length > 0 && { missingPredecessorIds: missing.join(', ') }),
  };
}

export function hyperTaskFeasibility(task: HyperHubTaskView, graph: TaskGraph, nowMs: number): HyperHubFeasibility {
  if (graph.heldTaskIds.has(task.id)) return { ready: false, code: 'waiting', facts: { held: 1 } };
  if (!hyperTaskIsPlanCandidate(task)) {
    return { ready: false, code: 'waiting', facts: { state: task.state, completion: task.authoritativeCompletion } };
  }
  const cycleIds = graph.cycles.get(task.id);
  if (cycleIds) return { ready: false, code: 'cycle', facts: { cycleIds } };
  const parents = graph.predecessors.get(task.id);
  if (parents?.size) return { ready: false, code: 'waiting', facts: predecessorFacts(graph, parents) };
  const release = releaseMs(task);
  if (release > nowMs) return { ready: false, code: 'waiting', facts: { until: instant(release).iso } };
  return { ready: true };
}

function findFits(windows: readonly Range[], after: number, duration: number, chunkSize: number): Fit[] {
  let remaining = duration;
  const fits: Fit[] = [];
  for (const gap of windows) {
    let start = Math.max(gap.start, after);
    while (remaining > 0) {
      const chunk = Math.min(remaining, chunkSize);
      const end = start + chunk;
      if (end > gap.end || end <= start) break;
      fits.push({ range: { start, end }, gap });
      start = end;
      remaining -= chunk;
    }
    if (remaining <= 0) return fits;
  }
  return [];
}

function effectiveDeadlines(graph: TaskGraph, deadlines: ReadonlyMap<string, Deadline | undefined>) {
  const effective = new Map<string, number>();
  for (const id of graph.finished) {
    let due = deadlines.get(id)?.ms ?? Infinity;
    if (!graph.cycles.has(id)) {
      for (const successorId of graph.successors.get(id) ?? []) {
        if (graph.cycles.has(successorId)) continue;
        const successor = graph.byId.get(successorId)!;
        due = Math.min(due, (effective.get(successorId) ?? Infinity) - hyperTaskPlanningEffort(successor) * minute);
      }
    }
    effective.set(id, due);
  }
  return effective;
}

function fixedFacts(ranges: readonly Reservation[]): HyperHubFacts {
  return {
    fixedStart: instant(ranges[0].start).iso,
    fixedEnd: instant(ranges.reduce((end, range) => Math.max(end, range.end), ranges[0].end)).iso,
    fixedBlockCount: ranges.length,
  };
}

/** Computes both greedy passes and chooses by the two integer objectives. */
export function hyperPlanDay(input: HyperHubPlanInput): HyperHubPlan {
  const result = hyperEvaluatePlanPasses(input);
  const [score, due] = [result['score-first'], result['due-first']];
  return due.onTime > score.onTime || (due.onTime === score.onTime && due.total > score.total) ? due.plan : score.plan;
}

/** Makes the two objective values and individual pass timings available for acceptance tests and benchmarks. */
export function hyperEvaluatePlanPasses(input: HyperHubPlanInput, measure?: (pass: HyperHubPlan['pass'], run: () => void) => void) {
  const { tasks, nowMs, availability } = input;
  const coverage = hyperResolveAvailability(nowMs, availability);
  const today = coverage.day(nowMs);
  const graph = hyperBuildTaskGraph(tasks, input);
  const reservations = reservationsFor(tasks, graph.heldTaskIds).filter(range => range.end > nowMs && range.start < coverage.dayEnd);
  const fixedById = new Map<string, Reservation[]>();
  const overlapsFixed = new Set<Reservation>();
  let active: Reservation | undefined;
  for (const reservation of reservations) {
    if (!fixedById.has(reservation.taskId)) fixedById.set(reservation.taskId, []);
    fixedById.get(reservation.taskId)!.push(reservation);
    if (active && overlaps(active, reservation)) {
      overlapsFixed.add(active);
      overlapsFixed.add(reservation);
    }
    if (!active || reservation.end > active.end) active = reservation;
  }
  const reserved = union(reservations);
  const initialFree = subtract(today.free, reserved);
  const initialFreeIgnoringCoverage = subtract(today.freeIgnoringCoverage, reserved);
  const deadlines = new Map(tasks.map(task => [task.id, hyperTaskDeadline(task)]));
  const scores = new Map(input.ranking.map(rank => [rank.taskId, rank.scoreCents]));
  const eligible = tasks.filter(task => hyperTaskIsPlanCandidate(task) && !graph.heldTaskIds.has(task.id));
  const eligibleById = new Map(eligible.map(task => [task.id, task]));

  const score = (id: string) => scores.get(id) ?? 0;
  function run(pass: HyperHubPlan['pass']) {
    const effective = pass === 'due-first' ? effectiveDeadlines(graph, deadlines) : undefined;
    const compare = (a: HyperHubTaskView, b: HyperHubTaskView) => hyperCompareManualOrder(a, b) ||
      (effective ? effective.get(a.id)! - effective.get(b.id)! : score(b.id) - score(a.id)) ||
      ((deadlines.get(a.id)?.ms ?? Infinity) - (deadlines.get(b.id)?.ms ?? Infinity)) ||
      hyperCompareTaskIds(a.id, b.id);
    const pendingParents = new Map(eligible.map(task => [task.id, graph.predecessors.get(task.id)?.size ?? 0]));
    const queue = eligible.filter(task => pendingParents.get(task.id) === 0 && !graph.cycles.has(task.id)).sort(compare);
    const finishes = new Map<string, number>();
    const blocks: HyperHubPlanBlock[] = [];
    const blocked = new Map<string, HyperHubUnscheduled>();
    let free = initialFree;
    let freeIgnoringCoverage = initialFreeIgnoringCoverage;
    let onTime = 0;
    let total = 0;

    function enqueue(task: HyperHubTaskView) {
      let start = 0;
      let end = queue.length;
      while (start < end) {
        const mid = (start + end) >>> 1;
        if (compare(task, queue[mid]) < 0) end = mid;
        else start = mid + 1;
      }
      queue.splice(start, 0, task);
    }

    function reject(taskId: string, code: HyperHubUnscheduled['code'], facts: HyperHubFacts) {
      blocked.set(taskId, { taskId, code, facts });
    }

    for (let task = queue.shift(); task; task = queue.shift()) {
      const id = task.id;
      const fixed = fixedById.get(id);
      const parents = graph.predecessors.get(id);
      let after = Math.max(nowMs, releaseMs(task));
      if (parents) for (const parent of parents) after = Math.max(after, finishes.get(parent)!);
      const effort = hyperTaskPlanningEffort(task);
      const estimated = !hyperTaskHasKnownEffort(task);
      const chunk = task.chunkMinutes;
      const chunkMs = chunk !== undefined && Number.isFinite(chunk) && chunk > 0
        ? Math.max(1, Math.round(chunk * minute)) : Infinity;
      const duration = Math.max(1, Math.round(effort * minute));
      let fits: Fit[] = [];

      if (fixed) {
        if ((fixed.length > 1 && chunkMs === Infinity) ||
          fixed.some(range => range.start < after || overlapsFixed.has(range) || !contains(today.freeIgnoringCoverage, range))) {
          reject(id, 'fixed-conflict', {
            ...fixedFacts(fixed),
            ...(parents && predecessorFacts(graph, parents)),
            ...(after > nowMs && { earliestStart: instant(after).iso }),
          });
          continue;
        }
        if (fixed.some(range => !contains(today.free, range))) {
          reject(id, 'no-coverage', fixedFacts(fixed));
          continue;
        }
        fits = fixed.map(range => ({ range, gap: range, fixed: true }));
      }

      // A fixed reservation anchors a contiguous task. For split tasks it can reserve just some of the effort.
      const reservedMs = fixed?.reduce((ms, range) => ms + range.end - range.start, 0) ?? 0;
      const remaining = fixed && chunkMs === Infinity ? 0 : duration - reservedMs;
      if (remaining > 0) {
        const extra = findFits(free, after, remaining, chunkMs);
        if (extra.length === 0) {
          const missingCoverage = !availability || findFits(freeIgnoringCoverage, after, remaining, chunkMs).length > 0;
          reject(id, missingCoverage ? 'no-coverage' : 'no-window', {
            effortMinutes: effort,
            ...(estimated && { estimateMinutes: effort }),
            ...(after > nowMs && { earliestStart: instant(after).iso }),
            ...(fixed && fixedFacts(fixed)),
          });
          continue;
        }
        const allocated = extra.map(fit => fit.range);
        free = subtract(free, allocated);
        freeIgnoringCoverage = subtract(freeIgnoringCoverage, allocated);
        fits = fixed ? [...fits, ...extra].sort((a, b) => compareRanges(a.range, b.range)) : extra;
      }

      const finish = fits[fits.length - 1].range.end;
      const deadline = deadlines.get(id);
      const readiness = hyperTaskFeasibility(task, graph, nowMs);
      for (const { range, gap, fixed: isFixed } of fits) {
        const { start, end } = range;
        const meetingId = !isFixed ? coverage.meetingsByStart.get(gap.end) : undefined;
        const facts: HyperHubFacts = {
          minutes: (end - start) / minute,
          gapStart: instant(Math.max(gap.start, after)).iso,
          gapEnd: instant(gap.end).iso,
          ...(estimated && { estimateMinutes: effort }),
        };
        const reasons: HyperHubPlacementReason[] = [{
          code: isFixed ? 'fixed-block' : meetingId ? 'fits-before-meeting' : 'earliest-fit',
          facts: meetingId ? { ...facts, meetingId } : facts,
        }];
        if (parents?.size) reasons.push({ code: 'after-predecessor', facts: predecessorFacts(graph, parents) });
        if (!readiness.ready) reasons.push({ code: readiness.code, facts: readiness.facts });
        if (deadline && finish > deadline.ms) {
          reasons.push({ code: 'late', facts: { deadline: instant(deadline.ms).iso, lateMinutes: (finish - deadline.ms) / minute } });
        }
        const usesOwner = coverage.ownerOnly.some(window => overlaps(window, range));
        const usesStale = coverage.stale.some(window => overlaps(window, range));
        if (usesOwner) reasons.push({ code: 'owner-availability', facts: {} });
        if (usesStale) reasons.push({ code: 'stale-coverage', facts: {} });
        blocks.push({ taskId: id, start: instant(start), end: instant(end), fixed: !!isFixed, provisional: estimated || usesOwner || usesStale, reasons });
      }

      finishes.set(id, finish);
      const value = 100 + score(id);
      total += value;
      if (deadline && deadline.ms >= nowMs && finish <= deadline.ms &&
        (deadline.ms < coverage.dayEnd || (deadline.ms === coverage.dayEnd && deadline.date.kind === 'civil-date'))) {
        onTime += value;
      }
      for (const successor of graph.successors.get(id) ?? []) {
        const candidate = eligibleById.get(successor);
        if (!candidate || graph.cycles.has(successor)) continue;
        const remaining = pendingParents.get(successor)! - 1;
        pendingParents.set(successor, remaining);
        if (remaining === 0) enqueue(candidate);
      }
    }

    for (const { id } of eligible) {
      if (finishes.has(id) || blocked.has(id)) continue;
      const cycleIds = graph.cycles.get(id);
      const parents = [...(graph.predecessors.get(id) ?? [])].filter(parent => !finishes.has(parent));
      const fixed = fixedById.get(id);
      const facts = parents.length ? predecessorFacts(graph, parents) : {};
      if (fixed) reject(id, 'fixed-conflict', { ...fixedFacts(fixed), ...facts, ...(cycleIds && { cycleIds }) });
      else if (cycleIds) reject(id, 'cycle', { cycleIds });
      else reject(id, 'waiting', facts);
    }
    // Personal Waiting uses no capacity, but is an explicit blocker rather than a failed fit.
    for (const task of tasks) {
      if (graph.heldTaskIds.has(task.id)) {
        reject(task.id, 'waiting', { held: 1 });
      } else if (task.state === 'waiting' && task.authoritativeCompletion !== 'complete') {
        reject(task.id, 'waiting', { state: task.state });
      }
    }
    blocks.sort((a, b) => dateMs(a.start) - dateMs(b.start) || hyperCompareTaskIds(a.taskId, b.taskId));
    const first = blocks.find(block => hyperTaskFeasibility(graph.byId.get(block.taskId)!, graph, nowMs).ready);
    const plan: HyperHubPlan = {
      pass, blocks,
      unscheduled: [...blocked.values()].sort((a, b) => hyperCompareTaskIds(a.taskId, b.taskId)),
      provisional: blocks.some(block => block.provisional),
    };
    if (first) {
      plan.recommendation = {
        kind: dateMs(first.start) === nowMs ? 'start-now' : 'start-later',
        taskId: first.taskId, start: first.start, reasons: first.reasons,
      };
    }
    return { plan, onTime, total };
  }

  function measured(pass: HyperHubPlan['pass']) {
    if (!measure) return run(pass);
    let result: ReturnType<typeof run> | undefined;
    measure(pass, () => { result = run(pass); });
    return result!;
  }
  return { 'score-first': measured('score-first'), 'due-first': measured('due-first') };
}
