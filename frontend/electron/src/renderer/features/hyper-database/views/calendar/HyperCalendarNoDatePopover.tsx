import { HyperMentionText } from '@/features/hyper-people/HyperMentionText';
import { useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { floatingSurfaceClass } from '@/components/app/menu-row';

export function HyperCalendarNoDatePopover({ rows, onSchedule }: { rows: Array<{ rowId: string; title: string }>; onSchedule: (rowId: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="sm" />}><CalendarOff className="size-4" />No date<span className="rounded-full bg-muted px-1.5 text-2xs font-medium tabular-nums">{rows.length}</span></PopoverTrigger>
    <PopoverContent align="end" className={`${floatingSurfaceClass} w-80 gap-0 p-0`}>
      <div className="border-b border-border px-4 py-3"><PopoverTitle>Rows without a date</PopoverTitle><p className="mt-1 text-xs text-muted-foreground">Choose a row to schedule it.</p></div>
      <ScrollArea className="max-h-80 **:data-[slot=scroll-area-viewport]:max-h-80"><div className="flex flex-col p-1">{rows.map(row => <Button key={row.rowId} variant="ghost" className="h-auto min-h-8 justify-start px-3 py-2 text-left" onClick={() => { setOpen(false); onSchedule(row.rowId); }}><CalendarOff className="size-4 shrink-0 text-muted-foreground" /><span className="truncate"><HyperMentionText value={row.title} /></span></Button>)}</div></ScrollArea>
    </PopoverContent>
  </Popover>;
}
