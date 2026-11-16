// t3code's useTheme hook and custom-theme library functions (apps/web/src/hooks/useTheme.ts, useCustomThemes.ts and
// themePalette.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// Same names and return values as t3code, so the ported theme library, editor and import dialog call them unchanged.
// The state lives in theme/appearance-store.ts: the appearance mode is HyperTask's AppearanceSettingsPB.themeMode,
// and the theme, halves and custom library are key-value entries. Writes report success synchronously, as t3code's
// localStorage writes do; a failed key-value write is logged.

import { ThemeModePB } from '@shared/protobuf/hyper-user/user_setting_pb';
import {
  appearanceActions,
  appearanceModeOf,
  effectiveBrightness,
  readThemeHalvesRaw as readStoredHalvesRaw,
  refreshTheme,
  themeActions,
  useAppearanceStore,
} from '@/theme/appearance-store';
import { canonicalizeThemeDefinition } from '@/theme/HyperThemeColorMath';
import { RESERVED_THEME_IDS } from '@/theme/HyperThemePalettes';
import {
  BUILT_IN_THEMES,
  parseStoredThemes,
  withInstalledTheme,
  withoutThemes,
  withUpdatedTheme,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemePreference,
  type ThemePreferenceMode,
} from '@/theme/HyperThemeLibrary';

function logWriteFailure(what: string) {
  return (error: unknown) => console.error(`Failed to save the ${what}`, error);
}

export function setTheme(next: ThemePreference): boolean {
  void themeActions.setTheme(next).catch(logWriteFailure('theme'));
  return true;
}

export function setThemeHalf(appearance: ThemeAppearance, themeId: string | null): boolean {
  void themeActions.setThemeHalf(appearance, themeId).catch(logWriteFailure('theme half'));
  return true;
}

export function setAppearanceMode(mode: ThemePreferenceMode): boolean {
  const pb = mode === 'light' ? ThemeModePB.Light : mode === 'dark' ? ThemeModePB.Dark : ThemeModePB.System;
  void appearanceActions.setThemeMode(pb).catch(logWriteFailure('appearance mode'));
  return true;
}

/** The stored halves, including ids of themes that are not loaded. */
export function readThemeHalvesRaw(): { light?: string; dark?: string } {
  return readStoredHalvesRaw();
}

export { refreshTheme };

export function useTheme() {
  const theme = useAppearanceStore((s) => s.themePreference);
  const themeHalves = useAppearanceStore((s) => s.themeHalves);
  const appearanceMode = useAppearanceStore((s) => appearanceModeOf(s));
  const resolvedTheme: ThemeAppearance = useAppearanceStore((s) => effectiveBrightness(s));
  return {
    theme,
    setTheme,
    setAppearanceMode,
    setThemeHalf,
    refreshTheme,
    followSystem: appearanceMode === 'system',
    appearanceMode,
    resolvedTheme,
    themeHalves,
  } as const;
}

export function useCustomThemes(): ReadonlyArray<ThemeDefinition> {
  return useAppearanceStore((s) => s.libraryThemes);
}

export function getCustomThemes(): ReadonlyArray<ThemeDefinition> {
  return useAppearanceStore.getState().libraryThemes;
}

/** Adds a theme to the library, colors as canonical oklch; throws for reserved or taken ids, as t3code does. */
export function installCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  const canonicalTheme = canonicalizeThemeDefinition(theme);
  void themeActions.saveLibrary(withInstalledTheme(canonicalTheme)).catch(logWriteFailure('theme library'));
  return canonicalTheme;
}

/** Replaces the saved theme of the same id. */
export function updateCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  const canonicalTheme = canonicalizeThemeDefinition(theme);
  void themeActions.saveLibrary(withUpdatedTheme(canonicalTheme)).catch(logWriteFailure('theme library'));
  return canonicalTheme;
}

export function removeCustomThemes(themeIds: ReadonlyArray<string>): void {
  if (themeIds.length === 0) return;
  void themeActions.saveLibrary(withoutThemes(themeIds)).catch(logWriteFailure('theme library'));
}

export function removeCustomTheme(themeId: string): void {
  removeCustomThemes([themeId]);
}

/** The installed themes of one Open VSX collection. */
export function getStoredCustomThemeCollection(collectionId: string): ReadonlyArray<ThemeDefinition> {
  return getCustomThemes().filter((theme) => theme.collection?.id === collectionId);
}

/** Replaces an installed collection with a new download of it, in place (t3code's replaceCustomThemeCollection). */
export function replaceCustomThemeCollection(
  collectionId: string,
  themes: ReadonlyArray<ThemeDefinition>,
  options?: { expectedCollection?: ReadonlyArray<ThemeDefinition> },
): ReadonlyArray<ThemeDefinition> {
  if (themes.length === 0) throw new Error('A theme collection cannot be empty.');

  const replacement = parseStoredThemes(JSON.stringify(themes));
  if (replacement.length !== themes.length || replacement.some((theme) => theme.collection?.id !== collectionId)) {
    throw new Error('That theme collection is invalid.');
  }
  const current = getCustomThemes();
  const currentCollection = current.filter((theme) => theme.collection?.id === collectionId);
  if (options?.expectedCollection && JSON.stringify(currentCollection) !== JSON.stringify(options.expectedCollection)) {
    throw new Error('Your installed themes changed while this package was downloading. Try again.');
  }
  const occupiedIds = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
  for (const theme of current) {
    if (theme.collection?.id !== collectionId) occupiedIds.add(theme.id);
  }
  const conflictingTheme = replacement.find((theme) => RESERVED_THEME_IDS.has(theme.id) || occupiedIds.has(theme.id));
  if (conflictingTheme) {
    throw new Error(`A theme named "${conflictingTheme.label}" is already installed.`);
  }

  const nextThemes: ThemeDefinition[] = [];
  let insertedReplacement = false;
  for (const theme of current) {
    if (theme.collection?.id !== collectionId) {
      nextThemes.push(theme);
    } else if (!insertedReplacement) {
      nextThemes.push(...replacement);
      insertedReplacement = true;
    }
  }
  if (!insertedReplacement) nextThemes.push(...replacement);

  void themeActions
    .saveLibrary(nextThemes)
    .catch((error: unknown) => console.error('Failed to save the theme library', error));
  return replacement;
}
