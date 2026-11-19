// Ported from t3code (apps/web/src/components/settings/AppearanceSettingsPanel.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// The Interface section of t3code's Appearance settings, with its Advanced fold. Titles, descriptions,
// ranges, steps, defaults and labels follow t3code. Each preference is stored through appearance-prefs.ts;
// the features that read it are listed in appearance-prefs.ts.

import {
  AdvancedSettings,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
  SettingsSlider,
} from './appearance-layout';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue, Switch } from './HyperSettingsControls';
import {
  DEFAULT_APPEARANCE_PREFS,
  ENVIRONMENT_IDENTIFICATION_MODES,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
  resetAppearancePrefs,
  updateAppearancePrefs,
  useAppearancePrefsStore,
  type ChatWidth,
  type EffortDisplay,
  type EnvironmentIdentificationMode,
} from './appearance-prefs';
import { HyperPanelAnimationsPreview } from './HyperPanelAnimationsPreview';

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: 'Comfortable',
  wide: 'Wide',
  full: 'Full',
};

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: 'Word',
  bars: 'Bars',
};

// HyperTask has no Dev or Nightly channels, so the channel artwork options are not offered. The
// artwork value is kept as stored and labeled None, as t3code labels it on its Latest channel.
const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: 'None',
  pill: 'Version pill',
};

export function HyperInterfaceSettingsSection() {
  const appearanceContrast = useAppearancePrefsStore((s) => s.appearanceContrast);
  const glassOpacity = useAppearancePrefsStore((s) => s.glassOpacity);
  const chatWidth = useAppearancePrefsStore((s) => s.chatWidth);
  const effortDisplay = useAppearancePrefsStore((s) => s.effortDisplay);
  const mathRenderingEnabled = useAppearancePrefsStore((s) => s.mathRenderingEnabled);
  const panelAnimationDurationMs = useAppearancePrefsStore((s) => s.panelAnimationDurationMs);
  const environmentIdentificationMode = useAppearancePrefsStore((s) => s.environmentIdentificationMode);
  const persistComposerContextStrip = useAppearancePrefsStore((s) => s.persistComposerContextStrip);

  return (
    <SettingsSection id="appearance-interface" title="Interface">
      <SettingsRow
        title="Contrast"
        description="Adjust the contrast of colors and borders across the interface."
        resetAction={
          appearanceContrast !== DEFAULT_APPEARANCE_PREFS.appearanceContrast ? (
            <SettingResetButton label="contrast" onClick={() => void resetAppearancePrefs(['appearanceContrast'])} />
          ) : null
        }
        control={
          <SettingsSlider
            label="Contrast"
            id="appearance-contrast"
            value={appearanceContrast}
            min={MIN_APPEARANCE_CONTRAST}
            max={MAX_APPEARANCE_CONTRAST}
            step={5}
            unit="%"
            onChange={(value) => void updateAppearancePrefs({ appearanceContrast: value })}
          />
        }
      />

      <SettingsRow
        title="Glass opacity"
        description="Higher values make menus, dialogs, and the composer more solid."
        resetAction={
          glassOpacity !== DEFAULT_APPEARANCE_PREFS.glassOpacity ? (
            <SettingResetButton label="glass opacity" onClick={() => void resetAppearancePrefs(['glassOpacity'])} />
          ) : null
        }
        control={
          <SettingsSlider
            label="Glass opacity"
            id="glass-opacity"
            value={glassOpacity}
            min={MIN_GLASS_OPACITY}
            max={MAX_GLASS_OPACITY}
            step={5}
            unit="%"
            onChange={(value) => void updateAppearancePrefs({ glassOpacity: value })}
          />
        }
      />

      <SettingsRow
        title="Chat width"
        description="Set how wide messages and the composer can grow on large screens."
        resetAction={
          chatWidth !== DEFAULT_APPEARANCE_PREFS.chatWidth ? (
            <SettingResetButton label="chat width" onClick={() => void resetAppearancePrefs(['chatWidth'])} />
          ) : null
        }
        control={
          <div className="w-full sm:w-40">
            <Select
              value={chatWidth}
              onValueChange={(value) => {
                if (value === 'comfortable' || value === 'wide' || value === 'full')
                  void updateAppearancePrefs({ chatWidth: value });
              }}
            >
              <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Chat width">
                <SelectValue>{CHAT_WIDTH_LABELS[chatWidth]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="comfortable">Comfortable (default)</SelectItem>
                <SelectItem value="wide">Wide</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="Effort display"
        description="Show reasoning effort in the composer as its name, such as High, or as bars."
        resetAction={
          effortDisplay !== DEFAULT_APPEARANCE_PREFS.effortDisplay ? (
            <SettingResetButton label="effort display" onClick={() => void resetAppearancePrefs(['effortDisplay'])} />
          ) : null
        }
        control={
          <div className="w-full sm:w-40">
            <Select
              value={effortDisplay}
              onValueChange={(value) => {
                if (value === 'bars' || value === 'label') void updateAppearancePrefs({ effortDisplay: value });
              }}
            >
              <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Effort display">
                <SelectValue>{EFFORT_DISPLAY_LABELS[effortDisplay]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="label">Word (default)</SelectItem>
                <SelectItem value="bars">Bars</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="Render math"
        description="Typeset LaTeX math, such as $x^2$ or \[x^2\], in messages and Markdown previews. The composer keeps TeX source editable."
        resetAction={
          mathRenderingEnabled !== DEFAULT_APPEARANCE_PREFS.mathRenderingEnabled ? (
            <SettingResetButton
              label="math rendering"
              onClick={() => void resetAppearancePrefs(['mathRenderingEnabled'])}
            />
          ) : null
        }
        control={
          <Switch
            checked={mathRenderingEnabled}
            onCheckedChange={(checked) =>
              void updateAppearancePrefs({
                mathRenderingEnabled: Boolean(checked),
              })
            }
            aria-label="Render math"
          />
        }
      />

      <AdvancedSettings>
        <SettingsRow
          title="Panel animations"
          description="Set how fast panels open and close."
          resetAction={
            panelAnimationDurationMs !== DEFAULT_APPEARANCE_PREFS.panelAnimationDurationMs ? (
              <SettingResetButton
                label="panel animations"
                onClick={() => void resetAppearancePrefs(['panelAnimationDurationMs'])}
              />
            ) : null
          }
          control={
            <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
              <HyperPanelAnimationsPreview durationMs={panelAnimationDurationMs} />
              <SettingsSlider
                label="Panel animation duration"
                id="panel-animation-duration"
                value={panelAnimationDurationMs}
                min={MIN_PANEL_ANIMATION_DURATION_MS}
                max={MAX_PANEL_ANIMATION_DURATION_MS}
                step={25}
                unit=" ms"
                badgeClassName="min-w-16"
                className=""
                onChange={(value) =>
                  void updateAppearancePrefs({
                    panelAnimationDurationMs: value,
                  })
                }
              />
            </div>
          }
        />

        <SettingsRow
          title="Environment identification"
          description="Show the version pill in the sidebar header."
          resetAction={
            environmentIdentificationMode !== DEFAULT_APPEARANCE_PREFS.environmentIdentificationMode ? (
              <SettingResetButton
                label="environment identification"
                onClick={() => void resetAppearancePrefs(['environmentIdentificationMode'])}
              />
            ) : null
          }
          control={
            <Select
              value={environmentIdentificationMode}
              onValueChange={(value) => {
                if (value === 'artwork' || value === 'pill' || value === 'none')
                  void updateAppearancePrefs({
                    environmentIdentificationMode: value,
                  });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Environment identification">
                <SelectValue>{ENVIRONMENT_IDENTIFICATION_LABELS[environmentIdentificationMode]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {ENVIRONMENT_IDENTIFICATION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {ENVIRONMENT_IDENTIFICATION_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Composer context"
          description="Keep branch and worktree controls below the composer after a thread starts."
          resetAction={
            persistComposerContextStrip !== DEFAULT_APPEARANCE_PREFS.persistComposerContextStrip ? (
              <SettingResetButton
                label="composer context"
                onClick={() => void resetAppearancePrefs(['persistComposerContextStrip'])}
              />
            ) : null
          }
          control={
            <Switch
              checked={persistComposerContextStrip}
              onCheckedChange={(checked) =>
                void updateAppearancePrefs({
                  persistComposerContextStrip: Boolean(checked),
                })
              }
              aria-label="Keep composer context visible in active threads"
            />
          }
        />
      </AdvancedSettings>
    </SettingsSection>
  );
}
