import { sidebarSpace } from '@/features/sidebar/stores/space-store';
import { ensureHyperGeneralKanban } from '@/features/hyper-home/HyperGeneralKanban';
import { createHyperJiraStore } from './jira-store';
import { startHyperJiraScheduler } from './HyperJiraScheduler';

type HyperJiraEntry = { store: ReturnType<typeof createHyperJiraStore>; consumers: number; session: symbol | null; stop?: () => void };
const hyperJiraStores = new Map<string, HyperJiraEntry>();
export function getHyperJiraStore(userId: string) {
  let entry = hyperJiraStores.get(userId);
  if (!entry) {
    const store = createHyperJiraStore({ userId, afterSync: async (config, issues) => {
      const session = entry!.session, workspaceId = sidebarSpace.actions.workspaceId;
      const isCurrent = () => session !== null && entry!.session === session && entry!.store.getState().kanbanEnabled &&
        entry!.store.getState().config?.encode() === config.encode() &&
        sidebarSpace.store.getState().isInitialized && sidebarSpace.actions.workspaceId === workspaceId;
      if (!workspaceId || !isCurrent()) return;
      const view = await ensureHyperGeneralKanban(workspaceId);
      if (!isCurrent()) return;
      const { HyperJiraKanbanMapper } = await import('../data/HyperJiraKanbanMapper');
      await new HyperJiraKanbanMapper().sync(view.id, config, issues, isCurrent);
    } });
    entry = { store, consumers: 0, session: null };
    hyperJiraStores.set(userId, entry);
  }
  return entry.store;
}
export function startHyperJiraBackgroundSync(userId: string) {
  const store = getHyperJiraStore(userId), entry = hyperJiraStores.get(userId)!;
  if (entry.consumers++ === 0) { entry.session = Symbol(userId); entry.stop = startHyperJiraScheduler(store.getState, window); }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--entry.consumers === 0) { entry.session = null; entry.stop?.(); entry.stop = undefined; }
  };
}
