// Ported from t3code (apps/web/src/appearanceFonts.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// The helpers the Typography section needs: the family stack, the availability and monospace probes,
// the Separate fonts flag, and the prompt and terminal typography that the composer and terminal read.
// This module must not import the theme store: the composer and terminal load it, and the theme store
// reads matchMedia at import time. The hooks use only useState and useEffect, so the composer and
// terminal keep rendering under the test harnesses that replace React's hooks.

import { type CSSProperties, useEffect, useState } from 'react';
import { KeyValueStorage } from '@/startup/kv';
import { type AppearancePrefs, useAppearancePrefsStore } from './appearance-prefs';

/** KeyValueStorage key of the Separate fonts switch. */
export const kAppearanceSeparateFonts = 'kAppearanceSeparateFonts';

/** HyperTerminal's fallback when the computed --font-mono is empty. */
const FALLBACK_MONOSPACE_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function quoteFontFamilyName(name: string): string {
  const bare = name.trim();
  if (bare.length === 0) return '';
  if (/^(['"]).*\1$/.test(bare)) return bare;
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare;
  return `"${bare.replaceAll('"', '')}"`;
}

function cssFontFamilies(input: string): string | null {
  const families = input
    .split(',')
    .map(quoteFontFamilyName)
    .filter((name) => name.length > 0);
  return families.length > 0 ? families.join(', ') : null;
}

/** The custom family list ahead of a default stack; the default stack alone when the custom list is empty. */
export function appearanceFontStack(custom: string, defaultStack: string): string {
  const families = cssFontFamilies(custom);
  return families === null ? defaultStack : `${families}, ${defaultStack}`;
}

/** A family name as a CSS font-family value, for drawing a list item in its own font. */
export function displayFontFamily(family: string): string {
  return cssFontFamilies(family) ?? '';
}

/** The app's monospace stack: the computed --font-mono, which applyTheme sets from the code font. */
export function monospaceStack(): string {
  const declared =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return declared || FALLBACK_MONOSPACE_STACK;
}

/** The app's monospace stack, re-read whenever the root's inline style changes (applyTheme writes --font-mono there). */
export function useMonospaceStack(): string {
  const [stack, setStack] = useState(monospaceStack());
  useEffect(() => {
    const sync = () => setStack(monospaceStack());
    sync();
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return stack;
}

/**
 * Reads one appearance preference and re-renders when it changes. The selector is fixed per call
 * site, so the subscription is made once.
 */
export function useAppearancePref<T>(select: (prefs: AppearancePrefs) => T): T {
  const [value, setValue] = useState(select(useAppearancePrefsStore.getState()));
  useEffect(() => {
    const sync = () => setValue(select(useAppearancePrefsStore.getState()));
    sync();
    return useAppearancePrefsStore.subscribe(sync);
  }, []);
  return value;
}

const FONT_PROBE_TEXT = 'mmmmmmmmMMWli1O0@# fjord';
let fontProbeContext: CanvasRenderingContext2D | null | undefined;

function probeContext(): CanvasRenderingContext2D | null {
  if (fontProbeContext === undefined) {
    fontProbeContext = document.createElement('canvas').getContext('2d');
  }
  return fontProbeContext;
}

function probeWidth(fontList: string, text = FONT_PROBE_TEXT): number | null {
  const context = probeContext();
  if (context === null) return null;
  context.font = `16px ${fontList}`;
  return context.measureText(text).width;
}

/** Probes canvas metrics because document.fonts.check() accepts uninstalled families. */
export function isFontFamilyAvailable(family: string): boolean {
  const families = cssFontFamilies(family);
  if (families === null) return false;
  if (/^(system-ui|sans-serif|serif|monospace|ui-monospace)$/i.test(families)) return true;
  try {
    for (const generic of ['monospace', 'serif', 'sans-serif']) {
      const baseline = probeWidth(generic);
      const candidate = probeWidth(`${families}, ${generic}`);
      if (baseline === null || candidate === null) return false;
      if (candidate !== baseline) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const MONOSPACE_PROBE_VARIANTS = ['normal 400', 'normal 700', 'italic 400', 'italic 700'] as const;
const MONOSPACE_PROBE_GLYPHS = ['i', 'M', 'W', '0', '@', '#', '.', ' '] as const;
const MONOSPACE_ADVANCE_TOLERANCE = 0.01;

function areFontAdvancesMonospace(advances: readonly number[]): boolean {
  const reference = advances[0];
  if (
    reference === undefined ||
    reference <= 0 ||
    advances.some((advance) => !Number.isFinite(advance) || advance <= 0)
  ) {
    return true;
  }
  return advances.every((advance) => Math.abs(advance - reference) < MONOSPACE_ADVANCE_TOLERANCE);
}

/** A family is monospace only when every glyph advances the same width in each style. */
export function isMonospaceFamily(family: string): boolean {
  const families = cssFontFamilies(family);
  if (families === null) return true;
  try {
    const context = probeContext();
    if (context === null) return true;
    for (const variant of MONOSPACE_PROBE_VARIANTS) {
      context.font = `${variant} 32px ${families}, monospace`;
      const advances = MONOSPACE_PROBE_GLYPHS.map((glyph) => context.measureText(glyph).width);
      if (!areFontAdvancesMonospace(advances)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

const separateFontsListeners = new Set<() => void>();

/**
 * Whether the prompt, code and terminal fonts are set separately (the Separate fonts switch). Reads as
 * off until the key-value storage has loaded, which is the default anyway.
 */
export function readSeparateFonts(): boolean {
  try {
    return KeyValueStorage.get(kAppearanceSeparateFonts) === 'true';
  } catch {
    return false;
  }
}

export function useSeparateFonts(): boolean {
  const [separate, setSeparate] = useState(readSeparateFonts());
  useEffect(() => {
    const sync = () => setSeparate(readSeparateFonts());
    sync();
    separateFontsListeners.add(sync);
    return () => {
      separateFontsListeners.delete(sync);
    };
  }, []);
  return separate;
}

export async function setSeparateFonts(next: boolean): Promise<void> {
  const saved = KeyValueStorage.set(kAppearanceSeparateFonts, String(next));
  for (const listener of separateFontsListeners) listener();
  await saved;
}

/**
 * The prompt box's font. Simple mode keeps the composer at the interface's type size, as t3code
 * does; separate fonts apply the composer family and the prompt size.
 */
export function usePromptFontStyle(): CSSProperties {
  const separate = useSeparateFonts();
  const family = useAppearancePref((s) => s.fontFamilyComposer);
  const size = useAppearancePref((s) => s.fontSizePrompt);
  if (!separate) return { fontSize: 'var(--text-sm, 0.875rem)' };
  return {
    fontFamily: family.trim() ? appearanceFontStack(family, 'var(--font-sans)') : undefined,
    fontSize: `${size}px`,
  };
}

/**
 * The terminal's family and size. Simple mode shares the code font, as t3code does; separate fonts
 * use the terminal family, falling back to the app's monospace stack when it is empty.
 */
export function useTerminalTypography(): { readonly family: string; readonly size: number } {
  const separate = useSeparateFonts();
  const terminalFamily = useAppearancePref((s) => s.fontFamilyTerminal).trim();
  const terminalSize = useAppearancePref((s) => s.fontSizeTerminal);
  const codeSize = useAppearancePref((s) => s.fontSizeCode);
  const monospace = useMonospaceStack();
  if (!separate) return { family: monospace, size: codeSize };
  return {
    family: terminalFamily ? appearanceFontStack(terminalFamily, monospace) : monospace,
    size: terminalSize,
  };
}

/** t3code's DEFAULT_SANS_FONT_STACK and DEFAULT_CODE_FONT_STACK (appearanceFonts.ts), which theme.ts also uses. */
export const DEFAULT_SANS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif';
// Some engines map `ui-monospace` to a proportional font, so prefer concrete names.
export const DEFAULT_CODE_FONT_STACK = '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * t3code's resolveDefaultFamilyLabel: the first family of a stack that this machine has, named for the "default"
 * entry of a font row. Generic families are skipped (t3code probes them against known faces; on Windows and Linux
 * that finds nothing the stack does not already name).
 */
export function resolveDefaultFamilyLabel(stack: string): string | null {
  for (const raw of stack.split(',')) {
    const family = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (family.length === 0) continue;
    if (/^(system-ui|sans-serif|serif|monospace|ui-monospace|-apple-system|BlinkMacSystemFont)$/i.test(family)) {
      continue;
    }
    if (isFontFamilyAvailable(family)) return family;
  }
  return null;
}
