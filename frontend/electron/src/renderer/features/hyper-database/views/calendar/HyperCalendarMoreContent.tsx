import { format } from 'date-fns';
import { useEventCalendarDay, useEventCalendarSettings } from '@/components/reui/event-calendar/event-calendar';
import { EventCalendarEvent } from '@/components/reui/event-calendar/event-calendar-event';
import { toZoned } from '@/components/reui/event-calendar/event-calendar-lib';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { HyperCalendarEventData } from './HyperCalendarData';

/** Reuse ReUI's indexed day segments and chips; include visible and hidden events. */
export function HyperCalendarMoreContent({ day, close }: { day: Date; close: () => void }) {
  const { segments } = useEventCalendarDay<HyperCalendarEventData>(day);
  const { timeZone } = useEventCalendarSettings();
  return <>
    <div className="px-1 py-1 text-xs font-medium text-muted-foreground">{format(toZoned(day, timeZone), 'EEEE, MMMM d')}</div>
    <ScrollArea className="min-h-0 **:data-[slot=scroll-area-viewport]:max-h-64">
      <div className="flex flex-col gap-1 p-1">{[...segments.allDay, ...segments.timed].map(segment => <EventCalendarEvent key={segment.occurrence.key} segment={segment} className="py-0.5" onClickCapture={close} />)}</div>
    </ScrollArea>
  </>;
}
