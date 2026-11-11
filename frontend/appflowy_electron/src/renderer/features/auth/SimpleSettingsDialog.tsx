import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { useTr } from '@/i18n';
import { runHyperTask } from '@/startup/HyperLauncher';
import { showToast } from '@/ui';
import { LanguageDropdown } from '../settings/LanguageDropdown';
import { SelfHostedSettingsView } from '../settings/SelfHostedSettingsView';

/** SimpleSettingsDialog (settings_dialog.dart): the Settings dialog on the sign-in screen. */
export function SimpleSettingsDialog({ close }: { close: () => void }) {
  const { tr } = useTr();
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="hyper-sign-in-settings-title" className="flex max-h-[calc(100vh-3rem)] w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-xl bg-popover p-6 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
      <h2 id="hyper-sign-in-settings-title" className="pb-6 text-xl font-semibold tracking-tight">{tr('signIn.settings')}</h2>
      <SettingsSection>
        <SettingsGroup>
          <SettingsRow label={tr('settings.workspacePage.language.title')} control={<LanguageDropdown />} />
        </SettingsGroup>
      </SettingsSection>
      <SelfHostedSettingsView restartApp={() => {
        close();
        void runHyperTask();
      }} />
      <SettingsSection title={tr('settings.mobile.support')} className="pb-0">
        <SettingsGroup>
          <SettingsRow label={tr('workspace.errorActions.exportLogFiles')} control={
            <Button variant="outline" size="sm" onClick={async () => {
              const zip = await window.appflowy.app.exportLogs();
              if (zip) await window.appflowy.shell.openPath(zip);
              else showToast({ message: tr('noLogFiles'), type: 'error' });
            }}>{tr('settings.files.export')}</Button>
          } />
          <SettingsRow label={tr('settings.files.clearCache')} control={
            <Button variant="outline" size="sm" onClick={async () => {
              await window.appflowy.app.clearCache();
              showToast({ message: tr('settings.manageDataPage.cache.dialog.successHint') });
            }}>{tr('button.clear')}</Button>
          } />
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}
