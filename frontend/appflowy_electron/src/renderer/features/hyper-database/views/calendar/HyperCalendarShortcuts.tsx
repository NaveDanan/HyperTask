import { useEffect } from 'react';
import { useEventCalendarView } from '@/components/reui/event-calendar/event-calendar';
import type { CalendarView } from '@/components/reui/event-calendar/event-calendar-types';

const HyperCalendarShortcutViews: Record<string, CalendarView> = { m: 'month', w: 'week', d: 'day', a: 'agenda' };

/** The vendored enableShortcuts option has no handler; keep keyboard scope local. */
export function HyperCalendarShortcuts() {
  const { setView } = useEventCalendarView();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest('[data-hyper-calendar]')) return;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      const view = HyperCalendarShortcutViews[event.key.toLowerCase()];
      if (!view) return;
      event.preventDefault(); setView(view);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setView]);
  return null;
}
