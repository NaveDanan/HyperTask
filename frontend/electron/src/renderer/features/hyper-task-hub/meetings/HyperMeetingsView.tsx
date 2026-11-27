// Meetings (M5 E2): the next seven days in the owner's zone, grouped by day, each meeting with its prep
// readiness, Viewed, and related open work. Every row opens the same brief sheet as Focus and HyperHome.
// Private, confidential and unclassified items show only as Busy.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarClock, Eye, Lock, TriangleAlert } from 'lucide-react';
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { Badge } from '@/components/reui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { HyperReadinessBadge } from '../brief/HyperMeetingBriefSheet';
import { hyperSelectMeetingDays, type HyperHubMeetingDay, type HyperHubMeetingsSnapshot } from '../state/HyperTaskHubSelectors';

export interface HyperMeetingsViewProps {
  snapshot: HyperHubSnapshot;
  nowMs: number;
  query: string;
  onOpenBrief: (meetingId: string) => void;
}

function hyperDayTitle(date: string, todayDate: string): { title: string; detail: string } {
  const [year, month, day] = date.split('-').map(Number);
  // Noon UTC keeps the civil date stable in every zone for formatting.
  const at = Date.UTC(year, month - 1, day, 12);
  const detail = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at);
  const todayAt = Date.parse(`${todayDate}T12:00:00Z`);
  const offset = Math.round((at - todayAt) / 86_400_000);
  return offset === 0 ? { title: 'Today', detail } : offset === 1 ? { title: 'Tomorrow', detail } : { title: detail, detail: '' };
}

function hyperCoverageNote(day: HyperHubMeetingDay): string | null {
  const partial = day.coverage.some(item => item.completeness === 'partial');
  return partial ? 'Calendar only partly read for this day' : null;
}

/** J and K move between rows; Enter opens the brief (the rows are buttons). */
function hyperRowKeys(event: KeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'j' && key !== 'k') return;
  const rows = [...(event.currentTarget.querySelectorAll<HTMLElement>('[data-hyper-meeting-row]'))];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const next = rows[index < 0 ? 0 : index + (key === 'j' ? 1 : -1)];
  if (next) { event.preventDefault(); next.focus(); }
}

export function HyperMeetingsView({ snapshot, nowMs, query, onOpenBrief }: HyperMeetingsViewProps) {
  const [needsPrep, setNeedsPrep] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const zone = snapshot.settings.zone;
  const now = useMemo(() => ({ kind: 'instant' as const, iso: new Date(nowMs).toISOString() }), [nowMs]);
  const meetingsSnapshot = snapshot as HyperHubMeetingsSnapshot;
  const all = useMemo(() => hyperSelectMeetingDays(meetingsSnapshot, { now }), [meetingsSnapshot, now]);
  const prep = useMemo(() => hyperSelectMeetingDays(meetingsSnapshot, { now, needsPrep: true }), [meetingsSnapshot, now]);
  const prepCount = prep.reduce((sum, day) => sum + day.rows.filter(row => row.kind === 'meeting').length, 0);
  const needle = query.trim().toLocaleLowerCase();
  const days = (needsPrep ? prep : all).map(day => ({
    ...day,
    rows: needle ? day.rows.filter(row => row.kind === 'meeting' && (row.agendaItem.title ?? '').toLocaleLowerCase().includes(needle)) : day.rows,
  }));
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone });
  const todayDate = all[0]?.date.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
  const unconfigured = !snapshot.settings.outlookAvailability && !snapshot.agenda?.length;
  const total = days.reduce((sum, day) => sum + day.rows.length, 0);

  if (unconfigured) return <Empty className="flex-1"><EmptyHeader><EmptyMedia variant="icon"><CalendarClock className="size-5" /></EmptyMedia>
    <EmptyTitle>No calendar connected</EmptyTitle><EmptyDescription>Turn on your Outlook calendar or a HyperTask calendar in Settings → Task Hub to see your meetings and prepare for them.</EmptyDescription></EmptyHeader></Empty>;

  return <div data-hyper-meetings className="min-h-0 flex-1 overflow-y-auto" ref={listRef} onKeyDown={hyperRowKeys}>
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Next 7 days</h2>
        <Toggle variant="outline" size="sm" className="ms-auto" pressed={needsPrep} onPressedChange={setNeedsPrep} aria-label="Show only meetings that need prep">
          Needs prep<Badge variant={needsPrep ? 'primary-light' : 'outline'} size="sm" className="rounded-full tabular-nums">{prepCount}</Badge>
        </Toggle>
      </div>
      {!total && <p className="py-10 text-center text-sm text-muted-foreground">
        {needle ? 'No meetings match your search.' : needsPrep ? 'Every meeting in the next 7 days is prepared.' : 'No meetings in the next 7 days.'}
      </p>}
      {days.map(day => {
        if (!day.rows.length && (needsPrep || needle)) return null;
        const { title, detail } = hyperDayTitle(day.date.date, todayDate);
        const note = hyperCoverageNote(day);
        return <section key={day.date.date} aria-label={`${title} ${detail}`.trim()} className="flex flex-col gap-1">
          <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="text-foreground">{title}</span>{detail && <span>{detail}</span>}
            {note && <span className="ms-auto flex items-center gap-1 text-warning-foreground dark:text-warning"><TriangleAlert className="size-3" />{note}</span>}
          </h3>
          {!day.rows.length ? <p className="ps-2 text-xs text-muted-foreground">No meetings</p>
            : <ul className="flex flex-col divide-y rounded-lg border">
              {day.rows.map(row => {
                const item = row.agendaItem;
                const range = item.allDay ? 'All day' : `${time.format(Date.parse(item.interval.start.iso))}–${time.format(Date.parse(item.interval.end.iso))}`;
                if (row.kind === 'busy') return <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
                  <span className="w-40 shrink-0 whitespace-nowrap tabular-nums">{range}</span>
                  <Lock aria-hidden="true" className="size-3.5" /><span>Busy</span>
                </li>;
                const past = Date.parse(item.interval.end.iso) < nowMs;
                return <li key={item.id}>
                  <button type="button" data-hyper-meeting-row onClick={() => onOpenBrief(item.id)}
                    className={cn('flex w-full min-w-0 items-center gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', past && 'opacity-60')}>
                    <span className="w-40 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{range}</span>
                    <bdi dir="auto" className="min-w-0 flex-1 truncate font-medium">{item.title ?? 'Meeting'}</bdi>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {row.relatedOpenItemCount > 0 && <Badge variant="outline" size="sm" className="font-normal text-muted-foreground tabular-nums">{row.relatedOpenItemCount} open</Badge>}
                      {row.viewed && <Eye aria-label="Brief viewed" className="size-3.5 text-muted-foreground" />}
                      <HyperReadinessBadge readiness={row.readiness} />
                    </span>
                  </button>
                </li>;
              })}
            </ul>}
        </section>;
      })}
    </div>
  </div>;
}
