// Ported from t3code (apps/web/src/components/settings/AppearanceSettingsPanel.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// The "Colors & themes" section of t3code's Appearance page: the appearance mode tiles and the theme library.

import { useState } from 'react';
import { SettingsSection } from './appearance-layout';
import { ThemeLibrary } from './HyperThemeSettings';
import { useCustomThemes, useTheme } from './useHyperTheme';

export function HyperColorsAndThemesSection() {
  const { appearanceMode, refreshTheme, resolvedTheme, setAppearanceMode, setTheme, setThemeHalf, theme, themeHalves } =
    useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);

  return (
    <SettingsSection id="appearance" title="Colors & themes" variant="plain" hideTitle>
      <div id="theme">
        <ThemeLibrary
          appearanceMode={appearanceMode}
          customThemes={customThemes}
          initialAppearance={resolvedTheme}
          refreshTheme={refreshTheme}
          isImportOpen={isImportThemeOpen}
          setAppearanceMode={setAppearanceMode}
          setTheme={setTheme}
          setThemeHalf={setThemeHalf}
          theme={theme}
          themeHalves={themeHalves}
          onImportOpenChange={setIsImportThemeOpen}
        />
      </div>
    </SettingsSection>
  );
}
