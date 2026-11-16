import { useEffect, useMemo, useState } from 'react';
import type { HyperDatabaseController } from './HyperDatabaseController';
import type { HyperDatabaseState } from './HyperDatabaseTypes';

/** Retain only requested fields; viewport cache writes never restart a scan. */
export function useHyperDatabaseScan(controller: HyperDatabaseController, state: HyperDatabaseState, rowIds: readonly string[], fieldIds: readonly string[], enabled = true, retry = 0) {
  const [result, setResult] = useState<{ cells: HyperDatabaseState['cells']; loading: boolean; error: string | null }>({ cells: {}, loading: true, error: null });
  const rowKey = rowIds.join(',');
  const fieldKey = fieldIds.join(',');
  useEffect(() => {
    if (!enabled || state.status !== 'ready') return;
    let active = true;
    setResult(previous => ({ ...previous, loading: true }));
    void controller.scanRows(rowIds, fieldIds, () => active).then(cells => {
      if (!active) return;
      const error = Object.values(cells).flatMap(row => Object.values(row)).find(cell => cell.error)?.error ?? null;
      setResult({ cells, loading: false, error });
    }).catch(error => { if (active) setResult(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) })); });
    return () => { active = false; };
  }, [controller, state.status, state.fields, state.dataRevision, rowKey, fieldKey, enabled, retry]);
  const cells = useMemo(() => {
    const next = { ...result.cells };
    for (const rowId of rowIds) {
      const cached = state.cells[rowId];
      if (!cached) continue;
      next[rowId] = { ...next[rowId] };
      for (const fieldId of fieldIds) if (cached[fieldId]) next[rowId][fieldId] = cached[fieldId];
    }
    return next;
  }, [result.cells, state.cells, rowKey, fieldKey]);
  return { ...result, cells };
}
