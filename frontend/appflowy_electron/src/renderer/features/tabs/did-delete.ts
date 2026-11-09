// HomeStackDelegate.didDeleteStackWidget, as implemented by DesktopHomeScreenStackAdaptor
// (workspace/presentation/home/desktop_home_screen.dart).
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetView } from '@/backend/events';
import { blankPlugin, viewPlugin } from './plugin';
import { tabsActions } from './tabs-store';

/** The sibling to open: childViews[index - 1] when index is given and not 0, else the last child. */
export function pickDeleteTarget(childViews: ViewPB[], index?: number | null): ViewPB | null {
  if (childViews.length === 0) return null;
  let target = childViews[childViews.length - 1];
  if (index != null && index !== 0 && childViews.length > index - 1) target = childViews[index - 1];
  return target;
}

/** An open page was permanently deleted: open a sibling from its parent, or the blank page. */
export async function didDeleteStackWidget(view: ViewPB, index?: number | null): Promise<void> {
  const result = await FolderEventGetView({ value: view.parentViewId });
  if (!result.ok) {
    console.error('didDeleteStackWidget', result.error);
    return;
  }
  const target = pickDeleteTarget(result.value.childViews, index);
  tabsActions.openPlugin(target ? viewPlugin(target) : blankPlugin());
}
