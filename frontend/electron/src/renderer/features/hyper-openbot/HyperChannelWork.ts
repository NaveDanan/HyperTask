// Adapted from OpenBot channels/routes announceWork and channel-chat rosterSaysWorking.
// Copyright (c) 2026 CopilotKit. MIT.
export interface HyperChannelWorkHint { busy?: boolean; work?: readonly unknown[]; workAt?: string }
function hyperWorkClock(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return;
  // PostgreSQL emits six fractional digits. Date.parse alone truncates them
  // to milliseconds and can accept an older empty list within the same ms.
  return `${parts[1]}.${(parts[2] ?? '').padEnd(6, '0')}Z`;
}
export function hyperUpdateChannelWork(previous: HyperChannelWorkHint | undefined, event: { busy?: boolean; work?: unknown; workAt?: unknown }): HyperChannelWorkHint {
  const next = { ...previous };
  if (typeof event.busy === 'boolean') next.busy = event.busy;
  if (Array.isArray(event.work)) {
    const before = hyperWorkClock(previous?.workAt), after = hyperWorkClock(event.workAt);
    // The list uses the database clock, not arrival order. Missing/older stamps
    // cannot clear or resurrect a previously stamped authoritative work list.
    if (before === undefined || after !== undefined && after >= before) {
      next.work = [...event.work];
      if (typeof event.workAt === 'string' && after !== undefined) next.workAt = event.workAt;
    }
  }
  return next;
}
export function hyperChannelHasWork(hint: HyperChannelWorkHint | undefined): boolean {
  return hint?.busy === true || Array.isArray(hint?.work) && hint.work.length > 0;
}
