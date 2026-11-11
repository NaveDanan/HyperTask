// The ViewBackendService / ViewBloc operations the page header uses
// (workspace/application/view/view_service.dart, view_bloc.dart).
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { create } from '@bufbuild/protobuf';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import type { FlowyResult } from '@/backend/dispatch';
import {
  FolderEventDeleteView,
  FolderEventGetPublishInfo,
  FolderEventGetView,
  FolderEventUnpublishViews,
} from '@/backend/events';
import { tr } from '@/i18n';
import { updateRecentViews } from '../search/recent-views-store';
import { hyperCaptureSearchOwner, type HyperSearchOwnerScope } from '../search/HyperSearchOwner';
import { hyperDuplicateView } from '../document-duplicate/HyperDocumentDuplicateBackend';

/** getChildViews: FolderEventGetView(id).childViews ([] for an empty id or a failure). */
export async function getChildViews(viewId: string, scope?: HyperSearchOwnerScope): Promise<ViewPB[]> {
  if (!viewId || scope && !scope.isCurrent()) return [];
  const result = await FolderEventGetView({ value: viewId });
  if (scope && !scope.isCurrent()) return [];
  return result.ok ? result.value.childViews : [];
}

/** getAllChildViews: every descendant, depth-first. */
export async function getAllChildViews(view: Pick<ViewPB, 'id'>, scope?: HyperSearchOwnerScope): Promise<ViewPB[]> {
  const views: ViewPB[] = [];
  for (const child of await getChildViews(view.id, scope)) {
    if (scope && !scope.isCurrent()) return [];
    if (child.id === view.id) continue;
    views.push(child, ...(await getAllChildViews(child, scope)));
  }
  return views;
}

/** containPublishedPage: the view and its descendants that have publish info. */
export async function containPublishedPage(view: ViewPB, scope?: HyperSearchOwnerScope): Promise<[boolean, ViewPB[]]> {
  const views = [view, ...(await getAllChildViews(view, scope))];
  const published: ViewPB[] = [];
  for (const v of views) {
    if (scope && !scope.isCurrent()) return [false, []];
    const info = await FolderEventGetPublishInfo({ value: v.id });
    if (scope && !scope.isCurrent()) return [false, []];
    if (info.ok) published.push(v);
  }
  return [published.length > 0, published];
}

/** ViewEvent.delete: unpublish, move to trash, drop from recent views. */
export async function deleteView(view: ViewPB, scope = hyperCaptureSearchOwner()): Promise<FlowyResult<void>> {
  const stale = (): FlowyResult<void> => ({ ok: false, error: create(FlowyErrorSchema, { code: ErrorCode.Internal, msg: 'The workspace changed. Reopen the page and try again.' }) });
  if (!scope?.isCurrent()) return stale();
  const [, published] = await containPublishedPage(view, scope);
  if (!scope.isCurrent()) return stale();
  await Promise.all(published.map((v) => scope.isCurrent() ? FolderEventUnpublishViews({ viewIds: [v.id] }) : undefined));
  if (!scope.isCurrent()) return stale();
  const result = await FolderEventDeleteView({ items: [view.id] });
  if (!scope.isCurrent()) return stale();
  await updateRecentViews([view.id], false, scope.owner);
  if (!scope.isCurrent()) return stale();
  return result;
}

/** Initialize independent timers, then open the confirmed copy. */
export function duplicateView(view: ViewPB) {
  return hyperDuplicateView({
    view,
    openAfterDuplicate: true,
    includeChildren: true,
    suffix: ` (${tr('menuAppHeader.pageNameSuffix')})`,
    syncAfterDuplicate: true,
  });
}
