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
} from '@shared/protobuf/flowy-user/user_setting_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';
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
import { isBuiltInTheme, loadCustomThemes, type CustomTheme } from '@/features/settings/workspace/flowy-theme';
import { ensureGoogleFont } from '@/features/settings/workspace/google-fonts';

interface AppearanceState {
  appearance: AppearanceSettingsPB;
  dateTime: DateTimeSettingsPB;
  /** KV textScaleFactor, clamped 0.7..1.0. */
  textScaleFactor: number;
  systemBrightness: Brightness;
  /** Names of the custom `<name>.flowy_plugin` themes registered in the color-scheme table. */
  customThemes: string[];
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
}));

export function effectiveBrightness(state: AppearanceState = useAppearanceStore.getState()): Brightness {
  switch (state.appearance.themeMode) {
    case ThemeModePB.Light:
      return 'light';
    case ThemeModePB.Dark:
      return 'dark';
    default:
      return state.systemBrightness;
  }
}

export const useBrightness = () => useAppearanceStore((s) => effectiveBrightness(s));

function render() {
  const state = useAppearanceStore.getState();
  applyTheme({
    scheme: state.appearance.theme || 'Default',
    brightness: effectiveBrightness(state),
    font: state.appearance.font,
    monospaceFont: state.appearance.monospaceFont,
    textScaleFactor: state.textScaleFactor,
    rtl: state.appearance.layoutDirection === LayoutDirectionPB.RTLLayout,
  });
  // getGoogleFontSafely: workspace fonts are google_fonts families fetched at runtime.
  if (state.appearance.font) void ensureGoogleFont(state.appearance.font);
}

/**
 * Registers custom `<name>.flowy_plugin` themes so applyTheme can find them by name
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
 * cannot be read, as in the Flutter app (FlowySDKException.AppearanceSettingsIsEmpty).
 */
export async function loadAppearance(): Promise<void> {
  // appTheme(PB.theme) may name a custom plugin theme.
  await refreshCustomThemes();
  const [appearance, dateTime] = await Promise.all([UserEventGetAppearanceSetting(), UserEventGetDateTimeSettings()]);
  if (!appearance.ok || !dateTime.ok) throw new Error('AppearanceSettingsIsEmpty');

  const scale = Number(KeyValueStorage.get(KVKeys.textScaleFactor) ?? '1');
  useAppearanceStore.setState({
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
