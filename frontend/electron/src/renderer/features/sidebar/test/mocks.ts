// Test doubles shared by the sidebar store tests (backend events, notifications, KV storage).
import { vi, type Mock } from 'vitest';

const EVENT_NAMES = [
  'DocumentEventDeleteFile',
  'DocumentEventOpenDocument',
  'FolderEventCreateView',
  'FolderEventDeleteView',
  'FolderEventDuplicateView',
  'FolderEventGetAllViews',
  'FolderEventGetPublishInfo',
  'FolderEventGetView',
  'FolderEventGetViewAncestors',
  'FolderEventMoveNestedView',
  'FolderEventReadCurrentWorkspace',
  'FolderEventReadFavorites',
  'FolderEventReadPrivateViews',
  'FolderEventReadWorkspaceViews',
  'FolderEventSetLatestView',
  'FolderEventToggleFavorite',
  'FolderEventUnpublishViews',
  'FolderEventUpdateRecentViews',
  'FolderEventUpdateView',
  'FolderEventUpdateViewIcon',
  'FolderEventUpdateViewVisibilityStatus',
  'UserEventChangeWorkspaceIcon',
  'UserEventCreateWorkspace',
  'UserEventDeleteWorkspace',
  'UserEventGetAllReminders',
  'UserEventGetAllWorkspace',
  'UserEventGetCloudConfig',
  'UserEventGetWorkspaceSubscriptionInfo',
  'UserEventLeaveWorkspace',
  'UserEventOpenWorkspace',
  'UserEventRemoveReminder',
  'UserEventRenameWorkspace',
  'UserEventUpdateReminder',
] as const;

/** Every event resolves `{ ok: true, value: undefined }` unless a test overrides it. */
export function eventsMock(): Record<string, Mock> {
  const mocks: Record<string, Mock> = {};
  for (const name of EVENT_NAMES) mocks[name] = vi.fn(async () => ({ ok: true, value: undefined }));
  return mocks;
}

type Handler = (ty: number, result: { ok: true; value: Uint8Array }) => void;
export const notificationListeners: Array<{ source: string; objectId?: string; handler: Handler }> = [];

export function notificationsMock(): { NotificationSource: Record<string, string>; listen: Mock } {
  return {
    NotificationSource: { Folder: 'Workspace', User: 'User', Document: 'Document', Database: 'Database', Chat: 'Chat', Search: 'Search' },
    listen: vi.fn((source: string, handler: Handler, objectId?: string) => {
      const entry = { source, objectId, handler };
      notificationListeners.push(entry);
      return () => {
        const index = notificationListeners.indexOf(entry);
        if (index >= 0) notificationListeners.splice(index, 1);
      };
    }),
  };
}

/** Delivers a notification to the listeners of that source/object. */
export function notify(source: string, objectId: string, ty: number, payload: Uint8Array) {
  for (const l of [...notificationListeners]) {
    if (l.source === source && (l.objectId === undefined || l.objectId === objectId)) l.handler(ty, { ok: true, value: payload });
  }
}

export const kvStore: Record<string, string> = {};

export function kvMock() {
  return {
    KVKeys: { expandedViews: 'expandedViews', lastOpenedSpaceId: 'lastOpenedSpaceId', featureFlag: 'featureFlag' },
    KeyValueStorage: {
      get: (key: string) => kvStore[key] ?? null,
      getJson: (key: string) => {
        const value = kvStore[key];
        if (value === undefined) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
      set: async (key: string, value: string) => {
        kvStore[key] = value;
      },
      remove: async (key: string) => {
        delete kvStore[key];
      },
    },
  };
}

export function resetKv() {
  for (const key of Object.keys(kvStore)) delete kvStore[key];
}

/** Lets pending promise chains settle. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
