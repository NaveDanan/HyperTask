import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { HyperDatabaseController } from './HyperDatabaseController';
import type { HyperDatabaseState } from './HyperDatabaseTypes';
import type { HyperDatabaseBackend } from './HyperDatabaseBackend';
/** Stable controller identity for a view; React StrictMode mount replay is supported. */
export function useHyperDatabase(viewId: string, backend?: HyperDatabaseBackend) {
  const controller = useMemo(() => new HyperDatabaseController(viewId, backend), [viewId, backend]);
  useEffect(() => { void controller.open(); return () => controller.dispose(); }, [controller]);
  const state = useStore(controller.store);
  return { controller, state };
}

/** Subscribe a cell/row child to only the slice it renders. Selector results must be stable. */
export function useHyperDatabaseSelector<T>(controller: HyperDatabaseController, selector: (state: HyperDatabaseState) => T): T {
  return useStore(controller.store, selector);
}
