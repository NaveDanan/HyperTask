import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { HyperLayoutIcon } from '@/features/plugins/PlaceholderPage';
import type { HyperDatabaseViewProps } from '../HyperDatabaseTypes';

/** Owned exclusively by the HyperCalendarView executor. */
export function HyperCalendarView({ state, view }: HyperDatabaseViewProps) {
  return <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><HyperLayoutIcon layout={view.layout} hyperLayout="calendar" className="size-5" /></EmptyMedia><EmptyTitle>Calendar view</EmptyTitle><EmptyDescription>{state.rowIds.length} records · {state.fields.length} properties</EmptyDescription></EmptyHeader></Empty>;
}
