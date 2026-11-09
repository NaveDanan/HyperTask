import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { useAppStore } from '@/startup/app-store';

/** FeatureFlag (lib/shared/feature_flags.dart), in enum declaration order. */
export enum FeatureFlag {
  collaborativeWorkspace = 'collaborativeWorkspace',
  membersSettings = 'membersSettings',
  syncDocument = 'syncDocument',
  syncDatabase = 'syncDatabase',
  search = 'search',
  planBilling = 'planBilling',
  spaceDesign = 'spaceDesign',
  inlineSubPageMention = 'inlineSubPageMention',
  sharedSection = 'sharedSection',
  unknown = 'unknown',
}

export const FEATURE_FLAGS: FeatureFlag[] = Object.values(FeatureFlag);

export type FeatureFlagMap = Map<FeatureFlag, boolean>;

/** Flags released in earlier versions: always on, the stored value is ignored. */
const RELEASED = new Set<FeatureFlag>([
  FeatureFlag.planBilling,
  FeatureFlag.spaceDesign,
  FeatureFlag.search,
  FeatureFlag.collaborativeWorkspace,
  FeatureFlag.membersSettings,
  FeatureFlag.syncDatabase,
  FeatureFlag.syncDocument,
  FeatureFlag.inlineSubPageMention,
]);

/**
 * FeatureFlag.initialize's KV decoding: unknown names map to `unknown`, and the stored
 * values overlay "every flag false" (so the map keeps enum order).
 * Deviation: malformed JSON (which throws in Dart at startup) reads as no stored values.
 */
export function parseFeatureFlagMap(raw: string | null): FeatureFlagMap {
  const values: FeatureFlagMap = new Map(FEATURE_FLAGS.map((flag) => [flag, false]));
  if (raw === null) return values;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return values;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return values;
  for (const [key, value] of Object.entries(decoded as Record<string, unknown>)) {
    if (typeof value !== 'boolean') continue;
    const flag = (FEATURE_FLAGS as string[]).includes(key) ? (key as FeatureFlag) : FeatureFlag.unknown;
    values.set(flag, value);
  }
  return values;
}

/** FeatureFlag.update's KV encoding: every entry of the map, `{"<name>": bool}`. */
export function encodeFeatureFlagMap(values: FeatureFlagMap): string {
  const json: Record<string, boolean> = {};
  for (const [flag, value] of values) json[flag] = value;
  return JSON.stringify(json);
}

/** FeatureFlag.isOn for a given value map (planBilling is forced off in this checkout). */
export function isOnWith(flag: FeatureFlag, values: FeatureFlagMap): boolean {
  if (flag === FeatureFlag.planBilling) return false;
  if (RELEASED.has(flag)) return true;
  const stored = values.get(flag);
  if (stored !== undefined) return stored;
  // Only reached after clear(): the fallback switch.
  return flag !== FeatureFlag.sharedSection && flag !== FeatureFlag.unknown;
}

export function featureFlagDescription(flag: FeatureFlag): string {
  switch (flag) {
    case FeatureFlag.collaborativeWorkspace:
      return "if it's on, you can see the workspace list and the workspace settings in the top-left corner of the app";
    case FeatureFlag.membersSettings:
      return "if it's on, you can see the members settings in the settings page";
    case FeatureFlag.syncDocument:
      return "if it's on, the document will be synced in real-time";
    case FeatureFlag.syncDatabase:
      return "if it's on, the collaborators will show in the database";
    case FeatureFlag.search:
      return "if it's on, the command palette and search button will be available";
    case FeatureFlag.planBilling:
      return "if it's on, plan and billing pages will be available in Settings";
    case FeatureFlag.spaceDesign:
      return "if it's on, the space design feature will be available";
    case FeatureFlag.inlineSubPageMention:
      return "if it's on, the inline sub-page mention feature will be available";
    case FeatureFlag.sharedSection:
      return "if it's on, the shared section will be available";
    case FeatureFlag.unknown:
      return '';
  }
}

// The Flutter app initializes the flags in FeatureFlagTask on every runAppFlowy(); here they
// are read from the KV store on first use after each launch.
let values: FeatureFlagMap = new Map();
let initializedFor: number | null = null;

function current(): FeatureFlagMap {
  const launchId = useAppStore.getState().launchId;
  if (initializedFor !== launchId) {
    values = parseFeatureFlagMap(KeyValueStorage.get(KVKeys.featureFlag));
    initializedFor = launchId;
  }
  return values;
}

export const featureFlags = {
  /** FeatureFlag.data: the in-memory values (empty after clear() until the next launch). */
  data(): FeatureFlagMap {
    return new Map(current());
  },
  isOn(flag: FeatureFlag): boolean {
    return isOnWith(flag, current());
  },
  /** FeatureFlag.update: sets the value and rewrites the whole KV map. */
  async update(flag: FeatureFlag, value: boolean): Promise<void> {
    const map = current();
    map.set(flag, value);
    await KeyValueStorage.set(KVKeys.featureFlag, encodeFeatureFlagMap(map));
  },
  /** FeatureFlag.clear (FeatureFlagCache in Clear cache): empties the values and removes the KV key. */
  async clear(): Promise<void> {
    current();
    values = new Map();
    await KeyValueStorage.remove(KVKeys.featureFlag);
  },
};
