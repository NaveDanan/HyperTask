import { HyperColorsAndThemesSection } from './HyperColorsAndThemes';
import { HyperInterfaceSettingsSection } from './HyperInterfaceSettings';
import { HyperTypographySettingsSection } from './HyperTypographySettings';
import { HyperDateTimeSection, HyperDocumentSection, HyperTextAndLanguageSection } from './HyperTextAndDocumentSettings';
import { SettingsPageContainer } from './appearance-layout';

/**
 * The Appearance settings page (formerly the Workspace page), laid out as t3code's AppearanceSettingsPanel: the
 * settings dialog shows its "Settings / Appearance" bar, then Colors & themes, Interface and Typography. The HyperTask
 * settings with no t3code counterpart follow in the same rows. The theme editor (Create, Edit, Duplicate theme) is
 * mounted in App.tsx, as t3code mounts it at its root.
 */
export function HyperAppearancePage() {
  return (
    <SettingsPageContainer>
      <HyperColorsAndThemesSection />
      <HyperInterfaceSettingsSection />
      <HyperTypographySettingsSection />
      <HyperTextAndLanguageSection />
      <HyperDocumentSection />
      <HyperDateTimeSection />
    </SettingsPageContainer>
  );
}
