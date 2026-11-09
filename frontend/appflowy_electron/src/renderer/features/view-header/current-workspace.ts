// The slice of UserWorkspaceBloc (features/workspace/logic/workspace_bloc.dart) the page header
// reads: the current workspace's role, type and name. The sidebar owns the full bloc; this
// keeps the header independent of it.
import { useEffect } from 'react';
import { create } from 'zustand';
import type { UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventGetAllWorkspace } from '@/backend/events';
import { useHomeStore } from '@/features/home/home-store';

const useStore = create<{ workspaceId: string | null; workspace: UserWorkspacePB | null }>(() => ({
  workspaceId: null,
  workspace: null,
}));

let inflight: string | null = null;

async function load(workspaceId: string) {
  if (inflight === workspaceId) return;
  inflight = workspaceId;
  const result = await UserEventGetAllWorkspace();
  inflight = null;
  if (!result.ok) return;
  const workspace = result.value.items.find((w) => w.workspaceId === workspaceId) ?? null;
  if (useHomeStore.getState().workspaceSetting?.workspaceId === workspaceId) {
    useStore.setState({ workspaceId, workspace });
  }
}

/** UserWorkspaceBloc.state.currentWorkspace (null until loaded). */
export function useCurrentWorkspace(): UserWorkspacePB | null {
  const workspaceId = useHomeStore((s) => s.workspaceSetting?.workspaceId ?? null);
  const state = useStore();
  useEffect(() => {
    if (workspaceId && state.workspaceId !== workspaceId) void load(workspaceId);
  }, [workspaceId, state.workspaceId]);
  return state.workspaceId === workspaceId ? state.workspace : null;
}
