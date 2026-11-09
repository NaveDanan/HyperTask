import { useState } from 'react';
import { runAppFlowy } from '@/startup/launcher';
import { FlowyText, FlowyTextButton } from '@/ui';
import { MdSwitch } from '../material';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody } from '../shared';
import { FeatureFlag, featureFlagDescription, featureFlags } from './feature-flags';

/** Material Divider (height 16, hairline in the theme divider color). */
const Divider = () => (
  <div style={{ height: 16, display: 'flex', alignItems: 'center' }}>
    <div style={{ height: 1, flex: 1, background: 'var(--th-divider)', transform: 'scaleY(0.5)' }} />
  </div>
);

/** FeatureFlagsPage (widgets/feature_flags/feature_flag_page.dart): debug builds only. */
export function FeatureFlagsPage(_: SettingsPageProps) {
  const flags = [...featureFlags.data().keys()].filter((flag) => flag !== FeatureFlag.unknown);
  return (
    <SettingsBody title="Feature flags">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {flags.map((flag, index) => (
          <div key={flag}>
            {index > 0 && <Divider />}
            <FeatureFlagItem flag={flag} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        <FlowyTextButton
          text="Restart the app to apply changes"
          fontSize={16}
          fontColor="#F44336"
          padding="12px 16px"
          onPressed={() => void runAppFlowy()}
        />
      </div>
    </SettingsBody>
  );
}

/** _FeatureFlagItem: a two-line ListTile (contentPadding 16) with a trailing Switch.adaptive. */
function FeatureFlagItem({ flag }: { flag: FeatureFlag }) {
  const [on, setOn] = useState(() => featureFlags.isOn(flag));
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 72, padding: '0 16px', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <FlowyText fontSize={16}>{flag}</FlowyText>
        <FlowyText.small maxLines={3}>{featureFlagDescription(flag)}</FlowyText.small>
      </div>
      <MdSwitch
        value={on}
        onChanged={async (value) => {
          await featureFlags.update(flag, value);
          setOn(featureFlags.isOn(flag));
        }}
      />
    </div>
  );
}
