import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import type { EventCalendarRangeInfo, EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import { showToast } from '@/ui';
import type { HyperCalendarEvent, HyperDatabaseState, HyperDatabaseViewProps } from '../../HyperDatabaseTypes';
import { hyperCalendarError, hyperCalendarMapEvent, hyperCalendarSeconds, hyperCalendarWriteUpdate, type HyperCalendarEventData } from './HyperCalendarData';

export function useHyperCalendarEvents({ controller, state, view }: HyperDatabaseViewProps, timeZone: string) {
  const setting = state.settings?.layoutSetting?.oneOfCalendar.value;
  const dateFields = useMemo(() => state.fields.filter(field => field.type === FieldType.DateTime), [state.fields]);
  const dateField = dateFields.find(field => field.id === setting?.fieldId) ?? dateFields[0];
  const colorFields = useMemo(() => state.fields.filter(field => field.type === FieldType.SingleSelect), [state.fields]);
  const primaryField = state.fields.find(field => field.isPrimary && field.type === FieldType.RichText);
  const [colorBy, setColorBy] = useState<string | null>(() => {
    try { return localStorage.getItem(`hyper.calendar.colorBy.${view.id}`); } catch { return null; }
  });
  const colorField = colorBy === '' ? undefined : colorFields.find(field => field.id === colorBy) ?? colorFields[0];
  const changeColorBy = useCallback((id: string) => {
    setColorBy(id);
    try { localStorage.setItem(`hyper.calendar.colorBy.${view.id}`, id); } catch { /* Calendar remains usable when storage is unavailable. */ }
  }, [view.id]);
  const [range, setRange] = useState<EventCalendarRangeInfo | null>(null);
  const onRangeChange = useCallback((info: EventCalendarRangeInfo) => setRange(previous => previous?.range.start.getTime() === info.range.start.getTime() && previous.range.end.getTime() === info.range.end.getTime() ? previous : info), []);
  const [rawCells, setRawCells] = useState<HyperDatabaseState['cells']>({});
  const rowKey = state.rowIds.join(',');
  const [rawEvents, setRawEvents] = useState<HyperCalendarEvent[]>([]);
  const [fetchedField, setFetchedField] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);
  const request = useRef(0);
  const settingsAttempt = useRef('');
  const refetch = useCallback(() => {
    settingsAttempt.current = '';
    setRefetchKey(key => key + 1);
  }, []);
  useEffect(() => {
    if (state.status !== 'ready' || !dateField || setting?.fieldId === dateField.id || settingsAttempt.current === dateField.id) return;
    settingsAttempt.current = dateField.id;
    let active = true;
    void controller.updateCalendarSettings({ fieldId: dateField.id }).catch(cause => {
      if (!active) return;
      const message = hyperCalendarError(cause);
      setError(message);
      showToast({ type: 'error', message });
    });
    return () => { active = false; };
  }, [controller, dateField, setting?.fieldId, state.status, refetchKey]);
  useEffect(() => {
    if (!range || !dateField || state.status !== 'ready' || setting?.fieldId !== dateField.id) return;
    const version = ++request.current;
    const fetchEvents = async () => {
      const cells = await controller.scanRows(state.rowIds, [dateField.id, ...(primaryField ? [primaryField.id] : []), ...(colorField ? [colorField.id] : [])], () => version === request.current);
      const events = await controller.getCalendarEvents(hyperCalendarSeconds(range.range.start), hyperCalendarSeconds(range.range.end), cells);
      if (version !== request.current) return;
      setRawCells(cells); setRawEvents(events); setFetchedField(dateField.id); setError(Object.values(cells).flatMap(row => Object.values(row)).find(cell => cell.error)?.error ?? null);
    };
    void fetchEvents().catch(cause => { if (version === request.current) { setError(hyperCalendarError(cause)); setFetchedField(dateField.id); } });
    return () => { if (request.current === version) request.current++; };
  }, [controller, range, dateField?.id, primaryField?.id, colorField?.id, state.dataRevision, state.fields, state.status, rowKey, setting?.fieldId, refetchKey]);
  const pending = useRef(new Set<string>());
  const rowIds = useMemo(() => new Set(state.rowIds), [state.rowIds]);
  const events = useMemo(() => rawEvents.filter(event => event.dateFieldId === dateField?.id && rowIds.has(event.rowId)).map(event => hyperCalendarMapEvent(event, rawCells[event.rowId]?.[event.dateFieldId], colorField ? rawCells[event.rowId]?.[colorField.id] : undefined, timeZone)), [rawEvents, rawCells, rowIds, dateField?.id, colorField, timeZone]);
  const noDateRows = useMemo(() => dateField ? state.rowIds.filter(rowId => {
    const cell = rawCells[rowId]?.[dateField.id];
    return cell?.kind === 'date' && cell.timestamp === null && !cell.error;
  }).map(rowId => ({ rowId, title: (primaryField ? rawCells[rowId]?.[primaryField.id]?.display.trim() : '') || 'Untitled' })) : [], [dateField, state.rowIds, rawCells, primaryField]);
  // ReUI's public update contract is synchronous. Reject its local commit and
  // publish only the authoritative events after the asynchronous Rust write.
  const onEventUpdate = useCallback((update: EventCalendarProposedUpdate<HyperCalendarEventData>) => {
    if (pending.current.has(update.event.id)) return false;
    pending.current.add(update.event.id);
    void hyperCalendarWriteUpdate(controller, update, rawCells[update.event.id]?.[update.event.data?.dateFieldId ?? ''])
      .catch(cause => showToast({ type: 'error', message: hyperCalendarError(cause) }))
      .finally(() => { pending.current.delete(update.event.id); refetch(); });
    return false;
  }, [controller, refetch, rawCells]);
  return { dateField, dateFields, colorField, colorFields, primaryField, changeColorBy, events, noDateRows, onRangeChange, onEventUpdate, refetch,
    loading: state.status !== 'ready' || Boolean(dateField && fetchedField !== dateField.id), error, setting };
}
