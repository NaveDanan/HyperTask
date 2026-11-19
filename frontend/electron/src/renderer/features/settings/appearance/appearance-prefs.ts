// Appearance preferences of the Appearance settings page. Ranges, defaults and labels follow
// t3code's ClientSettings (packages/contracts/src/settings.ts). Stored through KeyValueStorage
// as strings, like the other KV preferences, and applied as CSS variables on the document root.
// Copyright (c) 2026 T3 Tools Inc. (MIT), see NOTICE.md in this folder.

import { create } from 'zustand';
import { KeyValueStorage } from '@/startup/kv';

export const MIN_APPEARANCE_CONTRAST = 50;
export const MAX_APPEARANCE_CONTRAST = 200;
export const MIN_GLASS_OPACITY = 40;
export const MAX_GLASS_OPACITY = 100;
export const MIN_PANEL_ANIMATION_DURATION_MS = 0;
export const MAX_PANEL_ANIMATION_DURATION_MS = 400;
export const MIN_INTERFACE_FONT_SIZE = 12;
export const MAX_INTERFACE_FONT_SIZE = 20;
export const MIN_PROMPT_FONT_SIZE = 12;
export const MAX_PROMPT_FONT_SIZE = 20;
export const MIN_CODE_FONT_SIZE = 10;
export const MAX_CODE_FONT_SIZE = 18;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 20;

export const CHAT_WIDTHS = ['comfortable', 'wide', 'full'] as const;
export type ChatWidth = (typeof CHAT_WIDTHS)[number];

export const EFFORT_DISPLAYS = ['label', 'bars'] as const;
export type EffortDisplay = (typeof EFFORT_DISPLAYS)[number];

export const ENVIRONMENT_IDENTIFICATION_MODES = ['artwork', 'nightly-artwork', 'dev-artwork', 'pill', 'none'] as const;
export type EnvironmentIdentificationMode = (typeof ENVIRONMENT_IDENTIFICATION_MODES)[number];

export interface AppearancePrefs {
  appearanceContrast: number;
  glassOpacity: number;
  chatWidth: ChatWidth;
  effortDisplay: EffortDisplay;
  mathRenderingEnabled: boolean;
  panelAnimationDurationMs: number;
  environmentIdentificationMode: EnvironmentIdentificationMode;
  persistComposerContextStrip: boolean;
  fontSizeInterface: number;
  fontSizePrompt: number;
  fontSizeCode: number;
  fontSizeTerminal: number;
  fontFamilyComposer: string;
  fontFamilyTerminal: string;
  wordWrap: boolean;
  fontSmoothing: boolean;
}

export const DEFAULT_APPEARANCE_PREFS: AppearancePrefs = {
  appearanceContrast: 100,
  glassOpacity: 80,
  chatWidth: 'comfortable',
  effortDisplay: 'label',
  mathRenderingEnabled: false,
  panelAnimationDurationMs: 0,
  environmentIdentificationMode: 'artwork',
  persistComposerContextStrip: false,
  fontSizeInterface: 16,
  fontSizePrompt: 14,
  fontSizeCode: 13,
  fontSizeTerminal: 12,
  fontFamilyComposer: '',
  fontFamilyTerminal: '',
  wordWrap: true,
  fontSmoothing: true,
};

const KV_KEYS: Record<keyof AppearancePrefs, string> = {
  appearanceContrast: 'kAppearanceContrast',
  glassOpacity: 'kAppearanceGlassOpacity',
  chatWidth: 'kAppearanceChatWidth',
  effortDisplay: 'kAppearanceEffortDisplay',
  mathRenderingEnabled: 'kAppearanceMathRendering',
  panelAnimationDurationMs: 'kAppearancePanelAnimationDuration',
  environmentIdentificationMode: 'kAppearanceEnvironmentIdentification',
  persistComposerContextStrip: 'kAppearanceComposerContextStrip',
  fontSizeInterface: 'kAppearanceFontSizeInterface',
  fontSizePrompt: 'kAppearanceFontSizePrompt',
  fontSizeCode: 'kAppearanceFontSizeCode',
  fontSizeTerminal: 'kAppearanceFontSizeTerminal',
  fontFamilyComposer: 'kAppearanceFontFamilyComposer',
  fontFamilyTerminal: 'kAppearanceFontFamilyTerminal',
  wordWrap: 'kAppearanceWordWrap',
  fontSmoothing: 'kAppearanceFontSmoothing',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Reads one stored value, falling back to the default for a missing or invalid entry. */
function readPref<K extends keyof AppearancePrefs>(key: K): AppearancePrefs[K] {
  const raw = KeyValueStorage.get(KV_KEYS[key]);
  const fallback = DEFAULT_APPEARANCE_PREFS[key];
  if (raw === null) return fallback;
  switch (key) {
    case 'appearanceContrast':
      return clampedInt(
        raw,
        MIN_APPEARANCE_CONTRAST,
        MAX_APPEARANCE_CONTRAST,
        fallback as number,
      ) as AppearancePrefs[K];
    case 'glassOpacity':
      return clampedInt(raw, MIN_GLASS_OPACITY, MAX_GLASS_OPACITY, fallback as number) as AppearancePrefs[K];
    case 'panelAnimationDurationMs':
      return clampedInt(
        raw,
        MIN_PANEL_ANIMATION_DURATION_MS,
        MAX_PANEL_ANIMATION_DURATION_MS,
        fallback as number,
      ) as AppearancePrefs[K];
    case 'fontSizeInterface':
      return clampedInt(
        raw,
        MIN_INTERFACE_FONT_SIZE,
        MAX_INTERFACE_FONT_SIZE,
        fallback as number,
      ) as AppearancePrefs[K];
    case 'fontSizePrompt':
      return clampedInt(raw, MIN_PROMPT_FONT_SIZE, MAX_PROMPT_FONT_SIZE, fallback as number) as AppearancePrefs[K];
    case 'fontSizeCode':
      return clampedInt(raw, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE, fallback as number) as AppearancePrefs[K];
    case 'fontSizeTerminal':
      return clampedInt(raw, MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE, fallback as number) as AppearancePrefs[K];
    case 'chatWidth':
      return (CHAT_WIDTHS as readonly string[]).includes(raw) ? (raw as AppearancePrefs[K]) : fallback;
    case 'effortDisplay':
      return (EFFORT_DISPLAYS as readonly string[]).includes(raw) ? (raw as AppearancePrefs[K]) : fallback;
    case 'environmentIdentificationMode':
      return (ENVIRONMENT_IDENTIFICATION_MODES as readonly string[]).includes(raw)
        ? (raw as AppearancePrefs[K])
        : fallback;
    case 'fontFamilyComposer':
    case 'fontFamilyTerminal':
      return raw as AppearancePrefs[K];
    default:
      return (raw === 'true' ? true : raw === 'false' ? false : fallback) as AppearancePrefs[K];
  }
}

function clampedInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) ? clamp(value, min, max) : fallback;
}

export const useAppearancePrefsStore = create<AppearancePrefs>(() => ({ ...DEFAULT_APPEARANCE_PREFS }));

/** Reads every stored preference. Call after loadKeyValueStorage(), as loadAppearance() does. */
export function loadAppearancePrefs(): void {
  const prefs = {} as AppearancePrefs;
  for (const key of Object.keys(KV_KEYS) as Array<keyof AppearancePrefs>) {
    (prefs as Record<keyof AppearancePrefs, unknown>)[key] = readPref(key);
  }
  useAppearancePrefsStore.setState(prefs);
}

/** Updates the given preferences, clamped to their ranges, and stores each one. */
export async function updateAppearancePrefs(patch: Partial<AppearancePrefs>): Promise<void> {
  const next: Partial<AppearancePrefs> = {};
  for (const key of Object.keys(patch) as Array<keyof AppearancePrefs>) {
    (next as Record<keyof AppearancePrefs, unknown>)[key] = patch[key];
  }
  useAppearancePrefsStore.setState(next);
  await Promise.all(
    (Object.keys(next) as Array<keyof AppearancePrefs>).map((key) =>
      KeyValueStorage.set(KV_KEYS[key], String(next[key])),
    ),
  );
}

/** Resets every preference listed to its default. */
export async function resetAppearancePrefs(keys: Array<keyof AppearancePrefs>): Promise<void> {
  const patch = {} as Partial<AppearancePrefs>;
  for (const key of keys) (patch as Record<keyof AppearancePrefs, unknown>)[key] = DEFAULT_APPEARANCE_PREFS[key];
  await updateAppearancePrefs(patch);
}

/** Writes the CSS variables and attributes that the preferences drive, on the document root. */
export function applyAppearancePrefs(prefs: AppearancePrefs = useAppearancePrefsStore.getState()): void {
  const root = document.documentElement;
  const contrast = prefs.appearanceContrast;
  root.style.setProperty('--appearance-contrast-base', `${Math.min(contrast, 100)}%`);
  root.style.setProperty('--appearance-contrast-boost', `${Math.max(contrast - 100, 0)}%`);
  root.style.setProperty('--appearance-contrast-border-boost', `${Math.max(contrast - 100, 0) / 4}%`);
  root.style.setProperty('--glass-opacity', `${prefs.glassOpacity}%`);
  root.style.setProperty('--panel-animation-duration', `${prefs.panelAnimationDurationMs}ms`);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.dataset.panelAnimations = String(prefs.panelAnimationDurationMs > 0 && !reducedMotion);
  root.style.setProperty('--font-size-interface', `${prefs.fontSizeInterface}px`);
  root.style.setProperty('--font-size-prompt', `${prefs.fontSizePrompt}px`);
  root.style.setProperty('--font-size-code', `${prefs.fontSizeCode}px`);
  root.style.setProperty('--font-size-terminal', `${prefs.fontSizeTerminal}px`);
  root.dataset.fontSmoothing = String(prefs.fontSmoothing);
  // Chat width values from t3code's index.css. The OpenBot message column reads this variable.
  root.style.setProperty(
    '--chat-content-max-width',
    { comfortable: '46rem', wide: '72rem', full: '100%' }[prefs.chatWidth],
  );
}

let applyScheduled = false;
useAppearancePrefsStore.subscribe(() => {
  if (applyScheduled) return;
  applyScheduled = true;
  queueMicrotask(() => {
    applyScheduled = false;
    applyAppearancePrefs();
  });
});
