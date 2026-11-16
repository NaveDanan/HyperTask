import { useEffect } from 'react';
import { useEventCalendar } from '@/components/reui/event-calendar/event-calendar';
import type { EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import type { HyperOutlookCalendarData } from '@/features/hyper-outlook/HyperOutlookData';
import { hyperCalendarTypeOnlyUpdate } from './HyperCalendarData';

/** ReUI skips equal-date drops even when the all-day flag changed. */
export function HyperCalendarDragBridge({ onEventUpdate }: { onEventUpdate: (update: EventCalendarProposedUpdate<HyperOutlookCalendarData>) => boolean }) {
  const calendar = useEventCalendar<HyperOutlookCalendarData>();
  useEffect(() => {
    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (!(event.target instanceof Element) || !event.target.closest('[data-hyper-calendar]')) return;
      // Capture before the vendor's window listener clears its drag state.
      const update = hyperCalendarTypeOnlyUpdate(calendar.getState().drag);
      if (update) onEventUpdate(update);
    };
    document.addEventListener('pointerup', onPointerUp, true);
    return () => document.removeEventListener('pointerup', onPointerUp, true);
  }, [calendar, onEventUpdate]);
  return null;
}
