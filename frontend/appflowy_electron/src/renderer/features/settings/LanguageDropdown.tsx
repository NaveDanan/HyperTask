import { useI18nStore } from '@/i18n';
import { appearanceActions } from '@/theme/appearance-store';
import { FLUTTER_SUPPORTED_LOCALES, languageFromLocale } from './language';
import { SettingsDropdown } from './shared';

export { FLUTTER_SUPPORTED_LOCALES, languageFromLocale };

/** LanguageDropdown (settings_workspace_view.dart): SettingsDropdown<Locale>(expandWidth: false). */
export function LanguageDropdown() {
  const locale = useI18nStore((s) => s.locale);
  return (
    <SettingsDropdown
      selected={locale}
      expandWidth={false}
      options={FLUTTER_SUPPORTED_LOCALES.map((value) => ({ value: value as string, label: languageFromLocale(value) }))}
      onChanged={(value) => void appearanceActions.setLocale(value)}
    />
  );
}
