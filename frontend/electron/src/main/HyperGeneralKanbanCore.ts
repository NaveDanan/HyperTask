import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { hyperIsGeneralKanban } from '@shared/HyperTaskView';
import { CreateViewPayloadPBSchema, RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import type { CoreProcess } from './core/process';
import { Status } from './core/protocol';

/** Both HyperHome and Hyper-Bot can initialize the board when a workspace is first opened. */
export function hyperCoreWithGeneralKanban(request: CoreProcess['request']): CoreProcess['request'] {
  const empty = new Uint8Array();
  let queue: Promise<unknown> = Promise.resolve();
  return async (event, payload) => {
    if (event !== 'CreateView') return request(event, payload);
    let view;
    try { view = fromBinary(CreateViewPayloadPBSchema, payload); }
    catch { return request(event, payload); }
    if (view.layout !== ViewLayoutPB.Board || !hyperIsGeneralKanban(view)) return request(event, payload);

    const initial = await request('GetCurrentWorkspaceSetting', empty);
    if (initial.status !== Status.Ok) return initial;
    const { workspaceId } = fromBinary(WorkspaceLatestPBSchema, initial.payload);
    const create = queue.then(async () => {
      const current = await request('GetCurrentWorkspaceSetting', empty);
      if (current.status !== Status.Ok) return current;
      if (!workspaceId || fromBinary(WorkspaceLatestPBSchema, current.payload).workspaceId !== workspaceId) {
        return { status: Status.Internal, payload: new TextEncoder().encode('The workspace changed before General Kanban could be created.') };
      }
      const views = await request('GetAllViews', empty);
      if (views.status !== Status.Ok) return views;
      const existing = fromBinary(RepeatedViewPBSchema, views.payload).items
        .find(item => item.layout === ViewLayoutPB.Board && hyperIsGeneralKanban(item));
      if (existing) return { status: Status.Ok, payload: toBinary(ViewPBSchema, existing) };
      return request(event, payload);
    });
    queue = create.catch(() => {});
    return create;
  };
}
