// Ported from t3code (apps/web/src/components/settings/TypographySettings.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// The Typography section of the Appearance page. Every t3code row is here; the font, size and smoothing
// values live in appearance-prefs.ts and the theme store, and the rules that apply them are in
// styles/appearance-typography.css and in the composer, terminal and markdown code blocks.

import type { ReactNode } from 'react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { appearanceActions, useAppearanceStore } from '@/theme/appearance-store';
import { AdvancedSettings, SettingResetButton, SettingsRow, SettingsSection } from './appearance-layout';
import { Input, Select, SelectItem, SelectPopup, SelectTrigger, SelectValue, Switch } from './HyperSettingsControls';
import {
  DEFAULT_APPEARANCE_PREFS,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  resetAppearancePrefs,
  updateAppearancePrefs,
  useAppearancePrefsStore,
} from './appearance-prefs';
import { CodeFontPreview, PromptFontPreview, TerminalFontPreview } from './HyperFontPreviews';
import { discoverInstalledFonts, HyperFontFamilyPicker, useFontEnumeration } from './HyperFontFamilyPicker';
import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
  resolveDefaultFamilyLabel,
  appearanceFontStack,
  isFontFamilyAvailable,
  isMonospaceFamily,
  monospaceStack,
  setSeparateFonts,
  useSeparateFonts,
} from './font-families';

let fontDefaultFamilies: { readonly sans: string; readonly code: string } | undefined;

/** t3code's resolveFontDefaultFamilies: the names shown for an empty family, cached once the fonts have loaded. */
function resolveFontDefaultFamilies() {
  if (fontDefaultFamilies !== undefined) return fontDefaultFamilies;
  const families = {
    sans: resolveDefaultFamilyLabel(DEFAULT_SANS_FONT_STACK) ?? 'System default',
    code: resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK) ?? 'System monospace',
  };
  if (document.fonts.status === 'loaded') fontDefaultFamilies = families;
  return families;
}

/** t3code's isMacPlatform: the platform names a Mac or an Apple mobile device. */
function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function InterfaceFontRow({ preview }: { preview?: ReactNode }) {
  const font = useAppearanceStore((s) => s.appearance.font);
  const size = useAppearancePrefsStore((s) => s.fontSizeInterface);
  return (
    <FontFamilySettingsRow
      title="Interface font"
      description="Everything outside code blocks and the terminal."
      defaultFamily={resolveFontDefaultFamilies().sans}
      defaultValue={''}
      value={font}
      onValueChange={(next) => void appearanceActions.setFontFamily(next)}
      onReset={() => {
        void appearanceActions.resetFontFamily();
        void resetAppearancePrefs(['fontSizeInterface']);
      }}
      size={{
        label: 'Interface font size',
        min: MIN_INTERFACE_FONT_SIZE,
        max: MAX_INTERFACE_FONT_SIZE,
        value: size,
        defaultValue: DEFAULT_APPEARANCE_PREFS.fontSizeInterface,
        onChange: (fontSizeInterface) => void updateAppearancePrefs({ fontSizeInterface }),
      }}
      preview={preview}
    />
  );
}

function PromptFontRow() {
  const font = useAppearancePrefsStore((s) => s.fontFamilyComposer);
  const size = useAppearancePrefsStore((s) => s.fontSizePrompt);
  const interfaceFamily = useAppearanceStore((s) => s.appearance.font).trim() || resolveFontDefaultFamilies().sans;
  return (
    <FontFamilySettingsRow
      title="Prompt font"
      description="Only the box you write prompts in. Mono works well here."
      defaultFamily={interfaceFamily}
      defaultValue={DEFAULT_APPEARANCE_PREFS.fontFamilyComposer}
      value={font}
      onValueChange={(fontFamilyComposer) => void updateAppearancePrefs({ fontFamilyComposer })}
      onReset={() => void resetAppearancePrefs(['fontFamilyComposer', 'fontSizePrompt'])}
      size={{
        label: 'Prompt font size',
        min: MIN_PROMPT_FONT_SIZE,
        max: MAX_PROMPT_FONT_SIZE,
        value: size,
        defaultValue: DEFAULT_APPEARANCE_PREFS.fontSizePrompt,
        onChange: (fontSizePrompt) => void updateAppearancePrefs({ fontSizePrompt }),
      }}
      preview={<PromptFontPreview />}
    />
  );
}

function CodeFontRow({
  title = 'Code font',
  description = 'Code blocks, diffs, and file previews.',
  preview,
}: {
  title?: string;
  description?: string;
  preview?: ReactNode;
}) {
  const font = useAppearanceStore((s) => s.appearance.monospaceFont);
  const size = useAppearancePrefsStore((s) => s.fontSizeCode);
  return (
    <FontFamilySettingsRow
      title={title}
      description={description}
      defaultFamily={resolveFontDefaultFamilies().code}
      defaultValue={''}
      value={font}
      onValueChange={(next) => void appearanceActions.setMonospaceFont(next)}
      onReset={() => {
        void appearanceActions.setMonospaceFont('');
        void resetAppearancePrefs(['fontSizeCode']);
      }}
      requireMonospace
      size={{
        label: 'Code font size',
        min: MIN_CODE_FONT_SIZE,
        max: MAX_CODE_FONT_SIZE,
        value: size,
        defaultValue: DEFAULT_APPEARANCE_PREFS.fontSizeCode,
        onChange: (fontSizeCode) => void updateAppearancePrefs({ fontSizeCode }),
      }}
      preview={preview ?? <CodeFontPreview />}
    />
  );
}

function TerminalFontRow() {
  const font = useAppearancePrefsStore((s) => s.fontFamilyTerminal);
  const size = useAppearancePrefsStore((s) => s.fontSizeTerminal);
  return (
    <FontFamilySettingsRow
      title="Terminal font"
      description="Terminal output, independent from code blocks and diffs."
      defaultFamily={resolveFontDefaultFamilies().code}
      defaultValue={DEFAULT_APPEARANCE_PREFS.fontFamilyTerminal}
      value={font}
      onValueChange={(fontFamilyTerminal) => void updateAppearancePrefs({ fontFamilyTerminal })}
      onReset={() => void resetAppearancePrefs(['fontFamilyTerminal', 'fontSizeTerminal'])}
      requireMonospace
      size={{
        label: 'Terminal font size',
        min: MIN_TERMINAL_FONT_SIZE,
        max: MAX_TERMINAL_FONT_SIZE,
        value: size,
        defaultValue: DEFAULT_APPEARANCE_PREFS.fontSizeTerminal,
        onChange: (fontSizeTerminal) => void updateAppearancePrefs({ fontSizeTerminal }),
      }}
      preview={<TerminalFontPreview family={appearanceFontStack(font.trim(), monospaceStack())} size={size} />}
    />
  );
}

function FontSettingsGroup() {
  return (
    <>
      <InterfaceFontRow />
      <PromptFontRow />
      <CodeFontRow />
      <TerminalFontRow />
    </>
  );
}

function SimpleFontRows() {
  const codeFont = useAppearanceStore((s) => s.appearance.monospaceFont);
  const codeSize = useAppearancePrefsStore((s) => s.fontSizeCode);
  return (
    <>
      <InterfaceFontRow preview={<PromptFontPreview />} />
      <CodeFontRow
        title="Monospace font"
        description="Code blocks, diffs, file previews, and the terminal."
        preview={
          <>
            <CodeFontPreview />
            <TerminalFontPreview family={appearanceFontStack(codeFont.trim(), monospaceStack())} size={codeSize} />
          </>
        }
      />
    </>
  );
}

function SeparateFontsRow({
  checked,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingsRow
      title="Separate fonts"
      description="Set the prompt, code, and terminal fonts separately instead of one monospace font."
      control={
        <Switch
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(Boolean(next))}
          aria-label="Separate fonts"
        />
      }
    />
  );
}

function WordWrapRow() {
  const wordWrap = useAppearancePrefsStore((s) => s.wordWrap);
  return (
    <SettingsRow
      title="Word wrap"
      description="Wrap long lines in code blocks, diffs, and file previews by default."
      resetAction={
        wordWrap !== DEFAULT_APPEARANCE_PREFS.wordWrap ? (
          <SettingResetButton label="word wrapping" onClick={() => void resetAppearancePrefs(['wordWrap'])} />
        ) : null
      }
      control={
        <Switch
          checked={wordWrap}
          onCheckedChange={(checked) => void updateAppearancePrefs({ wordWrap: Boolean(checked) })}
          aria-label="Wrap code, diffs, and file previews by default"
        />
      }
    />
  );
}

function FontSmoothingRow() {
  const smoothing = useAppearancePrefsStore((s) => s.fontSmoothing);
  if (!isMacPlatform(navigator.platform)) return null;
  return (
    <SettingsRow
      title="Font smoothing"
      description="Use thinner grayscale text smoothing instead of the macOS default."
      resetAction={
        smoothing !== DEFAULT_APPEARANCE_PREFS.fontSmoothing ? (
          <SettingResetButton label="font smoothing" onClick={() => void resetAppearancePrefs(['fontSmoothing'])} />
        ) : null
      }
      control={
        <Switch
          checked={smoothing}
          onCheckedChange={(checked) => void updateAppearancePrefs({ fontSmoothing: Boolean(checked) })}
          aria-label="Font smoothing"
        />
      }
    />
  );
}

export function HyperTypographySettingsSection() {
  const separate = useSeparateFonts();
  return (
    <SettingsSection id="typography" title="Typography">
      {separate ? <FontSettingsGroup /> : <SimpleFontRows />}
      <WordWrapRow />
      <AdvancedSettings>
        <SeparateFontsRow checked={separate} onCheckedChange={(next) => void setSeparateFonts(next)} />
        <FontSmoothingRow />
      </AdvancedSettings>
    </SettingsSection>
  );
}

interface FontFamilyRowProps {
  readonly title: string;
  readonly description: string;
  readonly defaultFamily: string;
  readonly defaultValue: string;
  readonly preview?: ReactNode;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onReset: () => void;
  readonly requireMonospace?: boolean;
  readonly size: {
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly value: number;
    readonly defaultValue: number;
    readonly onChange: (v: number) => void;
  };
}

/** One font row: a family picker or text field, a size select, and the preview below. */
function FontFamilySettingsRow({
  title,
  description,
  defaultFamily,
  defaultValue,
  preview,
  value,
  onValueChange,
  onReset,
  requireMonospace = false,
  size,
}: FontFamilyRowProps) {
  const trimmed = value.trim();
  const [draft, setDraft] = useState(value);
  const [draftSettled, setDraftSettled] = useState(true);
  // Each pending commit remembers the value it was typed against, so one that outlives
  // an external change (hydration, reset, picker selection) drops its stale draft.
  const commitTimerRef = useRef<{
    readonly id: number;
    readonly value: string;
  } | null>(null);
  const cancelPendingCommit = () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current.id);
    commitTimerRef.current = null;
  };
  // Bumped on every external value change, so a pending commit typed before one never lands,
  // even if the value has since changed back to what it was typed against.
  const [adopted, setAdopted] = useState({ value, generation: 0 });
  if (adopted.value !== value) {
    setAdopted({ value, generation: adopted.generation + 1 });
    setDraft(value);
    setDraftSettled(true);
  }
  const readAdoptedGeneration = useEffectEvent(() => adopted.generation);
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current.id);
    },
    [],
  );
  const acceptsFamily = (candidate: string) =>
    isFontFamilyAvailable(candidate) && (!requireMonospace || isMonospaceFamily(candidate));
  const commitDraft = (next: string) => {
    setDraftSettled(true);
    if (next.trim().length === 0 || acceptsFamily(next)) {
      onValueChange(next);
    }
  };
  const flushDraft = () => {
    const pending = commitTimerRef.current;
    cancelPendingCommit();
    if (pending !== null && pending.value === value) commitDraft(draft);
  };
  const draftTrimmed = draft.trim();
  const draftPending = draftSettled && draftTrimmed.length > 0 && draftTrimmed !== trimmed;
  const resetToDefault = () => {
    cancelPendingCommit();
    setDraft(defaultValue);
    setDraftSettled(true);
    onReset();
  };
  const resetAction =
    value !== defaultValue || size.value !== size.defaultValue ? (
      <SettingResetButton label={title.toLowerCase()} onClick={resetToDefault} />
    ) : null;
  const fontEnumeration = useFontEnumeration();
  const [inputFocused, setInputFocused] = useState(false);
  const familyControl =
    fontEnumeration.status === 'granted' ? (
      <HyperFontFamilyPicker
        ariaLabel={`${title} family`}
        defaultFamily={defaultFamily}
        selectedFamily={trimmed}
        requireMonospace={requireMonospace}
        initialOpen={inputFocused}
        onSelect={onValueChange}
      />
    ) : (
      <Input
        size="sm"
        aria-label={`${title} family`}
        aria-invalid={draftPending || undefined}
        autoCapitalize="off"
        autoComplete="off"
        className="min-w-0 flex-1"
        maxLength={200}
        onFocus={() => {
          setInputFocused(true);
          discoverInstalledFonts();
        }}
        onBlur={() => {
          setInputFocused(false);
          flushDraft();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          setDraftSettled(false);
          cancelPendingCommit();
          const typedAgainst = value;
          const typedInGeneration = adopted.generation;
          commitTimerRef.current = {
            id: window.setTimeout(() => {
              commitTimerRef.current = null;
              if (readAdoptedGeneration() === typedInGeneration) commitDraft(next);
            }, 400),
            value: typedAgainst,
          };
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') flushDraft();
          if (event.key === 'Escape') {
            // Discard uncommitted typing without closing the settings page,
            // which is what an unhandled Escape does.
            event.preventDefault();
            event.stopPropagation();
            cancelPendingCommit();
            setDraft(value);
            setDraftSettled(true);
          }
        }}
        placeholder={defaultFamily}
        spellCheck={false}
        value={draft}
      />
    );
  const control = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto @min-[32rem]/settings-row:flex-nowrap">
      <div className="min-w-36 flex-1 sm:w-44 sm:flex-none">{familyControl}</div>
      <Select
        value={String(size.value)}
        onValueChange={(next) => {
          if (typeof next !== 'string') return;
          const parsed = Number(next);
          if (Number.isInteger(parsed) && parsed >= size.min && parsed <= size.max) {
            size.onChange(parsed);
          }
        }}
      >
        <SelectTrigger size="sm" className="w-22 shrink-0" aria-label={size.label}>
          <SelectValue>{`${size.value} px`}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {Array.from({ length: size.max - size.min + 1 }, (_, index) => size.min + index).map((px) => (
            <SelectItem key={px} value={String(px)}>
              {px} px
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
  return (
    <SettingsRow title={title} description={description} resetAction={resetAction} control={control}>
      {preview}
    </SettingsRow>
  );
}
