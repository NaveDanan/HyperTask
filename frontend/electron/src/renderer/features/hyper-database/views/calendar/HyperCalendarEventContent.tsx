import { hyperParseMentions } from '@/features/hyper-people/hyperMentions';
import { HyperMentionText } from '@/features/hyper-people/HyperMentionText';
import { format } from 'date-fns';
import { useEventCalendarSettings, useEventCalendarViewConfig, type EventCalendarRenderEventProps } from '@/components/reui/event-calendar/event-calendar';
import { spansMultipleDays, toZoned } from '@/components/reui/event-calendar/event-calendar-lib';
import { Mail } from 'lucide-react';
import { hyperIsOutlook, hyperOutlookTone, type HyperOutlookCalendarData } from '@/features/hyper-outlook/HyperOutlookData';

/** Keep the vendor's chip, geometry and gestures; customize only timed content. */
export function hyperCalendarRenderEvent(props: EventCalendarRenderEventProps<HyperOutlookCalendarData>, timeZone: string) {
  if (hyperIsOutlook(props.occurrence.event.data) && ((props.view !== 'week' && props.view !== 'day') || props.occurrence.allDay || spansMultipleDays(props.occurrence, timeZone))) return <HyperCalendarOutlookEventContent {...props} />;
  if ((props.view !== 'week' && props.view !== 'day') || props.occurrence.allDay || spansMultipleDays(props.occurrence, timeZone)) return hyperParseMentions(props.occurrence.event.title).some(part => part.kind === 'mention') ? <HyperCalendarMentionEventContent {...props} /> : undefined;
  return <HyperCalendarTimedEventContent {...props} />;
}

function HyperCalendarTimedEventContent({ occurrence, segment }: EventCalendarRenderEventProps<HyperOutlookCalendarData>) {
  const settings = useEventCalendarSettings();
  const config = useEventCalendarViewConfig();
  const showTime = (segment.endMin ?? 0) - (segment.startMin ?? 0) >= config.compactEventMinutes;
  const outlook = hyperIsOutlook(occurrence.event.data) ? occurrence.event.data.item : null;
  return <span data-hyper-outlook-event={outlook ? '' : undefined} className={`flex w-full min-w-0 flex-col gap-0.5 ${hyperOutlookTone(outlook)}`}>
    <span className="flex min-w-0 items-center gap-1.5 leading-4">
      {outlook ? <Mail aria-label="Outlook event" className="size-3 shrink-0 text-(--ec-event-color)" /> : <span aria-hidden data-slot="hyper-calendar-event-dot" className="size-2 shrink-0 rounded-full bg-(--ec-event-color)" />}
      <span dir="auto" data-slot="hyper-calendar-event-title" className="min-w-0 flex-1 truncate text-left text-xs font-medium"><HyperMentionText value={occurrence.event.title} /></span>
    </span>
    {showTime && <span data-slot="hyper-calendar-event-time" className="truncate text-2xs leading-4 text-muted-foreground tabular-nums">
      {settings.i18n.functions.formatEventTime(toZoned(occurrence.start, settings.timeZone), toZoned(occurrence.end, settings.timeZone), false, { locale: settings.locale })}
    </span>}
  </span>;
}

function HyperCalendarOutlookEventContent({ occurrence, view, segment }: EventCalendarRenderEventProps<HyperOutlookCalendarData>) {
  const settings = useEventCalendarSettings();
  const data = occurrence.event.data;
  if (!hyperIsOutlook(data)) return null;
  return <span data-hyper-outlook-event className={`flex w-full min-w-0 items-center gap-1.5 ${hyperOutlookTone(data.item)}`}>
    <Mail aria-label="Outlook event" className="size-3 shrink-0 text-(--ec-event-color)" /><span dir="auto" className="min-w-0 flex-1 truncate text-left font-medium"><HyperMentionText value={occurrence.event.title} /></span>
    {((!occurrence.allDay && (view !== 'month' || segment.isStart)) || view === 'agenda') && <span className="shrink-0 truncate text-muted-foreground tabular-nums">{view === 'month' ? format(toZoned(occurrence.start, settings.timeZone), settings.i18n.formats.eventTime, { locale: settings.locale }) : settings.i18n.functions.formatEventTime(toZoned(occurrence.start, settings.timeZone), toZoned(occurrence.end, settings.timeZone), occurrence.allDay, { locale: settings.locale })}</span>}
  </span>;
}

function HyperCalendarMentionEventContent({ occurrence, view, segment }: EventCalendarRenderEventProps<HyperOutlookCalendarData>) {
  const settings = useEventCalendarSettings();
  return <span className="flex w-full min-w-0 items-center gap-1.5"><span aria-hidden className="size-2 shrink-0 rounded-full bg-(--ec-event-color)" /><span className="min-w-0 flex-1 truncate"><HyperMentionText value={occurrence.event.title} /></span>{!occurrence.allDay && (view !== 'month' || segment.isStart) && <span className="shrink-0 text-muted-foreground tabular-nums">{format(toZoned(occurrence.start, settings.timeZone), settings.i18n.formats.eventTime, { locale: settings.locale })}</span>}</span>;
}
