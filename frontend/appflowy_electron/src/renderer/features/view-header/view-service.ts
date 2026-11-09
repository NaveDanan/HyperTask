// The ViewBackendService / ViewBloc operations the page header uses
// (workspace/application/view/view_service.dart, view_bloc.dart).
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import {
  FolderEventDeleteView,
  FolderEventDuplicateView,
  FolderEventGetPublishInfo,
  FolderEventGetView,
  FolderEventUnpublishViews,
} from '@/backend/events';
import { tr } from '@/i18n';
import { updateRecentViews } from '../search/recent-views-store';

/** getChildViews: FolderEventGetView(id).childViews ([] for an empty id or a failure). */
export async function getChildViews(viewId: string): Promise<ViewPB[]> {
  if (!viewId) return [];
  const result = await FolderEventGetView({ value: viewId });
  return result.ok ? result.value.childViews : [];
}

/** getAllChildViews: every descendant, depth-first. */
export async function getAllChildViews(view: Pick<ViewPB, 'id'>): Promise<ViewPB[]> {
  const views: ViewPB[] = [];
  for (const child of await getChildViews(view.id)) {
    if (child.id === view.id) continue;
    views.push(child, ...(await getAllChildViews(child)));
  }
  return views;
}

/** containPublishedPage: the view and its descendants that have publish info. */
export async function containPublishedPage(view: ViewPB): Promise<[boolean, ViewPB[]]> {
  const views = [view, ...(await getAllChildViews(view))];
  const published: ViewPB[] = [];
  for (const v of views) {
    const info = await FolderEventGetPublishInfo({ value: v.id });
    if (info.ok) published.push(v);
  }
  return [published.length > 0, published];
}

/** ViewEvent.delete: unpublish, move to trash, drop from recent views. */
export async function deleteView(view: ViewPB) {
  const [, published] = await containPublishedPage(view);
  await Promise.all(published.map((v) => FolderEventUnpublishViews({ viewIds: [v.id] })));
  const result = await FolderEventDeleteView({ items: [view.id] });
  await updateRecentViews([view.id], false);
  return result;
}

/** ViewEvent.duplicate: same parent, with children, " (Copy)" suffix; Rust opens the copy. */
export function duplicateView(view: ViewPB) {
  return FolderEventDuplicateView({
    viewId: view.id,
    openAfterDuplicate: true,
    includeChildren: true,
    oneOfSuffix: { case: 'suffix', value: ` (${tr('menuAppHeader.pageNameSuffix')})` },
    syncAfterCreate: true,
  });
}
