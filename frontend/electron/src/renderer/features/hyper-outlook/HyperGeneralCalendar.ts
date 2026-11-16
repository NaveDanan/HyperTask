import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { ViewBackendService } from '@/features/view/view-service';
import { mergeViewExtra, viewExtra } from '@/features/view/view-ext';
import { favoriteActions, useFavoriteStore } from '@/features/sidebar/stores/favorite-store';
import { sidebarSpace } from '@/features/sidebar/stores/space-store';
import { KeyValueStorage } from '@/startup/kv';
import type { HyperResult } from '@/backend/dispatch';
export const hyperIsGeneralCalendar = (view: Pick<ViewPB, 'oneOfExtra'>) => viewExtra(view)?.hyper_general_calendar === true;
const hyperGeneralPending = new Map<string, Promise<ViewPB>>();
function hyperGeneralUnwrap<T>(result: HyperResult<T>): T { if (!result.ok) throw new Error(result.error.msg); return result.value; }
export function ensureHyperGeneralCalendar(workspaceId: string): Promise<ViewPB> {
  const pending = hyperGeneralPending.get(workspaceId); if (pending) return pending;
  const run = (async () => {
    const key = `hyperGeneralCalendarViewId:${workspaceId}`, cached = KeyValueStorage.get(key);
    // GetAllViews excludes trash (including descendants) in the core.
    const views = hyperGeneralUnwrap(await ViewBackendService.getAllViews()).items;
    const valid = (view: ViewPB) => view.layout === ViewLayoutPB.Calendar && hyperIsGeneralCalendar(view);
    let view = views.find(view => view.id === cached && valid(view)) ?? views.find(valid);
    if (!view) {
      const space = sidebarSpace.store.getState().currentSpace;
      if (!sidebarSpace.store.getState().isInitialized || sidebarSpace.actions.workspaceId !== workspaceId) throw new Error('The calendar workspace is not ready.');
      view = hyperGeneralUnwrap(await ViewBackendService.createView({ layoutType: ViewLayoutPB.Calendar, name: 'Hyper-Event', parentViewId: space?.id ?? workspaceId, openAfterCreate: false }));
      view = hyperGeneralUnwrap(await ViewBackendService.updateView({ viewId: view.id, extra: mergeViewExtra(view, { hyper_general_calendar: true }) }));
    }
    // The General calendar is now Hyper-Event; a user-chosen name is kept.
    if (view.name === 'General calendar') view = hyperGeneralUnwrap(await ViewBackendService.updateView({ viewId: view.id, name: 'Hyper-Event' }));
    await KeyValueStorage.set(key, view.id);
    if (!view.isFavorite && !useFavoriteStore.getState().views.some(row => row.item.id === view.id)) hyperGeneralUnwrap(await ViewBackendService.favorite(view.id));
    await favoriteActions.pin(view);
    return view;
  })();
  hyperGeneralPending.set(workspaceId, run);
  void run.finally(() => { if (hyperGeneralPending.get(workspaceId) === run) hyperGeneralPending.delete(workspaceId); }).catch(() => {});
  return run;
}
