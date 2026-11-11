import { useState } from 'react';
import { runHyperTask } from '@/startup/HyperLauncher';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { SettingsPageProps } from '../page-props';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { FeatureFlag, featureFlagDescription, featureFlags } from './feature-flags';

/** FeatureFlagsPage (widgets/feature_flags/feature_flag_page.dart): debug builds only. */
export function FeatureFlagsPage(_: SettingsPageProps) {
  const flags = [...featureFlags.data().keys()].filter((flag) => flag !== FeatureFlag.unknown);
  return (
    <>
      <SettingsPageHeader title="Feature flags" />
      <SettingsSection><SettingsGroup>
        {flags.map((flag) => <FeatureFlagItem key={flag} flag={flag} />)}
        <SettingsRow label="Restart the app to apply changes" control={
          <Button variant="outline" size="sm" onClick={() => void runHyperTask()}>Restart the app to apply changes</Button>
        } />
      </SettingsGroup></SettingsSection>
    </>
  );
}

/** _FeatureFlagItem: a two-line ListTile (contentPadding 16) with a trailing Switch.adaptive. */
function FeatureFlagItem({ flag }: { flag: FeatureFlag }) {
  const [on, setOn] = useState(() => featureFlags.isOn(flag));
  return (
    <SettingsRow label={flag} description={featureFlagDescription(flag)} control={
      <Switch aria-label={flag} checked={on} onCheckedChange={async (value) => {
        await featureFlags.update(flag, value);
        setOn(featureFlags.isOn(flag));
      }} />
    } />
  );
}
