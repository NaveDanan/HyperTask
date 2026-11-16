import { HyperCalendarShortcuts } from './HyperCalendarShortcuts';
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EventCalendarNavToday, EventCalendarNavPrev, EventCalendarNavNext, EventCalendarTitle, EventCalendarViewSwitcher, EventCalendarToolbar } from '@/components/reui/event-calendar/event-calendar-nav';

export function HyperCalendarToolbar({ noDate, settings, outlook, onCreate, disabled }: { noDate: ReactNode; settings: ReactNode; outlook?: ReactNode; onCreate: () => void; disabled: boolean }) {
  return <TooltipProvider><HyperCalendarShortcuts />
    <EventCalendarToolbar className="h-12 shrink-0 gap-2 border-b border-border px-4">
      <EventCalendarNavToday /><EventCalendarViewSwitcher />
      <div className="flex items-center"><EventCalendarNavPrev tooltip="Previous" /><EventCalendarNavNext tooltip="Next" /></div>
      <EventCalendarTitle className="truncate text-sm font-semibold" />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">{outlook}{noDate}{settings}<Button size="sm" onClick={onCreate} disabled={disabled}><Plus className="size-4" />New event</Button></div>
    </EventCalendarToolbar>
  </TooltipProvider>;
}
