import { useEventCalendarSettings, useEventCalendarViewConfig, type EventCalendarRenderEventProps } from '@/components/reui/event-calendar/event-calendar';
import { spansMultipleDays, toZoned } from '@/components/reui/event-calendar/event-calendar-lib';
import type { HyperCalendarEventData } from './HyperCalendarData';

/** Keep the vendor's chip, geometry and gestures; customize only timed content. */
export function hyperCalendarRenderEvent(props: EventCalendarRenderEventProps<HyperCalendarEventData>, timeZone: string) {
  if ((props.view !== 'week' && props.view !== 'day') || props.occurrence.allDay || spansMultipleDays(props.occurrence, timeZone)) return undefined;
  return <HyperCalendarTimedEventContent {...props} />;
}

function HyperCalendarTimedEventContent({ occurrence, segment }: EventCalendarRenderEventProps<HyperCalendarEventData>) {
  const settings = useEventCalendarSettings();
  const config = useEventCalendarViewConfig();
  const showTime = (segment.endMin ?? 0) - (segment.startMin ?? 0) >= config.compactEventMinutes;
  return <span className="flex w-full min-w-0 flex-col gap-0.5">
    <span className="flex min-w-0 items-center gap-1.5 leading-4">
      <span aria-hidden data-slot="hyper-calendar-event-dot" className="size-2 shrink-0 rounded-full bg-(--ec-event-color)" />
      <span data-slot="hyper-calendar-event-title" className="min-w-0 flex-1 truncate text-xs font-medium">{occurrence.event.title}</span>
    </span>
    {showTime && <span data-slot="hyper-calendar-event-time" className="truncate text-2xs leading-4 text-muted-foreground tabular-nums">
      {settings.i18n.functions.formatEventTime(toZoned(occurrence.start, settings.timeZone), toZoned(occurrence.end, settings.timeZone), false, { locale: settings.locale })}
    </span>}
  </span>;
}
