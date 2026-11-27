// "I'm free 09:00–12:00" (spec D7.6). Without availability coverage Focus never invents free time; the
// owner declares a window for today, recorded as an undoable `declare-availability` ledger entry.
import { useId, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { CalendarPlus } from 'lucide-react';
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperHubCivilDay } from '../HyperTaskHubFormat';

/** A local wall-clock time on a civil day in a zone, as an ISO instant. */
export function hyperHubZonedIso(day: string, time: string, zone: string): string {
  const [year, month, date] = day.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  return new TZDate(year, month - 1, date, hour, minute, zone).toISOString();
}

export function HyperOwnerWindowPrompt({ snapshot, reason, onDeclare, onCancel }: {
  snapshot: HyperHubSnapshot;
  reason: 'missing' | 'manual';
  onDeclare: (windows: { start: string; end: string }[]) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const zone = snapshot.settings.zone;
  const day = snapshot.day?.date.date ?? hyperHubCivilDay(Date.parse(snapshot.asOf.iso), zone);
  const [start, setStart] = useState(snapshot.settings.hours?.start ?? '09:00');
  const [end, setEnd] = useState(snapshot.settings.hours?.end ?? '12:00');
  const valid = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
  return <section aria-labelledby={id} className="rounded-xl border border-dashed p-4">
    <div className="flex items-center gap-2">
      <CalendarPlus aria-hidden="true" className="size-4 text-muted-foreground" />
      <h3 id={id} className="text-sm font-semibold">When are you free today?</h3>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">
      {reason === 'missing'
        ? 'Task Hub has no complete calendar for today, so it will not guess your free time. Add a window and it will plan your tasks into it.'
        : 'Add a window you are free today. Known meetings inside it stay busy.'}
    </p>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      if (valid) onDeclare([{ start: hyperHubZonedIso(day, start, zone), end: hyperHubZonedIso(day, end, zone) }]);
    }}>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">From<Input type="time" value={start} onChange={event => setStart(event.target.value)} className="h-8 w-36" aria-invalid={!valid} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">To<Input type="time" value={end} onChange={event => setEnd(event.target.value)} className="h-8 w-36" aria-invalid={!valid} /></label>
      <Button type="submit" size="sm" disabled={!valid}>Plan into this window</Button>
      {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
    </form>
  </section>;
}
