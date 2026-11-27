import { hyperMentionText } from '@/features/hyper-people/hyperMentions';
import type { HyperOutlookEvent } from '@shared/api';
import { hyperIsGeneralCalendar } from '@/features/hyper-outlook/HyperGeneralCalendar';
import { hyperIsOutlook, hyperOutlookDraft, type HyperOutlookCalendarData } from '@/features/hyper-outlook/HyperOutlookData';
import { useHyperOutlookEvents } from '@/features/hyper-outlook/useHyperOutlookEvents';
import { hyperOutlookClient } from '@/features/hyper-outlook/hyper-outlook-client';
import { HyperOutlookToolbar } from '@/features/hyper-outlook/HyperOutlookToolbar';
import { HyperOutlookEventDialog } from '@/features/hyper-outlook/HyperOutlookEventDialog';
import { HyperOutlookSaveTo } from '@/features/hyper-outlook/HyperOutlookSaveTo';
import { useHyperOutlookSendConfirm } from '@/features/hyper-outlook/HyperOutlookSendConfirm';
import { useCallback, useMemo, useRef, useState } from 'react';
import { addHours, format, setHours, startOfDay } from 'date-fns';
import { CalendarDays, CalendarX2, TriangleAlert } from 'lucide-react';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { EventCalendar, type EventCalendarClassNames, type EventCalendarRenderEventProps } from '@/components/reui/event-calendar/event-calendar';
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content';
import type { CalendarView, EventCalendarOccurrence, EventCalendarProposedUpdate, EventCalendarRangeInfo } from '@/components/reui/event-calendar/event-calendar-types';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { showToast } from '@/ui';
import type { HyperDatabaseViewProps } from '../HyperDatabaseTypes';
import { HyperCalendarDragBridge } from './calendar/HyperCalendarDragBridge';
import { hyperCalendarRenderEvent } from './calendar/HyperCalendarEventContent';
import { HyperCalendarMoreContent } from './calendar/HyperCalendarMoreContent';
import { HyperCalendarToolbar } from './calendar/HyperCalendarToolbar';
import { HyperCalendarSettingsPopover } from './calendar/HyperCalendarSettingsPopover';
import { HyperCalendarNoDatePopover } from './calendar/HyperCalendarNoDatePopover';
import { HyperCalendarEventDialog } from './calendar/HyperCalendarEventDialog';
import { hyperCalendarDate, hyperCalendarDraft, hyperCalendarError, type HyperCalendarDraft, type HyperCalendarEventData } from './calendar/HyperCalendarData';
import { useHyperCalendarEvents } from './calendar/useHyperCalendarEvents';

const HyperCalendarViews: CalendarView[] = ['month', 'week', 'day', 'agenda'];
// Composite the user-data tint onto an opaque token surface so month bars
// cover the underlying day borders while retaining ReUI's state recipe.
const HyperCalendarMonthChipClasses = [
  'data-[view=month]:bg-[color-mix(in_oklab,var(--ec-event-color)_15%,var(--color-background))]',
  'data-[view=month]:hover:bg-[color-mix(in_oklab,var(--ec-event-color)_25%,var(--color-background))]',
  'dark:data-[view=month]:bg-[color-mix(in_oklab,var(--ec-event-color)_20%,var(--color-background))]',
  'dark:data-[view=month]:hover:bg-[color-mix(in_oklab,var(--ec-event-color)_30%,var(--color-background))]',
  'data-[view=month]:data-selected:bg-[color-mix(in_oklab,var(--ec-event-color)_30%,var(--color-background))]',
  'dark:data-[view=month]:data-selected:bg-[color-mix(in_oklab,var(--ec-event-color)_30%,var(--color-background))]',
].join(' ');
const HyperCalendarClasses: EventCalendarClassNames = {
  viewSwitcherContent: `${floatingSurfaceClass} w-44`, viewShortcut: 'text-2xs',
  monthView: 'border-t-0 overflow-y-auto [--ec-month-bar-h:1.5rem]', monthBody: 'min-h-[36rem] shrink-0',
  monthHeader: 'h-8 shrink-0', monthDayHeader: 'text-xs font-medium',
  monthCell: 'data-weekend:bg-muted/50 data-outside:bg-muted/50 data-today:bg-primary/3 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
  monthDayNumber: 'rounded-sm text-xs font-normal tabular-nums group-data-outside/ec-cell:text-muted-foreground/50',
  monthCellFooter: 'order-first pt-1.5 pb-1', monthBarOverlay: 'top-8!',
  monthCellContent: 'pb-5', moreIndicator: 'absolute inset-x-1 bottom-1 h-4 py-0 text-2xs',
  event: `text-2xs data-[view=month]:py-0.5 data-[view=agenda]:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${HyperCalendarMonthChipClasses}`,
  timedChip: 'text-xs',
  timeGrid: '[--ec-hour-height:3rem]!', timeGutter: 'text-xs',
  morePopover: floatingSurfaceClass, agendaDayHeader: 'bg-muted/60', agendaItem: 'px-4 py-2.5 text-sm',
};
function HyperCalendarNoEvents() {
  return <Empty className="min-h-72"><EmptyHeader><EmptyMedia variant="icon"><CalendarX2 className="size-5" /></EmptyMedia><EmptyTitle>No events</EmptyTitle><EmptyDescription>Events scheduled in this period will appear here.</EmptyDescription></EmptyHeader></Empty>;
}

function HyperCalendarViewContent(props: HyperDatabaseViewProps) {
  const { controller, state } = props;
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const calendar = useHyperCalendarEvents(props, timeZone);
  const general = hyperIsGeneralCalendar(state.view ?? props.view);
  const element = useRef<HTMLDivElement>(null);
  const visible = useCallback(() => Boolean(element.current?.getClientRects().length), []);
  const outlook = useHyperOutlookEvents(props.view.id, general, timeZone, visible);
  const send = useHyperOutlookSendConfirm();
  const [outlookItem, setOutlookItem] = useState<HyperOutlookEvent | null>(null);
  const [saveTo, setSaveTo] = useState<'outlook' | 'calendar'>('outlook');
  const pendingOutlook = useRef(new Set<string>());
  const events = useMemo(() => [...calendar.events, ...outlook.events], [calendar.events, outlook.events]);
  const onRangeChange = useCallback((info: EventCalendarRangeInfo) => { calendar.onRangeChange(info); outlook.onRangeChange(info); }, [calendar.onRangeChange, outlook.onRangeChange]);
  const onEventUpdate = (update: EventCalendarProposedUpdate<HyperOutlookCalendarData>) => {
    if (!hyperIsOutlook(update.event.data)) return calendar.onEventUpdate(update as EventCalendarProposedUpdate<HyperCalendarEventData>);
    const item = update.event.data.item;
    if (update.event.readOnly || pendingOutlook.current.has(item.id)) return false;
    pendingOutlook.current.add(item.id);
    void (async () => {
      if (item.attendeeCount && !await send.confirm(item.attendeeCount, 'update')) return;
      await hyperOutlookClient.update({ id: item.id, expectedLastModified: item.lastModified, send: item.attendeeCount > 0, patch: {
        start: update.allDay ? format(update.start, 'yyyy-MM-dd') : new Date(update.start.getTime()).toISOString(), end: update.allDay ? format(update.end, 'yyyy-MM-dd') : new Date(update.end.getTime()).toISOString(), allDay: update.allDay,
      } });
      showToast({ type: 'success', message: 'Outlook event updated' });
    })().catch(error => showToast({ type: 'error', message: hyperCalendarError(error) })).finally(() => { pendingOutlook.current.delete(item.id); outlook.refresh(); });
    return false;
  };
  const renderEvent = useCallback((event: EventCalendarRenderEventProps<HyperOutlookCalendarData>) => hyperCalendarRenderEvent(event, timeZone), [timeZone]);
  const [draft, setDraft] = useState<HyperCalendarDraft | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const selection = useMemo(() => ({ eventKeys: selectedKey ? [selectedKey] : [], slot: null }), [selectedKey]);
  const close = () => { setDraft(null); setOutlookItem(null); setSelectedKey(null); };
  const create = (initial: HyperCalendarDraft) => { setSelectedKey(null); setOutlookItem(null); setSaveTo('outlook'); setDraft(initial); };
  // The shared cache lists Outlook items with an opaque handle; the editor needs the full item (M5 E6).
  // Protected items arrive as anonymous Busy spans without a handle and never open.
  const openOutlook = async (key: string, listed: HyperOutlookEvent) => {
    if (!listed.occurrenceHandle && listed.isPrivate) return;
    setSelectedKey(key);
    try {
      // Eligibility can change between listing and opening, so only the resolved item decides Prep.
      const item = await hyperOutlookClient.resolve(listed);
      setOutlookItem(item);
      setDraft(hyperOutlookDraft(item, timeZone));
    } catch (error) {
      setSelectedKey(null);
      showToast({ type: 'error', message: hyperCalendarError(error) });
    }
  };
  const destination = (value: 'outlook' | 'calendar', current: HyperCalendarDraft) => <HyperOutlookSaveTo value={value} onChange={value => { setDraft(current); setSaveTo(value); }} />;
  const openRow = async (rowId: string, occurrence?: EventCalendarOccurrence<HyperCalendarEventData>) => {
    if (!calendar.dateField) return;
    try {
      const loaded = await controller.scanRows([rowId], [calendar.dateField.id, ...(calendar.primaryField ? [calendar.primaryField.id] : []), ...(calendar.colorField ? [calendar.colorField.id] : [])]);
      const cells = loaded[rowId];
      const date = cells?.[calendar.dateField.id];
      const start = date?.kind === 'date' && date.timestamp !== null ? hyperCalendarDate(date.timestamp, timeZone) : setHours(startOfDay(new Date()), 9);
      const initial = hyperCalendarDraft(start, undefined, date?.kind !== 'date' || !date.includeTime, timeZone);
      const end = date?.kind === 'date' && date.endTimestamp !== null ? hyperCalendarDate(date.endTimestamp, timeZone) : addHours(start, 1);
      const color = calendar.colorField ? cells?.[calendar.colorField.id] : undefined;
      setSelectedKey(occurrence?.key ?? null);
      setDraft({ ...initial, rowId, title: (calendar.primaryField ? cells?.[calendar.primaryField.id]?.display : '') || occurrence?.event.title || '',
        isRange: date?.kind === 'date' && date.isRange, endDate: format(end, 'yyyy-MM-dd'), endTime: format(end, 'HH:mm'),
        optionId: color?.kind === 'singleSelect' ? color.selected[0]?.id ?? '' : '', readOnly: Boolean(!date || date.error || (calendar.primaryField && (!cells?.[calendar.primaryField.id] || cells[calendar.primaryField.id].error)) || (calendar.colorField && (!color || color.error))) });
    } catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); }
  };
  const retry = async () => {
    try { await controller.refresh(); calendar.refetch(); }
    catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); }
  };
  const addDateField = async () => {
    setAddingField(true);
    try { const field = await controller.createField('Date', FieldType.DateTime); await controller.updateCalendarSettings({ fieldId: field.id }); }
    catch (error) { showToast({ type: 'error', message: hyperCalendarError(error) }); }
    finally { setAddingField(false); }
  };
  if (state.status === 'error' || calendar.error) return <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><TriangleAlert className="size-5" /></EmptyMedia><EmptyTitle>Calendar could not be loaded</EmptyTitle><EmptyDescription>{state.error || calendar.error}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => void retry()}>Retry</Button></EmptyContent></Empty>;
  if (state.status === 'ready' && !calendar.dateField) return <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><CalendarDays className="size-5" /></EmptyMedia><EmptyTitle>No date property</EmptyTitle><EmptyDescription>Add a Date property to place rows on the calendar.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => void addDateField()} disabled={addingField}>{addingField ? 'Adding…' : 'Add date property'}</Button></EmptyContent></Empty>;
  return <div ref={element} data-hyper-calendar className="flex h-full min-h-0 flex-col bg-background">
    <EventCalendar<HyperOutlookCalendarData> i18n={{ functions: { formatEventLabel: (title, time) => hyperMentionText(title) + (time ? ", " + time : ""), formatEventAriaLabel: (title, time, continues) => hyperMentionText(title) + ", " + time + (continues ? ", continues" : "") } }} className="min-h-0 flex-1" views={HyperCalendarViews} defaultView="month" events={events} onEventsChange={() => calendar.refetch()}
      timeZone={timeZone} weekStartsOn={calendar.setting?.firstDayOfWeek === 1 ? 1 : 0} viewSettings={{ weekends: calendar.setting?.showWeekends ?? true }}
      fixedWeeks snapDuration={15} slotDuration={60} scrollToHour={7} maxEventsPerCell={2} showDayAddButton nowIndicator enableShortcuts
      navButtonVariant="ghost" navButtonSize="sm" interactions={{ drag: true, resize: true, selectSlot: true }} eventTooltip={false}
      loading={calendar.loading} classNames={HyperCalendarClasses} todayClassName="border-b-0!" renderEvent={renderEvent} renderAgendaEvent={renderEvent} selection={selection} onRangeChange={onRangeChange} onEventUpdate={onEventUpdate} onDragBlocked={occurrence => { if (hyperIsOutlook(occurrence.event.data)) showToast({ type: 'error', message: 'This Outlook event is read-only. Respond to the invitation or open it in Outlook.' }); }}
      renderMoreContent={({ day, close }) => <HyperCalendarMoreContent day={day} close={close} />} renderNoEvents={HyperCalendarNoEvents} onEventClick={(occurrence, event) => { event.preventDefault(); if (hyperIsOutlook(occurrence.event.data)) { void openOutlook(occurrence.key, occurrence.event.data.item); } else void openRow(occurrence.eventId, occurrence as EventCalendarOccurrence<HyperCalendarEventData>); }}
      onSlotClick={slot => { create(hyperCalendarDraft(slot.date, slot.end, slot.allDay, timeZone)); }}
      onSelectSlot={slot => { create(hyperCalendarDraft(slot.start, slot.end, slot.allDay, timeZone)); }}>
      <HyperCalendarToolbar disabled={calendar.loading || !calendar.dateField} onCreate={() => { create(hyperCalendarDraft(setHours(startOfDay(new Date()), 9), undefined, true, timeZone)); }}
        outlook={general && <HyperOutlookToolbar status={outlook.status} error={outlook.error} refreshing={outlook.refreshing} shown={outlook.shown} lastSyncedAt={outlook.lastSyncedAt} onToggle={outlook.toggle} onRefresh={outlook.refresh} />}
        noDate={<HyperCalendarNoDatePopover rows={calendar.noDateRows} onSchedule={rowId => void openRow(rowId)} />}
        settings={calendar.dateField && <HyperCalendarSettingsPopover controller={controller} dateFieldId={calendar.dateField.id} dateFields={calendar.dateFields} colorFieldId={calendar.colorField?.id ?? ''} colorFields={calendar.colorFields} onColorByChange={calendar.changeColorBy} showWeekends={calendar.setting?.showWeekends ?? true} firstDayOfWeek={calendar.setting?.firstDayOfWeek === 1 ? 1 : 0} />} />
      <HyperCalendarDragBridge onEventUpdate={onEventUpdate} /><EventCalendarContent />
    </EventCalendar>
    {draft && calendar.dateField && (!general || draft.rowId || saveTo === 'calendar') && !outlookItem && <HyperCalendarEventDialog saveTo={general && !draft.rowId ? draft => destination('calendar', draft) : undefined} initial={draft} controller={controller} dateField={calendar.dateField} primaryField={calendar.primaryField} colorField={calendar.colorField} timeZone={timeZone} onClose={close} onSaved={calendar.refetch} />}
    {general && draft && (outlookItem || (!draft.rowId && saveTo === 'outlook')) && <HyperOutlookEventDialog initial={draft} item={outlookItem ?? undefined} timeZone={timeZone} onClose={close} onSaved={outlook.refresh} onItemChange={outlook.replace} confirmSend={send.confirm} saveTo={draft => destination('outlook', draft)} />}
    {send.dialog}
  </div>;
}

export function HyperCalendarView(props: HyperDatabaseViewProps) {
  return <HyperCalendarViewContent key={props.view.id} {...props} />;
}
