import { createStore } from 'zustand';
import { listenAll } from '@/backend/notifications';
import { DatabaseNotification } from '@shared/protobuf/flowy-database2/notification_pb';
import type { GroupPB } from '@shared/protobuf/flowy-database2/group_pb';
import { DatabaseLayoutPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { HyperDatabaseRepository, type HyperDatabaseSnapshot } from './HyperDatabaseRepository';

export interface HyperDatabaseState {
  snapshot: HyperDatabaseSnapshot | null;
  groups: GroupPB[];
  calendar: Awaited<ReturnType<HyperDatabaseRepository['calendar']>>;
  error: string | null;
  loading: boolean;
  writing: boolean;
  cellRevision: number;
}
export const hyperDatabaseError = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);

export function createHyperDatabaseStore(viewId: string, repository = new HyperDatabaseRepository()) {
  const store = createStore<HyperDatabaseState>(() => ({ snapshot: null, groups: [], calendar: { events: [], undated: [] }, error: null, loading: true, writing: false, cellRevision: 0 }));
  let active = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let writing = 0;
  const refresh = async () => {
    const request = ++generation;
    try {
      const snapshot = await repository.load(viewId);
      const groups = snapshot.database.layoutType === DatabaseLayoutPB.Board ? await repository.groups(viewId) : [];
      const calendar = snapshot.database.layoutType === DatabaseLayoutPB.Calendar ? await repository.calendar(viewId) : { events: [], undated: [] };
      if (active && request === generation) store.setState({ snapshot, groups, calendar, loading: false });
    } catch (error) { if (active && request === generation) store.setState({ error: hyperDatabaseError(error), loading: false }); }
  };
  const scheduleRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 75);
  };
  return Object.assign(store, {
    repository,
    viewId,
    refresh,
    start() {
      active = true;
      void refresh();
      const stop = listenAll(subject => {
        if (subject.source !== 'Database') return;
        const snapshot = store.getState().snapshot;
        const relevantObject = subject.id === viewId || snapshot?.database.id === subject.id || snapshot?.fields.some(field => field.id === subject.id) || snapshot?.database.rows.some(row => row.id === subject.id);
        // Cell notifications use a row/field compound id and are shared across linked views.
        if (subject.ty === DatabaseNotification.DidUpdateCell && snapshot?.database.rows.some(row => subject.id.startsWith(`${row.id}:`))) {
          store.setState(state => ({ cellRevision: state.cellRevision + 1 }));
          if (snapshot?.database.layoutType !== DatabaseLayoutPB.Grid) scheduleRefresh();
        } else if (relevantObject) scheduleRefresh();
      });
      return () => { active = false; generation++; clearTimeout(timer); stop(); };
    },
    async write<T>(operation: () => Promise<T>): Promise<T | null> {
      writing++;
      if (active) store.setState({ writing: true, error: null });
      try {
        const result = await operation();
        if (active) { store.setState(state => ({ cellRevision: state.cellRevision + 1 })); await refresh(); }
        return result;
      } catch (error) {
        if (active) store.setState({ error: hyperDatabaseError(error) });
        return null;
      } finally { writing--; if (active) store.setState({ writing: writing > 0 }); }
    },
    clearError() { store.setState({ error: null }); },
  });
}
export type HyperDatabaseStore = ReturnType<typeof createHyperDatabaseStore>;
