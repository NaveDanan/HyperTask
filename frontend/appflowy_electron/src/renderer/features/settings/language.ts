// Locale list and names of the language picker.

/** EasyLocalization supportedLocales (lib/startup/tasks/app_widget.dart), in this order. */
export const FLUTTER_SUPPORTED_LOCALES = [
  'am-ET', 'ar-SA', 'ca-ES', 'cs-CZ', 'ckb-KU', 'de-DE', 'en-US', 'en-GB', 'es-VE', 'eu-ES', 'el-GR', 'fr-FR', 'fr-CA',
  'he', 'hu-HU', 'id-ID', 'it-IT', 'ja-JP', 'ko-KR', 'pl-PL', 'pt-BR', 'ru-RU', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA',
  'ur', 'vi-VN', 'zh-CN', 'zh-TW', 'fa', 'hin', 'mr-IN',
] as const;

/** languageFromLocale (packages/flowy_infra/lib/language.dart). */
export function languageFromLocale(locale: string): string {
  const [language, country = ''] = locale.split('-');
  switch (language) {
    case 'zh':
      if (country === 'CN') return '简体中文';
      if (country === 'TW') return '繁體中文';
      return language;
    case 'en':
      return country === 'GB' ? 'English (GB)' : 'English (US)';
    case 'fr':
      if (country === 'CA') return 'Français (CA)';
      if (country === 'FR') return 'Français (FR)';
      return language;
    case 'am':
      return 'አማርኛ';
    case 'ar':
      return 'العربية';
    case 'ca':
      return 'Català';
    case 'cs':
      return 'Čeština';
    case 'ckb':
      return country === 'KU' ? 'کوردی سۆرانی' : language;
    case 'de':
      return 'Deutsch';
    case 'es':
      return 'Español';
    case 'eu':
      return 'Euskera';
    case 'el':
      return 'Ελληνικά';
    case 'mr':
      return 'मराठी';
    case 'he':
      return 'עברית';
    case 'hu':
      return 'Magyar';
    case 'id':
      return 'Bahasa Indonesia';
    case 'it':
      return 'Italiano';
    case 'ja':
      return '日本語';
    case 'ko':
      return '한국어';
    case 'pl':
      return 'Polski';
    case 'pt':
      return 'Português';
    case 'ru':
      return 'русский';
    case 'sv':
      return 'Svenska';
    case 'th':
      return 'ไทย';
    case 'tr':
      return 'Türkçe';
    case 'fa':
      return 'فارسی';
    case 'uk':
      return 'українська';
    case 'ur':
      return 'اردو';
    case 'hin':
      return 'हिन्दी';
    default:
      return language;
  }
}
