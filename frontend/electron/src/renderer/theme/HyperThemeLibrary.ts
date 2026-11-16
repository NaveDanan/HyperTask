// Ported from t3code (apps/web/src/themePalette.ts and apps/web/src/themeCss.ts), Copyright (c) 2026 T3 Tools Inc.,
// MIT License. See features/settings/appearance/NOTICE.md.
// The theme engine of t3code's Appearance settings: theme lookup, light/dark halves, the --app-theme-* variables
// that styles/app.css maps onto every surface token, and the custom theme library. Differences from t3code: the
// library and preferences live in HyperTask's key-value store (shared_preferences.json) instead of localStorage;
// environment (server-published) themes and context-chip colors are not ported.

import 'culori/css';
import { converter, parse } from 'culori/fn';
import {
  BUILT_IN_THEMES,
  RESERVED_THEME_IDS,
  T3_CHAT_THEME,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeVariants,
} from './HyperThemePalettes';

export type { ThemeAppearance, ThemeColorRole, ThemeColors, ThemeDefinition, ThemeVariants };
export { BUILT_IN_THEMES };

export const THEME_FILE_VERSION = 1 as const;
/** KV keys (t3code: t3code:theme, t3code:theme-halves:v1, t3code:themes:v1). */
export const THEME_PREFERENCE_KEY = 'hypertask:theme';
export const THEME_HALVES_KEY = 'hypertask:theme-halves:v1';
export const CUSTOM_THEMES_KEY = 'hypertask:themes:v1';
const THEME_CSS_MAX_LENGTH = 100_000;

/** "system", "light" and "dark" select the standard T3 Code palette; any other value is a theme id. */
export type ThemePreference = string;
export type ThemePreferenceMode = ThemeAppearance | 'system';
export type ThemeColorOverrides = Readonly<Partial<Record<ThemeColorRole, string>>>;
export type ThemeVariantOverrides = Readonly<Partial<Record<ThemeAppearance, ThemeColorOverrides>>>;
export type ThemeCollection = Readonly<{ id: string; label: string }>;
export type ThemeHalves = Readonly<{ light?: string; dark?: string }>;

const THEME_COLOR_ROLE_SET: ReadonlySet<string> = new Set(THEME_COLOR_ROLES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === 'light' || value === 'dark';
}

const convertToOklch = converter('oklch');

/** A literal CSS color as canonical oklch, as t3code stores it (parsed through culori); null when it is not one. */
export function toCanonicalThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const parsed = parse(input);
  if (!parsed) return null;
  const color = convertToOklch(parsed);
  const lightness = color.l ?? 0;
  const chroma = color.c ?? 0;
  const hue = color.h ?? 0;
  // Missing CSS components are zero; Culori omits none alpha, so distinguish it from absent alpha.
  const alpha = /\/\s*none\s*\)$/i.test(input) ? 0 : (color.alpha ?? 1);
  if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return null;
  const format = (n: number, precision: number) =>
    (Math.abs(n) < 10 ** -precision / 2 ? 0 : n).toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, '$1');
  const L = Math.min(1, Math.max(0, lightness));
  const C = Math.max(0, chroma);
  const a = Math.min(1, Math.max(0, alpha));
  const normalizedHue = C < 0.0000005 ? 0 : ((hue % 360) + 360) % 360;
  const body = `${format(L, 6)} ${format(C, 6)} ${format(normalizedHue, 3)}`;
  return a < 1 ? `oklch(${body} / ${format(a, 4)})` : `oklch(${body})`;
}

export function isThemeColor(value: unknown): value is string {
  return toCanonicalThemeColor(value) !== null;
}

function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,47})$/.test(value);
}

function isThemeLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 48;
}

function isThemeCss(value: unknown): value is string {
  return typeof value === 'string' && value.length <= THEME_CSS_MAX_LENGTH;
}

function parseThemeCollection(value: unknown): ThemeCollection | undefined {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-z0-9][a-z0-9.:-]{0,127}$/i.test(value.id) &&
    isThemeLabel(value.label)
    ? { id: value.id, label: value.label.trim() }
    : undefined;
}

export function getDefaultThemeColors(appearance: ThemeAppearance): ThemeColors {
  return appearance === 'dark' ? T3_CHAT_THEME.variants!.dark! : T3_CHAT_THEME.colors;
}

// ---- Custom theme library ------------------------------------------------------------------

function lenientThemeColorOverrides(value: Readonly<Record<string, unknown>>): Partial<Record<ThemeColorRole, string>> {
  const overrides: Partial<Record<ThemeColorRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    const normalized = toCanonicalThemeColor(color);
    if (THEME_COLOR_ROLE_SET.has(role) && normalized) overrides[role as ThemeColorRole] = normalized;
  }
  return overrides;
}

function parseStoredThemeColors(value: unknown, appearance: ThemeAppearance): ThemeColors | null {
  if (!isRecord(value)) return null;
  return { ...getDefaultThemeColors(appearance), ...lenientThemeColorOverrides(value) };
}

function parseStoredThemeVariants(value: unknown, baseAppearance: ThemeAppearance): ThemeVariants | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {};
  for (const [appearance, colors] of Object.entries(value)) {
    if (!isThemeAppearance(appearance)) return null;
    // Base colors shadow a matching variant; drop it for parseThemeFile round-trips.
    if (appearance === baseAppearance) continue;
    const parsedColors = parseStoredThemeColors(colors, appearance);
    if (!parsedColors) return null;
    variants[appearance] = parsedColors;
  }
  return Object.keys(variants).length > 0 ? variants : undefined;
}

function parseStoredTheme(value: unknown): ThemeDefinition | null {
  if (!isRecord(value)) return null;
  if (!isThemeId(value.id) || RESERVED_THEME_IDS.has(value.id)) return null;
  if (!isThemeLabel(value.label) || !isThemeAppearance(value.appearance)) return null;
  const colors = parseStoredThemeColors(value.colors, value.appearance);
  if (!colors) return null;
  const variants = parseStoredThemeVariants(value.variants, value.appearance);
  if (value.variants !== undefined && variants === null) return null;
  const collection = parseThemeCollection(value.collection);
  return {
    id: value.id,
    label: value.label.trim(),
    appearance: value.appearance,
    colors,
    ...(variants ? { variants } : {}),
    ...(collection ? { collection } : {}),
    ...(value.managed === true ? { managed: true } : {}),
    ...(isThemeCss(value.css) && value.css.length > 0 ? { css: value.css } : {}),
  };
}

/** Parses the stored library, skipping entries that no longer validate and later duplicates of an id. */
export function parseStoredThemes(raw: string | null | undefined): ReadonlyArray<ThemeDefinition> {
  if (!raw) return [];
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const themes: ThemeDefinition[] = [];
  for (const value of stored) {
    const theme = parseStoredTheme(value);
    if (theme && !themes.some((existing) => existing.id === theme.id)) themes.push(theme);
  }
  return themes;
}

let customThemes: ReadonlyArray<ThemeDefinition> = [];

/** The custom library the store last loaded; getThemeDefinition reads it synchronously. */
export function setCustomThemeLibrary(themes: ReadonlyArray<ThemeDefinition>): void {
  customThemes = themes;
}

export function getCustomThemes(): ReadonlyArray<ThemeDefinition> {
  return customThemes;
}

export function themeIdFromName(name: string): string {
  const label = name.trim().toLowerCase();
  const normalized = label
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (normalized || !label) return normalized || 'custom-theme';
  // Names without ASCII letters or digits still need independent, stable ids.
  let hash = 2_166_136_261;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `theme-${(hash >>> 0).toString(36)}`;
}

/** The library with `theme` added; throws for reserved or taken ids, as t3code's installCustomTheme does. */
export function withInstalledTheme(theme: ThemeDefinition): ReadonlyArray<ThemeDefinition> {
  if (RESERVED_THEME_IDS.has(theme.id)) throw new Error(`The theme id "${theme.id}" is reserved.`);
  if (BUILT_IN_THEMES.some((existing) => existing.id === theme.id) || customThemes.some((t) => t.id === theme.id)) {
    throw new Error(`A theme named "${theme.label}" is already installed.`);
  }
  return [...customThemes, theme];
}

/** The library with `theme` replacing the theme of the same id. */
export function withUpdatedTheme(theme: ThemeDefinition): ReadonlyArray<ThemeDefinition> {
  if (!customThemes.some((existing) => existing.id === theme.id)) throw new Error(`"${theme.label}" is not installed.`);
  return customThemes.map((existing) => (existing.id === theme.id ? theme : existing));
}

export function withoutThemes(themeIds: ReadonlyArray<string>): ReadonlyArray<ThemeDefinition> {
  const removed = new Set(themeIds);
  return customThemes.filter((theme) => !removed.has(theme.id));
}

/** A free id for a copy named `name` (t3code's editor derives ids from names the same way). */
export function uniqueThemeId(name: string): string {
  const base = themeIdFromName(name).slice(0, 44);
  const taken = (id: string) =>
    RESERVED_THEME_IDS.has(id) ||
    BUILT_IN_THEMES.some((theme) => theme.id === id) ||
    customThemes.some((theme) => theme.id === id);
  if (!taken(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken(candidate)) return candidate;
  }
}

// ---- Theme files -----------------------------------------------------------------------------

function parseThemeColorOverrides(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) throw new Error('Theme colors must be objects.');
  const overrides: Partial<Record<ThemeColorRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (!THEME_COLOR_ROLE_SET.has(role)) throw new Error(`"${role}" is not a supported theme color role.`);
    const normalized = toCanonicalThemeColor(color);
    if (!normalized) {
      throw new Error(`The color for "${role}" must be a literal CSS color such as oklch(0.62 0.2 280).`);
    }
    overrides[role as ThemeColorRole] = normalized;
  }
  if (Object.keys(overrides).length === 0) throw new Error('Add at least one color role to the theme file.');
  return overrides;
}

export function parseThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new Error('Theme files must contain a JSON object.');
  if (value.version !== THEME_FILE_VERSION) {
    throw new Error(`This theme file uses an unsupported version. Expected ${THEME_FILE_VERSION}.`);
  }
  const name = value.name;
  const appearance = value.appearance;
  const rawColors = value.colors;
  if (!isThemeLabel(name)) throw new Error('Theme files need a name (48 characters or fewer).');
  if (!isThemeAppearance(appearance)) throw new Error('Theme files need an appearance of "light" or "dark".');
  if (!isRecord(rawColors)) throw new Error('Theme files need a colors object.');

  const id = value.id === undefined ? themeIdFromName(name) : value.id;
  if (!isThemeId(id)) throw new Error('Theme ids may only contain lowercase letters, numbers, and hyphens.');
  if (RESERVED_THEME_IDS.has(id)) throw new Error(`The theme id "${id}" is reserved.`);

  const overrides = parseThemeColorOverrides(rawColors);
  const collection = parseThemeCollection(value.collection);
  if (value.collection !== undefined && !collection) throw new Error('Theme collections need a valid id and label.');
  if (value.css !== undefined && !isThemeCss(value.css)) {
    throw new Error(`Theme CSS must be text of ${THEME_CSS_MAX_LENGTH} characters or fewer.`);
  }

  const fallback = getDefaultThemeColors(appearance);
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {};
  if (value.variants !== undefined) {
    if (!isRecord(value.variants)) throw new Error('Theme variants must be an object.');
    for (const [variantAppearance, variantColors] of Object.entries(value.variants)) {
      if (!isThemeAppearance(variantAppearance)) throw new Error('Theme variants may only be named "light" or "dark".');
      if (variantAppearance === appearance) {
        throw new Error(`Theme variants must not repeat the base appearance "${appearance}".`);
      }
      variants[variantAppearance] = {
        ...getDefaultThemeColors(variantAppearance),
        ...parseThemeColorOverrides(variantColors),
      };
    }
  }

  return {
    id,
    label: name.trim(),
    appearance,
    colors: { ...fallback, ...overrides },
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
    ...(collection ? { collection } : {}),
    ...(value.managed === true ? { managed: true } : {}),
    ...(value.css ? { css: value.css as string } : {}),
  };
}

export function serializeThemeFile(theme: ThemeDefinition): string {
  const file = {
    version: THEME_FILE_VERSION,
    id: theme.id,
    name: theme.label,
    appearance: theme.appearance,
    colors: theme.colors,
    ...(theme.variants ? { variants: theme.variants } : {}),
    ...(theme.collection ? { collection: theme.collection } : {}),
    ...(theme.managed ? { managed: true } : {}),
    ...(theme.css ? { css: theme.css } : {}),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---- Lookup and halves ---------------------------------------------------------------------

const LEGACY_THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  't3-chat-dark': 't3-chat',
  't3-grove': 'grove',
  't3-ocean': 'ocean',
  't3-ember': 'ember',
  't3-iris': 'iris',
};

function themeIdFromPreference(theme: ThemePreference): string {
  return Object.hasOwn(LEGACY_THEME_ID_ALIASES, theme) ? (LEGACY_THEME_ID_ALIASES[theme] ?? theme) : theme;
}

export function getThemeDefinition(theme: ThemePreference): ThemeDefinition | null {
  const themeId = themeIdFromPreference(theme);
  return (
    BUILT_IN_THEMES.find((definition) => definition.id === themeId) ??
    customThemes.find((definition) => definition.id === themeId) ??
    null
  );
}

/** Every selection path must check single-appearance themes to keep mix and appearance tiles in sync. */
export function singleAppearanceOf(theme: ThemeDefinition): ThemeAppearance | null {
  const modes = getThemeModes(theme);
  return modes.length === 1 ? modes[0]! : null;
}

export function getThemeColorsForMode(theme: ThemeDefinition, mode: ThemeAppearance): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors;
  return theme.variants?.[mode] ?? null;
}

export function getThemeModes(theme: ThemeDefinition): ReadonlyArray<ThemeAppearance> {
  return (['light', 'dark'] as const).filter((mode) => getThemeColorsForMode(theme, mode) !== null);
}

export function parseThemeHalves(raw: string | null | undefined): ThemeHalves | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const halves: { light?: string; dark?: string } = {};
    for (const appearance of ['light', 'dark'] as const) {
      const themeId = value[appearance];
      if (typeof themeId !== 'string') continue;
      const definition = getThemeDefinition(themeId);
      if (definition && getThemeColorsForMode(definition, appearance) !== null) halves[appearance] = definition.id;
    }
    return halves.light !== undefined || halves.dark !== undefined ? halves : null;
  } catch {
    return null;
  }
}

/** The stored halves without dropping ids whose themes are not loaded (t3code's readThemeHalvesRaw). */
export function parseThemeHalvesRaw(raw: string | null | undefined): { light?: string; dark?: string } {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    return {
      ...(typeof value.light === 'string' ? { light: value.light } : {}),
      ...(typeof value.dark === 'string' ? { dark: value.dark } : {}),
    };
  } catch {
    return {};
  }
}

export function resolveThemeHalf(
  theme: ThemePreference,
  halves: ThemeHalves | null,
  appearance: ThemeAppearance,
): ThemePreference {
  return halves?.[appearance] ?? theme;
}

/** The appearance on screen: the mode, unless the picked theme has no colors for it (t3code's resolveThemeAppearance). */
export function resolveThemeAppearance(
  theme: ThemePreference,
  systemDark: boolean,
  appearanceMode: ThemePreferenceMode,
  halves: ThemeHalves | null,
): ThemeAppearance {
  const mode = appearanceMode === 'system' ? (systemDark ? 'dark' : 'light') : appearanceMode;
  if (halves?.[mode]) return mode;
  const definition = getThemeDefinition(theme);
  return definition && getThemeColorsForMode(definition, mode) === null ? definition.appearance : mode;
}

// ---- Applying --------------------------------------------------------------------------------

const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
  canvas: '--app-theme-canvas',
  chrome: '--app-theme-chrome',
  toolbar: '--app-theme-toolbar',
  toolbarForeground: '--app-theme-toolbar-foreground',
  toolbarBorder: '--app-theme-toolbar-border',
  toolbarControl: '--app-theme-toolbar-control',
  toolbarControlForeground: '--app-theme-toolbar-control-foreground',
  toolbarControlHover: '--app-theme-toolbar-control-hover',
  surface: '--app-theme-surface',
  surfaceRaised: '--app-theme-surface-raised',
  surfaceOverlay: '--app-theme-surface-overlay',
  text: '--app-theme-text',
  textMuted: '--app-theme-text-muted',
  border: '--app-theme-border',
  input: '--app-theme-input',
  focus: '--app-theme-focus',
  accent: '--app-theme-accent',
  accentForeground: '--app-theme-accent-foreground',
  secondary: '--app-theme-secondary',
  secondaryForeground: '--app-theme-secondary-foreground',
  muted: '--app-theme-muted',
  mutedForeground: '--app-theme-muted-foreground',
  placeholder: '--app-theme-placeholder',
  secondaryLabel: '--app-theme-secondary-label',
  iconMuted: '--app-theme-icon-muted',
  error: '--app-theme-error',
  errorForeground: '--app-theme-error-foreground',
  errorSurface: '--app-theme-error-surface',
  warning: '--app-theme-warning',
  warningForeground: '--app-theme-warning-foreground',
  warningSurface: '--app-theme-warning-surface',
  update: '--app-theme-update',
  updateForeground: '--app-theme-update-foreground',
  updateSurface: '--app-theme-update-surface',
  accentSurface: '--app-theme-accent-surface',
  accentSurfaceForeground: '--app-theme-accent-surface-foreground',
  messageSurface: '--app-theme-message-surface',
  messageForeground: '--app-theme-message-foreground',
  messageAction: '--app-theme-message-action',
  messageActionForeground: '--app-theme-message-action-foreground',
  messageActionHover: '--app-theme-message-action-hover',
  codeBackground: '--app-theme-code-background',
  codeForeground: '--app-theme-code-foreground',
  searchMatchBackground: '--app-theme-search-match-background',
  searchMatchForeground: '--app-theme-search-match-foreground',
  searchMatchActiveBackground: '--app-theme-search-match-active-background',
  searchMatchActiveForeground: '--app-theme-search-match-active-foreground',
  sidebar: '--app-theme-sidebar',
  sidebarForeground: '--app-theme-sidebar-foreground',
  sidebarMutedForeground: '--app-theme-sidebar-muted-foreground',
  sidebarControlSurface: '--app-theme-sidebar-control-surface',
  sidebarRowHover: '--app-theme-sidebar-row-hover',
  sidebarRowActive: '--app-theme-sidebar-row-active',
  sidebarRowSelected: '--app-theme-sidebar-row-selected',
  sidebarBorder: '--app-theme-sidebar-border',
  terminalBackground: '--app-theme-terminal-background',
  terminalForeground: '--app-theme-terminal-foreground',
  terminalCursor: '--app-theme-terminal-cursor',
  terminalSelection: '--app-theme-terminal-selection-background',
  terminalScrollbar: '--app-theme-terminal-scrollbar',
  terminalScrollbarHover: '--app-theme-terminal-scrollbar-hover',
};

export function getThemeColorVariable(role: ThemeColorRole): string {
  return APP_THEME_VARIABLES[role];
}

const THEME_CSS_ELEMENT_ID = 'hyper-theme-css';

/** A theme's custom CSS, in one style element after the app's own styles (t3code's applyThemeCss). */
function applyThemeCss(css: string | undefined): void {
  const existing = document.getElementById(THEME_CSS_ELEMENT_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.head.appendChild(document.createElement('style'));
  element.id = THEME_CSS_ELEMENT_ID;
  if (element.textContent !== css) element.textContent = css;
}

/** Sets data-theme-id and the --app-theme-* variables for a theme, or clears them for the standard palette. */
export function applyThemePalette(theme: ThemePreference, appearance: ThemeAppearance): void {
  const root = document.documentElement;
  const palette = getThemeDefinition(theme);
  applyThemeCss(palette?.css);
  if (palette) {
    root.dataset.themeId = palette.id;
    const colors = getThemeColorsForMode(palette, appearance) ?? palette.colors;
    for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
      root.style.setProperty(APP_THEME_VARIABLES[role], value);
    }
    return;
  }
  delete root.dataset.themeId;
  for (const variable of Object.values(APP_THEME_VARIABLES)) root.style.removeProperty(variable);
}

export const THEME_PREVIEW_ID = '__preview';

/**
 * Paints a draft palette (the theme editor's live preview). Callers restore the stored theme with refreshTheme
 * (appearance-store) when the draft closes.
 */
export function applyThemeColorPreview(colors: ThemeColors, appearance: ThemeAppearance, css?: string): void {
  const root = document.documentElement;
  root.dataset.themeId = THEME_PREVIEW_ID;
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
  for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
    if (isThemeColor(value)) root.style.setProperty(APP_THEME_VARIABLES[role], value);
  }
  applyThemeCss(css);
}
