import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { ViewBackendService } from '@/features/view/view-service';
import { mergeViewExtra, viewExtra } from '@/features/view/view-ext';
import { sidebarSpace } from '@/features/sidebar/stores/space-store';
import { KeyValueStorage } from '@/startup/kv';
import type { HyperResult } from '@/backend/dispatch';
/** The workspace board shown on HyperHome, marked in its view extra like the General calendar. */
export const hyperIsGeneralKanban = (view: Pick<ViewPB, 'oneOfExtra'>) => viewExtra(view)?.hyper_general_kanban === true;
const hyperKanbanPending = new Map<string, Promise<ViewPB>>();
function hyperKanbanUnwrap<T>(result: HyperResult<T>): T { if (!result.ok) throw new Error(result.error.msg); return result.value; }
export function ensureHyperGeneralKanban(workspaceId: string): Promise<ViewPB> {
  const pending = hyperKanbanPending.get(workspaceId); if (pending) return pending;
  const run = (async () => {
    const key = `hyperGeneralKanbanViewId:${workspaceId}`, cached = KeyValueStorage.get(key);
    // GetAllViews excludes trash (including descendants) in the core.
    const views = hyperKanbanUnwrap(await ViewBackendService.getAllViews()).items;
    const valid = (view: ViewPB) => view.layout === ViewLayoutPB.Board && hyperIsGeneralKanban(view);
    let view = views.find(view => view.id === cached && valid(view)) ?? views.find(valid);
    if (!view) {
      const space = sidebarSpace.store.getState().currentSpace;
      if (!sidebarSpace.store.getState().isInitialized || sidebarSpace.actions.workspaceId !== workspaceId) throw new Error('The board workspace is not ready.');
      view = hyperKanbanUnwrap(await ViewBackendService.createView({ layoutType: ViewLayoutPB.Board, name: 'Hyper-Kanban', parentViewId: space?.id ?? workspaceId, openAfterCreate: false }));
      view = hyperKanbanUnwrap(await ViewBackendService.updateView({ viewId: view.id, extra: mergeViewExtra(view, { hyper_general_kanban: true }) }));
    }
    await KeyValueStorage.set(key, view.id);
    return view;
  })();
  hyperKanbanPending.set(workspaceId, run);
  void run.finally(() => { if (hyperKanbanPending.get(workspaceId) === run) hyperKanbanPending.delete(workspaceId); }).catch(() => {});
  return run;
}
