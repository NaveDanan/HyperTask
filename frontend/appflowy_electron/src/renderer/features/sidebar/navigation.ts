import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { PluginArguments } from '@/features/tabs/plugin';
import { tabsActions } from '@/features/tabs/tabs-store';
import { ViewBackendService } from '@/features/view/view-service';
import { sidebarSpace } from './stores/space-store';

/**
 * ViewAncestorCache.getAncestor: the view's ancestors without the workspace root and itself,
 * root first, so the first one is the view's space.
 */
async function ancestorsOf(viewId: string): Promise<ViewPB[] | null> {
  const result = await ViewBackendService.getViewAncestors(viewId);
  if (!result.ok) return null;
  return result.value.items.filter((v) => v.parentViewId !== '' && v.id !== viewId);
}

/** checkForSpace: switch the sidebar to the view's space first (then open the view again). */
async function checkForSpace(view: ViewPB, afterOpen: () => void) {
  const ancestors = await ancestorsOf(view.id);
  if (!ancestors || ancestors.length === 0) return;
  const first = ancestors[0];
  if (first.id === sidebarSpace.store.getState().currentSpace?.id) return;
  const space = await ViewBackendService.getView(first.id);
  if (space.ok) void sidebarSpace.actions.open(space.value, afterOpen);
}

/**
 * ActionNavigationBloc.performAction(ActionType.openView) as handled by
 * HomeSideBar._onNotificationAction: resolve the view, switch space when needed and open it
 * with the selection/block/row arguments. The view opens twice when the space changes (the
 * second open is de-duplicated by the tabs store), as in Flutter.
 */
export async function performOpenViewAction({
  objectId,
  view,
  nodePath,
  blockId,
  rowId,
}: {
  objectId: string;
  view?: ViewPB | null;
  nodePath?: number | null;
  blockId?: string | null;
  rowId?: string | null;
}) {
  let target = view ?? null;
  if (!target) {
    const result = await ViewBackendService.getView(objectId);
    if (!result.ok) return;
    target = result.value;
  }
  const resolved = target;
  const args: PluginArguments = {};
  if (nodePath != null) args.selection = [nodePath];
  const openView = () => {
    if (blockId) args.blockId = blockId;
    if (rowId) args.rowId = rowId;
    requestAnimationFrame(() => tabsActions.openView(resolved, { ...args }));
  };
  void checkForSpace(resolved, openView);
  openView();
}
