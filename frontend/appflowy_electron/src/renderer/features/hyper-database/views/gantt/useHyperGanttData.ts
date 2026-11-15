import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, startOfDay } from 'date-fns';
import type { GanttEvent, GanttProposedUpdate } from '@/components/reui/gantt/gantt-types';
import { viewExtra } from '@/features/view/view-ext';
import { showToast } from '@/ui/toast';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { useHyperDatabaseScan } from '../../useHyperDatabaseScan';
import type { HyperDatabaseViewProps } from '../../HyperDatabaseTypes';
import { hyperGanttDateWrites, hyperGanttWrittenTiming, hyperGanttMap, hyperGanttReadConfig, type HyperGanttConfig } from './HyperGanttMapping';
import { hyperGanttClearDates, hyperGanttCommitDates } from './HyperGanttMutations';

export function useHyperGanttData({ controller, state, view }: HyperDatabaseViewProps) {
  const [config, setConfig] = useState(() => hyperGanttReadConfig(view, state));
  const configRef = useRef(config);
  const configVersion = useRef(0);
  const persistedConfig = useRef(config);
  const saveQueue = useRef(Promise.resolve());
  const [initialized, setInitialized] = useState(false);
  const [pending, setPending] = useState(new Map<string, GanttEvent>());
  const writing = useRef(new Set<string>());
  const dateKey = state.fields.filter(f => f.type === FieldType.DateTime).map(f => f.id).join(',');
  const fieldKey = [...new Set([state.fields.find(f => f.isPrimary)?.id, config.start_field_id, config.end_field_id, config.color_field_id, config.progress_field_id, config.assignee_field_id].filter((id): id is string => !!id))].join(',');

  const scan = useHyperDatabaseScan(controller, state, state.rowIds, [...new Set([...(dateKey ? dateKey.split(',') : []), ...fieldKey.split(',')].filter(Boolean))]);
  const indexedState = useMemo(() => ({ ...state, cells: scan.cells }), [state, scan.cells]);

  const saveConfig = useCallback((patch: Partial<HyperGanttConfig>) => {
    const version = ++configVersion.current;
    const next = { ...configRef.current, ...patch };
    if (next.end_field_id === next.start_field_id) next.end_field_id = null;
    configRef.current = next;
    setConfig(next);
    const save = saveQueue.current.then(async () => {
      const rebased = { ...persistedConfig.current, ...patch };
      if (rebased.end_field_id === rebased.start_field_id) rebased.end_field_id = null;
      await controller.updateViewExtra({ hyper_gantt: rebased });
      persistedConfig.current = rebased;
      if (version === configVersion.current) { configRef.current = rebased; setConfig(rebased); }
    });
    saveQueue.current = save.catch(() => {});
    return save.catch(error => {
      if (version === configVersion.current) { configRef.current = persistedConfig.current; setConfig(persistedConfig.current); }
      showToast({ type: 'error', message: "Couldn't save Gantt settings" });
      throw error;
    });
  }, [controller]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    let active = true;
    const version = configVersion.current;
    void controller.scanRows(controller.state.rowIds, [...(dateKey ? dateKey.split(',') : []), ...controller.state.fields.filter(f => f.isPrimary).map(f => f.id)], () => active).then(cells => {
      if (!active) return;
      setInitialized(true);
      if (version !== configVersion.current) return;
      const next = hyperGanttReadConfig(controller.state.view ?? view, { ...controller.state, cells });
      configRef.current = next; persistedConfig.current = next; setConfig(next);
      if (!viewExtra(controller.state.view ?? view)?.hyper_gantt) void saveConfig(next).catch(() => {});
    });
    return () => { active = false; };
    // Hydrate field choices only on schema changes; cell changes must not reset edits.
  }, [controller, dateKey, state.fields, state.status, saveConfig, view.id]);
  const mapped = useMemo(() => hyperGanttMap(indexedState, config), [indexedState, config]);
  const events = useMemo(() => mapped.events.map(event => pending.get(event.id) ?? event).concat([...pending.values()].filter(event => !mapped.tasks.get(event.id)?.event)), [mapped, pending]);
  const setDates = useCallback(async (rowId: string, start: Date, end: Date, move = false) => {
    if (writing.current.has(rowId)) throw new Error('Dates are still saving');
    const currentConfig = configRef.current;
    const cells = scan.cells[rowId] ?? controller.state.cells[rowId] ?? {};
    const writes = hyperGanttDateWrites(currentConfig, cells, start, end, move);
    const event = { ...(mapped.tasks.get(rowId)?.event ?? { id: rowId, resourceId: rowId, title: mapped.tasks.get(rowId)?.title ?? 'Untitled' }), ...hyperGanttWrittenTiming(writes) };
    writing.current.add(rowId);
    setPending(old => new Map(old).set(rowId, event));
    try { await hyperGanttCommitDates(controller, rowId, currentConfig, cells, start, end, move); }
    finally {
      writing.current.delete(rowId);
      setPending(old => { const next = new Map(old); next.delete(rowId); return next; });
    }
  }, [controller, mapped.tasks, scan.cells]);
  const commit = useCallback((update: GanttProposedUpdate) => {
    if (update.end < update.start || writing.current.has(update.event.id)) return false;
    const move = update.source === 'drag' || (update.source === 'keyboard' && update.start.getTime() !== update.event.start.getTime());
    let timing;
    try { timing = hyperGanttWrittenTiming(hyperGanttDateWrites(configRef.current, scan.cells[update.event.id] ?? controller.state.cells[update.event.id] ?? {}, update.start, update.end, move)); }
    catch { return false; }
    void setDates(update.event.id, update.start, update.end, move).catch(error => showToast({ type: 'error', message: error instanceof Error && error.message.includes('check both') ? error.message : "Couldn't update dates" }));
    return timing;
  }, [controller, setDates, scan.cells]);
  const clearDates = async (rowId: string) => {
    if (writing.current.has(rowId)) throw new Error('Dates are still saving');
    writing.current.add(rowId);
    try { await hyperGanttClearDates(controller, rowId, configRef.current, scan.cells[rowId] ?? controller.state.cells[rowId] ?? {}); }
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
