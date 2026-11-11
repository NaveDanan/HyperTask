import { useMemo } from 'react';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { useAppStore, type AppState } from '@/startup/app-store';

export interface HyperDocumentOwner {
  workspaceId: string;
  actorId: string;
  contextKey: string;
  isCurrent(): boolean;
}
const contextKey = (state: Pick<AppState, 'dataDirectory' | 'env'>) => JSON.stringify([state.dataDirectory, state.env?.authenticatorType ?? null, state.env?.appflowyCloudConfig.base_url ?? '']);
const opening = () => {
  const action = useWorkspaceStore.getState().actionResult;
  return action?.actionType === 'open' && action.isLoading;
};
export function hyperGetDocumentOwner(): HyperDocumentOwner | null {
  const current = useWorkspaceStore.getState();
  if (!current.currentWorkspace?.workspaceId || !current.userProfile || opening()) return null;
  const workspaceId = current.currentWorkspace.workspaceId, actorId = String(current.userProfile.id), context = contextKey(useAppStore.getState());
  return { workspaceId, actorId, contextKey: context, isCurrent: () => {
    const latest = useWorkspaceStore.getState();
    // Sidebar profile refresh briefly clears workspace metadata without switching the core.
    const sameWorkspace = latest.currentWorkspace?.workspaceId === workspaceId || latest.currentWorkspace === null && latest.actionResult === null;
    return !opening() && sameWorkspace && String(latest.userProfile?.id) === actorId && contextKey(useAppStore.getState()) === context;
  } };
}
export const hyperDocumentOwnerKey = (owner: HyperDocumentOwner | null) => owner ? JSON.stringify([owner.workspaceId, owner.actorId, owner.contextKey]) : '';

export function useHyperDocumentOwner(): HyperDocumentOwner | null {
  const workspaceId = useWorkspaceStore(state => state.currentWorkspace?.workspaceId ?? '');
  const actorId = useWorkspaceStore(state => state.userProfile ? String(state.userProfile.id) : '');
  const pending = useWorkspaceStore(state => state.actionResult?.actionType === 'open' && state.actionResult.isLoading);
  const context = useAppStore(contextKey);
  return useMemo(() => hyperGetDocumentOwner(), [workspaceId, actorId, pending, context]);
}
