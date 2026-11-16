import { hypertaskTokens, type Brightness } from './apphyper-tokens';
import { builtInColorSchemes, type HyperColorScheme } from './color-schemes';

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


/**
 * CSS variables for one color scheme, named after the Flutter accessors:
 * --cs-* = Theme.colorScheme, --th-* = other ThemeData colors, --afx-* = AFThemeExtension,
 * --hyper-* = raw HyperColorScheme fields, --af-* = HypertaskTheme (hypertask_ui).
 */
export function themeVariables(colors: HyperColorScheme, brightness: Brightness): Record<string, string> {
  const light = brightness === 'light';
  const vars: Record<string, string> = {};
  for (const [field, value] of Object.entries(colors)) {
    vars[`--hyper-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
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
  for (const [name, value] of Object.entries(hypertaskTokens[brightness])) vars[`--af-${name}`] = value;
  return vars;
}

const quote = (family: string) => (/^[\w-]+$/.test(family) ? family : `"${family}"`);

// t3code's default stacks (apps/web/src/index.css @theme), Copyright (c) 2026 T3 Tools Inc., MIT License.
const SANS_FALLBACK = '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif';
const MONO_FALLBACK = 'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Shadcn tokens a color scheme used to override. The Appearance themes (HyperThemeLibrary, ported from t3code) own
 * the accent now, so applyTheme clears them.
 */
const ACCENT_VARS = ['--primary', '--primary-foreground', '--ring', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-ring'];

export function applyTheme(options: ThemeOptions): void {
  const schemeName = builtInColorSchemes[options.scheme] ? options.scheme : 'Default';
  const scheme = builtInColorSchemes[schemeName];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(scheme[options.brightness], options.brightness))) {
    root.style.setProperty(name, value);
  }
  for (const name of ACCENT_VARS) root.style.removeProperty(name);
  root.dataset.theme = options.brightness;
  root.style.colorScheme = options.brightness;
  const sans = options.font ? `${quote(options.font)}, ${SANS_FALLBACK}` : SANS_FALLBACK;
  const mono = options.monospaceFont ? `${quote(options.monospaceFont)}, ${MONO_FALLBACK}` : MONO_FALLBACK;
  root.style.setProperty('--app-font-sans', sans);
  root.style.setProperty('--app-font-mono', mono);
  // Legacy names, read by screens that have not moved to Tailwind yet.
  root.style.setProperty('--font-family', sans);
  root.style.setProperty('--font-mono', mono);
  root.style.setProperty('--text-scale', String(options.textScaleFactor));
  // AppearanceSettingsPB.layout_direction only mirrors the document editor in Flutter,
  // not the app chrome; the editor reads this attribute.
  root.dataset.layoutDirection = options.rtl ? 'rtl' : 'ltr';
}

