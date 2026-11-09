// Pure helpers of the Workspace settings page (settings_workspace_view.dart and friends).

/** Color.toHexString(): lowercase "0xaarrggbb" from a CSS `#RRGGBB(AA)`. */
export function cssToHexString(css: string): string {
  const h = css.replace('#', '');
  return `0x${h.length >= 8 ? h.slice(6, 8) : 'ff'}${h.slice(0, 6)}`.toLowerCase();
}

/** "0xaarrggbb" → CSS `#rrggbbaa`. */
export function hexStringToCss(hex: string): string {
  const v = hex.replace(/^0x/i, '').padStart(8, '0');
  return `#${v.slice(2, 8)}${v.slice(0, 2)}`;
}

/** HexOpacityExtension.extractHex on '0xaarrggbb'. */
export const extractHex = (hex: string) => hex.substring(4);

/** HexOpacityExtension.extractOpacity: alpha / 2.55, toStringAsFixed(0). */
export const extractOpacity = (hex: string) => (parseInt(hex.substring(2, 4), 16) / 2.55).toFixed(0);

/** combineHexWithOpacity: the alpha byte is not zero-padded (upstream quirk A6). */
export function combineHexWithOpacity(hex: string, opacity: string): string {
  return `0x${Math.round(parseInt(opacity, 10) * 2.55).toString(16)}${hex}`;
}

type Tr = (key: string) => string;

/** validateOpacityValue: an int in 1..100. */
export function validateOpacityValue(value: string, tr: Tr): string | null {
  if (value === '') return tr('settings.appearance.documentSettings.opacityEmptyError');
  const parsed = /^\s*[+-]?\d+\s*$/.test(value) ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed > 100 || parsed <= 0) return tr('settings.appearance.documentSettings.opacityRangeError');
  return null;
}

/** validateHexValue: 6 characters that parse as hex together with a valid opacity. */
export function validateHexValue(hex: string, opacity: string, tr: Tr): string | null {
  if (hex === '') return tr('settings.appearance.documentSettings.hexEmptyError');
  if (hex.length !== 6) return tr('settings.appearance.documentSettings.hexLengthError');
  if (validateOpacityValue(opacity, tr) === null && !/^0x[0-9a-fA-F]+$/.test(combineHexWithOpacity(hex, opacity))) {
    return tr('settings.appearance.documentSettings.hexInvalidError');
  }
  return null;
}

/** fontFamilyDisplayName: '' → the "System" label; else strip `_regular` and split camelCase. */
export function fontFamilyDisplayName(font: string, systemLabel: string): string {
  if (font === '') return systemLabel;
  return font.replace(/_regular/g, '').replace(/(?<=[a-z])[A-Z]/g, (m) => ` ${m}`);
}

/**
 * _FontSelectorDropdown._onTextFieldChanged: empty → all; the current font's own name keeps
 * the previous list; else a substring match on the raw or display name, with '' (System)
 * put first when the text is part of "system".
 */
export function filterFonts(options: string[], value: string, currentFont: string, previous: string[], systemLabel: string): string[] {
  const v = value.trim();
  if (v === '') return options;
  const display = (f: string) => fontFamilyDisplayName(f, systemLabel);
  if (display(value) === display(currentFont)) return previous;
  const needle = display(v).toLowerCase();
  const out = options.filter((f) => f.toLowerCase().includes(v.toLowerCase()) || display(f).toLowerCase().includes(needle));
  if (!out.includes('') && 'system'.includes(v.toLowerCase())) out.unshift('');
  return out;
}

const ICON_COLORS: Array<[string, string]> = [
  ['#8A2BE2', '#F0E6FF'],
  ['#2E8B57', '#E0FFF0'],
  ['#1E90FF', '#E6F3FF'],
  ['#FF7F50', '#FFF0E6'],
  ['#FF69B4', '#FFE6F0'],
  ['#20B2AA', '#E0FFFF'],
  ['#DC143C', '#FFE6E6'],
  ['#8B4513', '#FFF0E6'],
];

/** ColorGenerator(name).randomColor(): (text, background) from the UTF-16 code-unit sum. */
export function workspaceIconColors(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return ICON_COLORS[hash % ICON_COLORS.length];
}

/** Dart DateTime.toLocal().toIso8601String().split('T').first. */
export function localIsoDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
