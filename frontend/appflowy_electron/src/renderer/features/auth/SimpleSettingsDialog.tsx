import { useTr } from '@/i18n';
import { runAppFlowy } from '@/startup/launcher';
import { FlowyDialog, FlowyText, VSpace, showToast } from '@/ui';
import { LanguageDropdown } from '../settings/LanguageDropdown';
import { SelfHostedSettingsView } from '../settings/SelfHostedSettingsView';
import { OutlinedRoundedButton, SettingsCategory } from '../settings/shared';

/** SimpleSettingsDialog (settings_dialog.dart): the Settings dialog on the sign-in screen. */
export function SimpleSettingsDialog({ close }: { close: () => void }) {
  const { tr } = useTr();
  return (
    <FlowyDialog minWidth={564} maxWidth={784}>
      <div style={{ overflowY: 'auto', padding: 24 }}>
        <FlowyText fontSize={36} fontWeight={600}>
          {tr('signIn.settings')}
        </FlowyText>
        <VSpace size={18} />
        <SettingsCategory title={tr('settings.workspacePage.language.title')}>
          <LanguageDropdown />
        </SettingsCategory>
        <VSpace size={22} />
        <SelfHostedSettingsView
          restartApp={() => {
            close();
            void runAppFlowy();
          }}
        />
        <VSpace size={22} />
        <SettingsCategory title={tr('settings.mobile.support')}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <FlowyText style={{ flex: 1 }}>{tr('workspace.errorActions.exportLogFiles')}</FlowyText>
            <OutlinedRoundedButton
              text={tr('settings.files.export')}
              minWidth={78}
              onTap={async () => {
                const zip = await window.appflowy.app.exportLogs();
                if (zip) await window.appflowy.shell.openPath(zip);
                else showToast({ message: tr('noLogFiles'), type: 'error' });
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <FlowyText style={{ flex: 1 }}>{tr('settings.files.clearCache')}</FlowyText>
            <OutlinedRoundedButton
              text={tr('button.clear')}
              onTap={async () => {
                await window.appflowy.app.clearCache();
                showToast({ message: tr('settings.manageDataPage.cache.dialog.successHint') });
              }}
            />
          </div>
        </SettingsCategory>
      </div>
    </FlowyDialog>
  );
}
