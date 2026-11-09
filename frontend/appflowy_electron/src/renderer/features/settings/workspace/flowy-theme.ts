import { builtInColorSchemes, type FlowyColorScheme } from '@/theme/color-schemes';

// FlowyColorScheme JSON (packages/flowy_infra/lib/colorscheme/colorscheme.dart, ColorConverter)
// for custom `<name>.flowy_plugin` themes: colors are Dart int strings, usually "0xaarrggbb".

/** The built-in themes, in themeMap order. */
export const BUILT_IN_THEMES = ['Default', 'Dandelion', 'Lemonade', 'Lavender'] as const;

export const isBuiltInTheme = (name: string) => (BUILT_IN_THEMES as readonly string[]).includes(name);

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Dart int.tryParse: optional sign, decimal or 0x-prefixed hex, surrounding whitespace allowed. */
export function dartIntTryParse(source: string): bigint | null {
  const match = /^\s*([+-]?)(0[xX][0-9a-fA-F]+|[0-9]+)\s*$/.exec(source);
  if (!match) return null;
  const value = BigInt(match[2]);
  return match[1] === '-' ? -value : value;
}

/** ColorConverter.fromJson → CSS `#RRGGBBAA` (Color(int) keeps the low 32 bits; unparsable → transparent). */
export function dartColorToCss(value: string): string {
  const parsed = dartIntTryParse(value);
  const argb = parsed === null ? 0 : Number(BigInt.asUintN(32, parsed));
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`.toUpperCase();
}

/** ColorConverter.toJson: lowercase `0xaarrggbb` from a CSS `#RRGGBB` / `#RRGGBBAA`. */
export function cssToDartColor(css: string): string {
  const h = css.replace('#', '');
  const rgb = h.slice(0, 6);
  const a = h.length >= 8 ? h.slice(6, 8) : 'ff';
  return `0x${a}${rgb}`.toLowerCase();
}

/**
 * FlowyColorScheme.fromJsonSoft: the Default scheme of that brightness, overlaid with the
 * given JSON; every field must be a String. Throws on invalid JSON.
 */
export function colorSchemeFromJsonSoft(text: string, brightness: 'light' | 'dark'): FlowyColorScheme {
  const json = JSON.parse(text) as unknown;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new TypeError('not a map');
  const defaults = builtInColorSchemes.Default[brightness];
  const scheme: FlowyColorScheme = {};
  for (const key of Object.keys(defaults)) {
    const value = key in json ? (json as Record<string, unknown>)[key] : cssToDartColor(defaults[key]);
    if (typeof value !== 'string') throw new TypeError(`${key} is not a String`);
    scheme[key] = dartColorToCss(value);
  }
  return scheme;
}

/** FlowyColorScheme.toJson via jsonEncode (compact, declaration order). */
export function colorSchemeToJson(scheme: FlowyColorScheme): string {
  const out: Record<string, string> = {};
  for (const key of Object.keys(builtInColorSchemes.Default.light)) out[key] = cssToDartColor(scheme[key] ?? '#00000000');
  return JSON.stringify(out);
}

export interface CustomTheme {
  name: string;
  light: FlowyColorScheme;
  dark: FlowyColorScheme;
}

export class PluginCompilationError extends Error {}

/** FlowyDynamicPlugin._theme: parse both files with the Dart error texts. */
export function decodeThemePlugin(files: { name: string; light: string; dark: string }): CustomTheme {
  let light: FlowyColorScheme;
  let dark: FlowyColorScheme;
  try {
    light = colorSchemeFromJsonSoft(files.light, 'light');
  } catch {
    throw new PluginCompilationError('The light theme json file is not valid.');
  }
  try {
    dark = colorSchemeFromJsonSoft(files.dark, 'dark');
  } catch {
    throw new PluginCompilationError('The dark theme json file is not valid.');
  }
  return { name: files.name, light, dark };
}

/** FlowyPluginService.plugins: every decodable theme folder in Documents. */
export async function loadCustomThemes(): Promise<CustomTheme[]> {
  const themes: CustomTheme[] = [];
  for (const files of await window.appflowy.themes.list()) {
    try {
      themes.push(decodeThemePlugin(files));
    } catch {
      // A broken plugin is skipped, as a failed decode is when listing.
    }
  }
  return themes;
}
