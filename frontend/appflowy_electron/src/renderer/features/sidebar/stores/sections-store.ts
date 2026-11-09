import { fromBinary } from '@bufbuild/protobuf';
import { create } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { SectionViewsPBSchema, ViewLayoutPB, ViewSectionPB, type SectionViewsPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { FolderEventCreateView, FolderEventReadPrivateViews, FolderEventReadWorkspaceViews } from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { blankPlugin } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import { isSpace } from '@/features/view/view-ext';

export interface SidebarSection {
  publicViews: ViewPB[];
  privateViews: ViewPB[];
}

export interface SidebarSectionsState {
  section: SidebarSection;
  /** A "please open this" signal: the sidebar opens it when its id changes. */
  lastCreatedRootView: ViewPB | null;
  createRootViewResult: { ok: boolean } | null;
  /** true before the first load; never flips back to false on updates. */
  containsSpace: boolean;
}

const initialState = (): SidebarSectionsState => ({
  section: { publicViews: [], privateViews: [] },
  lastCreatedRootView: null,
  createRootViewResult: null,
  containsSpace: true,
});

/** SidebarSectionsBloc (workspace/application/menu/sidebar_sections_bloc.dart). */
export const useSectionsStore = create<SidebarSectionsState>(initialState);
const get = useSectionsStore.getState;
const set = useSectionsStore.setState;

let workspaceId = '';
let stopListener: (() => void) | null = null;
let generation = 0;

/** WorkspaceSectionsListener: DidUpdateSectionViews for the workspace. */
export function listenSectionViews(wsId: string, onUpdate: (pb: SectionViewsPB) => void): () => void {
  return listen<FolderNotification>(
    NotificationSource.Folder,
    (ty, result) => {
      if (ty !== FolderNotification.DidUpdateSectionViews || !result.ok) return;
      onUpdate(fromBinary(SectionViewsPBSchema, result.value));
    },
    wsId,
  );
}

/** WorkspaceService.getPublicViews + getPrivateViews; null when either read fails. */
export async function readSectionViews(wsId: string): Promise<SidebarSection | null> {
  const publicViews = await FolderEventReadWorkspaceViews({ value: wsId });
  if (!publicViews.ok) return null;
  const privateViews = await FolderEventReadPrivateViews({ value: wsId });
  if (!privateViews.ok) return null;
  return { publicViews: publicViews.value.items, privateViews: privateViews.value.items };
}

const containsSpaceIn = (section: SidebarSection) =>
  section.publicViews.some(isSpace) || section.privateViews.some(isSpace);

function start(wsId: string) {
  workspaceId = wsId;
  stopListener?.();
  const gen = generation;
  stopListener = listenSectionViews(wsId, (pb) => {
    if (gen === generation) sectionsActions.receiveSectionViewsUpdate(pb);
  });
}

async function load(): Promise<SidebarSection | null> {
  const gen = generation;
  const section = await readSectionViews(workspaceId);
  if (!section || gen !== generation) return null;
  set({ section, containsSpace: containsSpaceIn(section) });
  return section;
}

export const sectionsActions = {
  get workspaceId() {
    return workspaceId;
  },

  async initial(_user: UserProfilePB, wsId: string) {
    start(wsId);
    await load();
  },

  async reset(_user: UserProfilePB, wsId: string) {
    start(wsId);
    await load();
  },

  /** reload: re-read, then open the first public (else private) root view, else the blank page. */
  async reload(_user: UserProfilePB, wsId: string) {
    start(wsId);
    const section = await load();
    if (!section) return;
    const first = section.publicViews[0] ?? section.privateViews[0];
    if (first) tabsActions.openView(first);
    else tabsActions.openPlugin(blankPlugin());
  },

  dispose() {
    generation++;
    stopListener?.();
    stopListener = null;
    workspaceId = '';
    set(initialState());
  },

  /** createRootViewInSection: a Document under the workspace root (not set as current). */
  async createRootViewInSection(name: string, viewSection: ViewSectionPB, index?: number) {
    const gen = generation;
    const result = await FolderEventCreateView({
      parentViewId: workspaceId,
      name,
      layout: ViewLayoutPB.Document,
      oneOfSection: { case: 'section', value: viewSection },
      ...(index !== undefined ? { oneOfIndex: { case: 'index', value: index } } : null),
    });
    if (gen !== generation) return;
    if (result.ok) set({ lastCreatedRootView: result.value, createRootViewResult: { ok: true } });
    else set({ createRootViewResult: { ok: false } });
  },

  receiveSectionViewsUpdate(pb: SectionViewsPB) {
    const state = get();
    const containsSpace = state.containsSpace || pb.views.some(isSpace);
    if (pb.section === ViewSectionPB.Public) {
      set({ containsSpace, section: { ...state.section, publicViews: pb.views } });
    } else if (pb.section === ViewSectionPB.Private) {
      set({ containsSpace, section: { ...state.section, privateViews: pb.views } });
    }
  },

  /** getViewSection: Public/Private for root views (by id), otherwise null. */
  getViewSection(view: Pick<ViewPB, 'id'>): ViewSectionPB | null {
    const { publicViews, privateViews } = get().section;
    if (publicViews.some((v) => v.id === view.id)) return ViewSectionPB.Public;
    if (privateViews.some((v) => v.id === view.id)) return ViewSectionPB.Private;
    return null;
  },
};
