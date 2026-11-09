// ViewListener (workspace/application/view/view_listener.dart) and TrashListener
// (plugins/trash/application/trash_listener.dart) over the folder notification stream.
import { fromBinary } from '@bufbuild/protobuf';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { RepeatedTrashPBSchema, type TrashPB } from '@shared/protobuf/flowy-folder/trash_pb';
import {
  ChildViewUpdatePBSchema,
  DeletedViewPBSchema,
  ViewPBSchema,
  type ChildViewUpdatePB,
  type DeletedViewPB,
  type ViewPB,
} from '@shared/protobuf/flowy-folder/view_pb';
import { NotificationSource, listen } from '@/backend/notifications';

export interface ViewListenerHandlers {
  onViewUpdated?: (view: ViewPB) => void;
  onViewChildViewsUpdated?: (update: ChildViewUpdatePB) => void;
  onViewMoveToTrash?: (deleted: DeletedViewPB) => void;
  onViewDeleted?: (view: ViewPB) => void;
  onViewRestored?: (view: ViewPB) => void;
}

/** ViewListener(viewId).start(...): returns stop(). Failures are dropped, as the callers ignore them. */
export function listenView(viewId: string, handlers: ViewListenerHandlers): () => void {
  return listen<FolderNotification>(
    NotificationSource.Folder,
    (ty, result) => {
      if (!result.ok) return;
      try {
        switch (ty) {
          case FolderNotification.DidUpdateView:
            handlers.onViewUpdated?.(fromBinary(ViewPBSchema, result.value));
            break;
          case FolderNotification.DidUpdateChildViews:
            handlers.onViewChildViewsUpdated?.(fromBinary(ChildViewUpdatePBSchema, result.value));
            break;
          case FolderNotification.DidMoveViewToTrash:
            handlers.onViewMoveToTrash?.(fromBinary(DeletedViewPBSchema, result.value));
            break;
          case FolderNotification.DidDeleteView:
            handlers.onViewDeleted?.(fromBinary(ViewPBSchema, result.value));
            break;
          case FolderNotification.DidRestoreView:
            handlers.onViewRestored?.(fromBinary(ViewPBSchema, result.value));
            break;
        }
      } catch (error) {
        console.error('ViewListener decode error', error);
      }
    },
    viewId,
  );
}

/** TrashListener: subject "trash", DidUpdateTrash → RepeatedTrashPB. */
export function listenTrash(onTrashUpdated: (items: TrashPB[]) => void): () => void {
  return listen<FolderNotification>(
    NotificationSource.Folder,
    (ty, result) => {
      if (ty !== FolderNotification.DidUpdateTrash || !result.ok) return;
      onTrashUpdated(fromBinary(RepeatedTrashPBSchema, result.value).items);
    },
    'trash',
  );
}
