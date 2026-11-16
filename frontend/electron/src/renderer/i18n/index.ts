import { create } from 'zustand';
import en from '@resources/translations/en-US.json';
import { Translator, type Translations, type TrOptions } from './translator';

const loaders = import.meta.glob('@resources/translations/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<Translations>
>;

const localeFiles = new Map<string, () => Promise<Translations>>();
for (const [file, load] of Object.entries(loaders)) {
  localeFiles.set(file.slice(file.lastIndexOf('/') + 1, -'.json'.length), load);
}

/** Locale file names available (e.g. "en-US", "fa"), as EasyLocalization's supported locales. */
export const supportedLocales = [...localeFiles.keys()].sort();

interface I18nState {
  locale: string;
  translator: Translator;
}

export const useI18nStore = create<I18nState>(() => ({
  locale: 'en-US',
  translator: new Translator(en, en),
}));

/** Resolves a language/country pair to an available file, as EasyLocalization does. */
export function resolveLocale(languageCode: string, countryCode: string): string {
  const full = countryCode ? `${languageCode}-${countryCode}` : languageCode;
  if (localeFiles.has(full)) return full;
  if (localeFiles.has(languageCode)) return languageCode;
  const sameLanguage = supportedLocales.find((l) => l.split('-')[0] === languageCode);
  return sameLanguage ?? 'en-US';
}

export async function setLocale(locale: string): Promise<void> {
  const load = localeFiles.get(locale);
  const translations = locale === 'en-US' || !load ? en : await load();
  useI18nStore.setState({ locale: load ? locale : 'en-US', translator: new Translator(translations, en) });
  document.documentElement.lang = locale;
}

/** Translate outside React. Components should use useTr() so they follow locale changes. */
export function tr(key: string, options?: TrOptions): string {
  return useI18nStore.getState().translator.tr(key, options);
}

export function plural(key: string, count: number, options?: TrOptions): string {
  return useI18nStore.getState().translator.plural(key, count, options);
}

export function useTr() {
  const translator = useI18nStore((s) => s.translator);
  return {
    tr: (key: string, options?: TrOptions) => translator.tr(key, options),
    plural: (key: string, count: number, options?: TrOptions) => translator.plural(key, count, options),
  };
}

/** languageFromLocale (appearance settings): the native language name shown in pickers. */
export function languageName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : locale;
  } catch {
    return locale;
  }
}
