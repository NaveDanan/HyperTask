import { appFlowyTokens, type Brightness } from './appflowy-tokens';
import { builtInColorSchemes, type FlowyColorScheme } from './color-schemes';

export type { Brightness };

export interface ThemeOptions {
  scheme: string;
  brightness: Brightness;
  /** AppearanceSettingsPB.font; '' = platform font. */
  font: string;
  monospaceFont: string;
  textScaleFactor: number;
  rtl: boolean;
}

/** Platform default family Flutter's Material 2014 typography resolves to. */
const PLATFORM_FONT = navigator.userAgent.includes('Windows')
  ? '"Segoe UI"'
  : navigator.userAgent.includes('Mac')
    ? 'system-ui, -apple-system'
    : 'Roboto, Ubuntu, Cantarell, "DejaVu Sans", "Liberation Sans", Arial';

/**
 * CSS variables for one color scheme, named after the Flutter accessors:
 * --cs-* = Theme.colorScheme, --th-* = other ThemeData colors, --afx-* = AFThemeExtension,
 * --flowy-* = raw FlowyColorScheme fields, --af-* = AppFlowyTheme (appflowy_ui).
 */
export function themeVariables(colors: FlowyColorScheme, brightness: Brightness): Record<string, string> {
  const light = brightness === 'light';
  const vars: Record<string, string> = {};
  for (const [field, value] of Object.entries(colors)) {
    vars[`--flowy-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  }
  Object.assign(vars, {
    // ColorScheme (desktop_appearance.dart)
    '--cs-primary': colors.primary,
    '--cs-on-primary': colors.onPrimary,
    '--cs-primary-container': colors.main2,
    '--cs-on-primary-container': '#FFFFFF',
    '--cs-secondary': colors.hoverBG1,
    '--cs-on-secondary': colors.shader1,
    '--cs-secondary-container': colors.selector,
    '--cs-on-secondary-container': colors.topbarBg,
    '--cs-tertiary': colors.shader7,
    '--cs-on-tertiary': colors.toolbarColor,
    '--cs-tertiary-container': colors.questionBubbleBG,
    '--cs-surface': colors.surface,
    '--cs-on-surface': colors.hoverFG,
    '--cs-inverse-surface': colors.hoverBG3,
    '--cs-error': colors.red,
    '--cs-on-error': colors.onPrimary,
    '--cs-outline': colors.shader4,
    '--cs-surface-container-highest': colors.sidebarBg,
    '--cs-shadow': colors.shadow,
    // ThemeData
    '--th-divider': colors.divider,
    '--th-hint': colors.hint,
    '--th-hover': colors.hoverBG2,
    '--th-disabled': colors.shader4,
    '--th-highlight': colors.main1,
    '--th-card': colors.input,
    '--th-cursor': colors.main2,
    '--icon-color': colors.icon,
    '--text-color': colors.text,
    '--th-scrollbar': colors.scrollbarColor,
    '--th-scrollbar-hover': colors.scrollbarHoverColor,
    // AFThemeExtension
    '--afx-warning': colors.yellow,
    '--afx-success': colors.green,
    '--afx-text': colors.text,
    '--afx-secondary-text': colors.secondaryText,
    '--afx-strong-text': colors.strongText,
    '--afx-grey-hover': colors.hoverBG1,
    '--afx-grey-select': colors.bg3,
    '--afx-light-grey-hover': colors.hoverBG3,
    '--afx-toggle-off-fill': colors.shader5,
    '--afx-progress-bar-bg': colors.progressBarBGColor,
    '--afx-toggle-button-bg': colors.toggleButtonBGColor,
    '--afx-callout-bg': colors.hoverBG3,
    '--afx-table-cell-bg': colors.surface,
    '--afx-calendar-weekend-bg': colors.calendarWeekendBGColor,
    '--afx-grid-row-count': colors.gridRowCountColor,
    '--afx-background': colors.surface,
    '--afx-on-background': colors.text,
    '--afx-border': colors.borderColor,
    '--afx-toolbar-hover': colors.toolbarHoverColor,
    '--afx-light-icon': colors.lightIconColor,
    '--afx-caption-color': colors.hint,
    '--afx-callout-color': colors.shader3,
    // Fixed values that do not follow the selected scheme
    '--popover-border': light ? '#EDEDEE' : '#3A3F49',
    '--popover-shadow': light ? '0 4px 20px #1F23291A' : '0 2px 16px #0000007A',
    '--popover-shadow-medium': light ? '0 4px 32px #1F222512' : '0 4px 32px #0000007A',
    '--tooltip-bg': light ? '#1D2129' : '#E5E5E5E5',
    '--tooltip-fg': light ? '#FFFFFF' : '#000000',
  });
  for (let i = 1; i <= 9; i++) vars[`--afx-tint-${i}`] = colors[`tint${i}`];
  for (const [name, value] of Object.entries(appFlowyTokens[brightness])) vars[`--af-${name}`] = value;
  return vars;
}

const quote = (family: string) => (/^[\w-]+$/.test(family) ? family : `"${family}"`);

export function applyTheme(options: ThemeOptions): void {
  const scheme = builtInColorSchemes[options.scheme] ?? builtInColorSchemes.Default;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(scheme[options.brightness], options.brightness))) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = options.brightness;
  root.style.colorScheme = options.brightness;
  root.style.setProperty('--font-family', options.font ? `${quote(options.font)}, ${PLATFORM_FONT}` : PLATFORM_FONT);
  root.style.setProperty('--font-mono', `${quote(options.monospaceFont || 'RobotoMono')}, RobotoMono, monospace`);
  root.style.setProperty('--text-scale', String(options.textScaleFactor));
  // AppearanceSettingsPB.layout_direction only mirrors the document editor in Flutter,
  // not the app chrome; the editor reads this attribute.
  root.dataset.layoutDirection = options.rtl ? 'rtl' : 'ltr';
}
