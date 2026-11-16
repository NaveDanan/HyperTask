// KeyValueStorage (core/config/kv.dart): the app's shared-preferences store. Values are
// loaded once at startup and written through to the same shared_preferences.json the
// Flutter app uses.

let cache: Record<string, unknown> | null = null;

export const KVKeys = {
  cloudType: 'kCloudType',
  hypertaskCloudBaseURL: 'kHypertaskCloudBaseURL',
  hypertaskBaseShareDomain: 'kHypertaskBaseShareDomain',
  enableSyncTrace: 'kHypertaskEnableSyncTrace',
  pathLocation: 'io.hypertask.hypertask_flutter.path_location',
  scaleFactor: 'scaleFactor',
  textScaleFactor: 'textScaleFactor',
  featureFlag: 'featureFlag',
  expandedViews: 'expandedViews',
  expandedFolders: 'expandedFolders',
  lastOpenedSpaceId: 'lastOpenedSpaceId',
  showRenameDialogWhenCreatingNewFile: 'showRenameDialogWhenCreatingNewFile',
  recentIcons: 'kRecentIcons',
} as const;

// Read preferences written by the previous desktop and Flutter builds.
const legacyKeys: Record<string, string> = {
  [KVKeys.hypertaskCloudBaseURL]: 'kAppFlowyCloudBaseURL',
  [KVKeys.hypertaskBaseShareDomain]: 'kAppFlowyBaseShareDomain',
  [KVKeys.enableSyncTrace]: 'kAppFlowyEnableSyncTrace',
  [KVKeys.pathLocation]: 'io.appflowy.appflowy_flutter.path_location',
};

function storedKey(key: string): string {
  const data = store();
  const legacy = legacyKeys[key];
  return legacy && !(key in data) && legacy in data ? legacy : key;
}

export async function loadKeyValueStorage(): Promise<void> {
  cache = await window.hypertask.prefs.getAll();
}

function store(): Record<string, unknown> {
  if (!cache) throw new Error('KeyValueStorage used before loadKeyValueStorage()');
  return cache;
}

export const KeyValueStorage = {
  get(key: string): string | null {
    const value = store()[storedKey(key)];
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
    const actualKey = storedKey(key);
    store()[actualKey] = value;
    await window.hypertask.prefs.set(actualKey, value);
  },
  async remove(key: string): Promise<void> {
    const keys = [key, legacyKeys[key]].filter((entry): entry is string => !!entry && entry in store());
    for (const entry of keys) delete store()[entry];
    await Promise.all(keys.map((entry) => window.hypertask.prefs.remove(entry)));
  },
  async clear(): Promise<void> {
    await Promise.all(Object.keys(store()).map((key) => this.remove(key)));
  },
};
