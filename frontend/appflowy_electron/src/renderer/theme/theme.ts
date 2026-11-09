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

const SANS_FALLBACK = `"Geist Variable", ${PLATFORM_FONT}, sans-serif`;
const MONO_FALLBACK = '"Geist Mono Variable", ui-monospace, monospace';

/** Shadcn tokens a color scheme overrides; the Default scheme keeps the monochrome values in app.css. */
const ACCENT_VARS = ['--primary', '--primary-foreground', '--ring', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-ring'];

/** Near-black or near-white, whichever reads better on a #RRGGBB background. */
function readableOn(hex: string): string {
  const value = hex.replace('#', '').slice(-6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? 'oklch(0.21 0.006 285.885)' : 'oklch(0.985 0 0)';
}

/** The scheme's primary color as the shadcn accent; null for Default. */
export function accentVariables(schemeName: string, colors: FlowyColorScheme): Record<string, string> | null {
  if (schemeName === 'Default' || !colors.primary) return null;
  const foreground = readableOn(colors.primary);
  return {
    '--primary': colors.primary,
    '--primary-foreground': foreground,
    '--ring': colors.primary,
    '--sidebar-primary': colors.primary,
    '--sidebar-primary-foreground': foreground,
    '--sidebar-ring': colors.primary,
  };
}

export function applyTheme(options: ThemeOptions): void {
  const schemeName = builtInColorSchemes[options.scheme] ? options.scheme : 'Default';
  const scheme = builtInColorSchemes[schemeName];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(scheme[options.brightness], options.brightness))) {
    root.style.setProperty(name, value);
  }
  const accent = accentVariables(schemeName, scheme[options.brightness]);
  for (const name of ACCENT_VARS) {
    if (accent) root.style.setProperty(name, accent[name]);
    else root.style.removeProperty(name);
  }
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

