// KVKeys.expandedViews: one JSON map {"<view id | folder type>": true} shared by FolderBloc,
// SpaceBloc, ViewBloc and TabsBloc. Collapsing removes the key, so a missing key means
// "collapsed" for tree rows (ViewBloc reads `?? false`) but "expanded" for folders and
// spaces (FolderBloc/SpaceBloc read `?? true`). BUG-COMPAT: collapsed folders/spaces are
// therefore expanded again after a restart, exactly as in Flutter.
import { KVKeys, KeyValueStorage } from '@/startup/kv';

export function readExpandedViews(): Record<string, unknown> {
  const map = KeyValueStorage.getJson<Record<string, unknown>>(KVKeys.expandedViews);
  return map && typeof map === 'object' ? map : {};
}

/** _setViewIsExpanded / _setSpaceExpandStatus / FolderBloc._setFolderExpandStatus. */
export async function setExpanded(key: string, isExpanded: boolean): Promise<void> {
  const map = readExpandedViews();
  if (isExpanded) map[key] = true;
  else delete map[key];
  await KeyValueStorage.set(KVKeys.expandedViews, JSON.stringify(map));
}

/** ViewBloc._getViewIsExpanded: `map[id] ?? false`. */
export function getViewIsExpanded(viewId: string): boolean {
  return Boolean(readExpandedViews()[viewId] ?? false);
}

/** FolderBloc / SpaceBloc: `map[key] ?? true`. */
export function getFolderIsExpanded(key: string): boolean {
  return Boolean(readExpandedViews()[key] ?? true);
}
