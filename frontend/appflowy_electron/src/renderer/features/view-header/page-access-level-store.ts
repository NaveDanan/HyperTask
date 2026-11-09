// PageAccessLevelBloc (features/page_access_level/logic/page_access_level_bloc.dart), one per
// view plugin (created in Plugin.init()).
import { clone } from '@bufbuild/protobuf';
import { createStore, type StoreApi } from 'zustand';
import { AFAccessLevelPB, SharedViewSectionPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB, AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import {
  FolderEventGetSharedUsers,
  FolderEventGetSharedViewSection,
  FolderEventGetView,
  FolderEventLockView,
  FolderEventReadCurrentWorkspace,
  FolderEventUnlockView,
  UserEventGetAllWorkspace,
  UserEventGetUserProfile,
} from '@/backend/events';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { listenView } from './view-listener';

/** SharedSectionType (features/share_tab/data/models/share_section_type.dart). */
export enum SharedSectionType {
  unknown = 'unknown',
  public = 'public',
  private = 'private',
  shared = 'shared',
}

/** ShareAccessLevel (features/share_tab/data/models/share_access_level.dart). */
export enum ShareAccessLevel {
  readOnly = 'readOnly',
  readAndComment = 'readAndComment',
  readAndWrite = 'readAndWrite',
  fullAccess = 'fullAccess',
}

export const viewIsLocked = (view: Pick<ViewPB, 'oneOfIsLocked'>) =>
  view.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value;

/** FeatureFlag.sharedSection: off unless the dev flag JSON turns it on. */
export function isSharedSectionOn(): boolean {
  try {
    const flags = KeyValueStorage.getJson<Record<string, unknown>>(KVKeys.featureFlag);
    return flags?.sharedSection === true;
  } catch {
    return false;
  }
}

export function sectionTypeFromPB(section: SharedViewSectionPB): SharedSectionType {
  switch (section) {
    case SharedViewSectionPB.PublicSection:
      return SharedSectionType.public;
    case SharedViewSectionPB.PrivateSection:
      return SharedSectionType.private;
    case SharedViewSectionPB.SharedSection:
      return SharedSectionType.shared;
    default:
      return SharedSectionType.unknown;
  }
}

function accessLevelFromPB(level: AFAccessLevelPB): ShareAccessLevel {
  switch (level) {
    case AFAccessLevelPB.FullAccess:
      return ShareAccessLevel.fullAccess;
    case AFAccessLevelPB.ReadAndWrite:
      return ShareAccessLevel.readAndWrite;
    case AFAccessLevelPB.ReadAndComment:
      return ShareAccessLevel.readAndComment;
    default:
      return ShareAccessLevel.readOnly;
  }
}

export interface PageAccessLevelState {
  view: ViewPB;
  isLocked: boolean;
  /** Incremented on every unlock during this session (drives the "Re-lock" chip). */
  lockCounter: number;
  isLoadingLockStatus: boolean;
  accessLevel: ShareAccessLevel;
  sectionType: SharedSectionType;
}

export const isEditable = (s: PageAccessLevelState) =>
  isSharedSectionOn() ? s.accessLevel !== ShareAccessLevel.readOnly && !s.isLocked : !s.isLocked;
export const isReadOnly = (s: PageAccessLevelState) => s.accessLevel === ShareAccessLevel.readOnly;

export interface PageAccessLevelStore extends StoreApi<PageAccessLevelState> {
  /** PageAccessLevelEvent.initial(): starts the view listener and loads; returns the stop function. */
  start(): () => void;
  lock(): Promise<void>;
  unlock(): Promise<void>;
  updateLockStatus(isLocked: boolean, lockCounter?: number): void;
  updateSectionType(sectionType: SharedSectionType): void;
}

async function getSectionType(viewId: string): Promise<SharedSectionType | null> {
  const result = await FolderEventGetSharedViewSection({ value: viewId });
  return result.ok ? sectionTypeFromPB(result.value.section) : null;
}

/** RustPageAccessLevelRepositoryImpl.getAccessLevel. */
async function getAccessLevel(viewId: string): Promise<ShareAccessLevel> {
  const user = await UserEventGetUserProfile();
  if (!user.ok) return ShareAccessLevel.readOnly;
  if (user.value.userAuthType === AuthTypePB.Local) return ShareAccessLevel.fullAccess;
  if (user.value.workspaceType === WorkspaceTypePB.LocalW) return ShareAccessLevel.fullAccess;
  const view = await FolderEventGetView({ value: viewId });
  if (view.ok && view.value.oneOfCreatedBy.case === 'createdBy' && view.value.oneOfCreatedBy.value === user.value.id) {
    return ShareAccessLevel.fullAccess;
  }
  const current = await FolderEventReadCurrentWorkspace();
  if (!current.ok) return ShareAccessLevel.readOnly;
  const workspaces = await UserEventGetAllWorkspace();
  const workspace = workspaces.ok ? workspaces.value.items.find((w) => w.workspaceId === current.value.id) : undefined;
  const role = workspace?.oneOfRole.case === 'role' ? workspace.oneOfRole.value : undefined;
  const section = await getSectionType(viewId);
  if (section === SharedSectionType.public && role !== AFRolePB.Guest) {
    return ShareAccessLevel.fullAccess;
  }
  const shared = await FolderEventGetSharedUsers({ viewId });
  if (!shared.ok) return ShareAccessLevel.readOnly;
  const me = shared.value.items.find((item) => item.email === user.value.email);
  return me ? accessLevelFromPB(me.accessLevel) : ShareAccessLevel.readOnly;
}

/** Creates the bloc; call start() (from an effect) to dispatch PageAccessLevelEvent.initial(). */
export function createPageAccessLevelStore(view: ViewPB): PageAccessLevelStore {
  const store = createStore<PageAccessLevelState>(() => ({
    view,
    isLocked: false,
    lockCounter: 0,
    isLoadingLockStatus: true,
    accessLevel: ShareAccessLevel.readOnly,
    sectionType: SharedSectionType.public,
  }));
  let active = false;
  const set = (partial: Partial<PageAccessLevelState>) => {
    if (active) store.setState(partial);
  };

  const updateLockStatus = (isLocked: boolean, lockCounter?: number) => {
    const s = store.getState();
    // The bloc only emits states that differ (its view copy only differs in is_locked).
    if (s.isLocked === isLocked && (lockCounter ?? s.lockCounter) === s.lockCounter) return;
    const updated = clone(ViewPBSchema, s.view);
    updated.oneOfIsLocked = { case: 'isLocked', value: isLocked };
    set({ view: updated, isLocked, lockCounter: lockCounter ?? s.lockCounter });
  };

  const initial = async () => {
    const sectionType = (await getSectionType(view.id)) ?? SharedSectionType.public;
    if (!isSharedSectionOn()) {
      set({ view, isLocked: viewIsLocked(view), isLoadingLockStatus: false, accessLevel: ShareAccessLevel.fullAccess, sectionType });
      return;
    }
    const latest = await FolderEventGetView({ value: view.id });
    const latestView = latest.ok ? latest.value : view;
    const accessLevel = await getAccessLevel(view.id);
    set({ view: latestView, isLocked: viewIsLocked(latestView), isLoadingLockStatus: false, accessLevel, sectionType });
  };

  return Object.assign(store, {
    start() {
      active = true;
      const stopListening = listenView(view.id, {
        onViewUpdated: (updated) => updateLockStatus(viewIsLocked(updated)),
      });
      void initial();
      return () => {
        active = false;
        stopListening();
      };
    },
    async lock() {
      const result = await FolderEventLockView({ value: view.id });
      updateLockStatus(result.ok);
    },
    async unlock() {
      const result = await FolderEventUnlockView({ value: view.id });
      updateLockStatus(!result.ok, store.getState().lockCounter + 1);
    },
    updateLockStatus,
    updateSectionType(sectionType: SharedSectionType) {
      if (store.getState().sectionType !== sectionType) set({ sectionType });
    },
  });
}
