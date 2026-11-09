// KeyValueStorage (core/config/kv.dart): the app's shared-preferences store. Values are
// loaded once at startup and written through to the same shared_preferences.json the
// Flutter app uses.

let cache: Record<string, unknown> | null = null;

export const KVKeys = {
  cloudType: 'kCloudType',
  appflowyCloudBaseURL: 'kAppFlowyCloudBaseURL',
  appflowyBaseShareDomain: 'kAppFlowyBaseShareDomain',
  enableSyncTrace: 'kAppFlowyEnableSyncTrace',
  pathLocation: 'io.appflowy.appflowy_flutter.path_location',
  scaleFactor: 'scaleFactor',
  textScaleFactor: 'textScaleFactor',
  featureFlag: 'featureFlag',
  expandedViews: 'expandedViews',
  expandedFolders: 'expandedFolders',
  lastOpenedSpaceId: 'lastOpenedSpaceId',
  showRenameDialogWhenCreatingNewFile: 'showRenameDialogWhenCreatingNewFile',
  recentIcons: 'kRecentIcons',
} as const;

export async function loadKeyValueStorage(): Promise<void> {
  cache = await window.appflowy.prefs.getAll();
}

function store(): Record<string, unknown> {
  if (!cache) throw new Error('KeyValueStorage used before loadKeyValueStorage()');
  return cache;
}

export const KeyValueStorage = {
  get(key: string): string | null {
    const value = store()[key];
    return value === undefined || value === null ? null : String(value);
  },
  getJson<T>(key: string): T | null {
    const value = this.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    store()[key] = value;
    await window.appflowy.prefs.set(key, value);
  },
  async remove(key: string): Promise<void> {
    delete store()[key];
    await window.appflowy.prefs.remove(key);
  },
  async clear(): Promise<void> {
    await Promise.all(Object.keys(store()).map((key) => this.remove(key)));
  },
};
