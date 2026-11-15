import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, startOfDay } from 'date-fns';
import type { GanttEvent, GanttProposedUpdate } from '@/components/reui/gantt/gantt-types';
import { viewExtra } from '@/features/view/view-ext';
import { showToast } from '@/ui/toast';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { HyperDatabaseViewProps } from '../../HyperDatabaseTypes';
import { hyperGanttDateWrites, hyperGanttWrittenTiming, hyperGanttMap, hyperGanttReadConfig, type HyperGanttConfig } from './HyperGanttMapping';
import { hyperGanttClearDates, hyperGanttCommitDates } from './HyperGanttMutations';

export function useHyperGanttData({ controller, state, view }: HyperDatabaseViewProps) {
  const [config, setConfig] = useState(() => hyperGanttReadConfig(view, state));
  const configRef = useRef(config);
  const configVersion = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const [initialized, setInitialized] = useState(false);
  const [pending, setPending] = useState(new Map<string, GanttEvent>());
  const writing = useRef(new Set<string>());
  const rowKey = state.rowIds.join(',');
  const dateKey = state.fields.filter(f => f.type === FieldType.DateTime).map(f => f.id).join(',');
  const fieldKey = [...new Set([state.fields.find(f => f.isPrimary)?.id, config.start_field_id, config.end_field_id, config.color_field_id, config.progress_field_id, config.assignee_field_id].filter((id): id is string => !!id))].join(',');

  const saveConfig = useCallback((patch: Partial<HyperGanttConfig>) => {
    configVersion.current++;
    const previous = configRef.current;
    const next = { ...previous, ...patch };
    if (next.end_field_id === next.start_field_id) next.end_field_id = null;
    configRef.current = next;
    setConfig(next);
    const save = saveQueue.current.then(() => controller.updateViewExtra({ hyper_gantt: next }));
    saveQueue.current = save.catch(() => {});
    return save.catch(error => {
      if (configRef.current === next) { configRef.current = previous; setConfig(previous); }
      showToast({ type: 'error', message: "Couldn't save Gantt settings" });
      throw error;
    });
  }, [controller]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    let active = true;
    const version = configVersion.current;
    void Promise.all([controller.loadRows(controller.state.rowIds, [...(dateKey ? dateKey.split(',') : []), ...controller.state.fields.filter(f => f.isPrimary).map(f => f.id)]), controller.loadRows(controller.state.rowIds.slice(0, 50), fieldKey.split(','))]).then(() => {
      if (!active) return;
      setInitialized(true);
      if (version !== configVersion.current) return;
      const next = hyperGanttReadConfig(controller.state.view ?? view, controller.state);
      configRef.current = next; setConfig(next);
      if (!viewExtra(controller.state.view ?? view)?.hyper_gantt) void saveConfig(next).catch(() => {});
    });
    return () => { active = false; };
    // Hydrate field choices only on schema changes; cell changes must not reset edits.
  }, [controller, dateKey, state.status, saveConfig, view.id]);
  useEffect(() => {
    if (state.status === 'ready') void controller.loadRows(state.rowIds, [...(dateKey ? dateKey.split(',') : []), ...state.fields.filter(f => f.isPrimary).map(f => f.id)]);
  }, [controller, rowKey, dateKey, state.status]);

  useEffect(() => {
    if (state.status === 'ready' && fieldKey) void controller.loadRows(state.rowIds.slice(0, 50), fieldKey.split(','));
  }, [controller, rowKey, fieldKey, state.status]);

  useEffect(() => {
    if (state.status === 'ready' && state.fields.some(f => f.id === config.progress_field_id && f.type === FieldType.Number)) {
      void controller.loadRows(state.rowIds, [config.progress_field_id!]);
    }
  }, [controller, rowKey, config.progress_field_id, state.status]);

  const mapped = useMemo(() => hyperGanttMap(state, config), [state.cells, state.rowIds, state.fields, config]);
  const events = useMemo(() => mapped.events.map(event => pending.get(event.id) ?? event).concat([...pending.values()].filter(event => !mapped.tasks.get(event.id)?.event)), [mapped, pending]);
  const setDates = useCallback(async (rowId: string, start: Date, end: Date) => {
    if (writing.current.has(rowId)) throw new Error('Dates are still saving');
    const currentConfig = configRef.current;
    const cells = controller.state.cells[rowId] ?? {};
    const writes = hyperGanttDateWrites(currentConfig, cells, start, end);
    const event = { ...(mapped.tasks.get(rowId)?.event ?? { id: rowId, resourceId: rowId, title: mapped.tasks.get(rowId)?.title ?? 'Untitled' }), ...hyperGanttWrittenTiming(writes) };
    writing.current.add(rowId);
    setPending(old => new Map(old).set(rowId, event));
    try { await hyperGanttCommitDates(controller, rowId, currentConfig, cells, start, end); }
    finally {
      writing.current.delete(rowId);
      setPending(old => { const next = new Map(old); next.delete(rowId); return next; });
    }
  }, [controller, mapped.tasks]);
  const commit = useCallback((update: GanttProposedUpdate) => {
    if (update.end < update.start || writing.current.has(update.event.id)) return false;
    let timing;
    try { timing = hyperGanttWrittenTiming(hyperGanttDateWrites(configRef.current, controller.state.cells[update.event.id] ?? {}, update.start, update.end)); }
    catch { return false; }
    void setDates(update.event.id, update.start, update.end).catch(error => showToast({ type: 'error', message: error instanceof Error && error.message.includes('check both') ? error.message : "Couldn't update dates" }));
    return timing;
  }, [controller, setDates]);
  const clearDates = async (rowId: string) => {
    if (writing.current.has(rowId)) throw new Error('Dates are still saving');
    writing.current.add(rowId);
    try { await hyperGanttClearDates(controller, rowId, configRef.current, controller.state.cells[rowId] ?? {}); }
    finally { writing.current.delete(rowId); }
  };
  const createTask = async () => {
    const row = await controller.createRow();
    await controller.loadRows([row.id], fieldKey.split(','));
    if (configRef.current.start_field_id) await setDates(row.id, startOfDay(new Date()), addDays(startOfDay(new Date()), 3));
    return row.id;
  };
  const addDateField = async () => {
    const field = await controller.createField('Dates', FieldType.DateTime);
    await saveConfig({ start_field_id: field.id, end_field_id: null });
  };
  return { ...mapped, events, fieldIds: fieldKey.split(','), fieldKey, config, saveConfig, initialized, setDates, commit, clearDates, createTask, addDateField };
}
