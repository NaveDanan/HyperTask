// ViewBackendService (workspace/application/view/view_service.dart).
import type { ViewLayoutPB, ViewPB, ViewSectionPB } from '@shared/protobuf/hyper-folder/view_pb';
import {
  DocumentEventDeleteFile,
  FolderEventCreateView,
  FolderEventDeleteView,
  FolderEventDuplicateView,
  FolderEventGetAllViews,
  FolderEventGetPublishInfo,
  FolderEventGetView,
  FolderEventGetViewAncestors,
  FolderEventMoveNestedView,
  FolderEventSetLatestView,
  FolderEventToggleFavorite,
  FolderEventUnpublishViews,
  FolderEventUpdateView,
  FolderEventUpdateViewIcon,
  FolderEventUpdateViewVisibilityStatus,
} from '@/backend/events';
import type { HyperResult } from '@/backend/dispatch';
import { iconTypeToProto, viewIconData, mergeViewExtra, type EmojiIconData } from './view-ext';

export interface CreateViewOptions {
  layoutType: ViewLayoutPB;
  hyperLayout?: 'gantt';
  parentViewId: string;
  name: string;
  /** Opens and sets the view as the workspace's current view (set_as_current). */
  openAfterCreate?: boolean;
  initialDataBytes?: Uint8Array;
  /** CreateViewPayloadPB.meta, e.g. {"database_id": id} for linked views. */
  ext?: Record<string, string>;
  /** Insert position in the parent; appended when unset. */
  index?: number;
  section?: ViewSectionPB;
  viewId?: string;
  extra?: string;
}

export const ViewBackendService = {
  async createView({
    layoutType,
    hyperLayout,
    parentViewId,
    name,
    openAfterCreate = false,
    initialDataBytes,
    ext = {},
    index,
    section,
    viewId,
    extra,
  }: CreateViewOptions): Promise<HyperResult<ViewPB>> {
    const result = await FolderEventCreateView({
      parentViewId,
      name: hyperLayout === 'gantt' && !name ? 'Gantt' : name,
      layout: layoutType,
      setAsCurrent: openAfterCreate && hyperLayout !== 'gantt',
      initialData: initialDataBytes ?? new Uint8Array(),
      meta: ext,
      ...(index !== undefined ? { oneOfIndex: { case: 'index', value: index } } : null),
      ...(section !== undefined ? { oneOfSection: { case: 'section', value: section } } : null),
      ...(viewId !== undefined ? { oneOfViewId: { case: 'viewId', value: viewId } } : null),
      ...(extra !== undefined ? { oneOfExtra: { case: 'extra', value: extra } } : null),
    });
    if (!result.ok || hyperLayout !== 'gantt') return result;
    const ganttExtra = mergeViewExtra(result.value, { hyper_layout: 'gantt' });
    const updated = await ViewBackendService.updateView({ viewId: result.value.id, extra: ganttExtra });
    if (!updated.ok) return updated;
    if (openAfterCreate) {
      const opened = await FolderEventSetLatestView({ value: result.value.id });
      if (!opened.ok) return opened;
    }
    return updated;
  },

  /** The direct children of a view ([] for an empty id). */
  async getChildViews(viewId: string): Promise<HyperResult<ViewPB[]>> {
    if (!viewId) return { ok: true, value: [] };
    const result = await FolderEventGetView({ value: viewId });
    return result.ok ? { ok: true, value: result.value.childViews } : result;
  },

  getView(viewId: string) {
    return FolderEventGetView({ value: viewId });
  },

  deleteView(viewId: string) {
    return FolderEventDeleteView({ items: [viewId] });
  },

  deleteViews(viewIds: string[]) {
    return FolderEventDeleteView({ items: viewIds });
  },

  duplicate({
    view,
    openAfterDuplicate,
    includeChildren,
    parentViewId,
    suffix,
    syncAfterDuplicate,
  }: {
    view: Pick<ViewPB, 'id'>;
    openAfterDuplicate: boolean;
    includeChildren: boolean;
    parentViewId?: string;
    suffix?: string;
    syncAfterDuplicate: boolean;
  }) {
    return FolderEventDuplicateView({
      viewId: view.id,
      openAfterDuplicate,
      includeChildren,
      syncAfterCreate: syncAfterDuplicate,
      ...(parentViewId !== undefined ? { oneOfParentViewId: { case: 'parentViewId', value: parentViewId } } : null),
      ...(suffix !== undefined ? { oneOfSuffix: { case: 'suffix', value: suffix } } : null),
    });
  },

  favorite(viewId: string) {
    return FolderEventToggleFavorite({ items: [viewId] });
  },

  /** UpdateView only acknowledges success; keep this service's ViewPB contract with GetView. */
  async updateView({ viewId, name, isFavorite, extra }: { viewId: string; name?: string; isFavorite?: boolean; extra?: string }): Promise<HyperResult<ViewPB>> {
    const result = await FolderEventUpdateView({
      viewId,
      ...(name !== undefined ? { oneOfName: { case: 'name', value: name } } : null),
      ...(isFavorite !== undefined ? { oneOfIsFavorite: { case: 'isFavorite', value: isFavorite } } : null),
      ...(extra !== undefined ? { oneOfExtra: { case: 'extra', value: extra } } : null),
    });
    return result.ok ? FolderEventGetView({ value: viewId }) : result;
  },

  /** updateViewIcon: a replaced custom (uploaded) icon file is deleted. */
  updateViewIcon(view: ViewPB, icon: EmojiIconData) {
    const old = viewIconData(view);
    if (old.type === 'custom' && icon.emoji !== old.emoji) {
      void DocumentEventDeleteFile({ url: old.emoji });
    }
    return FolderEventUpdateViewIcon({
      viewId: view.id,
      oneOfIcon: { case: 'icon', value: { ty: iconTypeToProto(icon.type), value: icon.emoji } },
    });
  },

  /** moveViewV2: a null prevViewId moves the view to the start of the new parent. */
  moveViewV2({
    viewId,
    newParentId,
    prevViewId,
    fromSection,
    toSection,
  }: {
    viewId: string;
    newParentId: string;
    prevViewId: string | null;
    fromSection?: ViewSectionPB | null;
    toSection?: ViewSectionPB | null;
  }) {
    return FolderEventMoveNestedView({
      viewId,
      newParentId,
      ...(prevViewId != null ? { oneOfPrevViewId: { case: 'prevViewId', value: prevViewId } } : null),
      ...(fromSection != null ? { oneOfFromSection: { case: 'fromSection', value: fromSection } } : null),
      ...(toSection != null ? { oneOfToSection: { case: 'toSection', value: toSection } } : null),
    });
  },

  getAllViews() {
    return FolderEventGetAllViews();
  },

  getViewAncestors(viewId: string) {
    return FolderEventGetViewAncestors({ value: viewId });
  },

  updateViewsVisibility(views: Pick<ViewPB, 'id'>[], isPublic: boolean) {
    return FolderEventUpdateViewVisibilityStatus({ viewIds: views.map((v) => v.id), isPublic });
  },

  getPublishInfo(view: Pick<ViewPB, 'id'>) {
    return FolderEventGetPublishInfo({ value: view.id });
  },

  unpublish(view: Pick<ViewPB, 'id'>) {
    return FolderEventUnpublishViews({ viewIds: [view.id] });
  },

  /** Every descendant (depth first), loading children level by level. */
  async getAllChildViews(view: Pick<ViewPB, 'id'>): Promise<ViewPB[]> {
    const views: ViewPB[] = [];
    const result = await ViewBackendService.getChildViews(view.id);
    const children = result.ok ? result.value : [];
    for (const child of children) {
      if (child.id === view.id) continue;
      views.push(child);
      views.push(...(await ViewBackendService.getAllChildViews(child)));
    }
    return views;
  },

  /** containPublishedPage: [any published?, the published pages] over the view and its subtree. */
  async containPublishedPage(view: ViewPB): Promise<[boolean, ViewPB[]]> {
    const views = [view, ...(await ViewBackendService.getAllChildViews(view))];
    const published: ViewPB[] = [];
    for (const v of views) {
      const info = await ViewBackendService.getPublishInfo(v);
      if (info.ok) published.push(v);
    }
    return [published.length > 0, published];
  },
};
