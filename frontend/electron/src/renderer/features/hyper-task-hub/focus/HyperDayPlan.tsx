// Today's plan as a single-day time grid on the vendored ReUI event calendar: meetings are read-only,
// private items show only "Busy", and plan blocks can be dragged to make them fixed (a `reschedule`
// feedback event). Capacity sits above the grid (spec D9.2).
import { useMemo } from 'react';
import { CalendarCheck2, CalendarClock, Circle, CircleCheck, CircleDot, Lock, Pin } from 'lucide-react';
import type { HyperMeetingReadiness } from '@shared/HyperMeetingBrief';
import type { HyperHubSnapshot, HyperHubTaskView } from '@shared/HyperTaskHub';
import { EventCalendar, type EventCalendarClassNames, type EventCalendarRenderEventProps } from '@/components/reui/event-calendar/event-calendar';
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content';
import type { CalendarEvent, EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import type { HyperFocusToday } from './HyperFocusView';

type HyperFocusEventData =
  | { kind: 'agenda'; private: boolean; tentative: boolean; meeting: boolean; briefId?: string; readiness?: HyperMeetingReadiness }
  | { kind: 'block'; task: HyperHubTaskView; fixed: boolean; provisional: boolean };

const hyperReadinessIcon = (readiness: HyperMeetingReadiness) => readiness === 'prepared'
  ? <CircleCheck aria-label="Prepared" className="size-3 shrink-0 text-success" />
  : readiness === 'planned' ? <CircleDot aria-label="Prep planned" className="size-3 shrink-0 text-info" />
  : <Circle aria-label="Not prepared" className="size-3 shrink-0 text-muted-foreground" />;

const hyperFocusClasses: EventCalendarClassNames = {
  event: 'text-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
  timedChip: 'text-xs',
  timeGrid: '[--ec-hour-height:3.25rem]!',
  timeGutter: 'text-xs',
  morePopover: floatingSurfaceClass,
};

function hyperFocusRenderEvent({ occurrence }: EventCalendarRenderEventProps<HyperFocusEventData>) {
  const data = occurrence.event.data;
  if (!data) return undefined;
  if (data.kind === 'agenda') return <span className={cn('flex w-full min-w-0 items-center gap-1.5', data.tentative && 'opacity-70')}>
    {data.private ? <Lock aria-hidden="true" className="size-3 shrink-0" /> : <CalendarCheck2 aria-hidden="true" className="size-3 shrink-0" />}
    <span dir="auto" className="min-w-0 flex-1 truncate text-start font-medium">{occurrence.event.title}</span>
    {data.tentative && <span className="shrink-0 text-2xs text-muted-foreground">tentative</span>}
    {data.readiness && hyperReadinessIcon(data.readiness)}
  </span>;
  return <span className="flex w-full min-w-0 items-center gap-1.5">
    {data.fixed ? <Pin aria-label="Fixed block" className="size-3 shrink-0" /> : <CalendarClock aria-hidden="true" className="size-3 shrink-0" />}
    <span dir="auto" className="min-w-0 flex-1 truncate text-start font-medium">{data.task.title}</span>
    {data.provisional && <span className="shrink-0 text-2xs text-muted-foreground">provisional</span>}
  </span>;
}

function HyperCapacityBar({ today }: { today: HyperFocusToday }) {
  const { freeMinutes, plannedMinutes, unplacedMinutes, provisional } = today.capacity;
  const percent = freeMinutes > 0 ? Math.min(100, Math.round(plannedMinutes / freeMinutes * 100)) : 0;
  const over = unplacedMinutes > 0;
  return <div className="flex flex-col gap-1.5">
    <div className="flex items-center gap-2 text-xs">
      <span className={cn('font-medium', provisional && 'text-warning-foreground dark:text-warning')}>{today.capacity.text}</span>
      {over && <span className="ms-auto text-warning-foreground dark:text-warning">{today.unscheduled.filter(entry => entry.task.state !== 'waiting').length} didn&apos;t fit</span>}
    </div>
    <Progress aria-label="Planned time compared with free time" value={percent} className={cn('h-1.5 [&_[data-slot=progress-track]]:h-1.5', over && '[&_[data-slot=progress-indicator]]:bg-warning')} />
  </div>;
}

export function HyperDayPlan({ snapshot, today, nowMs, onReschedule, onDeclare, onOpenMeeting }: {
  snapshot: HyperHubSnapshot;
  today: HyperFocusToday;
  nowMs: number;
  onReschedule: (task: HyperHubTaskView, start: Date, end: Date) => void;
  onDeclare: () => void;
  /** Opens the brief for a verified meeting (agenda id). */
  onOpenMeeting?: (meetingId: string) => void;
}) {
  const zone = snapshot.settings.zone;
  const date = useMemo(() => new Date(snapshot.day ? `${snapshot.day.date.date}T12:00:00Z` : nowMs), [snapshot.day, nowMs]);
  const hours = snapshot.settings.hours;
  const startHour = Math.max(0, Math.min(Number(hours?.start.slice(0, 2) ?? 8) - 1, 23));
  const endHour = Math.min(24, Math.max(Number(hours?.end.slice(0, 2) ?? 18) + 2, startHour + 1));
  const events = useMemo<CalendarEvent<HyperFocusEventData>[]>(() => [
    ...today.agenda.filter(item => item.availability !== 'free' && item.availability !== 'working-elsewhere').map(item => ({
      id: 'agenda:' + item.id,
      title: item.private ? 'Busy' : item.title || (item.isMeeting ? 'Meeting' : 'Busy'),
      start: new Date(item.interval.start.iso), end: new Date(item.interval.end.iso), allDay: item.allDay,
      color: item.availability === 'tentative' ? 'var(--color-warning)' : 'var(--color-muted-foreground)',
      readOnly: true, draggable: false, resizable: false,
      data: { kind: 'agenda' as const, private: item.private, tentative: item.availability === 'tentative', meeting: !item.private && item.isMeeting,
        ...(!item.private && item.meeting?.verifiedEligible ? { briefId: item.id, readiness: item.meeting.readiness } : {}) },
    })),
    ...today.blocks.map(({ block, task }) => ({
      id: 'block:' + task.id + ':' + block.start.iso,
      title: task.title,
      start: new Date(block.start.iso), end: new Date(block.end.iso),
      color: block.fixed ? 'var(--color-primary)' : 'var(--color-info)',
      readOnly: false, draggable: true, resizable: false,
      data: { kind: 'block' as const, task, fixed: block.fixed, provisional: block.provisional },
    })),
  ], [today.agenda, today.blocks]);

  const onEventUpdate = (update: EventCalendarProposedUpdate<HyperFocusEventData>) => {
    const data = update.event.data;
    if (data?.kind === 'block' && !update.allDay) onReschedule(data.task, update.start, update.end);
    return false; // The next snapshot places the block; nothing moves locally until main accepts it.
  };
  const coverageLabel = today.coverage === 'complete' ? 'Calendar read in full' : today.coverage === 'provisional' ? 'Calendar not fully current' : 'No calendar coverage';

  return <section aria-label="Today's plan" data-hyper-day-plan className="flex flex-col gap-3 rounded-xl border p-3">
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-semibold">Today</h3>
      <span className={cn('text-xs text-muted-foreground', today.coverage !== 'complete' && 'text-warning-foreground dark:text-warning')}>{coverageLabel}</span>
      <Button variant="ghost" size="xs" className="ms-auto text-muted-foreground" onClick={onDeclare}>I&apos;m free…</Button>
    </div>
    <HyperCapacityBar today={today} />
    <div className="h-[34rem] min-h-0 overflow-hidden rounded-lg border">
      <EventCalendar<HyperFocusEventData> className="h-full" views={['day']} view="day" date={date} events={events} timeZone={zone}
        dayStartHour={startHour} dayEndHour={endHour} scrollToHour={Math.max(startHour, new Date(nowMs).getHours() - 1)} snapDuration={15} slotDuration={60}
        nowIndicator eventTooltip={false} classNames={hyperFocusClasses} renderEvent={hyperFocusRenderEvent}
        interactions={{ drag: true, resize: false, selectSlot: false }} onEventUpdate={onEventUpdate}
        onEventClick={(occurrence, event) => {
          const data = occurrence.event.data;
          if (data?.kind === 'agenda' && data.briefId && onOpenMeeting) { event.preventDefault(); onOpenMeeting(data.briefId); }
        }}
        canDropEvent={update => update.event.data?.kind === 'block' && !update.allDay}>
        <EventCalendarContent />
      </EventCalendar>
    </div>
  </section>;
}
