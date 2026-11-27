// Display helpers for HyperTaskHub views. Dates follow the contract: civil dates end at the next local
// midnight of their zone; instants are ISO with an offset.
import type { HyperHubCivilDate, HyperHubDate, HyperHubPriority, HyperHubTaskView } from '@shared/HyperTaskHub';

/** The civil date (YYYY-MM-DD) of an instant in a zone. */
export function hyperHubCivilDay(ms: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function hyperHubAddDays(day: string, days: number): string {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface HyperHubDueLabel { text: string; overdue: boolean; soon: boolean; title: string }

/** "Overdue · 26 Nov", "Today", "Today 17:00", "Tomorrow", "Wed 2 Dec". */
export function hyperHubDueLabel(due: HyperHubDate, nowMs: number, zone: string, locale?: string): HyperHubDueLabel {
  const today = hyperHubCivilDay(nowMs, zone), tomorrow = hyperHubAddDays(today, 1);
  if (due.kind === 'civil-date') {
    const day = due.date;
    const short = hyperHubShortDay(day, locale);
    const title = `Due ${short} (${(due as HyperHubCivilDate).zone})`;
    if (day < today) return { text: `Overdue · ${short}`, overdue: true, soon: false, title };
    if (day === today) return { text: 'Today', overdue: false, soon: true, title };
    if (day === tomorrow) return { text: 'Tomorrow', overdue: false, soon: true, title };
    return { text: short, overdue: false, soon: false, title };
  }
  const ms = Date.parse(due.iso), day = hyperHubCivilDay(ms, zone);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(ms);
  const title = `Due ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(ms)}`;
  if (ms < nowMs) return { text: `Overdue · ${day === today ? time : hyperHubShortDay(day, locale)}`, overdue: true, soon: false, title };
  if (day === today) return { text: `Today ${time}`, overdue: false, soon: true, title };
  if (day === tomorrow) return { text: `Tomorrow ${time}`, overdue: false, soon: true, title };
  return { text: hyperHubShortDay(day, locale), overdue: false, soon: false, title };
}

function hyperHubShortDay(day: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function hyperHubRelative(iso: string | null | undefined, nowMs: number, locale?: string): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.parse(iso) - nowMs) / 1000);
  if (!Number.isFinite(seconds)) return 'unknown';
  if (Math.abs(seconds) < 45) return 'just now';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

/** "45 min", "1 h 30 min"; estimates get a leading "~" and "(estimate)" in the title. */
export function hyperHubEffortLabel(task: Pick<HyperHubTaskView, 'effortMinutes' | 'effortIsEstimate'>): { text: string; title: string } {
  const minutes = Math.max(0, Math.round(task.effortMinutes));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const text = hours ? (rest ? `${hours} h ${rest} min` : `${hours} h`) : `${rest} min`;
  return task.effortIsEstimate ? { text: `~${text}`, title: `~${text} (estimate)` } : { text, title: text };
}

export const hyperHubPriorityTier: Record<HyperHubPriority, { label: string; variant: 'destructive-light' | 'warning-light' | 'info-light' | 'secondary' }> = {
  3: { label: 'P1', variant: 'destructive-light' },
  2: { label: 'P2', variant: 'warning-light' },
  1: { label: 'P3', variant: 'info-light' },
  0: { label: 'P4', variant: 'secondary' },
};

/** The owner's priority wins; a mapped source priority is shown with its origin. */
export function hyperHubPriorityOf(task: HyperHubTaskView): { priority: HyperHubPriority; origin: 'owner' | 'source' } | null {
  if (task.ownerPriority !== undefined) return { priority: task.ownerPriority, origin: 'owner' };
  if (task.sourcePriority?.mapped !== undefined) return { priority: task.sourcePriority.mapped, origin: 'source' };
  return null;
}

/** Next working day at 09:00 local time, as an ISO instant (snooze target). */
export function hyperHubNextWorkdayMorning(nowMs: number, workdays: readonly number[]): string {
  const date = new Date(nowMs);
  for (let step = 1; step <= 7; step++) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + step, 9, 0, 0, 0);
    if (!workdays.length || workdays.includes(next.getDay())) return next.toISOString();
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 9).toISOString();
}

export function hyperHubInDays(nowMs: number, days: number): string {
  const date = new Date(nowMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 9, 0, 0, 0).toISOString();
}

const hyperNewsletterStatusNames: Record<string, string> = { pending: 'Pending', 'in-progress': 'In progress', completed: 'Completed', delayed: 'Delayed' };

/** A source status as people read it: Newsletter's enum values get labels; Jira names are already readable. */
export function hyperHubStatusName(kind: string, raw: string): string {
  return kind === 'newsletter' || kind === 'newsletter-task' ? hyperNewsletterStatusNames[raw] ?? raw : raw;
}

/** A source version for the write-back preview: a timestamp reads as "Updated 5 min ago". */
export function hyperHubVersionText(label: string, nowMs: number): string {
  const at = Date.parse(label);
  return /^\d{4}-\d{2}-\d{2}T/.test(label) && Number.isFinite(at) ? `Updated ${hyperHubRelative(label, nowMs)}` : label;
}
