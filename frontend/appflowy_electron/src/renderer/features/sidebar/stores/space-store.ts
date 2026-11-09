import { create as createMessage } from '@bufbuild/protobuf';
import { createStore, type StoreApi } from 'zustand';
import { ViewLayoutPB, ViewPBSchema, ViewSectionPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { FolderEventCreateView } from '@/backend/events';
import type { FlowyResult } from '@/backend/dispatch';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { ViewBackendService } from '@/features/view/view-service';
import {
  SpacePermission,
  ViewExtKeys,
  extraString,
  isSpace,
  spaceIcon,
  spaceIconColor,
  spacePermission,
} from '@/features/view/view-ext';
import { getFolderIsExpanded, setExpanded } from './expand-storage';
import { listenSectionViews, readSectionViews } from './sections-store';
import { builtInSpaceColors, builtInSpaceIcons, uniqueById } from './types';

export interface SpaceState {
  spaces: ViewPB[];
  currentSpace: ViewPB | null;
  isExpanded: boolean;
  /** A "please open this" signal; an empty ViewPB means "open the blank page". */
  lastCreatedPage: ViewPB | null;
  createPageResult: FlowyResult<unknown> | null;
  shouldShowUpgradeDialog: boolean;
  isDuplicatingSpace: boolean;
  isInitialized: boolean;
}

const initialState = (): SpaceState => ({
  spaces: [],
  currentSpace: null,
  isExpanded: true,
  lastCreatedPage: null,
  createPageResult: null,
  shouldShowUpgradeDialog: false,
  isDuplicatingSpace: false,
  isInitialized: false,
});

/** [public spaces..., private spaces...] in backend order, de-duplicated by id. */
export function spacesFromSections(publicViews: ViewPB[], privateViews: ViewPB[]): ViewPB[] {
  return [...uniqueById(publicViews).filter(isSpace), ...uniqueById(privateViews).filter(isSpace)];
}

/** _getLastOpenedSpace: KV lastOpenedSpaceId, falling back to the first space. */
export function lastOpenedSpace(spaces: ViewPB[], lastOpenedId: string | null): ViewPB | null {
  if (spaces.length === 0) return null;
  if (lastOpenedId === null) return spaces[0];
  return spaces.find((s) => s.id === lastOpenedId) ?? spaces[0];
}

/** switchToNextSpace target. Dart compares protobufs by value; ids are compared here. */
export function nextSpace(spaces: ViewPB[], current: ViewPB | null): ViewPB | null {
  if (spaces.length === 0 || !current) return null;
  const index = spaces.findIndex((s) => s.id === current.id);
  return spaces[(index + 1) % spaces.length];
}

/** SpaceBloc.update's extra: merge icon/color/permission, or (none given) drop the icon keys. */
export function updatedSpaceExtra(
  space: Pick<ViewPB, 'oneOfExtra'>,
  { icon, iconColor, permission }: { icon?: string | null; iconColor?: string | null; permission?: SpacePermission | null },
): string {
  const extra = extraString(space);
  const current = (extra ? JSON.parse(extra) : {}) as Record<string, unknown>;
  if (icon != null || iconColor != null || permission != null) {
    const updated: Record<string, unknown> = {};
    if (icon != null) updated[ViewExtKeys.spaceIcon] = icon;
    if (iconColor != null) updated[ViewExtKeys.spaceIconColor] = iconColor;
    if (permission != null) updated[ViewExtKeys.spacePermission] = permission;
    return JSON.stringify({ ...current, ...updated });
  }
  // BUG-COMPAT: saving the Manage dialog without touching icon/permission wipes the icon.
  delete current[ViewExtKeys.spaceIcon];
  delete current[ViewExtKeys.spaceIconColor];
  return JSON.stringify(current);
}

export interface SpaceStore {
  store: StoreApi<SpaceState>;
  actions: ReturnType<typeof spaceActionsFor>;
}

function spaceActionsFor(store: StoreApi<SpaceState>) {
  const get = store.getState;
  const set = store.setState;
  let userProfile: UserProfilePB | null = null;
  let workspaceId = '';
  let stopListener: (() => void) | null = null;
  let generation = 0;

  async function getSpaces() {
    const section = await readSectionViews(workspaceId);
    if (!section || section.publicViews.length + section.privateViews.length === 0) return [];
    return spacesFromSections(section.publicViews, section.privateViews);
  }

  const getLastOpened = (spaces: ViewPB[]) => lastOpenedSpace(spaces, KeyValueStorage.get(KVKeys.lastOpenedSpaceId));
  const getSpaceExpandStatus = (space: ViewPB | null) => (space ? getFolderIsExpanded(space.id) : true);

  function startListener() {
    stopListener?.();
    const gen = generation;
    stopListener = listenSectionViews(workspaceId, () => {
      if (gen === generation) void actions.didReceiveSpaceUpdate();
    });
  }

  async function createSpace({
    name,
    icon,
    iconColor,
    permission,
    viewId,
  }: {
    name: string;
    icon: string;
    iconColor: string;
    permission: SpacePermission;
    viewId?: string;
  }): Promise<ViewPB | null> {
    const extra = {
      [ViewExtKeys.isSpace]: true,
      [ViewExtKeys.spaceIcon]: icon,
      [ViewExtKeys.spaceIconColor]: iconColor,
      [ViewExtKeys.spacePermission]: permission,
      [ViewExtKeys.spaceCreatedAt]: Date.now(),
    };
    const result = await FolderEventCreateView({
      parentViewId: workspaceId,
      name,
      layout: ViewLayoutPB.Document,
      oneOfSection: {
        case: 'section',
        value: permission === SpacePermission.publicToAll ? ViewSectionPB.Public : ViewSectionPB.Private,
      },
      setAsCurrent: true,
      oneOfExtra: { case: 'extra', value: JSON.stringify(extra) },
      ...(viewId ? { oneOfViewId: { case: 'viewId', value: viewId } } : null),
    });
    return result.ok ? result.value : null;
  }

  const actions = {
    get userProfile() {
      return userProfile;
    },
    get workspaceId() {
      return workspaceId;
    },

    /** SpaceEvent.initial: the desktop sidebar passes openFirstPage = false. */
    async initial(user: UserProfilePB, wsId: string, openFirstPage: boolean) {
      userProfile = user;
      workspaceId = wsId;
      startListener();
      const gen = generation;
      const spaces = await getSpaces();
      if (gen !== generation) return;
      const currentSpace = getLastOpened(spaces);
      set({
        spaces,
        currentSpace,
        isExpanded: getSpaceExpandStatus(currentSpace),
        shouldShowUpgradeDialog: false,
        isInitialized: true,
      });
      if (openFirstPage && currentSpace) void actions.open(currentSpace);
    },

    /** Closes the bloc: stops the listener and drops in-flight results. */
    dispose() {
      generation++;
      stopListener?.();
      stopListener = null;
      set(initialState());
    },

    async create(options: {
      name: string;
      icon: string;
      iconColor: string;
      permission: SpacePermission;
      createNewPageByDefault: boolean;
      openAfterCreate: boolean;
    }) {
      const gen = generation;
      const space = await createSpace(options);
      if (!space || gen !== generation) return;
      set({ spaces: [...get().spaces, space], currentSpace: space });
      void actions.open(space);
      if (options.createNewPageByDefault) {
        void actions.createPage({ name: '', index: 0, layout: ViewLayoutPB.Document, openAfterCreate: options.openAfterCreate });
      }
    },

    /** No-op when only one space is left; the tree refreshes from DidUpdateSectionViews. */
    async delete(space?: ViewPB | null) {
      if (get().spaces.length <= 1) return;
      const target = space ?? get().currentSpace;
      if (!target) return;
      await ViewBackendService.deleteView(target.id);
    },

    rename(space: ViewPB, name: string) {
      return actions.update({
        space,
        name,
        icon: spaceIcon(space) ?? null,
        iconColor: spaceIconColor(space) ?? null,
        permission: spacePermission(space),
      });
    },

    changeIcon({ space, icon, iconColor }: { space?: ViewPB | null; icon?: string | null; iconColor?: string | null }) {
      return actions.update({ space, icon, iconColor });
    },

    async update({
      space,
      name,
      icon,
      iconColor,
      permission,
    }: {
      space?: ViewPB | null;
      name?: string | null;
      icon?: string | null;
      iconColor?: string | null;
      permission?: SpacePermission | null;
    }) {
      const target = space ?? get().currentSpace;
      if (!target) return;
      if (name != null) await ViewBackendService.updateView({ viewId: target.id, name });
      try {
        await ViewBackendService.updateView({ viewId: target.id, extra: updatedSpaceExtra(target, { icon, iconColor, permission }) });
      } catch {
        // invalid extra JSON: logged and ignored in Flutter
      }
      if (permission != null) {
        await ViewBackendService.updateViewsVisibility([target], permission === SpacePermission.publicToAll);
      }
    },

    /** open: remember the space, reload its pages, and (desktop) ask to open its first page. */
    async open(space: ViewPB, afterOpen?: () => void) {
      const gen = generation;
      await KeyValueStorage.set(KVKeys.lastOpenedSpaceId, space.id);
      const isExpanded = getSpaceExpandStatus(space);
      const views = await ViewBackendService.getChildViews(space.id);
      if (gen !== generation) return;
      const currentSpace = views.ok ? { ...space, childViews: views.value } : space;
      set({ currentSpace, isExpanded });
      set({ lastCreatedPage: currentSpace.childViews[0] ?? createMessage(ViewPBSchema, {}) });
      afterOpen?.();
    },

    async expand(space: ViewPB, isExpanded: boolean) {
      await setExpanded(space.id, isExpanded);
      set({ isExpanded });
    },

    async createPage({
      name,
      layout,
      index,
      openAfterCreate,
    }: {
      name: string;
      layout: ViewLayoutPB;
      index?: number;
      openAfterCreate: boolean;
    }) {
      const parentViewId = get().currentSpace?.id;
      if (!parentViewId) return;
      const gen = generation;
      const result = await ViewBackendService.createView({ name, layoutType: layout, parentViewId, index, openAfterCreate });
      if (gen !== generation) return;
      if (result.ok) set({ lastCreatedPage: openAfterCreate ? result.value : null, createPageResult: result });
      else set({ createPageResult: result });
    },

    async didReceiveSpaceUpdate() {
      const gen = generation;
      const spaces = await getSpaces();
      if (gen !== generation) return;
      set({ spaces, currentSpace: getLastOpened(spaces) });
    },

    /** reset: re-point the bloc at another workspace (no-op for the same one). */
    async reset(user: UserProfilePB, wsId: string, openFirstPage: boolean) {
      if (workspaceId === wsId) return;
      stopListener?.();
      stopListener = null;
      await actions.initial(user, wsId, openFirstPage);
    },

    switchToNextSpace() {
      const next = nextSpace(get().spaces, get().currentSpace);
      if (next) void actions.open(next);
    },

    async duplicate(space?: ViewPB | null) {
      const source = space ?? get().currentSpace;
      if (!source) return;
      const gen = generation;
      set({ isDuplicatingSpace: true });
      const newSpace = await createSpace({
        name: `${source.name} (copy)`,
        icon: spaceIcon(source) || builtInSpaceIcons[0],
        iconColor: spaceIconColor(source) || builtInSpaceColors[0],
        permission: spacePermission(source),
      });
      if (newSpace) {
        for (const view of source.childViews) {
          await ViewBackendService.duplicate({
            view,
            openAfterDuplicate: true,
            syncAfterDuplicate: true,
            includeChildren: true,
            parentViewId: newSpace.id,
            suffix: '',
          });
        }
        if (gen !== generation) return;
        void actions.didReceiveSpaceUpdate();
        void actions.open(newSpace);
      }
      if (gen === generation) set({ isDuplicatingSpace: false });
    },
  };
  return actions;
}

/** SpaceBloc (workspace/application/sidebar/space/space_bloc.dart). */
export function createSpaceStore(): SpaceStore {
  const store = createStore<SpaceState>(initialState);
  return { store, actions: spaceActionsFor(store) };
}

/** The sidebar's SpaceBloc (Flutter scopes it to HomeSideBar; it is reset on unmount). */
export const sidebarSpace = createSpaceStore();

/** Delete is disabled for the last space and, for non-owners, for spaces created by others. */
export function spaceDeleteDisabledReason({
  spaceCount,
  isOwner,
  currentSpaceCreatedBy,
  userId,
}: {
  spaceCount: number;
  isOwner: boolean;
  currentSpaceCreatedBy: bigint | null;
  userId: bigint | null;
}): 'last' | 'notCreator' | null {
  if (spaceCount <= 1) return 'last';
  const isPageCreator = currentSpaceCreatedBy !== null && currentSpaceCreatedBy === userId;
  if (!(isOwner || isPageCreator)) return 'notCreator';
  return null;
}
