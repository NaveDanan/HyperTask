import { create as createMessage, clone } from '@bufbuild/protobuf';
import { create } from 'zustand';
import {
  AppearanceSettingsPBSchema,
  DateTimeSettingsPBSchema,
  DocumentSettingsPBSchema,
  LayoutDirectionPB,
  TextDirectionPB,
  ThemeModePB,
  type AppearanceSettingsPB,
  type DateTimeSettingsPB,
} from '@shared/protobuf/hyper-user/user_setting_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/hyper-user/date_time_pb';
import {
  UserEventGetAppearanceSetting,
  UserEventGetDateTimeSettings,
  UserEventSetAppearanceSetting,
  UserEventSetDateTimeSettings,
} from '@/backend/events';
import { resolveLocale, setLocale as applyLocale } from '@/i18n';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { applyTheme, type Brightness } from './theme';
import { builtInColorSchemes } from './color-schemes';
import { isBuiltInTheme, loadCustomThemes, type CustomTheme } from '@/features/settings/workspace/hyper-theme';
import { ensureGoogleFont } from '@/features/settings/workspace/google-fonts';
import { loadAppearancePrefs } from '@/features/settings/appearance/appearance-prefs';
import {
  applyThemePalette,
  CUSTOM_THEMES_KEY,
  parseStoredThemes,
  parseThemeHalves,
  parseThemeHalvesRaw,
  resolveThemeAppearance,
  resolveThemeHalf,
  setCustomThemeLibrary,
  THEME_PREVIEW_ID,
  THEME_HALVES_KEY,
  THEME_PREFERENCE_KEY,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemeHalves,
  type ThemePreference,
  type ThemePreferenceMode,
} from './HyperThemeLibrary';

interface AppearanceState {
  appearance: AppearanceSettingsPB;
  dateTime: DateTimeSettingsPB;
  /** KV textScaleFactor, clamped 0.7..1.0. */
  textScaleFactor: number;
  systemBrightness: Brightness;
  /** Names of the custom `<name>.hyper_plugin` themes registered in the color-scheme table. */
  customThemes: string[];
  /**
   * The Appearance theme (ported from t3code): "system", "light" or "dark" for the standard T3 Code palette, or a
   * theme id. KV hypertask:theme.
   */
  themePreference: ThemePreference;
  /** Separate light and dark theme picks; null when one theme covers both. KV hypertask:theme-halves:v1. */
  themeHalves: ThemeHalves | null;
  /** The custom theme library. KV hypertask:themes:v1. */
  libraryThemes: ReadonlyArray<ThemeDefinition>;
}

export const useAppearanceStore = create<AppearanceState>(() => ({
  appearance: createMessage(AppearanceSettingsPBSchema, { theme: 'Default', themeMode: ThemeModePB.System }),
  dateTime: createMessage(DateTimeSettingsPBSchema, {
    dateFormat: UserDateFormatPB.Friendly,
    timeFormat: UserTimeFormatPB.TwentyFourHour,
  }),
  textScaleFactor: 1,
  systemBrightness: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  customThemes: [],
  themePreference: 'system',
  themeHalves: null,
  libraryThemes: [],
}));

/** The appearance mode the user picked (System, Light or Dark). */
export function appearanceModeOf(state: AppearanceState = useAppearanceStore.getState()): ThemePreferenceMode {
  switch (state.appearance.themeMode) {
    case ThemeModePB.Light:
      return 'light';
    case ThemeModePB.Dark:
      return 'dark';
    default:
      return 'system';
  }
}

/** The brightness on screen: the mode, unless the picked theme only has colors for the other one. */
export function effectiveBrightness(state: AppearanceState = useAppearanceStore.getState()): Brightness {
  return resolveThemeAppearance(
    state.themePreference,
    state.systemBrightness === 'dark',
    appearanceModeOf(state),
    state.themeHalves,
  );
}

let lastPalette = '';
let forceRepaint = false;

export const useBrightness = () => useAppearanceStore((s) => effectiveBrightness(s));

function render() {
  const root = document.documentElement;
  // An open theme editor keeps its draft painted until it restores the theme with refreshTheme.
  if (root.dataset.themeId === THEME_PREVIEW_ID && !forceRepaint) return;
  forceRepaint = false;
  const state = useAppearanceStore.getState();
  const brightness = effectiveBrightness(state);
  const palette = resolveThemeHalf(state.themePreference, state.themeHalves, brightness);
  // t3code suppresses transitions while a theme or appearance switch repaints every surface.
  const paletteKey = `${palette}:${brightness}:${state.libraryThemes.length}`;
  const switching = lastPalette !== '' && lastPalette !== paletteKey;
  lastPalette = paletteKey;
  if (switching) root.classList.add('no-transitions');
  applyThemePalette(palette, brightness);
  applyTheme({
    scheme: state.appearance.theme || 'Default',
    brightness,
    font: state.appearance.font,
    monospaceFont: state.appearance.monospaceFont,
    textScaleFactor: state.textScaleFactor,
    rtl: state.appearance.layoutDirection === LayoutDirectionPB.RTLLayout,
  });
  // getGoogleFontSafely: workspace fonts are google_fonts families fetched at runtime.
  if (state.appearance.font) void ensureGoogleFont(state.appearance.font);
  if (switching) {
    // Force a reflow so the no-transitions class takes effect before removal.
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove('no-transitions'));
  }
}

/** Repaints the stored theme, replacing a theme editor preview (t3code's refreshTheme). */
export function refreshTheme(): void {
  lastPalette = '';
  forceRepaint = true;
  render();
}

/** Reads the theme preference, halves and custom library from the key-value store. */
function readThemeState(): Pick<AppearanceState, 'themePreference' | 'themeHalves' | 'libraryThemes'> {
  const libraryThemes = parseStoredThemes(KeyValueStorage.get(CUSTOM_THEMES_KEY));
  setCustomThemeLibrary(libraryThemes);
  return {
    themePreference: KeyValueStorage.get(THEME_PREFERENCE_KEY) || 'system',
    themeHalves: parseThemeHalves(KeyValueStorage.get(THEME_HALVES_KEY)),
    libraryThemes,
  };
}

/** The stored halves, including ids of themes that are not loaded (t3code's readThemeHalvesRaw). */
export function readThemeHalvesRaw(): { light?: string; dark?: string } {
  return parseThemeHalvesRaw(KeyValueStorage.get(THEME_HALVES_KEY));
}

export const themeActions = {
  /** t3code's setTheme: a whole theme replaces the light/dark mix. */
  async setTheme(next: ThemePreference): Promise<void> {
    useAppearanceStore.setState({ themePreference: next, themeHalves: null });
    await KeyValueStorage.remove(THEME_HALVES_KEY);
    await KeyValueStorage.set(THEME_PREFERENCE_KEY, next);
  },
  /** t3code's setThemeHalf: picks a theme for one appearance; null drops that half. */
  async setThemeHalf(appearance: ThemeAppearance, themeId: string | null): Promise<void> {
    const next: { light?: string; dark?: string } = { ...readThemeHalvesRaw() };
    if (themeId === null) delete next[appearance];
    else next[appearance] = themeId;
    const raw = next.light === undefined && next.dark === undefined ? null : JSON.stringify(next);
    useAppearanceStore.setState({ themeHalves: parseThemeHalves(raw) });
    if (raw === null) await KeyValueStorage.remove(THEME_HALVES_KEY);
    else await KeyValueStorage.set(THEME_HALVES_KEY, raw);
  },
  /** Saves the custom library and re-resolves the theme, whose definition may have changed. */
  async saveLibrary(themes: ReadonlyArray<ThemeDefinition>): Promise<void> {
    setCustomThemeLibrary(themes);
    useAppearanceStore.setState({
      libraryThemes: themes,
      themeHalves: parseThemeHalves(KeyValueStorage.get(THEME_HALVES_KEY)),
    });
    await KeyValueStorage.set(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  },
};

/**
 * Registers custom `<name>.hyper_plugin` themes so applyTheme can find them by name
 * (AppTheme.fromName searches built-ins, then plugins). Built-in names are never replaced.
 */
export function registerCustomThemes(themes: CustomTheme[]) {
  for (const name of useAppearanceStore.getState().customThemes) {
    if (!isBuiltInTheme(name)) delete builtInColorSchemes[name];
  }
  const names: string[] = [];
  for (const theme of themes) {
    if (isBuiltInTheme(theme.name) || names.includes(theme.name)) continue;
    builtInColorSchemes[theme.name] = { light: theme.light, dark: theme.dark };
    names.push(theme.name);
  }
  useAppearanceStore.setState({ customThemes: names });
}

export async function refreshCustomThemes(): Promise<void> {
  try {
    registerCustomThemes(await loadCustomThemes());
  } catch (error) {
    console.error('Failed to load custom themes', error);
  }
}

useAppearanceStore.subscribe(render);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) =>
  useAppearanceStore.setState({ systemBrightness: event.matches ? 'dark' : 'light' }),
);

/**
 * InitAppWidgetTask: loads the appearance and date/time settings. Startup fails if either
 * cannot be read, as in the Flutter app (HyperSDKException.AppearanceSettingsIsEmpty).
 */
export async function loadAppearance(): Promise<void> {
  // appTheme(PB.theme) may name a custom plugin theme.
  await refreshCustomThemes();
  const [appearance, dateTime] = await Promise.all([UserEventGetAppearanceSetting(), UserEventGetDateTimeSettings()]);
  if (!appearance.ok || !dateTime.ok) throw new Error('AppearanceSettingsIsEmpty');

  const scale = Number(KeyValueStorage.get(KVKeys.textScaleFactor) ?? '1');
  useAppearanceStore.setState({
    ...readThemeState(),
    appearance: appearance.value,
    dateTime: dateTime.value,
    textScaleFactor: Number.isFinite(scale) ? Math.min(1, Math.max(0.7, scale)) : 1,
  });

  const { locale, resetToDefault } = appearance.value;
  if (resetToDefault || !locale?.languageCode) {
    // The device locale becomes the saved locale, as AppearanceSettingsCubit does.
    const [language, country = ''] = navigator.language.split('-');
    const resolved = resolveLocale(language, country);
    await applyLocale(resolved);
    const [lang, ctry = ''] = resolved.split('-');
    await updateAppearance((pb) => {
      pb.locale = { $typeName: 'LocaleSettingsPB', languageCode: lang, countryCode: ctry };
      pb.resetToDefault = false;
    });
  } else {
    await applyLocale(resolveLocale(locale.languageCode, locale.countryCode));
  }
  render();
  loadAppearancePrefs();
}

/** Read-modify-write of the whole AppearanceSettingsPB, as the Flutter cubit re-sends it. */
export async function updateAppearance(mutate: (pb: AppearanceSettingsPB) => void): Promise<void> {
  const next = clone(AppearanceSettingsPBSchema, useAppearanceStore.getState().appearance);
  mutate(next);
  useAppearanceStore.setState({ appearance: next });
  await UserEventSetAppearanceSetting(next);
}

export async function updateDateTime(mutate: (pb: DateTimeSettingsPB) => void): Promise<void> {
  const next = clone(DateTimeSettingsPBSchema, useAppearanceStore.getState().dateTime);
  mutate(next);
  useAppearanceStore.setState({ dateTime: next });
  await UserEventSetDateTimeSettings(next);
}

export const appearanceActions = {
  setTheme: (theme: string) => updateAppearance((pb) => void (pb.theme = theme)),
  setThemeMode: (mode: ThemeModePB) => updateAppearance((pb) => void (pb.themeMode = mode)),
  setFontFamily: (font: string) => updateAppearance((pb) => void (pb.font = font)),
  setMonospaceFont: (font: string) => updateAppearance((pb) => void (pb.monospaceFont = font)),
  setLayoutDirection: (dir: LayoutDirectionPB) => updateAppearance((pb) => void (pb.layoutDirection = dir)),
  setTextDirection: (dir: TextDirectionPB) => updateAppearance((pb) => void (pb.textDirection = dir)),
  setEnableRtlToolbarItems: (on: boolean) => updateAppearance((pb) => void (pb.enableRtlToolbarItems = on)),
  saveIsMenuCollapsed: (collapsed: boolean) => updateAppearance((pb) => void (pb.isMenuCollapsed = collapsed)),
  saveMenuOffset: (offset: number) => updateAppearance((pb) => void (pb.menuOffset = offset)),
  setKeyValue: (key: string, value: string | null) =>
    updateAppearance((pb) => {
      if (value === null) delete pb.settingKeyValue[key];
      else pb.settingKeyValue[key] = value;
    }),
  async setLocale(locale: string) {
    await applyLocale(locale);
    const [languageCode, countryCode = ''] = locale.split('-');
    await updateAppearance((pb) => {
      pb.locale = { $typeName: 'LocaleSettingsPB', languageCode, countryCode };
      pb.resetToDefault = false;
    });
  },
  async setTextScaleFactor(factor: number) {
    const value = Math.min(1, Math.max(0.7, factor));
    useAppearanceStore.setState({ textScaleFactor: value });
    await KeyValueStorage.set(KVKeys.textScaleFactor, String(value));
  },
  setDateFormat: (format: UserDateFormatPB) => updateDateTime((pb) => void (pb.dateFormat = format)),
  setTimeFormat: (format: UserTimeFormatPB) => updateDateTime((pb) => void (pb.timeFormat = format)),
  /** resetTheme(): back to the Default theme. */
  resetTheme: () => updateAppearance((pb) => void (pb.theme = 'Default')),
  /** resetFontFamily(): the system font. */
  resetFontFamily: () => updateAppearance((pb) => void (pb.font = '')),
  /** setDocumentCursorColor(c) stores c.toHexString() ("0xaarrggbb"); null = resetDocumentCursorColor (''). */
  setDocumentCursorColor: (hex: string | null) =>
    updateAppearance((pb) => {
      pb.documentSetting ??= createMessage(DocumentSettingsPBSchema, {});
      pb.documentSetting.oneOfCursorColor = { case: 'cursorColor', value: hex ?? '' };
    }),
  /** setDocumentSelectionColor(c) / resetDocumentSelectionColor(). */
  setDocumentSelectionColor: (hex: string | null) =>
    updateAppearance((pb) => {
      pb.documentSetting ??= createMessage(DocumentSettingsPBSchema, {});
      pb.documentSetting.oneOfSelectionColor = { case: 'selectionColor', value: hex ?? '' };
    }),
  refreshCustomThemes,
};
