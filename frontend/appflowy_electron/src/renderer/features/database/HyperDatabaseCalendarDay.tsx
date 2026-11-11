import { useEffect, useState } from 'react';
import type { CalendarEventPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HyperDatabaseCalendarSpanIndex } from './HyperDatabaseCalendarSpans';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import { HyperDatabaseWindowNavigation, useHyperDatabaseWindowText } from './HyperDatabaseWindow';
import { HyperDatabaseRowActivityRows } from './HyperDatabaseRowActivityView';

export function HyperDatabaseCalendarDay({ day, currentMonth, index, onOpen }: {
  day: string;
  currentMonth: number;
  index: HyperDatabaseCalendarSpanIndex<CalendarEventPB>;
  onOpen(row: RowMetaPB): void;
}) {
  const text = useHyperDatabaseText(), windowText = useHyperDatabaseWindowText();
  const [page, setPage] = useState(0), window = index.window(day, page);
  useEffect(() => { if (page !== window.page) setPage(window.page); }, [page, window.page]);
  return <div role="gridcell" aria-label={day} className={cn('min-h-28 border-b border-r p-2', Number(day.slice(5, 7)) !== currentMonth && 'bg-muted/30 text-muted-foreground')}>
    <HyperDatabaseRowActivityRows rowIds={window.items.flatMap(event => event.rowMeta?.id ? [event.rowMeta.id] : [])} />
    <div className="mb-1 text-xs font-medium">{Number(day.slice(-2))}</div>
    {window.items.map(event => <Button key={event.rowMeta!.id} variant="ghost" size="sm" className="mb-1 w-full justify-start truncate border bg-card text-xs" onClick={() => onOpen(event.rowMeta!)}>{event.title || text('openRow')}</Button>)}
    <HyperDatabaseWindowNavigation window={window} label={windowText('events', { day })} compact onPage={setPage} />
  </div>;
}
