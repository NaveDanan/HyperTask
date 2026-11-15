import * as database from '@/backend/events/flowy-database2';
import { FolderEventGetAllViews } from '@/backend/events/flowy-folder';
import { listenAll, NotificationSource } from '@/backend/notifications';
import { ViewBackendService } from '@/features/view/view-service';
import type { SubscribeObject } from '@shared/protobuf/flowy-notification/subject_pb';
/** Inject this interface for unit tests. All I/O remains in generated event wrappers. */
export const hyperDatabaseBackend = {
  ...database,
  views: ViewBackendService,
  allViews: FolderEventGetAllViews,
  subscribe: (handler: (subject: SubscribeObject) => void) => listenAll(subject => {
    if (subject.source === NotificationSource.Database || subject.source === NotificationSource.Folder) handler(subject);
  }),
};
export type HyperDatabaseBackend = typeof hyperDatabaseBackend;
