import { fromBinary } from '@bufbuild/protobuf';
import { useEffect, useState } from 'react';
import { createStore, type StoreApi } from 'zustand';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import {
  ChildViewUpdatePBSchema,
  RepeatedViewPBSchema,
  ViewPBSchema,
  type ChildViewUpdatePB,
  type ViewLayoutPB,
  type ViewPB,
  type ViewSectionPB,
} from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventUpdateRecentViews } from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { tr } from '@/i18n';
import { registerViewExpander, tabsActions } from '@/features/tabs/tabs-store';
import { ViewBackendService } from '@/features/view/view-service';
import { getViewIsExpanded, setExpanded } from './expand-storage';

export interface ViewState {
  /** The node, with one level of loaded childViews. */
  view: ViewPB;
  /** A row popover is open: keeps the highlight and the action icons. */
  isEditing: boolean;
  isExpanded: boolean;
  isDeleted: boolean;
  isLoading: boolean;
  /** "Please open this": the row opens it when its id changes. */
  lastCreatedView: ViewPB | null;
}

/**
 * _updateChildViews: created → refetch the parent; deleted → drop locally; updated → refetch and
 * replace only when the child order or count changed. Returns null when nothing changes.
 */
export async function applyChildViewsUpdate(
  current: ViewPB,
  update: ChildViewUpdatePB,
  getView: (id: string) => Promise<ViewPB | null>,
): Promise<ViewPB | null> {
  if (update.createChildViews.length > 0) return getView(update.parentViewId);
  if (update.deleteChildViews.length > 0) {
    const removed = new Set(update.deleteChildViews);
    return { ...current, childViews: current.childViews.filter((v) => !removed.has(v.id)) };
  }
  if (update.updateChildViews.length > 0 && update.parentViewId) {
    const fetched = await getView(update.parentViewId);
    const children = fetched?.childViews ?? [];
    const sameOrder =
      children.length === update.updateChildViews.length && children.every((c, i) => c.id === update.updateChildViews[i].id);
    if (!sameOrder) return fetched;
  }
  return null;
}

export interface ViewBlocOptions {
  shouldLoadChildViews?: boolean;
  /** Registers a ViewExpander so opening a page can reveal it (section-folder mode only). */
  engagedInExpanding?: boolean;
}

/** ViewBloc (workspace/application/view/view_bloc.dart): one per tree row. */
export function createViewBloc(view: ViewPB, { shouldLoadChildViews = true, engagedInExpanding = false }: ViewBlocOptions = {}) {
  const store: StoreApi<ViewState> = createStore<ViewState>(() => ({
    view,
    isEditing: false,
    isExpanded: false,
    isDeleted: false,
    isLoading: true,
    lastCreatedView: null,
  }));
  const get = store.getState;
  let generation = 0;
  let stops: Array<() => void> = [];

  const getView = async (id: string) => {
    const result = await ViewBackendService.getView(id);
    return result.ok ? result.value : null;
  };

  async function loadChildViews(gen: number) {
    const result = await ViewBackendService.getChildViews(get().view.id);
    if (gen !== generation) return;
    if (result.ok) store.setState({ view: { ...get().view, childViews: result.value } });
  }

  /** _unpublishPage: unpublish the view and every published descendant. */
  async function unpublishPage() {
    const [, published] = await ViewBackendService.containPublishedPage(view);
    await Promise.all(published.map((v) => ViewBackendService.unpublish(v)));
  }

  const actions = {
    store,
    /** The constructor view: Flutter keeps using it for ids and collapse-all. */
    view,

    initial() {
      const gen = ++generation;
      stops.forEach((stop) => stop());
      stops = [];
      if (engagedInExpanding) {
        stops.push(registerViewExpander(view.id, { isExpanded: () => get().isExpanded, expand: () => void actions.setIsExpanded(true) }));
      }
      // ViewListener(viewId)
      stops.push(
        listen<FolderNotification>(
          NotificationSource.Folder,
          (ty, result) => {
            if (!result.ok || gen !== generation) return;
            if (ty === FolderNotification.DidUpdateView) {
              void actions.viewDidUpdate(fromBinary(ViewPBSchema, result.value));
            } else if (ty === FolderNotification.DidUpdateChildViews) {
              const update = fromBinary(ChildViewUpdatePBSchema, result.value);
              void applyChildViewsUpdate(get().view, update, getView).then((next) => {
                if (next && gen === generation) store.setState({ view: next });
              });
            }
          },
          view.id,
        ),
      );
      // FavoriteListener: refresh when this view is in the (un)favorited payload.
      stops.push(
        listen<FolderNotification>(
          NotificationSource.Folder,
          (ty, result) => {
            if (!result.ok || gen !== generation) return;
            if (ty !== FolderNotification.DidFavoriteView && ty !== FolderNotification.DidUnfavoriteView) return;
            const current = fromBinary(RepeatedViewPBSchema, result.value).items.find((v) => v.id === get().view.id);
            if (current) void actions.viewDidUpdate(current);
          },
          'favorite',
        ),
      );
      // The tree row opens the page it just created.
      stops.push(
        store.subscribe((state, prev) => {
          if (state.lastCreatedView && state.lastCreatedView.id !== prev.lastCreatedView?.id) {
            tabsActions.openView(state.lastCreatedView);
          }
        }),
      );
      store.setState({ isExpanded: getViewIsExpanded(view.id), view });
      if (shouldLoadChildViews) void loadChildViews(gen);
    },

    dispose() {
      generation++;
      stops.forEach((stop) => stop());
      stops = [];
    },

    setIsEditing(isEditing: boolean) {
      if (get().isEditing !== isEditing) store.setState({ isEditing });
    },

    /** Expanding reloads the children first; the state is persisted in KV expandedViews. */
    async setIsExpanded(isExpanded: boolean) {
      const gen = generation;
      if (isExpanded && !get().isExpanded) {
        const result = await ViewBackendService.getChildViews(get().view.id);
        if (gen !== generation) return;
        if (result.ok) store.setState({ view: { ...get().view, childViews: result.value }, isExpanded: true, isLoading: false });
        else store.setState({ isExpanded: true, isLoading: false });
      } else {
        store.setState({ isExpanded });
      }
      await setExpanded(view.id, isExpanded);
    },

    async viewDidUpdate(notified: ViewPB) {
      const gen = generation;
      const fetched = await getView(view.id);
      if (gen !== generation) return;
      store.setState({ view: fetched ?? notified });
    },

    async rename(newName: string) {
      const gen = generation;
      const result = await ViewBackendService.updateView({ viewId: view.id, name: newName });
      if (gen === generation && result.ok) store.setState({ view: { ...get().view, name: newName } });
    },

    /** delete: unpublish, move to trash, and drop from the recent views. */
    async delete() {
      await unpublishPage();
      const result = await ViewBackendService.deleteView(view.id);
      if (result.ok) store.setState({ isDeleted: true });
      await FolderEventUpdateRecentViews({ viewIds: [view.id], addInRecent: false });
    },

    /** The copy opens through DidUpdateWorkspaceSetting (set_as_current), not through this bloc. */
    duplicate() {
      return ViewBackendService.duplicate({
        view,
        openAfterDuplicate: true,
        syncAfterDuplicate: true,
        includeChildren: true,
        suffix: ` (${tr('menuAppHeader.pageNameSuffix')})`,
      });
    },

    move(from: ViewPB, newParentId: string, prevId: string | null, fromSection: ViewSectionPB | null, toSection: ViewSectionPB | null) {
      return ViewBackendService.moveViewV2({ viewId: from.id, newParentId, prevViewId: prevId, fromSection, toSection });
    },

    async createView(name: string, layoutType: ViewLayoutPB, { openAfterCreated = true, section }: { openAfterCreated?: boolean; section?: ViewSectionPB } = {}) {
      const gen = generation;
      const result = await ViewBackendService.createView({
        parentViewId: view.id,
        name,
        layoutType,
        ext: {},
        openAfterCreate: openAfterCreated,
        section,
      });
      if (gen === generation && result.ok) store.setState({ lastCreatedView: result.value });
    },

    /** collapseAllPages: forget the expand state of the (constructor) view's direct children, then collapse. */
    async collapseAllPages() {
      for (const child of view.childViews) await setExpanded(child.id, false);
      await actions.setIsExpanded(false);
    },

    unpublish(sync: boolean) {
      const pending = unpublishPage();
      return sync ? pending : Promise.resolve();
    },
  };
  return actions;
}

export type ViewBloc = ReturnType<typeof createViewBloc>;

/** One ViewBloc per mounted row, created once (BlocProvider.create) and closed on unmount. */
export function useViewBloc(view: ViewPB, options: ViewBlocOptions = {}): ViewBloc {
  const [bloc] = useState(() => createViewBloc(view, options));
  useEffect(() => {
    bloc.initial();
    return () => bloc.dispose();
  }, [bloc]);
  return bloc;
}
