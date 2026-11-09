import { create as createMessage, fromBinary } from '@bufbuild/protobuf';
import { create } from 'zustand';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FlowyErrorSchema, type FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import { UserNotification } from '@shared/protobuf/flowy-user/notification_pb';
import {
  RepeatedUserWorkspacePBSchema,
  UserProfilePBSchema,
  UserWorkspacePBSchema,
  type UserProfilePB,
  type UserWorkspacePB,
} from '@shared/protobuf/flowy-user/user_profile_pb';
import { AFRolePB, AuthTypePB, WorkspaceTypePB, type WorkspaceSubscriptionInfoPB } from '@shared/protobuf/flowy-user/workspace_pb';
import {
  FolderEventReadCurrentWorkspace,
  UserEventChangeWorkspaceIcon,
  UserEventCreateWorkspace,
  UserEventDeleteWorkspace,
  UserEventGetAllWorkspace,
  UserEventGetCloudConfig,
  UserEventGetWorkspaceSubscriptionInfo,
  UserEventLeaveWorkspace,
  UserEventOpenWorkspace,
  UserEventRenameWorkspace,
} from '@/backend/events';
import type { FlowyResult } from '@/backend/dispatch';
import { NotificationSource, listen } from '@/backend/notifications';
import { tr } from '@/i18n';
import { reminderActions } from './reminder-store';

export type WorkspaceActionType =
  | 'none'
  | 'create'
  | 'delete'
  | 'open'
  | 'rename'
  | 'updateIcon'
  | 'fetchWorkspaces'
  | 'leave'
  | 'fetchSubscriptionInfo';

export interface WorkspaceActionResult {
  actionType: WorkspaceActionType;
  isLoading: boolean;
  result: FlowyResult<unknown> | null;
}

export interface UserWorkspaceState {
  userProfile: UserProfilePB | null;
  currentWorkspace: UserWorkspacePB | null;
  /** Always sorted by createdAtTimestamp ascending. */
  workspaces: UserWorkspacePB[];
  actionResult: WorkspaceActionResult | null;
  isCollabWorkspaceOn: boolean;
  workspaceSubscriptionInfo: WorkspaceSubscriptionInfoPB | null;
}

const initialState = (): UserWorkspaceState => ({
  userProfile: null,
  currentWorkspace: null,
  workspaces: [],
  actionResult: null,
  isCollabWorkspaceOn: false,
  workspaceSubscriptionInfo: null,
});

/** UserWorkspaceBloc (features/workspace/logic/workspace_bloc.dart). One per user session. */
export const useWorkspaceStore = create<UserWorkspaceState>(initialState);

const get = useWorkspaceStore.getState;
const set = useWorkspaceStore.setState;

/** UserWorkspacePB.role: the Dart getter returns AFRolePB.Owner (the enum default) when unset. */
export const workspaceRole = (workspace: UserWorkspacePB | null | undefined): AFRolePB | undefined =>
  workspace ? (workspace.oneOfRole.case === 'role' ? workspace.oneOfRole.value : AFRolePB.Owner) : undefined;

export const sortWorkspaces = (workspaces: UserWorkspacePB[]) =>
  [...workspaces].sort((a, b) => (a.createdAtTimestamp < b.createdAtTimestamp ? -1 : a.createdAtTimestamp > b.createdAtTimestamp ? 1 : 0));

const findById = (id: string, list: UserWorkspacePB[] = get().workspaces) => list.find((w) => w.workspaceId === id) ?? null;

let stopListener: (() => void) | null = null;
let generation = 0;

interface FetchResult {
  currentWorkspace: UserWorkspacePB | null;
  workspaces: UserWorkspacePB[];
  shouldOpenWorkspace: boolean;
}

/** _fetchWorkspaces: the folder's current workspace, resolved in the user's workspace list. */
async function fetchWorkspaces(initialWorkspaceId?: string): Promise<FetchResult> {
  const current = await FolderEventReadCurrentWorkspace();
  const folderWorkspace = current.ok ? current.value : null;
  const currentId = initialWorkspaceId ?? folderWorkspace?.id;
  const all = await UserEventGetAllWorkspace();
  if (!all.ok) {
    return { currentWorkspace: get().currentWorkspace, workspaces: get().workspaces, shouldOpenWorkspace: false };
  }
  const workspaces = [...all.value.items];
  if (workspaces.length === 0 && folderWorkspace) {
    workspaces.push(
      createMessage(UserWorkspacePBSchema, {
        workspaceId: folderWorkspace.id,
        name: folderWorkspace.name,
        createdAtTimestamp: folderWorkspace.createTime,
      }),
    );
  }
  const inList = findById(currentId ?? '', workspaces) ?? workspaces[0] ?? null;
  return {
    currentWorkspace: inList,
    workspaces: sortWorkspaces(workspaces),
    shouldOpenWorkspace: inList?.workspaceId !== currentId,
  };
}

function updateInList(workspaceId: string, update: (w: UserWorkspacePB) => UserWorkspacePB) {
  return get().workspaces.map((w) => (w.workspaceId === workspaceId ? update(w) : w));
}

const failure = (msg: string, code = ErrorCode.Internal): FlowyResult<never> => ({
  ok: false,
  error: createMessage(FlowyErrorSchema, { code, msg }) as FlowyError,
});

/** isBillingEnabled (setting_appflowy_cloud.dart): only the vendor beta/test servers. */
async function isBillingEnabled(): Promise<boolean> {
  const result = await UserEventGetCloudConfig();
  if (!result.ok) return false;
  return ['https://beta.appflowy.cloud', 'https://test.appflowy.cloud'].includes(result.value.serverUrl);
}

export const workspaceActions = {
  /** UserWorkspaceEvent.initialize(). */
  async initialize(userProfile: UserProfilePB) {
    const gen = ++generation;
    stopListener?.();
    set({ ...initialState(), userProfile });
    stopListener = listen<UserNotification>(
      NotificationSource.User,
      (ty, result) => {
        if (!result.ok || gen !== generation) return;
        switch (ty) {
          case UserNotification.DidUpdateUserProfile:
          case UserNotification.DidOpenWorkspace:
            set({ userProfile: fromBinary(UserProfilePBSchema, result.value) });
            break;
          case UserNotification.DidUpdateUserWorkspaces:
            set({ workspaces: sortWorkspaces(fromBinary(RepeatedUserWorkspacePBSchema, result.value).items) });
            break;
          case UserNotification.DidUpdateUserWorkspace: {
            const workspace = fromBinary(UserWorkspacePBSchema, result.value);
            if (get().currentWorkspace?.workspaceId === workspace.workspaceId) set({ currentWorkspace: workspace });
            break;
          }
          default:
            break;
        }
      },
      String(userProfile.id),
    );

    const fetched = await fetchWorkspaces();
    if (gen !== generation) return;
    // collaborativeWorkspace is forced on in this checkout.
    const isCollabWorkspaceOn = userProfile.userAuthType === AuthTypePB.Server;
    if (fetched.currentWorkspace) void workspaceActions.fetchWorkspaceSubscriptionInfo(fetched.currentWorkspace.workspaceId);
    if (fetched.currentWorkspace && fetched.shouldOpenWorkspace) {
      await UserEventOpenWorkspace({
        workspaceId: fetched.currentWorkspace.workspaceId,
        workspaceType: fetched.currentWorkspace.workspaceType,
      });
    }
    if (gen !== generation) return;
    set({
      currentWorkspace: fetched.currentWorkspace,
      workspaces: fetched.workspaces,
      isCollabWorkspaceOn,
      actionResult: { actionType: 'none', isLoading: false, result: null },
    });
  },

  dispose() {
    generation++;
    stopListener?.();
    stopListener = null;
    set(initialState());
  },

  async fetchWorkspaces(initialWorkspaceId?: string) {
    const gen = generation;
    const fetched = await fetchWorkspaces(initialWorkspaceId);
    if (gen !== generation) return;
    set({ workspaces: fetched.workspaces });
    const current = fetched.currentWorkspace;
    if (current && current.workspaceId !== get().currentWorkspace?.workspaceId) {
      void workspaceActions.openWorkspace(current.workspaceId, current.workspaceType);
    }
  },

  async createWorkspace(name: string, workspaceType: WorkspaceTypePB = WorkspaceTypePB.ServerW) {
    const gen = generation;
    set({ actionResult: { actionType: 'create', isLoading: true, result: null } });
    const result = await UserEventCreateWorkspace({ name, workspaceType });
    if (gen !== generation) return;
    const workspaces = result.ok ? [...get().workspaces, result.value] : get().workspaces;
    set({ workspaces: sortWorkspaces(workspaces), actionResult: { actionType: 'create', isLoading: false, result } });
    if (result.ok) void workspaceActions.openWorkspace(result.value.workspaceId, result.value.workspaceType);
  },

  async deleteWorkspace(workspaceId: string) {
    const gen = generation;
    set({ actionResult: { actionType: 'delete', isLoading: true, result: null } });
    const remote = (await fetchWorkspaces()).workspaces;
    if (gen !== generation) return;
    if (get().workspaces.length <= 1 || remote.length <= 1) {
      set({
        actionResult: {
          actionType: 'delete',
          isLoading: false,
          result: failure(tr('workspace.cannotDeleteTheOnlyWorkspace')),
        },
      });
      return;
    }
    const result = await UserEventDeleteWorkspace({ workspaceId });
    const { workspaces } = await fetchWorkspaces();
    if (gen !== generation) return;
    const containsDeleted = findById(workspaceId, workspaces) !== null;
    if (result.ok) {
      const first = workspaces[0];
      if (get().currentWorkspace?.workspaceId === workspaceId && first) {
        void workspaceActions.openWorkspace(first.workspaceId, first.workspaceType);
      }
    } else if (!containsDeleted && workspaces.length > 0) {
      void workspaceActions.openWorkspace(workspaces[0].workspaceId, workspaces[0].workspaceType);
    }
    set({ workspaces, actionResult: { actionType: 'delete', isLoading: false, result } });
  },

  async openWorkspace(workspaceId: string, workspaceType: WorkspaceTypePB) {
    const gen = generation;
    set({ actionResult: { actionType: 'open', isLoading: true, result: null } });
    const result = await UserEventOpenWorkspace({ workspaceId, workspaceType });
    if (gen !== generation) return;
    const currentWorkspace = result.ok ? findById(workspaceId) : get().currentWorkspace;
    if (result.ok) void workspaceActions.fetchWorkspaceSubscriptionInfo(workspaceId);
    set({ currentWorkspace, actionResult: { actionType: 'open', isLoading: false, result } });
    reminderActions.started();
  },

  async renameWorkspace(workspaceId: string, name: string) {
    const gen = generation;
    const result = await UserEventRenameWorkspace({ workspaceId, newName: name });
    if (gen !== generation) return;
    const workspaces = result.ok ? updateInList(workspaceId, (w) => ({ ...w, name })) : get().workspaces;
    const currentWorkspace = findById(get().currentWorkspace?.workspaceId ?? '', workspaces);
    set({ workspaces, currentWorkspace, actionResult: { actionType: 'rename', isLoading: false, result } });
  },

  async updateWorkspaceIcon(workspaceId: string, icon: string) {
    const workspace = findById(workspaceId);
    if (!workspace || icon === workspace.icon) return;
    const gen = generation;
    const result = await UserEventChangeWorkspaceIcon({ workspaceId, newIcon: icon });
    if (gen !== generation) return;
    const workspaces = result.ok ? updateInList(workspaceId, (w) => ({ ...w, icon })) : get().workspaces;
    const currentWorkspace = findById(get().currentWorkspace?.workspaceId ?? '', workspaces);
    set({ workspaces, currentWorkspace, actionResult: { actionType: 'updateIcon', isLoading: false, result } });
  },

  async leaveWorkspace(workspaceId: string) {
    const gen = generation;
    const result = await UserEventLeaveWorkspace({ workspaceId });
    if (gen !== generation) return;
    const workspaces = result.ok ? get().workspaces.filter((w) => w.workspaceId !== workspaceId) : get().workspaces;
    if (result.ok && get().currentWorkspace?.workspaceId === workspaceId && workspaces.length > 0) {
      void workspaceActions.openWorkspace(workspaces[0].workspaceId, workspaces[0].workspaceType);
    }
    set({ workspaces: sortWorkspaces(workspaces), actionResult: { actionType: 'leave', isLoading: false, result } });
  },

  /** No-op for self-hosted servers (billing is only enabled for the vendor cloud). */
  async fetchWorkspaceSubscriptionInfo(workspaceId: string) {
    const gen = generation;
    if (!(await isBillingEnabled())) return;
    const result = await UserEventGetWorkspaceSubscriptionInfo({ workspaceId });
    if (gen !== generation || !result.ok) return;
    if (get().currentWorkspace?.workspaceId !== workspaceId) return;
    set({ workspaceSubscriptionInfo: result.value });
  },
};

const ICON_PALETTE: Array<[string, string]> = [
  ['#8A2BE2', '#F0E6FF'],
  ['#2E8B57', '#E0FFF0'],
  ['#1E90FF', '#E6F3FF'],
  ['#FF7F50', '#FFF0E6'],
  ['#FF69B4', '#FFE6F0'],
  ['#20B2AA', '#E0FFFF'],
  ['#DC143C', '#FFE6E6'],
  ['#8B4513', '#FFF0E6'],
];

/** ColorGenerator(name).randomColor(): (text, background) by the sum of UTF-16 code units. */
export function workspaceIconColors(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return ICON_PALETTE[hash % ICON_PALETTE.length];
}
